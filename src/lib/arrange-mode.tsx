import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Ctx, FramedCtx, type Drag } from "@/lib/arrange-mode-context";

/**
 * "Arrange mode" — the app itself becomes the layout editor.
 *
 * When it is on, every arrangeable card and row keeps rendering its real
 * content but gains a frame with its name, drag handle, arrows and on/off
 * switch. Hidden blocks stay on screen (faded) so they can be switched back on
 * where they actually live. This replaced the old grey-box mock-up dialog.
 *
 * The contexts and hooks (`useArrangeMode`, `useAlreadyFramed`) live in
 * `arrange-mode-context.ts` — this file holds only the provider components.
 */

export function ArrangeModeProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<Drag>(null);

  const startDrag = useCallback(
    (scope: string, id: string) => setDrag({ scope, id }),
    [],
  );
  // Drag-over fires continuously. Avoid changing context state when the
  // pointer remains over the same frame, so the entire arranged page does
  // not re-render for duplicate browser drag events.
  const hover = useCallback(
    (scope: string, id: string) =>
      setOver((current) =>
        current?.scope === scope && current.id === id ? current : { scope, id },
      ),
    [],
  );
  const endDrag = useCallback(() => {
    setDrag(null);
    setOver(null);
  }, []);

  const value = useMemo(
    () => ({
      on,
      setOn,
      interactive,
      setInteractive,
      drag,
      over,
      startDrag,
      hover,
      endDrag,
    }),
    [on, interactive, drag, over, startDrag, hover, endDrag],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function FramedProvider({ children }: { children: ReactNode }) {
  return <FramedCtx.Provider value={true}>{children}</FramedCtx.Provider>;
}

/** Wrappers that draw frames for their own children reset this flag. */
export function UnframedProvider({ children }: { children: ReactNode }) {
  return <FramedCtx.Provider value={false}>{children}</FramedCtx.Provider>;
}
