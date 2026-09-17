import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
} from "lucide-react";
import { FramedProvider, useArrangeMode } from "@/lib/arrange-mode";
import {
  LOCKED_SECTION_ID,
  movePart,
  moveSection,
  moveSurfacePart,
  orderedParts,
  orderedSections,
  orderedSurfaceParts,
  partLabel,
  sectionLabel,
  setPartVisible,
  setSectionVisible,
  setSurfacePartVisible,
  useLayoutPrefs,
} from "@/lib/layout-prefs";
import { partDef } from "@/lib/layout-parts";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* The frame itself                                                    */
/* ------------------------------------------------------------------ */

type FrameProps = {
  id: string;
  scope: string;
  label: string;
  visible: boolean;
  locked?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  tight?: boolean;
  onMove: (dir: -1 | 1) => void;
  onToggle: () => void;
  onDropFrom: (fromId: string) => void;
  children: ReactNode;
};

function ArrangeFrame({
  id,
  scope,
  label,
  visible,
  locked,
  canMoveUp,
  canMoveDown,
  tight,
  onMove,
  onToggle,
  onDropFrom,
  children,
}: FrameProps) {
  const { drag, over, startDrag, hover, endDrag, interactive } =
    useArrangeMode();
  const isDragging = drag?.scope === scope && drag.id === id;
  const isOver =
    over?.scope === scope &&
    over.id === id &&
    !isDragging &&
    drag?.scope === scope;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        startDrag(scope, id);
      }}
      onDragOver={(e) => {
        if (drag?.scope !== scope) return;
        e.preventDefault();
        e.stopPropagation();
        hover(scope, id);
      }}
      onDrop={(e) => {
        if (drag?.scope !== scope) return;
        e.preventDefault();
        e.stopPropagation();
        if (drag && drag.id !== id) onDropFrom(drag.id);
        endDrag();
      }}
      onDragEnd={endDrag}
      className={cn(
        "pointer-events-auto relative rounded-xl border-2 border-dashed border-primary/35 bg-primary/[0.03] transition-all",
        tight ? "p-1" : "p-1.5",
        isDragging && "opacity-40",
        isOver && "border-primary bg-primary/10 ring-2 ring-primary/25",
        !visible && "border-muted-foreground/30 bg-muted/25",
      )}
    >
      <div className="flex items-center gap-1 px-1 pb-1">
        <GripVertical
          className="h-3.5 w-3.5 shrink-0 cursor-grab text-primary/70"
          aria-hidden
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide",
            visible ? "text-primary/80" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {!visible && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[9px] font-semibold uppercase text-muted-foreground">
            Off
          </span>
        )}
        <button
          type="button"
          aria-label={`Move ${label} up`}
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          className="shrink-0 rounded p-0.5 text-muted-foreground disabled:opacity-30 hover:text-foreground"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Move ${label} down`}
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          className="shrink-0 rounded p-0.5 text-muted-foreground disabled:opacity-30 hover:text-foreground"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {locked ? (
          <Lock
            className="h-3 w-3 shrink-0 text-muted-foreground"
            aria-label="Always on"
          />
        ) : (
          <button
            type="button"
            aria-label={visible ? `Hide ${label}` : `Show ${label}`}
            onClick={onToggle}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            {visible ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Real content, taps paused so dragging never fires a button. */}
      <div
        className={cn(
          "select-none",
          !interactive && "pointer-events-none",
          !visible && "opacity-45 saturate-50",
        )}
      >
        <FramedProvider>{children}</FramedProvider>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One card inside a tab                                               */
/* ------------------------------------------------------------------ */

export function SectionFrame({
  tabId,
  sectionId,
  children,
}: {
  tabId: string;
  sectionId: string;
  children: ReactNode;
}) {
  const { layout, update } = useLayoutPrefs();
  const sections = orderedSections(layout, tabId);
  const index = sections.findIndex((s) => s.id === sectionId);
  const state = sections[index];

  const move = (fromId: string, steps: number, dir: -1 | 1) =>
    update((prev) => {
      let next = prev;
      for (let i = 0; i < steps; i++)
        next = moveSection(next, tabId, fromId, dir);
      return next;
    });

  return (
    <ArrangeFrame
      id={sectionId}
      scope={`tab:${tabId}`}
      label={sectionLabel(sectionId)}
      visible={state?.visible ?? true}
      locked={sectionId === LOCKED_SECTION_ID}
      canMoveUp={index > 0}
      canMoveDown={index >= 0 && index < sections.length - 1}
      onMove={(dir) => move(sectionId, 1, dir)}
      onToggle={() =>
        update((prev) =>
          setSectionVisible(prev, tabId, sectionId, !(state?.visible ?? true)),
        )
      }
      onDropFrom={(fromId) => {
        const ids = sections.map((s) => s.id);
        const from = ids.indexOf(fromId);
        const to = ids.indexOf(sectionId);
        if (from < 0 || to < 0 || from === to) return;
        move(fromId, Math.abs(to - from), to > from ? 1 : -1);
      }}
    >
      {children}
    </ArrangeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* One row inside a card or a pop-up                                   */
/* ------------------------------------------------------------------ */

export function PartFrame({
  ownerId,
  isSurface,
  partId,
  children,
}: {
  ownerId: string;
  isSurface: boolean;
  partId: string;
  children: ReactNode;
}) {
  const { layout, update } = useLayoutPrefs();
  const parts = isSurface
    ? orderedSurfaceParts(layout, ownerId)
    : orderedParts(layout, ownerId);
  const index = parts.findIndex((p) => p.id === partId);
  const state = parts[index];
  const def = partDef(partId);

  const move = (fromId: string, steps: number, dir: -1 | 1) =>
    update((prev) => {
      let next = prev;
      for (let i = 0; i < steps; i++)
        next = isSurface
          ? moveSurfacePart(next, ownerId, fromId, dir)
          : movePart(next, ownerId, fromId, dir);
      return next;
    });

  return (
    <ArrangeFrame
      tight
      id={partId}
      scope={`${isSurface ? "surface" : "section"}:${ownerId}`}
      label={def?.label ?? partLabel(partId)}
      visible={state?.visible ?? true}
      locked={def?.locked === true}
      canMoveUp={index > 0}
      canMoveDown={index >= 0 && index < parts.length - 1}
      onMove={(dir) => move(partId, 1, dir)}
      onToggle={() =>
        update((prev) =>
          isSurface
            ? setSurfacePartVisible(
                prev,
                ownerId,
                partId,
                !(state?.visible ?? true),
              )
            : setPartVisible(prev, ownerId, partId, !(state?.visible ?? true)),
        )
      }
      onDropFrom={(fromId) => {
        const ids = parts.map((p) => p.id);
        const from = ids.indexOf(fromId);
        const to = ids.indexOf(partId);
        if (from < 0 || to < 0 || from === to) return;
        move(fromId, Math.abs(to - from), to > from ? 1 : -1);
      }}
    >
      {children}
    </ArrangeFrame>
  );
}
