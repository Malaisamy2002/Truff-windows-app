import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

async function importFresh() {
  vi.resetModules();
  return import("./printers");
}

describe("listAvailablePrinters()", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns the printer names reported by the native command", async () => {
    invokeMock.mockResolvedValue(["Office HP LaserJet", "Thermal 80mm POS"]);
    const { listAvailablePrinters } = await importFresh();
    expect(await listAvailablePrinters()).toEqual([
      "Office HP LaserJet",
      "Thermal 80mm POS",
    ]);
    expect(invokeMock).toHaveBeenCalledWith("list_printers", undefined);
  });

  it("drops blank names", async () => {
    invokeMock.mockResolvedValue(["Real Printer", "", "   "]);
    const { listAvailablePrinters } = await importFresh();
    expect(await listAvailablePrinters()).toEqual(["Real Printer"]);
  });

  it("resolves to an empty list instead of throwing when the command is unavailable", async () => {
    invokeMock.mockRejectedValue(new Error("command not found"));
    const { listAvailablePrinters } = await importFresh();
    await expect(listAvailablePrinters()).resolves.toEqual([]);
  });

  it("resolves to an empty list for a malformed (non-array) result", async () => {
    invokeMock.mockResolvedValue("not-an-array");
    const { listAvailablePrinters } = await importFresh();
    await expect(listAvailablePrinters()).resolves.toEqual([]);
  });
});

describe("printFileToPrinter()", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the native command with the path and printer", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { printFileToPrinter } = await importFresh();
    await printFileToPrinter("C:\\Invoices\\bill.pdf", "Office HP LaserJet");
    expect(invokeMock).toHaveBeenCalledWith("print_file_to_printer", {
      path: "C:\\Invoices\\bill.pdf",
      printer: "Office HP LaserJet",
    });
  });

  it("rejects locally, without calling the native command, when no printer is chosen", async () => {
    const { printFileToPrinter } = await importFresh();
    await expect(
      printFileToPrinter("C:\\Invoices\\bill.pdf", ""),
    ).rejects.toThrow(/no printer selected/i);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("propagates a descriptive error when the native command fails", async () => {
    invokeMock.mockRejectedValue(new Error("Silent print failed: offline"));
    const { printFileToPrinter } = await importFresh();
    await expect(
      printFileToPrinter("C:\\Invoices\\bill.pdf", "Office HP LaserJet"),
    ).rejects.toThrow(/offline/);
  });
});
