/**
 * Where the editor's card sits next to its marker (M6 E1, the chosen
 * prototype `editor-1-left-rail`'s `positionCard`), as numbers: to the
 * right of the marker, else to its left, else below it, always inside the
 * free part of the window (right of the rail, under the top bar), with the
 * arrow pointing at the marker. A marker outside that area hides the card
 * and shows the "off the map view" chip instead. Pure.
 *
 * @see popover-place.ts.md
 */

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type PopoverPlacement =
  | { readonly visible: false }
  | {
      readonly visible: true;
      readonly x: number;
      readonly y: number;
      readonly side: "right" | "left" | "below";
      /** The arrow's offset along the card's edge (top for a side card,
       *  left for a card below), px. */
      readonly arrow: number;
    };

/** How far outside the free area a marker may sit before the card hides. */
const SLACK_PX = 6;

/** The card's distance from a box it keeps clear of, px. */
const AVOID_GAP_PX = 8;

function overlaps(
  x: number,
  y: number,
  size: { readonly width: number; readonly height: number },
  box: Box,
): boolean {
  return (
    x < box.right &&
    x + size.width > box.left &&
    y < box.bottom &&
    y + size.height > box.top
  );
}

/** The card's top at `at`, moved up above `avoid` when it would cover
 *  it and fits there inside `free`; else where it was. */
function clearOf(
  avoid: Box | null,
  at: { readonly x: number; readonly y: number; readonly h: number },
  size: { readonly width: number; readonly height: number },
  free: Box,
): number {
  if (avoid === null || !overlaps(at.x, at.y, size, avoid)) return at.y;
  const above = avoid.top - AVOID_GAP_PX - at.h;
  return above >= free.top ? above : at.y;
}

export function placePopover(input: {
  /** The marker's ground point in window pixels. */
  readonly anchor: { readonly x: number; readonly y: number };
  /** From the ground point up to the marker's visual centre (a pin's
   *  bubble sits above its tip), px. */
  readonly lift: number;
  /** The gap between the marker and the card, px. */
  readonly gap: number;
  readonly size: { readonly width: number; readonly height: number };
  /** The free part of the window. */
  readonly free: Box;
  /** A box inside the free area the card keeps clear of (the editor's
   *  debug panel, r901 review #4): a card that would cover it moves up
   *  above it where it fits, else stays (the card is drawn on top). It
   *  hides nothing: a marker under it still has its card. */
  readonly avoid?: Box | null | undefined;
}): PopoverPlacement {
  const { anchor, size, free } = input;
  const centreY = anchor.y - input.lift;
  if (
    anchor.x < free.left - SLACK_PX ||
    anchor.x > free.right + SLACK_PX ||
    centreY < free.top - SLACK_PX ||
    anchor.y > free.bottom + SLACK_PX
  ) {
    return { visible: false };
  }
  const { width: w, height: h } = size;
  let side: "right" | "left" | "below" = "right";
  let x = anchor.x + input.gap;
  if (x + w > free.right) {
    x = anchor.x - input.gap - w;
    side = "left";
  }
  let y: number;
  if (x < free.left) {
    side = "below";
    // Never left of the free area (PR #609 review): when the card is wider
    // than it, the card starts at its edge and overflows on the right
    // rather than covering the rail.
    x = Math.max(
      Math.min(Math.max(anchor.x - w / 2, free.left), free.right - w),
      free.left,
    );
    y = anchor.y + 14;
    if (y + h > free.bottom) y = Math.max(free.top, free.bottom - h);
  } else {
    y = Math.min(
      Math.max(centreY - 46, free.top),
      Math.max(free.top, free.bottom - h),
    );
  }
  y = clearOf(input.avoid ?? null, { x, y, h }, size, free);
  const arrow =
    side === "below"
      ? Math.min(Math.max(anchor.x - x - 7, 16), w - 30)
      : Math.min(Math.max(centreY - y - 7, 14), h - 28);
  return {
    visible: true,
    x: Math.round(x),
    y: Math.round(y),
    side,
    arrow: Math.round(arrow),
  };
}

/** The smallest box, px, a marker is panned into: below it Leaflet's
 *  `panInside` box turns inside out and lands over the rail. */
const MIN_REVEAL_BOX_PX = 60;

/**
 * The padding a marker is panned inside (Leaflet `panInside`): clear of
 * the rail and the top bar, with room on the right for the card where the
 * window has it. On a narrow window the right and bottom padding shrink so
 * the box stays at least 60 px wide and tall; a fixed 380 px turned the box
 * inside out below about 490 px and "Show it" did nothing (E1 review #2).
 */
export function revealPadding(
  viewport: { readonly width: number; readonly height: number },
  free: { readonly left: number; readonly top: number },
): { topLeft: [number, number]; bottomRight: [number, number] } {
  const left = free.left + 40;
  const top = free.top + 40;
  const room = (span: number, start: number, wanted: number): number =>
    Math.max(0, Math.min(wanted, span - start - MIN_REVEAL_BOX_PX));
  return {
    topLeft: [left, top],
    bottomRight: [
      room(viewport.width, left, 380),
      room(viewport.height, top, 60),
    ],
  };
}
