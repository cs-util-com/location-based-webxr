/**
 * The late-terrain rebuild decision (F1d).
 *
 * WHY THESE TESTS MATTER. This module exists because of a defect that only
 * appears when a DEM load loses a race, and it is fixed by a signal that — if
 * it fires even slightly too eagerly — aborts an in-flight 15–90 s Overpass
 * fetch on every ordinary click. So there are two ways to be wrong here and
 * they pull in opposite directions: too quiet reproduces the reported bug, too
 * loud is a worse regression than the bug. Every test below pins one side or
 * the other of that line, and the suppression cases matter more than the
 * signalling one.
 */

import { describe, expect, it } from "vitest";

import {
  meshOutdatedByTerrain,
  type MeshBuildRecord,
} from "./terrain-arrival.js";

const HERE = { lat: 50.9413, lng: 6.9583 };
const THERE = { lat: 50.9231, lng: 6.9445 };

/** A mesh standing at `HERE`, built against terrain stamp 4. */
const STANDING: MeshBuildRecord = { centre: HERE, terrainStamp: 4 };

describe("meshOutdatedByTerrain", () => {
  it("signals a rebuild when terrain lands AFTER the mesh was built for that place", () => {
    // THE REPORTED BUG (F1d). The gate timed out at 15 s, the mesh was built on
    // flat ground, and the relief arrived afterwards. Before this module the
    // buildings stayed at zero until some unrelated action happened to rebuild
    // them; the owner reloaded the page.
    expect(
      meshOutdatedByTerrain(STANDING, {
        centre: HERE,
        terrainStamp: 5,
        updatesInFlight: 0,
      }),
    ).toBe(true);
  });

  it("stays quiet while an update is in flight, because that update WILL rebuild", () => {
    // THE MOST IMPORTANT TEST IN THIS FILE. On the page `refresh` is
    // `latestOnly`, so a redundant signal does not merely waste work — it
    // ABORTS the running refresh and restarts its Overpass fetch. An ordinary
    // cold click posts the terrain load and the refresh together, so without
    // this guard the fix would cancel and re-issue a 15-90 s request on every
    // click. That is strictly worse than the stall it was written to remove,
    // and it is what the first draft of the plan would have shipped.
    expect(
      meshOutdatedByTerrain(STANDING, {
        centre: HERE,
        terrainStamp: 5,
        updatesInFlight: 1,
      }),
    ).toBe(false);
  });

  it("stays quiet before anything has been drawn", () => {
    // Every first load. There is no stale mesh to replace, and the update that
    // follows builds against the field that just landed.
    expect(
      meshOutdatedByTerrain(undefined, {
        centre: HERE,
        terrainStamp: 1,
        updatesInFlight: 0,
      }),
    ).toBe(false);
  });

  it("stays quiet for terrain that landed somewhere else", () => {
    // A prefetch or a superseded load for a neighbouring position says nothing
    // about the ground under THIS mesh. Signalling on it would rebuild the
    // scene for a place the user has already left — the stale-field bug with
    // extra steps, which is the failure `terrain-gate.ts` exists to prevent.
    expect(
      meshOutdatedByTerrain(STANDING, {
        centre: THERE,
        terrainStamp: 5,
        updatesInFlight: 0,
      }),
    ).toBe(false);
  });

  it("stays quiet when the mesh already stands on this very field", () => {
    // The ordinary successful path: the join held, the update waited at the
    // gate, and the mesh was built after the stamp moved. Signalling here would
    // rebuild an already-correct scene on every single load.
    expect(
      meshOutdatedByTerrain(
        { centre: HERE, terrainStamp: 5 },
        { centre: HERE, terrainStamp: 5, updatesInFlight: 0 },
      ),
    ).toBe(false);
  });

  it("signals for an AR-entry field at an unchanged position", () => {
    // WHY THE RECORD CARRIES NO DATUM, stated as a test because the opposite
    // choice looks more consistent with `terrain-gate.ts` and is wrong here.
    //
    // AR entry re-samples the SAME position against a different datum (`-N`
    // rather than the window centre), which at Cologne is ~99 m apart. The
    // desktop mesh really is out of date the instant that field lands. The
    // gate keys on the datum because its question is "is this the same field";
    // this module keys on the place because its question is "is the mesh
    // standing on the newest field here". A datum-aware comparison would
    // answer "no rebuild" on exactly the transition that most needs one.
    expect(
      meshOutdatedByTerrain(STANDING, {
        centre: HERE,
        terrainStamp: 5,
        updatesInFlight: 0,
      }),
    ).toBe(true);
  });

  it("treats a stamp that moved backwards as outdated too", () => {
    // Why this test matters: the comparison is inequality, not `<`. The stamp
    // is a monotonic counter today, so this cannot happen — but "the mesh was
    // built against a different field than the one now held" is the property
    // that actually matters, and encoding it as an ordering would make the
    // module quietly wrong if the counter is ever reset (a worker restart, a
    // future per-datum stamp). Inequality has no such failure mode.
    expect(
      meshOutdatedByTerrain(
        { centre: HERE, terrainStamp: 9 },
        { centre: HERE, terrainStamp: 2, updatesInFlight: 0 },
      ),
    ).toBe(true);
  });
});
