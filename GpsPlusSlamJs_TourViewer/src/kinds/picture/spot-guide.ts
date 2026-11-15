/**
 * The rules of the spot guide (pure): what leads a visitor to the spot a
 * viewpoint picture lines up from, in the world. A decal on the ground at
 * the spot (footprints in a ring, an arrow the way to face), a soft light
 * column standing on it, and a card on a post beside it saying what to do
 * there. Far away all three show; the card and the column give way as the
 * visitor arrives, and the decal dims as the picture takes over. The
 * numbers are the chosen picture prototype's
 * (`public/prototypes/station-blocks-3-pictures`, its `makeSpot`).
 *
 * The meshes are `spot-guide-look.ts`'s. A screen hint (the distance
 * left, "turn this way") is not part of the guide: a page that shows one
 * reads the same distance the guide's card fades by.
 *
 * @see spot-guide.ts.md
 */
import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-kinds";

import { smoothstep } from "../../smoothstep.js";
import { viewpointYaw } from "./viewpoint-looks.js";

/** The views the guide leads to. The viewer is its own mark: the stand
 *  at the spot, with its halo and plate (`viewpoint-looks.ts`). */
export const SPOT_GUIDE_VIEWS = [
  "thenNow",
  "finder",
  "sharpen",
  "window",
] as const;
export type SpotGuideView = (typeof SPOT_GUIDE_VIEWS)[number];

/** Whether `view` is one the guide leads to. */
export function isSpotGuideView(view: string): view is SpotGuideView {
  return (SPOT_GUIDE_VIEWS as readonly string[]).includes(view);
}

/** The card's two lines per view. */
export const SPOT_CARD_LINES: Readonly<
  Record<SpotGuideView, readonly [string, string]>
> = {
  thenNow: ["Stand on the marker", "and face the arrow"],
  finder: ["Stand on the marker", "until the corners meet"],
  sharpen: ["Walk to the marker", "and the picture appears"],
  window: ["Stand on the marker", "and look through the frame"],
};

/** Whether the card shows the picture small: every view but sharpen,
 *  whose picture is the surprise at the spot. */
export function spotCardHasThumb(view: SpotGuideView): boolean {
  return view !== "sharpen";
}

/** The decal's side on the ground (m). */
export const SPOT_DECAL_M = 1.5;

/** The light column: its radius and height (m), standing on the spot. */
export const SPOT_BEAM = { radiusM: 0.05, heightM: 3.4 } as const;

/** The card on its post: its width; how far it stands to the left of the
 *  spot and behind it, seen from the spot the viewpoint's way; the post's
 *  height, the card's lower edge over the ground and its tilt back. */
export const SPOT_CARD = {
  widthM: 0.8,
  asideM: 1.05,
  behindM: 0.25,
  postM: 1.08,
  liftM: 1.05,
  tiltRad: 0.18,
} as const;

/** The card's fade by the distance to the spot (m): whole at the first,
 *  gone at the second; the column fades with it. Swept over 1.2-0.75,
 *  1.6-0.8 and 2.4-1.2 (`spot-guide.property.test.ts`). */
export const SPOT_CARD_FADE_M: readonly [number, number] = [1.6, 0.8];

/** How much the decal dims once the picture has taken over, per view. */
const DECAL_DIM: Readonly<Record<SpotGuideView, number>> = {
  thenNow: 0.6,
  finder: 0.7,
  sharpen: 0.7,
  window: 0.6,
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** The card's size (m) for a picture `aspect` high per unit wide: a
 *  padded thumbnail over the year and the two lines; without the
 *  thumbnail (or for an aspect that is no positive number), the lines
 *  only. */
export function spotCardSize(
  aspect: number,
  withThumb: boolean,
): { readonly widthM: number; readonly heightM: number } {
  const w = SPOT_CARD.widthM;
  const thumbH =
    withThumb && Number.isFinite(aspect) && aspect > 0
      ? (w - 0.09) * aspect + 0.035
      : 0;
  return { widthM: w, heightM: 0.045 + thumbH + 0.13 + 0.03 };
}

/** Where the card's post stands on the ground, in the viewpoint's frame. */
export function spotCardPlace(viewpoint: TourPictureViewpoint): {
  readonly x: number;
  readonly z: number;
} {
  const yaw = viewpointYaw(viewpoint);
  // A group turned by `yaw` has its -Z ahead and +X to its right.
  const aheadX = -Math.sin(yaw);
  const aheadZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const [px, , pz] = viewpoint.position;
  return {
    x: px - SPOT_CARD.asideM * rightX - SPOT_CARD.behindM * aheadX,
    z: pz - SPOT_CARD.asideM * rightZ - SPOT_CARD.behindM * aheadZ,
  };
}

/** The turn about up that faces the card's front (+Z) at the visitor on
 *  the ground; `last` when the visitor stands on it or is unknown. */
export function spotCardTurn(
  cardX: number,
  cardZ: number,
  viewerX: number,
  viewerZ: number,
  last: number,
): number {
  const dx = viewerX - cardX;
  const dz = viewerZ - cardZ;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return last;
  if (Math.hypot(dx, dz) < 1e-6) return last;
  return Math.atan2(dx, dz);
}

/** The guide's opacities, 0 to 1. */
export interface SpotGuideShade {
  readonly decal: number;
  readonly card: number;
  readonly beam: number;
}

/**
 * The guide of `view` with the visitor `distanceM` from the spot (on the
 * ground) and the picture taken over by `takeover` (0 to 1, the view's
 * own measure). No reading (not a number) counts as far, and no takeover.
 */
export function spotGuideShade(
  view: SpotGuideView,
  distanceM: number,
  takeover: number,
  cardFade: readonly [number, number] = SPOT_CARD_FADE_M,
): SpotGuideShade {
  const k = Number.isFinite(takeover) ? clamp01(takeover) : 0;
  const decal = clamp01(1 - DECAL_DIM[view] * k);
  const card = Number.isNaN(distanceM)
    ? 1
    : clamp01(1 - smoothstep(cardFade[0], cardFade[1], distanceM));
  return { decal, card, beam: Math.min(decal, card) };
}
