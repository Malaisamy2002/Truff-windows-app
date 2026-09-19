// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  useTabSummaries,
  type CustomerTab,
  type TabEntry,
  type TabSummary,
} from "./tabs";

// React only flushes effects/state inside act() when this flag is set.
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const KEY = "p:9876543210";

const tab = (): CustomerTab => ({
  id: "t1",
  customer_key: KEY,
  customer_name: "Ravi",
  phone: "9876543210",
  status: "open",
  opened_at: "2026-09-01T00:00:00.000Z",
  closed_at: null,
  created_at: "2026-09-01T00:00:00.000Z",
});

const entry = (
  id: string,
  kind: "charge" | "payment",
  amount: number,
): TabEntry =>
  ({
    id,
    tab_id: "t1",
    customer_key: KEY,
    kind,
    business: "Turf",
    amount,
    note: null,
    ref_type: null,
    ref_id: null,
    source_ref_type: null,
    source_ref_id: null,
    entry_date: "2026-09-01",
    created_at: "2026-09-01T00:00:00.000Z",
  }) as TabEntry;

function setup() {
  // staleTime: Infinity + seeded data => react-query never calls the Dexie
  // queryFn (there is no IndexedDB in this test environment).
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(["customer_tabs"], [tab()]);
  client.setQueryData(
    ["tab_entries"],
    [entry("e1", "charge", 100), entry("e2", "payment", 30)],
  );

  const seen: Map<string, TabSummary>[] = [];
  let bump: () => void = () => {};
  function Probe() {
    const [, setN] = useState(0);
    bump = () => setN((n) => n + 1);
    seen.push(useTabSummaries());
    return null;
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    );
  });
  return { client, seen, bump: () => act(() => bump()), root };
}

describe("useTabSummaries()", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("computes the running balance per customer key", () => {
    const { seen, root } = setup();
    cleanup = () => act(() => root.unmount());
    const summary = seen.at(-1)!.get(KEY)!;
    expect(summary.charged).toBe(100);
    expect(summary.paid).toBe(30);
    expect(summary.balance).toBe(70);
    expect(summary.entries).toHaveLength(2);
  });

  it("returns the SAME Map across unrelated re-renders", () => {
    const { seen, bump, root } = setup();
    cleanup = () => act(() => root.unmount());
    bump();
    bump();
    bump();
    expect(seen.length).toBeGreaterThanOrEqual(4);
    // Every render — initial and the forced ones — saw one identical Map, so
    // downstream useMemo([tabSummaries]) hooks no longer re-run per keystroke.
    expect(new Set(seen).size).toBe(1);
  });

  it("returns a NEW Map (with fresh totals) when the ledger changes", async () => {
    const { client, seen, root } = setup();
    cleanup = () => act(() => root.unmount());
    const before = seen.at(-1)!;
    // react-query notifies observers asynchronously, so flush with async act().
    await act(async () => {
      client.setQueryData(
        ["tab_entries"],
        [
          entry("e1", "charge", 100),
          entry("e2", "payment", 30),
          entry("e3", "charge", 50),
        ],
      );
      // notifyManager batches observer notifications on a macrotask.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const after = seen.at(-1)!;
    expect(after).not.toBe(before);
    expect(after.get(KEY)!.balance).toBe(120);
    // The earlier snapshot is untouched (no shared mutation).
    expect(before.get(KEY)!.balance).toBe(70);
  });
});
