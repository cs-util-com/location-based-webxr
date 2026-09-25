/**
 * **The §2.4 composed-flow test.** TASK.md asks for exactly this and says why
 * it matters: "an end-to-end replay test that loads a real tour zip, plays one
 * of your Task 1 walks through the app in viewing mode, and asserts that the
 * right knights become active (appear) at the right points along the route…
 * this is the test that proves all the pieces are plugged together correctly,
 * not just individually correct."
 *
 * What is REAL here, end to end:
 *
 * - component 5 packs the zip (`startFixtureServer` runs the real `packTour`),
 * - a real HTTP server serves it with real 206/Range semantics,
 * - component 6 opens it — real central-directory parse, real `validateTour`
 *   on the recovered `tour.json`, real ref-counted asset provider reading
 *   asset bytes by byte range,
 * - component 3's real store, component 4's real proximity machine, and
 *   component 8's real orchestrator drive the walk,
 * - the positions come from a real Task 1 outdoor recording.
 *
 * Substituted: only the rendering layer (`FakeSceneAdapter`) and, with it, the
 * GPS anchoring — the walk is already world-space, so waypoints use the
 * identity `lat`=X / `lon`=Z convention component 8's own demo documents. The
 * real geo path is covered by `ar-seams.test.ts` and, on device, by the
 * checklist in this directory's README (plan VC19).
 *
 * This is a strictly larger claim than component 8's own replay e2e: that one
 * hand-built a `Tour` object and a counting provider; this one gets its tour
 * AND its asset bytes through the real packaging → hosting → range-read →
 * asset-provider chain, which is where composition bugs actually live.
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { replayRecording } from "gps-plus-slam-app-framework/state";
import { InMemoryLocalCacheStore } from "gps-plus-slam-app-framework/storage";
import { Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createViewingStore } from "../../store/viewing-store.js";
import { loadTour } from "../../store/tour-slice.js";
import { validateTour } from "../../store/validate-tour.js";
import { selectVisitedWaypointIds } from "../../store/selectors.js";
import type { Tour, Waypoint } from "../../store/types.js";
import { createTourScene } from "../../components/ar-scene/runtime/tour-scene.js";
import { createFakeSceneAdapter } from "../../components/ar-scene/runtime/fake-scene-adapter.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "../../components/cloud-loader/view/fixture-server.js";
import { openRemoteTour } from "../../components/cloud-loader/view/open-remote-tour.js";
import { restoreProgress, persistProgress } from "./progress-store.js";

const HYSTERESIS_FRACTION = 0.15; // contract D16 default
const PREFETCH_R = 25;
const ACTIVE_R = 10;

/** Tiny stand-ins: `FakeSceneAdapter` never parses the bytes. */
const KNIGHT_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);
const STORY_BYTES = new Uint8Array([0x49, 0x44, 0x33, 9, 8, 7, 6]);

function toVec(p: unknown): Vector3 {
  if (Array.isArray(p)) {
    return new Vector3(Number(p[0]), Number(p[1]), Number(p[2]));
  }
  const o = p as { x: number; y: number; z: number };
  return new Vector3(o.x, o.y, o.z);
}

