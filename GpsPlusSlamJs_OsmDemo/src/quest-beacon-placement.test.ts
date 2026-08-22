import { describe, expect, it } from "vitest";
import { enuFrameAt } from "gps-plus-slam-osm";

import {
  QUEST_BEACON_HOVER_M,
  questBeaconPlacements,
} from "./quest-beacon-placement.js";
import { type Heightfield } from "./heightfield.js";

/**
 * Why these tests matter: this is a coordinate transform, and the fifteenth
 * session's review made the point that a transform pinned only by examples can
 * agree with a wrong implementation. The specific failure here is a beacon that
 * looks entirely reasonable and stands somewhere the quest is not — the same
 * class of bug `ar-scene-hierarchy.ts` records two independent readers hitting.
 *
 * The second failure this guards is subtler and was found by the plan's cold
 * review: `heightAt` CLAMPS outside its window rather than refusing, so a quest
 * beyond the sampled terrain would be given fabricated relief that reads as a
 * measurement.
 */

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

/** A flat field of known extent, centred where the caller says. */
function fieldAt(
  centre: { x: number; y: number },
  extentM: number,
  relief = 7,
): Heightfield {
  return {
    heights: new Float32Array(),
    side: 0,
    extentM,
    centreEnu: centre,
    hasData: true,
    heightAt: () => relief,
  } as unknown as Heightfield;
}

describe("questBeaconPlacements", () => {
  const frame = enuFrameAt(COLOGNE);

  it("puts a beacon at the origin's own position, hovering above the ground", () => {
    const [placed] = questBeaconPlacements(
      [{ position: COLOGNE }],
      frame,
      fieldAt({ x: 0, y: 0 }, 2400, 7),
    );

    expect(placed?.x).toBeCloseTo(0, 6);
    expect(placed?.z).toBeCloseTo(0, 6);
    expect(placed?.groundY).toBe(7);
    expect(placed?.y).toBe(7 + QUEST_BEACON_HOVER_M);
    expect(placed?.groundMeasured).toBe(true);
  });

  it("sends NORTH to -z, which is the reflection everything else uses", () => {
    // THE ASSERTION THAT PINS THE TRANSPOSITION. A frame that got this backwards
    // produces a beacon at a plausible-looking place on the wrong side of the
    // user, and `mesh-orientation.test.ts` records that a mirrored frame shipped
    // here once.
    const north = { lat: COLOGNE.lat + 0.001, lng: COLOGNE.lng };
    const [placed] = questBeaconPlacements(
      [{ position: north }],
      frame,
      fieldAt({ x: 0, y: 0 }, 2400),
    );

    expect(placed?.z).toBeLessThan(0);
    expect(placed?.x).toBeCloseTo(0, 6);
  });

  it("sends EAST to +x, leaving the north axis alone", () => {
    const east = { lat: COLOGNE.lat, lng: COLOGNE.lng + 0.001 };
    const [placed] = questBeaconPlacements(
      [{ position: east }],
      frame,
      fieldAt({ x: 0, y: 0 }, 2400),
    );

    expect(placed?.x).toBeGreaterThan(0);
    expect(placed?.z).toBeCloseTo(0, 6);
  });

  it("refuses to INVENT relief for a pick outside the sampled window", () => {
    // WHY THIS IS THE MOST IMPORTANT TEST HERE. `heightAt` clamps its sample
    // index per axis, so a point beyond the square is handed the edge profile
    // extruded outward — finding R2-9, sampled at a point. It would come back
    // as a perfectly ordinary number.
    //
    // A tiny window puts the pick outside it while everything else stays real.
    const [placed] = questBeaconPlacements(
      [{ position: { lat: COLOGNE.lat + 0.01, lng: COLOGNE.lng } }],
      frame,
      fieldAt({ x: 0, y: 0 }, 50, 7),
    );

    expect(placed?.groundMeasured).toBe(false);
    expect(placed?.groundY).toBe(0);
    expect(placed?.y).toBe(QUEST_BEACON_HOVER_M);
  });

  it("still places beacons during a DEM outage, and says the ground is unknown", () => {
    // A missing field is a normal state, not an error: the quest is still worth
    // showing, and hiding it would make an outage look like "no quests here".
    const [placed] = questBeaconPlacements(
      [{ position: COLOGNE }],
      frame,
      undefined,
    );

    expect(placed?.groundMeasured).toBe(false);
    expect(placed?.y).toBe(QUEST_BEACON_HOVER_M);
  });

  it("places one beacon per pick, in order, and drops none", () => {
    // The 2D map draws a glyph per pick — up to seven — and DEC-K4 is that the
    // two views must agree. A silent drop here is a disagreement nobody sees
    // until they count.
    const picks = [
      { position: COLOGNE },
      { position: { lat: COLOGNE.lat + 0.0005, lng: COLOGNE.lng } },
      { position: { lat: COLOGNE.lat, lng: COLOGNE.lng + 0.0005 } },
    ];

    expect(
      questBeaconPlacements(picks, frame, fieldAt({ x: 0, y: 0 }, 2400)),
    ).toHaveLength(3);
  });

  it("skips a pick whose position is not finite, rather than placing a NaN", () => {
    // A NaN reaching a scene position removes the object from the picture with
    // no error anywhere — the same "the 3D view is empty" report that
    // `render-distance.ts` guards against on the far plane.
    const placements = questBeaconPlacements(
      [
        { position: { lat: Number.NaN, lng: COLOGNE.lng } },
        { position: COLOGNE },
      ],
      frame,
      fieldAt({ x: 0, y: 0 }, 2400),
    );

    expect(placements).toHaveLength(1);
    expect(placements[0]?.x).toBeCloseTo(0, 6);
  });
});
