import { Children, isValidElement, type ReactNode } from "react";
import {
  usePartOrder,
  useSurfacePartOrder,
  useTabSectionOrder,
} from "@/lib/layout-prefs";
import { useAlreadyFramed, useArrangeMode } from "@/lib/arrange-mode";
import { PartFrame, SectionFrame } from "./ArrangeFrame";

/**
 * Marks one toggle-able / reorderable block inside a tab.
 *
 * On its own it just checks visibility; inside `<LayoutSections>` the parent
 * also uses its `id` to place it in the user's chosen order. In arrange mode
 * the block keeps rendering (even when switched off) wrapped in its frame.
 */
export function LayoutSection({
  id,
  tabId,
  children,
}: {
  id: string;
  /** Only needed when used standalone, outside a `<LayoutSections>` parent. */
  tabId?: string;
  children: ReactNode;
}) {
  const derivedTab = tabId ?? id.split(".")[0] ?? "";
  const { visible } = useTabSectionOrder(derivedTab);
  const arrange = useArrangeMode();
  const framed = useAlreadyFramed();

  if (arrange.on) {
    if (framed) return <>{children}</>;
    return (
      <SectionFrame tabId={derivedTab} sectionId={id}>
        {children}
      </SectionFrame>
    );
  }

  if (!visible.has(id)) return null;
  return <>{children}</>;
}

/**
 * Renders its `<LayoutSection>` children filtered by visibility and sorted by
 * the user's saved order for this tab. Children without a known id keep their
 * original position at the top.
 */
export function LayoutSections({
  tabId,
  className,
  children,
}: {
  tabId: string;
  className?: string;
  children: ReactNode;
}) {
  const { order, visible } = useTabSectionOrder(tabId);
  const arrange = useArrangeMode();
  const rank = new Map(order.map((id, i) => [id, i]));

  const items = Children.toArray(children)
    .filter(isValidElement)
    .map((el, i) => {
      const id = (el.props as { id?: string }).id;
      return { el, i, id };
    })
    .filter((x) => (x.id && !arrange.on ? visible.has(x.id) : true))
    .sort((a, b) => {
      const ra = a.id ? (rank.get(a.id) ?? 9999) : -1;
      const rb = b.id ? (rank.get(b.id) ?? 9999) : -1;
      return ra === rb ? a.i - b.i : ra - rb;
    });

  return (
    <div className={className}>
      {items.map((x) =>
        arrange.on && x.id ? (
          <SectionFrame key={x.id} tabId={tabId} sectionId={x.id}>
            {x.el}
          </SectionFrame>
        ) : (
          x.el
        ),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Level 3: parts inside a card, and parts inside a pop-up window      */
/* ------------------------------------------------------------------ */

type PartCtx = { order: string[]; visible: Set<string>; known: boolean };

function useOrderFor(sectionId?: string, surfaceId?: string): PartCtx {
  const section = usePartOrder(sectionId ?? "");
  const surface = useSurfacePartOrder(surfaceId ?? "");
  return surfaceId ? surface : section;
}

function arrange(children: ReactNode, ctx: PartCtx, keepHidden: boolean) {
  return Children.toArray(children)
    .filter(isValidElement)
    .map((el, i) => ({ el, i, id: (el.props as { id?: string }).id }))
    .filter((x) =>
      x.id && ctx.known && !keepHidden ? ctx.visible.has(x.id) : true,
    )
    .sort((a, b) => {
      const rank = (id?: string) =>
        id ? (ctx.order.indexOf(id) === -1 ? 9999 : ctx.order.indexOf(id)) : -1;
      const ra = rank(a.id);
      const rb = rank(b.id);
      return ra === rb ? a.i - b.i : ra - rb;
    });
}

/**
 * Renders its `<LayoutPart>` children filtered and sorted by the owner's saved
 * part arrangement. Pass `sectionId` for a card, `surfaceId` for a pop-up.
 */
export function LayoutParts({
  sectionId,
  surfaceId,
  className,
  children,
}: {
  sectionId?: string;
  surfaceId?: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useOrderFor(sectionId, surfaceId);
  const mode = useArrangeMode();
  const owner = surfaceId ?? sectionId ?? "";
  const items = arrange(children, ctx, mode.on);

  return (
    <div className={className}>
      {items.map((x) =>
        mode.on && x.id && ctx.known ? (
          <PartFrame
            key={x.id}
            ownerId={owner}
            isSurface={Boolean(surfaceId)}
            partId={x.id}
          >
            {x.el}
          </PartFrame>
        ) : (
          x.el
        ),
      )}
    </div>
  );
}

/** One row/field/button inside a card or pop-up. Hidden when switched off. */
export function LayoutPart({
  id,
  sectionId,
  surfaceId,
  className,
  children,
}: {
  id: string;
  /** Only needed outside a `<LayoutParts>` parent. Defaults to the id's owner. */
  sectionId?: string;
  surfaceId?: string;
  className?: string;
  children: ReactNode;
}) {
  const derived = id.split(".").slice(0, 2).join(".");
  const isSurface = id.startsWith("surface.");
  const ownerSection = isSurface ? undefined : (sectionId ?? derived);
  const ownerSurface = surfaceId ?? (isSurface ? derived : undefined);
  const ctx = useOrderFor(ownerSection, ownerSurface);
  const mode = useArrangeMode();
  const framed = useAlreadyFramed();

  const body = className ? (
    <div className={className}>{children}</div>
  ) : (
    <>{children}</>
  );

  if (mode.on) {
    if (framed || !ctx.known) return body;
    return (
      <PartFrame
        ownerId={ownerSurface ?? ownerSection ?? ""}
        isSurface={Boolean(ownerSurface)}
        partId={id}
      >
        {body}
      </PartFrame>
    );
  }

  if (ctx.known && !ctx.visible.has(id)) return null;
  return body;
}
