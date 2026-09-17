import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * "Arrange mode" — the app itself becomes the layout editor.
 *
 * When it is on, every arrangeable card and row keeps rendering its real
 * content but gains a frame with its name, drag handle, arrows and on/off
 * switch. Hidden blocks stay on screen (faded) so they can be switched back on
 * where they actually live. This replaced the old grey-box mock-up dialog.
 */

type Drag = { scope: string; id: string } | null;

type ArrangeCtx = {
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

const Ctx = createContext<ArrangeCtx>({
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

export function useArrangeMode() {
  return useContext(Ctx);
}

/**
 * True when a parent wrapper already drew the frame for this block, so nested
 * helpers (a standalone `<LayoutPart>` inside `<LayoutParts>`) don't double up.
 */
const FramedCtx = createContext(false);

export function FramedProvider({ children }: { children: ReactNode }) {
  return <FramedCtx.Provider value={true}>{children}</FramedCtx.Provider>;
}

/** Wrappers that draw frames for their own children reset this flag. */
export function UnframedProvider({ children }: { children: ReactNode }) {
  return <FramedCtx.Provider value={false}>{children}</FramedCtx.Provider>;
}

export function useAlreadyFramed() {
  return useContext(FramedCtx);
}
