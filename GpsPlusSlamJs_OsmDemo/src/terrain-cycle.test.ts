/**
 * The terrain load, and the ordering guarantee it exists to provide.
 *
 * WHY THESE TESTS MATTER. The demo has two async actions driven by the same
 * click: `refresh` and the terrain load. `refresh` was coalesced through
 * `latestOnly` from the start; the terrain load was not, and that asymmetry is
 * the whole bug. `TerrariumProvider` caches decoded tiles, so a second click can
 * resolve from cache while the first is still fetching — the older load then
 * lands LAST, and the 3D view draws the new position's buildings on the old
 * position's relief while the status line reports the old position's `reliefM`.
 *
 * Every part of that result is self-consistent, which is what makes it
 * invisible: the screen shows a plausible city on a plausible hill. So the
 * ordering has to be asserted directly, with a provider whose resolution order
 * the test controls.
 */

import { describe, expect, it } from "vitest";

import { enuFrameAt } from "gps-plus-slam-osm";
import type { ElevationProvider, LatLng } from "gps-plus-slam-osm";

import { buildHeightfieldData } from "./heightfield.js";
import { describeTerrain } from "./terrain-note.js";
import { createTerrainCycle, type TerrainState } from "./terrain-cycle.js";

const COLOGNE: LatLng = { lat: 50.9412, lng: 6.9583 };
const BONN: LatLng = { lat: 50.7339, lng: 7.0997 };

interface HeldCall {
  /** Mean latitude of the requested grid — i.e. which position asked. */
  readonly centreLat: number;
  /** Answers this call with a field of exactly `reliefM` peak-to-trough. */
  readonly resolve: (reliefM: number) => void;
}

/**
 * A provider whose every call is held open until the test releases it.
 *
 * `elevationAt` is the only network in the cycle, so holding it is enough to
 * interleave two loads exactly as two quick map clicks would.
 */
function deferredProvider(): {
  provider: ElevationProvider;
  /** One entry per call made, in call order. */
  readonly calls: HeldCall[];
} {
  const calls: HeldCall[] = [];

  const provider: ElevationProvider = {
    attribution: "test",
    sourceId: "test",
    elevationAt(positions) {
      // The grid is centred on the requested position, so its mean latitude
      // identifies which load this is without threading an id through.
      const centreLat =
        positions.reduce((sum, p) => sum + p.lat, 0) / positions.length;
      return new Promise((answer) => {
        calls.push({
          centreLat,
          resolve: (reliefM) =>
            answer(positions.map((_, i) => (i === 0 ? 0 : reliefM))),
        });
      });
    },
  };

  return { provider, calls };
}

function cycleFor(provider: ElevationProvider): {
  load: (centre: LatLng) => Promise<void>;
  readonly applied: TerrainState[];
} {
  const applied: TerrainState[] = [];
  const load = createTerrainCycle({
    // The sampling moved into the worker, so the cycle is now a coalescing
    // wrapper around an RPC call. This fake worker runs the REAL sampler and the
    // real status phrase in-process, so the coalescing behaviour these tests
    // exist for is still exercised end to end — only the thread boundary is
    // faked, which is the part that has nothing to do with coalescing.
    worker: {
      call: async (_kind, payload) => {
        const field = await buildHeightfieldData(provider, {
          frame: enuFrameAt(payload.centre),
          extentM: payload.extentM,
          spacingM: payload.spacingM,
        });
        return {
          field: field.hasData ? field : undefined,
          note: describeTerrain(field),
        };
      },
    },
    // Small enough that the fake provider is asked for a handful of posts
    // rather than thousands; the grid size is `heightfield.ts`'s business.
    extentM: 50,
    spacingM: 50,
    apply: (state) => applied.push(state),
  });
  return { load, applied };
}

