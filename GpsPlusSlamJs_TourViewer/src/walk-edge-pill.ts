/**
 * The edge pill (the radar-and-list prototype, its "on the way" and "behind
 * you" states): while the station the walk is about lies off screen, a
 * small pill at the screen's edge on its side names it and its distance -
 * "The well - 34 m", plus ", behind you" once it is behind the visitor.
 * Only the focus gets one; the HUD's edge arrows still mark the nearest
 * stations (each with its own distance label).
 *
 * Pure model plus a thin writer. The model decides whether the pill shows
 * and on which side, with a band against flicker at both edges of the
 * rule: a phone held still jitters by a degree or two, and a station
 * near the view's edge (or straight behind) would otherwise blink the pill
 * on and off (or flip it from side to side) with every frame.
 *
 * @see walk-edge-pill.ts.md
 */

import { formatDistance } from "gps-plus-slam-app-framework/utils/format-distance";
import { bearingDeltaDeg } from "gps-plus-slam-app-framework/utils/bearing-degrees";

import {
  WALK_DIRECTION_HYSTERESIS_DEG,
  type WalkDirection,
} from "./walk-direction.js";

/**
 * The pill shows once the focus lies past this share of half the camera's
 * horizontal field of view (the prototype's 0.92: just inside the screen's
 * edge, where the station is about to leave it). The range 0.85-1.0 is the
 * phone's to judge: lower and the pill shows while the station is still
 * plainly on screen, at 1.0 a station half off the edge has no cue.
 */
export const WALK_EDGE_PILL_SHARE = 0.92;

/**
 * The band, degrees, by which the angle must fall back inside the edge
 * before the pill goes, and cross straight behind before it changes side:
 * the direction words' band (`walk-direction.ts`), for the same jitter.
 */
export const WALK_EDGE_PILL_BAND_DEG = WALK_DIRECTION_HYSTERESIS_DEG;

/**
 * The band by which the angle must fall back inside the edge before the
 * pill goes: the words' band, but at most a tenth of half the view. A
 * phone held upright sees about 32 degrees across, where a fixed 5 degree
 * band kept the pill until the station was back 61 % of the way to the
 * centre, over its marker plainly on the screen. Crossing straight behind
 * keeps the full band (the view's width does not matter there).
 */
export function walkEdgePillHideBandDeg(
  fovDeg: number,
  bandDeg: number = WALK_EDGE_PILL_BAND_DEG,
): number {
  return Math.min(bandDeg, 0.1 * (fovDeg / 2));
}

type WalkEdgeSide = "left" | "right";

export interface WalkEdgePillInput {
  /** The focus's title; null without a focus (none guessed, a story
   *  plays with nothing left to find, the tour complete). */
  readonly title: string | null;
  /** The focus's distance, m, while the guide shows one; null otherwise
   *  (no distance on the screen anywhere then). */
  readonly distanceM: number | null;
  /** The focus's bearing relative to the camera's, degrees, positive to
   *  the right; null without a heading. */
  readonly angleDeg: number | null;
  /** The focus's direction word, with its own band (`walk-direction.ts`):
   *  "behind" adds ", behind you". */
  readonly word: WalkDirection | null;
  /** The camera's horizontal field of view, degrees. */
  readonly fovDeg: number;
  /** The list is pulled up: it lists the station already. */
  readonly listOpen: boolean;
  /** A story plays: the story card is what the visitor reads. */
  readonly storyPlaying: boolean;
}

export interface WalkEdgePill {
  readonly side: WalkEdgeSide;
  readonly text: string;
}

export interface WalkEdgePillOptions {
  readonly share?: number;
  readonly bandDeg?: number;
}

/**
 * The pill now, `previous` being the one shown last (null: none): shown
 * for a focus with a distance and a heading, past the edge share of half
 * the field of view, with the list closed and no story playing; kept
 * until the angle comes back inside the edge by the band; on the side the
 * station lies, kept across straight behind until it is past by the band.
 * Null when it does not show, or for input that is no number.
 */
export function walkEdgePill(
  input: WalkEdgePillInput,
  previous: WalkEdgePill | null = null,
  options: WalkEdgePillOptions = {},
): WalkEdgePill | null {
  const share = options.share ?? WALK_EDGE_PILL_SHARE;
  const band = options.bandDeg ?? WALK_EDGE_PILL_BAND_DEG;
  const { title, distanceM, angleDeg } = input;
  if (
    title === null ||
    distanceM === null ||
    angleDeg === null ||
    !Number.isFinite(distanceM) ||
    !Number.isFinite(angleDeg) ||
    !Number.isFinite(input.fovDeg) ||
    input.fovDeg <= 0 ||
    input.listOpen ||
    input.storyPlaying
  ) {
    return null;
  }
  const a = bearingDeltaDeg(angleDeg, 0);
  const edge = (input.fovDeg / 2) * share;
  const hideBand = walkEdgePillHideBandDeg(input.fovDeg, band);
  const off = Math.abs(a) > (previous === null ? edge : edge - hideBand);
  if (!off) return null;
  const side: WalkEdgeSide =
    previous !== null && Math.abs(a) > 180 - band
      ? previous.side
      : a > 0
        ? "right"
        : "left";
  const metres = formatDistance(distanceM, { metreDecimals: 0 });
  const behind = input.word === "behind" ? ", behind you" : "";
  return { side, text: `${title} - ${metres}${behind}` };
}

/** The pill's elements inside `#ar-root`. */
export interface WalkEdgePillDom {
  readonly root: Pick<HTMLElement, "hidden" | "dataset">;
  readonly text: Pick<HTMLElement, "textContent">;
  /** The chevron, drawn pointing to its side. */
  readonly arrow: Pick<SVGPathElement, "getAttribute" | "setAttribute">;
}

/** The chevron's path, pointing left or right (the prototype's). */
const CHEVRON: Record<WalkEdgeSide, string> = {
  left: "M9 2L4 7l5 5",
  right: "M5 2l5 5-5 5",
};

export interface WalkEdgePillView {
  /** Draw the pill for this frame's input; returns what it shows. */
  render(input: WalkEdgePillInput | null): WalkEdgePill | null;
}

/**
 * The writer: it keeps the pill last shown (the band's memory, a view
 * resource like the direction words') and writes a node only when what it
 * shows changed - the input changes with every camera frame.
 */
export function wireWalkEdgePill(dom: WalkEdgePillDom): WalkEdgePillView {
  let shown: WalkEdgePill | null = null;
  return {
    render(input) {
      shown = input === null ? null : walkEdgePill(input, shown);
      const hidden = shown === null;
      if (dom.root.hidden !== hidden) dom.root.hidden = hidden;
      if (shown === null) return null;
      if (dom.root.dataset["side"] !== shown.side) {
        dom.root.dataset["side"] = shown.side;
      }
      if (dom.arrow.getAttribute("d") !== CHEVRON[shown.side]) {
        dom.arrow.setAttribute("d", CHEVRON[shown.side]);
      }
      if (dom.text.textContent !== shown.text)
        dom.text.textContent = shown.text;
      return shown;
    },
  };
}
