/**
 * The band's hand-over gated by readiness (round-6 plan 2026-10-04-1050
 * G6-1, DEC-G6-2). The altitude gives the target share of pixels the relief
 * draws (`carrierShareAt`); the drawn share moves toward it only as far as
 * the carriers allow:
 * - while both carriers are ready, the share moves toward the target at
 *   most `sharePerS` a second, so the cross-fade never pops;
 * - while only one is ready, it takes every pixel at once: a hole is worse
 *   than a quick swap (measured 2026-10-04: zooming out widens the view
 *   past the relief's tiles faster than they load);
 * - while neither is, the share holds.
 *
 * Before, the share followed the altitude alone, and the owner saw the whole
 * Earth turn blue at the switch, both ways.
 *
 * @see globe-band-gate.ts.md
 */

/** The gate's one parameter. */
export const GLOBE_BAND_GATE = Object.freeze({
  /**
   * The share's largest change a second: a full swap takes 1 s at least.
   * The dither's cross-fade read continuous at the altitude law's own pace,
   * which crosses the band in 1-3 s of a dive.
   */
  sharePerS: 1,
});

const LOADED = 4;

/** What `topLevelReady` reads of a tile (3d-tiles-renderer 0.5.3's fields). */
interface GateTile {
  internal?: { loadingState?: number };
  traversal?: { lastFrameVisited?: number; inFrustum?: boolean };
  children?: unknown[];
}

/**
 * Whether a tile set can draw the whole view: every top-level tile (the
 * root's children: an image-tiled set's coarsest level) that its last update
 * visited in view has loaded. Below that level the library keeps a parent
 * drawn until its children are ready, so only a missing top-level tile
 * leaves a hole. False before any top-level tile was visited (a set never
 * updated is not ready).
 */
export function topLevelReady(tiles: {
  root: unknown;
  frameCount: number;
}): boolean {
  const root = tiles.root as GateTile | null;
  if (!root || !Array.isArray(root.children)) return false;
  let seen = 0;
  for (const child of root.children as GateTile[]) {
    const t = child.traversal;
    if (t?.lastFrameVisited !== tiles.frameCount || !t.inFrustum) continue;
    seen++;
    if (child.internal?.loadingState !== LOADED) return false;
  }
  return seen > 0;
}

/**
 * The relief's drawn share for the next frame: with both carriers ready,
 * from `drawn` toward the altitude's `target` by at most
 * `GLOBE_BAND_GATE.sharePerS` x `dtMs`; with only the relief ready, 1;
 * with only the globe ready, 0; with neither, `drawn`.
 * RangeError for a share outside 0-1 or a non-finite or negative time.
 */
export function nextDrawnShare(input: {
  drawn: number;
  target: number;
  reliefReady: boolean;
  globeReady: boolean;
  dtMs: number;
}): number {
  const { drawn, target, reliefReady, globeReady, dtMs } = input;
  for (const [name, v] of [
    ["drawn", drawn],
    ["target", target],
  ] as const) {
    if (!(v >= 0 && v <= 1)) {
      throw new RangeError(`the ${name} share must be in 0-1, got ${v}`);
    }
  }
  if (!(dtMs >= 0 && Number.isFinite(dtMs))) {
    throw new RangeError(`the frame time must be finite and >= 0, got ${dtMs}`);
  }
  if (!reliefReady && !globeReady) return drawn;
  if (!reliefReady) return 0;
  if (!globeReady) return 1;
  const limit = (GLOBE_BAND_GATE.sharePerS * dtMs) / 1000;
  const next = drawn + Math.max(-limit, Math.min(limit, target - drawn));
  return Math.min(1, Math.max(0, next));
}