function horizontal(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * The world-space walk is persisted as coordinates the way component 8's demo
 * does: `lat` is metres along X, `lon` metres along Z. This survives the round
 * trip through a REAL `tour.json` because `validate-tour.ts` checks coordinates
 * with `requireFiniteNumber` only — it has no lat/lon range check.
 *
 * That is load-bearing and invisible from here: if the shared contract ever
 * gains a bounds check, this test must fail loudly (the zip will not open)
 * rather than mysteriously.
 */
const asCoord = (v: Vector3): { lat: number; lon: number } => ({
  lat: v.x,
  lon: v.z,
});

let server: FixtureServer;
let walk: Vector3[];
let positions: Record<string, Vector3>;
let minDistance: Record<string, number>;
let authoredTour: Tour;

beforeAll(async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const zipPath = path.resolve(
    here,
    "../../../recordings/2026-06-22_16-06-59utc.zip",
  );
  const state = await replayRecording(new Uint8Array(readFileSync(zipPath)));
  walk = state.gpsData!.gpsEvents.odometryPositions.map(toVec);

  const at = (fraction: number): Vector3 =>
    walk[Math.floor(walk.length * fraction)]!.clone();

  // Synthesized from the route itself, so every expectation below is derived
  // from geometry rather than hand-tuned.
  const passA = at(0.25); // walked through
  const passB = at(0.7); // walked through
  const nearMiss = at(0.5).clone();
  nearMiss.z += 17; // inside PREFETCH (25 m), outside ACTIVE (10 m)
  const far = at(0.5).clone();
  far.x += 500; // never even prefetched

  positions = {
    "wp-gate": passA,
    "wp-tower": passB,
    "wp-near-miss": nearMiss,
    "wp-far": far,
  };

  const waypointAt = (
    id: string,
    point: Vector3,
    content: Waypoint["content"],
  ): Waypoint => ({
    id,
    position: asCoord(point),
    prefetchRadius: PREFETCH_R,
    activeRadius: ACTIVE_R,
    content,
  });

  authoredTour = {
    id: "tour-replay",
    name: "Task 1 replay walk",
    description: "A real outdoor recording, played through viewing mode.",
    assets: [
      { id: "asset-knight", type: "model", filename: "assets/knight.glb" },
      { id: "asset-banner", type: "sprite", filename: "assets/banner.png" },
      { id: "asset-story", type: "audio", filename: "assets/story.mp3" },
    ],
    waypoints: [
      waypointAt("wp-gate", passA, {
        model: "asset-knight",
        audio: "asset-story",
        transcript: "Sir Aldric held this gate for thirty winters.",
      }),
      waypointAt("wp-tower", passB, {
        sprite: "asset-banner",
        audio: "asset-story",
        transcript: "The market banner flew here every spring until 1643.",
      }),
      waypointAt("wp-near-miss", nearMiss, { model: "asset-knight" }),
      waypointAt("wp-far", far, { model: "asset-knight" }),
    ],
    breadcrumb: walk
      .filter((_, index) => index % 20 === 0)
      .map((point) => asCoord(point)),
  };

  minDistance = {};
  for (const [id, position] of Object.entries(positions)) {
    minDistance[id] = Math.min(
      ...walk.map((sample) => horizontal(sample, position)),
    );
  }

  // Component 5 packs this for real inside `startFixtureServer`.
  server = await startFixtureServer(
    authoredTour,
    new Map([
      ["asset-knight", new File([KNIGHT_BYTES], "knight.glb")],
      ["asset-banner", new File([KNIGHT_BYTES], "banner.png")],
      ["asset-story", new File([STORY_BYTES], "story.mp3")],
    ]),
  );
}, 30_000);

afterAll(async () => {
  await server.close();
});

/** `URL.createObjectURL` does not exist in Node — the loader's documented seam. */
function openOptions() {
  const blobs = new Map<string, Blob>();
  let n = 0;
  return {
    blobs,
    opts: {
      fetchImpl: fetch,
      localCacheStore: new InMemoryLocalCacheStore(),
      createObjectUrl: (blob: Blob) => {
        const url = `blob:replay/${++n}`;
        blobs.set(url, blob);
        return url;
      },
      revokeObjectUrl: (url: string) => {
        blobs.delete(url);
      },
    },
  };
}

interface WalkResult {
  readonly tour: Tour;
  readonly everVisible: ReadonlySet<string>;
  readonly calls: readonly { kind: string; id: string }[];
  readonly visitedIds: readonly string[];
  readonly outstandingRefs: number;
  readonly assetUrlsSeen: number;
  readonly firstActiveIndex: ReadonlyMap<string, number>;
}

/** Open the hosted zip and play the whole recorded walk through a real scene. */
async function runComposedWalk(urlPath = "ranges-ok"): Promise<WalkResult> {
  const { opts } = openOptions();
  const opened = await openRemoteTour(
    `${server.origin}/${urlPath}/tour.zip`,
    opts,
  );

  // The tour the scene runs on is the one recovered from the zip, not the
  // in-memory object that was packed.
  const tour = opened.tour;
  expect(() => validateTour(JSON.parse(JSON.stringify(tour)))).not.toThrow();

  let assetUrlsSeen = 0;
  let outstandingRefs = 0;
  const provider = {
    getAssetUrl: async (id: string) => {
      const url = await opened.assetProvider.getAssetUrl(id);
      assetUrlsSeen += 1;
      outstandingRefs += 1;
      return url;
    },
    release: (id: string) => {
      outstandingRefs -= 1;
      opened.assetProvider.release(id);
    },
  };

  const store = createViewingStore();
  const adapter = createFakeSceneAdapter({ positions });
  const scene = createTourScene({
    store,
    adapter,
    assetProvider: provider,
    hysteresisFraction: HYSTERESIS_FRACTION,
    log: () => {
      /* quiet */
    },
  });
  store.dispatch(loadTour(tour));

  const everVisible = new Set<string>();
  const firstActiveIndex = new Map<string, number>();

  // The fetch+parse chain is async even against the fake adapter, so the walk
  // advances with settle points — same mechanic component 8's own replay e2e
  // uses, so the ordering matches what a real frame loop would produce.
  for (const [index, sample] of walk.entries()) {
    adapter.setUserPosition(sample);
    scene.tick(1 / 30);
    await Promise.resolve();
    await Promise.resolve();
    for (const id of adapter.visible) {
      if (!everVisible.has(id)) {
        everVisible.add(id);
        firstActiveIndex.set(id, index);
      }
    }
  }

  const visitedIds = [...selectVisitedWaypointIds(store.getState())];
  const calls = adapter.calls.map((call) => ({ kind: call.kind, id: call.id }));
  scene.dispose();

  return {
    tour,
    everVisible,
    calls,
    visitedIds,
    outstandingRefs,
    assetUrlsSeen,
    firstActiveIndex,
  };
}

