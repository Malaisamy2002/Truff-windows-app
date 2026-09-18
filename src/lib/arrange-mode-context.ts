import { createContext, useContext } from "react";

/**
 * "Arrange mode" — the app itself becomes the layout editor. See
 * `arrange-mode.tsx` (the provider components) for the full picture; this
 * file holds only the contexts and hooks so consumers of `useArrangeMode`
 * / `useAlreadyFramed` don't need to pull in the provider components too.
 */

export type Drag = { scope: string; id: string } | null;

export type ArrangeCtx = {
  on: boolean;
  setOn: (v: boolean) => void;
  /** When true, the real content stays tappable (needed to open pop-ups). */
  interactive: boolean;
  setInteractive: (v: boolean) => void;
  drag: Drag;
  over: Drag;
  startDrag: (scope: string, id: string) => void;
  hover: (scope: string, id: string) => void;
  endDrag: () => void;
};

export const Ctx = createContext<ArrangeCtx>({
  on: false,
  setOn: () => {},
  interactive: false,
  setInteractive: () => {},
  drag: null,
  over: null,
  startDrag: () => {},
  hover: () => {},
  endDrag: () => {},
});

export function useArrangeMode() {
  return useContext(Ctx);
}

/**
 * True when a parent wrapper already drew the frame for this block, so nested
 * helpers (a standalone `<LayoutPart>` inside `<LayoutParts>`) don't double up.
 */
export const FramedCtx = createContext(false);

export function useAlreadyFramed() {
  return useContext(FramedCtx);
}