/** Lets every pending microtask and the awaited loads settle. */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("createTerrainCycle", () => {
  it("lets the NEWEST position win even when an older load resolves later", async () => {
    // The exact interleaving the tile cache makes easy: two clicks, and the
    // second one's tiles are already decoded. Un-coalesced, Cologne's write
    // lands after Bonn's and the 3D view stands Bonn's buildings on Cologne.
    const { provider, calls } = deferredProvider();
    const { load, applied } = cycleFor(provider);

    void load(COLOGNE);
    void load(BONN);

    // Only ONE load may be open: the second is queued behind it, never raced.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.centreLat).toBeCloseTo(COLOGNE.lat, 3);

    calls[0]?.resolve(100);
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.centreLat).toBeCloseTo(BONN.lat, 3);
    calls[1]?.resolve(200);
    await settle();

    // The last state applied belongs to the last position the user asked for —
    // which is the whole guarantee, since `apply` is what the UI reads.
    //
    // ONE apply, not two. This used to expect BOTH loads to apply, in order, with
    // the newest last — which pinned the implementation rather than the guarantee:
    // the superseded load's write was always going to be overwritten, so performing
    // it at all was one frame of the wrong relief. Since the staleness guard was
    // added (PR review on #228) the superseded load applies nothing, and the
    // guarantee is unchanged while the intermediate flash is gone.
    expect(applied.map((state) => state.note)).toEqual(["terrain ±200 m"]);
  });

  it("drops the loads in the MIDDLE of a burst, keeping only the last", async () => {
    // Three clicks while the first fetch is open. The middle one's relief would
    // be overwritten the instant it arrived, so fetching it is a DEM request
    // for ground nobody will ever see.
    const { provider, calls } = deferredProvider();
    const { load, applied } = cycleFor(provider);

    void load(COLOGNE);
    void load(BONN);
    void load(COLOGNE);

    calls[0]?.resolve(100);
    await settle();
    calls[1]?.resolve(100);
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.centreLat).toBeCloseTo(COLOGNE.lat, 3);
    // ONE apply: the first load was superseded before its reply was consumed, so
    // only the surviving load reaches the UI. Was 2 before the staleness guard —
    // see the note on the test above for why the smaller number is the better one.
    expect(applied).toHaveLength(1);
  });

  it("reports a DEM outage as flat rather than as sea level", async () => {
    // `field: undefined` and an explicit note, never a zero heightfield: a hole
    // shaped exactly like the outage reads as terrain, and buries the buildings
    // standing in it.
    const provider: ElevationProvider = {
      attribution: "test",
      sourceId: "test",
      elevationAt: (positions) =>
        Promise.resolve(positions.map(() => undefined)),
    };
    const { load, applied } = cycleFor(provider);

    await load(COLOGNE);
    expect(applied[0]?.field).toBeUndefined();
    expect(applied[0]?.note).toBe("terrain unavailable — ground is flat");
  });

  it("says how much relief it found, and how much data was missing", async () => {
    // The relief is the one number distinguishing "loaded, and this place is
    // flat" from "did not load" — two facts that render identically.
    const provider: ElevationProvider = {
      attribution: "test",
      sourceId: "test",
      elevationAt: (positions) =>
        Promise.resolve(positions.map((_, i) => (i === 0 ? undefined : 106))),
    };
    const { load, applied } = cycleFor(provider);

    await load(COLOGNE);
    expect(applied[0]?.note).toMatch(
      /^terrain ±0 m \(1\/\d+ samples missing\)$/,
    );
  });

  it("never rejects — a DEM failure must not take the 3D view down", async () => {
    const provider: ElevationProvider = {
      attribution: "test",
      sourceId: "test",
      elevationAt: () => Promise.reject(new Error("tiles are down")),
    };
    const { load, applied } = cycleFor(provider);

    await load(COLOGNE);
    expect(applied[0]?.field).toBeUndefined();
    expect(applied[0]?.note).toBe("terrain unavailable — ground is flat");
  });
});

describe("createTerrainCycle — a superseded load applies nothing", () => {
  it("drops a field whose reply landed just before the supersession", async () => {
    // WHY THIS TEST MATTERS, and a PR review is what surfaced it. `refresh-cycle.ts`
    // grew an `if (signal.aborted) return;` guard for a race that applies verbatim
    // here: if the worker's reply has already settled when a newer position
    // arrives, the abort has nothing left to cancel and the continuation runs
    // anyway — so `apply` fires with the SUPERSEDED centre's field.
    //
    // The consequence is worse here than the refresh cycle's one-frame flash,
    // because this module's entire documented reason for existing is "the
    // interleaving that made an older heightfield win". Shipping the RPC rewrite
    // without carrying the guard across reintroduced the exact bug the file was
    // written to prevent.
    //
    // The provider answers IMMEDIATELY here, unlike the tests above: the race being
    // pinned is a reply that has already landed, so holding the call open would
    // model the opposite situation.
    const immediate: ElevationProvider = {
      attribution: "test",
      sourceId: "test",
      elevationAt: (positions) =>
        Promise.resolve(positions.map((_, i) => (i === 0 ? 0 : 40))),
    };

    const applied: TerrainState[] = [];
    let superseded = false;
    // A function DECLARATION, hoisted so the callback can name it before `load` is
    // bound. A `let` holder is the same thing plus a reassignment `prefer-const`
    // objects to.
    function supersede(): void {
      void load(BONN);
    }
    const load = createTerrainCycle({
      worker: {
        call: async (_kind, payload) => {
          const field = await buildHeightfieldData(immediate, {
            frame: enuFrameAt(payload.centre),
            extentM: payload.extentM,
            spacingM: payload.spacingM,
          });
          // Supersede ONCE, after the reply exists and before the continuation.
          if (!superseded) {
            superseded = true;
            supersede();
          }
          return {
            field: field.hasData ? field : undefined,
            note: describeTerrain(field),
          };
        },
      },
      extentM: 50,
      spacingM: 50,
      apply: (state) => applied.push(state),
    });

    await load(COLOGNE);
    await settle();

    // ONE apply, not two: the superseded load applied nothing, and the load that
    // replaced it applied everything. Without the guard both fire — and the OLDER
    // one can be the last to land, which is the failure mode by name.
    expect(applied).toHaveLength(1);
  });
});
