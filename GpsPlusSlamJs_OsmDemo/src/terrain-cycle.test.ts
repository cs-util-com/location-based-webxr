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
import {
  createTerrainCycle,
  type TerrainLoad,
  type TerrainState,
} from "./terrain-cycle.js";

const COLOGNE: LatLng = { lat: 50.9412, lng: 6.9583 };
const BONN: LatLng = { lat: 50.7339, lng: 7.0997 };

/**
 * A load whose window and frame are the same point — the pre-anchor shape.
 *
 * These tests are about ORDERING, not about the frame, so they hold the two
 * together deliberately: `terrain-window.test.ts` owns the question of what
 * happens when they differ, and mixing the two concerns here would make an
 * ordering failure look like a frame failure.
 */
const at = (position: LatLng) => ({
  centre: position,
  frameOrigin: position,
});

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
  load: (request: TerrainLoad) => Promise<void>;
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
          // The real worker reports this even for a failed load; the fake must
          // too, or these tests would pass for a worker that stopped.
          centreEnu: enuFrameAt(payload.frameOrigin).toEnu(payload.centre),
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

    void load(at(COLOGNE));
    void load(at(BONN));

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

    void load(at(COLOGNE));
    void load(at(BONN));
    void load(at(COLOGNE));

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

    await load(at(COLOGNE));
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

    await load(at(COLOGNE));
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

    await load(at(COLOGNE));
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
      void load(at(BONN));
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
            centreEnu: enuFrameAt(payload.frameOrigin).toEnu(payload.centre),
          };
        },
      },
      extentM: 50,
      spacingM: 50,
      apply: (state) => applied.push(state),
    });

    await load(at(COLOGNE));
    await settle();

    // ONE apply, not two: the superseded load applied nothing, and the load that
    // replaced it applied everything. Without the guard both fire — and the OLDER
    // one can be the last to land, which is the failure mode by name.
    expect(applied).toHaveLength(1);
  });
});

describe("createTerrainCycle — the frame is SENT, not re-derived", () => {
  /**
   * WHY THESE TESTS MATTER. Everything else in this file holds `centre` and
   * `frameOrigin` equal on purpose, because these tests are about ordering. That
   * leaves a hole: with the two always the same value, `createTerrainCycle`
   * could drop `frameOrigin`, or swap the two, and every assertion would still
   * pass. `terrain-window.test.ts` covers what the WORKER does with the pair —
   * nothing covered the cycle actually forwarding it. Raised in review on #269.
   */
  function capturingWorker() {
    const payloads: {
      centre: LatLng;
      frameOrigin: LatLng;
      extentM: number;
      spacingM: number;
    }[] = [];
    const worker = {
      call: (
        _kind: "terrain",
        payload: {
          centre: LatLng;
          frameOrigin: LatLng;
          extentM: number;
          spacingM: number;
        },
      ) => {
        payloads.push(payload);
        // A FAILED load, reported exactly as the real worker reports one: no
        // field, but still a window centre — derived from the pair, so a cycle
        // that swapped the two would produce a visibly wrong value here.
        return Promise.resolve({
          field: undefined,
          note: "terrain unavailable — ground is flat",
          centreEnu: enuFrameAt(payload.frameOrigin).toEnu(payload.centre),
        });
      },
    };
    return { worker, payloads };
  }

  it("forwards centre and frameOrigin as DISTINCT values", async () => {
    // Cologne and Bonn are ~26 km apart, so a swap or a drop is unmissable.
    const { worker, payloads } = capturingWorker();
    const load = createTerrainCycle({
      worker,
      extentM: 50,
      spacingM: 50,
      apply: () => {},
    });

    await load({ centre: COLOGNE, frameOrigin: BONN });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.centre).toEqual(COLOGNE);
    expect(payloads[0]?.frameOrigin).toEqual(BONN);
  });

  it("carries the window centre to `apply` even when the DEM produced NOTHING", async () => {
    // WHY THIS TEST MATTERS, AND WHAT IT DOES NOT COVER. A failed load still has
    // to say WHERE it was asked to look: the ground plane follows that centre,
    // and the plane is finite, so one left behind during an outage stops
    // covering the user as soon as they walk past its extent. Raised in review
    // on #269, where the code returned early instead — which fixed the
    // appearance (moving a flat plane is invisible) and missed the coverage.
    //
    // THIS test only pins that the cycle does not DROP the centre on the way to
    // `apply` while the field is undefined — the place a "no field, nothing to
    // report" shortcut would be written. That the worker produces it, and that
    // the plane then moves, is the e2e's job ("keeps the ground under the user
    // even when the terrain fails to load"), because neither the worker nor
    // `BuildingView` can be constructed here.
    const { worker } = capturingWorker();
    const applied: TerrainState[] = [];
    const load = createTerrainCycle({
      worker,
      extentM: 50,
      spacingM: 50,
      apply: (state) => applied.push(state),
    });

    await load({ centre: COLOGNE, frameOrigin: BONN });

    expect(applied).toHaveLength(1);
    expect(applied[0]?.field).toBeUndefined();
    // The exact value, not merely "defined": Cologne expressed in a frame
    // anchored at Bonn is ~23 km from its origin, so a dropped or swapped pair
    // cannot round to the same numbers.
    expect(applied[0]?.centreEnu).toEqual(enuFrameAt(BONN).toEnu(COLOGNE));
  });
});