describe("Viewing mode composed flow — real zip, real walk", () => {
  let result: WalkResult;

  beforeAll(async () => {
    result = await runComposedWalk();
  }, 60_000);

  it("recovers a valid tour from the hosted zip", () => {
    expect(result.tour.id).toBe("tour-replay");
    expect(result.tour.waypoints).toHaveLength(4);
    expect(result.tour.breadcrumb.length).toBeGreaterThan(0);
  });

  it("shows exactly the knights the route actually reaches (the §2.4 property)", () => {
    const expected = Object.entries(minDistance)
      .filter(([, distance]) => distance < ACTIVE_R)
      .map(([id]) => id)
      .sort();

    // Guard against a vacuous pass: this route must genuinely reach some
    // waypoints and genuinely miss others, or the assertion below proves
    // nothing.
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(expected.length).toBeLessThan(Object.keys(minDistance).length);

    expect([...result.everVisible].sort()).toEqual(expected);
    // Stated explicitly, because it is the interesting half: a waypoint the
    // visitor passes at 17 m is prefetched but must never appear.
    expect(result.everVisible.has("wp-near-miss")).toBe(false);
    expect(result.everVisible.has("wp-far")).toBe(false);
  });

  it("never shows a knight before it has been instantiated (anti-jank ordering)", () => {
    const firstIndex = (kind: string, id: string): number =>
      result.calls.findIndex((call) => call.kind === kind && call.id === id);

    expect(result.everVisible.size).toBeGreaterThan(0);
    for (const id of result.everVisible) {
      const instantiated = firstIndex("instantiate", id);
      const shown = firstIndex("show", id);
      expect(
        instantiated,
        `${id} was never instantiated`,
      ).toBeGreaterThanOrEqual(0);
      expect(shown, `${id} was shown before it existed`).toBeGreaterThan(
        instantiated,
      );
    }
  });

  it("marks reached waypoints visited, and only those", () => {
    expect([...result.visitedIds].sort()).toEqual(
      [...result.everVisible].sort(),
    );
  });

  it("reads asset bytes through the real provider and releases every reference", () => {
    expect(result.assetUrlsSeen).toBeGreaterThan(0);
    expect(result.outstandingRefs).toBe(0);
  });

  it("activates each knight where the route actually crosses its active radius", () => {
    for (const [id, index] of result.firstActiveIndex) {
      const position = positions[id]!;
      // Every sample before the first ACTIVE must have been outside the radius
      // (allowing the hysteresis band) — i.e. the machine did not fire early.
      const earliestCrossing = walk.findIndex(
        (sample) => horizontal(sample, position) < ACTIVE_R,
      );
      expect(earliestCrossing).toBeGreaterThanOrEqual(0);
      expect(index).toBeGreaterThanOrEqual(earliestCrossing);
    }
  });
});

describe("Viewing mode composed flow — a range-refusing host still works", () => {
  it("falls back to a full download and produces the same tour", async () => {
    // §2.5.6: some real hosts answer 200 with the whole body. The visitor must
    // not be able to tell — the composition does nothing special for it.
    const result = await runComposedWalk("no-ranges");

    expect([...result.everVisible].sort()).toEqual(
      Object.entries(minDistance)
        .filter(([, distance]) => distance < ACTIVE_R)
        .map(([id]) => id)
        .sort(),
    );
    expect(result.outstandingRefs).toBe(0);
  }, 60_000);
});

describe("Progress survives a reload mid-walk (VC14)", () => {
  it("restores the visited set into a fresh store", () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    persistProgress("tour-replay", ["wp-gate"], fake);

    const store = createViewingStore();
    store.dispatch(loadTour(authoredTour));
    restoreProgress(store.dispatch, "tour-replay", fake);

    expect([...selectVisitedWaypointIds(store.getState())]).toEqual([
      "wp-gate",
    ]);
  });
});
