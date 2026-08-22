import type { EnuFrame } from "gps-plus-slam-osm";

import { type Heightfield } from "./heightfield.js";

/**
 * Where each quest beacon stands in the 3D scene (N6, DEC-U14, DEC-K4).
 *
 * Pure on purpose, like `route-path.ts` and `ar-descent.ts`: the arithmetic and
 * its invariants are the part worth testing, and `BuildingView` cannot be
 * instantiated by the unit suite because it constructs a `WebGLRenderer`.
 *
 * @see quest-beacon-placement.ts.md
 */

/**
 * How high the icon floats above the ground it marks, metres.
 *
 * The field report asked for "20 Meter […] oder 10 oder sowas"; 15 is the
 * midpoint. High enough to clear the tallest ordinary buildings in the demo's
 * cities, low enough that the connecting line still reads as attached to a
 * place rather than as a column disappearing into the sky.
 */
export const QUEST_BEACON_HOVER_M = 15;

/** A quest position, as `geo-event.ts` reports it. */
export interface QuestPick {
  readonly position: { readonly lat: number; readonly lng: number };
}

/** Where one beacon goes, in the demo scene's own frame. */
export interface QuestBeaconPlacement {
  /** Scene metres: `+x` east, `+y` up, `-z` north. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Ground height under the icon, so the line knows how far down to reach. */
  readonly groundY: number;
  /**
   * Whether the ground height is MEASURED or merely assumed.
   *
   * `false` when the pick falls outside the sampled terrain window, where the
   * honest answer is "unknown relief" rather than a number. Carried rather than
   * hidden so a caller can decide — and so a test can tell the two apart.
   */
  readonly groundMeasured: boolean;
}

/**
 * Whether an ENU point lies inside the terrain field's sampled square.
 *
 * **ASKED EXPLICITLY, because `heightAt` CLAMPS rather than refusing.** Its own
 * comment calls the clamp a last-resort guard whose reachability means sizing
 * has broken upstream — and a clamped read is the R2-9 failure sampled at a
 * point: `x` and `y` clamp independently, so a pick outside the square is given
 * the height of the nearest edge at its own cross-axis offset. That is
 * fabricated relief, and it looks exactly like a measurement.
 */
function insideField(
  field: Heightfield,
  point: { x: number; y: number },
): boolean {
  const centre = field.centreEnu;
  return (
    Math.abs(point.x - centre.x) <= field.extentM &&
    Math.abs(point.y - centre.y) <= field.extentM
  );
}

/**
 * Place one beacon per pick.
 *
 * `terrain` may be `undefined` — a DEM outage is a normal state, not an error —
 * in which case every beacon sits on relief 0 and says so.
 */
export function questBeaconPlacements(
  picks: readonly QuestPick[],
  frame: EnuFrame,
  terrain: Heightfield | undefined,
): QuestBeaconPlacement[] {
  const placements: QuestBeaconPlacement[] = [];
  for (const pick of picks) {
    const enu = frame.toEnu(pick.position);
    if (!Number.isFinite(enu.x) || !Number.isFinite(enu.y)) continue;

    const measured = terrain !== undefined && insideField(terrain, enu);
    const relief = measured ? terrain.heightAt(enu) : 0;
    const groundY = Number.isFinite(relief) ? relief : 0;

    placements.push({
      // THE ONE REFLECTION, matching `route-path.ts` and `cell-mesh.ts`: `+x` is
      // ENU east, `+y` is up, and NORTH IS `-z`. A fourth copy that disagreed
      // about which way is north is the failure `mesh-orientation.test.ts`
      // exists for, and it shipped once already.
      x: enu.x,
      y: groundY + QUEST_BEACON_HOVER_M,
      z: -enu.y,
      groundY,
      groundMeasured: measured && Number.isFinite(relief),
    });
  }
  return placements;
}
