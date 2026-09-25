/**
 * Orchestrator tests — the real store + the real proximity driver + the real
 * `createTourScene`, against the recording fake adapter. No THREE renderer, no
 * WebGL, no DOM: this is the payoff of the port (plan A20).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Vector3 } from "three";

import { createViewingStore } from "../../../store/viewing-store.js";
import { loadTour, clearTour } from "../../../store/tour-slice.js";
import type { Tour } from "../../../store/types.js";
import {
  createCountingAssetProvider,
  createFakeSceneAdapter,
  type CountingAssetProvider,
  type FakeSceneAdapter,
} from "./fake-scene-adapter.js";
import { createTourScene, type TourScene } from "./tour-scene.js";

/** Let queued microtasks (fetch → parse → attach) settle. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const TOUR: Tour = {
  id: "tour-test",
  name: "Test",
  description: "",
  assets: [
    { id: "asset-knight", type: "model", filename: "assets/knight.glb" },
    { id: "asset-flag", type: "sprite", filename: "assets/flag.png" },
    { id: "asset-story", type: "audio", filename: "assets/story.mp3" },
  ],
  waypoints: [
    {
      id: "wp-a",
      position: { lat: 1, lon: 1 },
      prefetchRadius: 25,
      activeRadius: 10,
      content: {
        model: "asset-knight",
        audio: "asset-story",
        transcript: "Sir Aldric guarded this gate.",
      },
    },
    {
      id: "wp-b",
      position: { lat: 2, lon: 2 },
      prefetchRadius: 25,
      activeRadius: 10,
      content: { sprite: "asset-flag", audio: "asset-story" },
    },
    // Never anchored: the fake has no position for it (bootstrap phase, A19).
    {
      id: "wp-c",
      position: { lat: 3, lon: 3 },
      prefetchRadius: 25,
      activeRadius: 10,
      content: {},
    },
  ],
  breadcrumb: [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 5 },
    { lat: 0, lon: 200 },
  ],
};

const POSITIONS: Readonly<Record<string, Vector3>> = {
  "wp-a": new Vector3(0, 0, 0),
  "wp-b": new Vector3(200, 0, 0),
};

interface Harness {
  store: ReturnType<typeof createViewingStore>;
  adapter: FakeSceneAdapter;
  provider: CountingAssetProvider;
  scene: TourScene;
  /** Move the visitor and run a frame. */
  walkTo(x: number, z?: number): void;
}

function setup(
  overrides: {
    failingAssets?: ReadonlySet<string>;
    manualParse?: boolean;
    audioReady?: boolean;
    failingProviderAssets?: ReadonlySet<string>;
    modelLruCapacity?: number;
    tour?: Tour;
    positions?: Readonly<Record<string, Vector3>>;
  } = {},
): Harness {
  const store = createViewingStore();
  const adapter = createFakeSceneAdapter({
    positions: overrides.positions ?? POSITIONS,
    failingAssets: overrides.failingAssets,
    manualParse: overrides.manualParse,
    audioReady: overrides.audioReady,
  });
  const provider = createCountingAssetProvider(overrides.failingProviderAssets);
  const scene = createTourScene({
    store,
    adapter,
    assetProvider: provider,
    hysteresisFraction: 0.15,
    modelLruCapacity: overrides.modelLruCapacity,
    log: () => {
      /* quiet in tests */
    },
  });
  store.dispatch(loadTour(overrides.tour ?? TOUR));

  return {
    store,
    adapter,
    provider,
    scene,
    walkTo(x: number, z = 0): void {
      adapter.setUserPosition(new Vector3(x, 0, z));
      scene.tick(1 / 60);
    },
  };
}

/** Walk from far away to `x`, one step per tick, so zones advance one at a time. */
function approach(h: Harness, from: number, to: number, step = 5): void {
  const direction = to >= from ? step : -step;
  for (let x = from; direction > 0 ? x <= to : x >= to; x += direction) {
    h.walkTo(x);
  }
  h.walkTo(to);
}

describe("tour load", () => {
  it("anchors every waypoint and seeds the zones slice", () => {
    const h = setup();
    const roots = h.adapter.calls.filter(
      (c) => c.kind === "createWaypointRoot",
    );
    expect(roots.map((c) => c.id)).toEqual(["wp-a", "wp-b", "wp-c"]);
    expect(h.store.getState().zones.byWaypointId).toEqual({
      "wp-a": "IDLE",
      "wp-b": "IDLE",
      "wp-c": "IDLE",
    });
  });

  it("leaves an un-bootstrapped waypoint IDLE however close the visitor gets", async () => {
    // wp-c has no anchored position: activating it would put the knight on a
    // provisional GPS fix, tens of metres out (plan A19).
    const h = setup();
    approach(h, 100, 0);
    await flush();
    expect(h.store.getState().zones.byWaypointId["wp-c"]).toBe("IDLE");
  });

  it("rebuilds wholesale when the tour changes", async () => {
    const h = setup();
    approach(h, 100, 0);
    await flush();
    expect(h.adapter.liveVisuals.size).toBeGreaterThan(0);

    h.store.dispatch(clearTour());
    await flush();
    expect(h.adapter.liveVisuals.size).toBe(0);
    expect(h.provider.outstanding).toBe(0);
  });
});

describe("zone lifecycle", () => {
  it("builds invisibly at PREFETCHING and only shows at ACTIVE", async () => {
    const h = setup();
    h.walkTo(100); // far: IDLE
    await flush();
    expect(h.adapter.calls.some((c) => c.kind === "buildTemplate")).toBe(false);

    h.walkTo(20); // inside 25 m: PREFETCHING
    await flush();
    expect(h.adapter.liveVisuals.size).toBe(1);
    expect(h.adapter.visible.has("wp-a")).toBe(false); // parsed, INVISIBLE (§2.5.3)

    h.walkTo(5); // inside 10 m: ACTIVE
    await flush();
    expect(h.adapter.visible.has("wp-a")).toBe(true);
  });

  it("never shows a visual before it was instantiated", async () => {
    const h = setup();
    approach(h, 100, 0);
    await flush();
    const instantiateAt = h.adapter.calls.findIndex(
      (c) => c.kind === "instantiate" && c.id === "wp-a",
    );
    const showAt = h.adapter.calls.findIndex(
      (c) => c.kind === "show" && c.id === "wp-a",
    );
    expect(instantiateAt).toBeGreaterThanOrEqual(0);
    expect(showAt).toBeGreaterThan(instantiateAt);
  });

  it("marks the waypoint visited on its first ACTIVE edge (plan A18)", async () => {
    const h = setup();
    approach(h, 100, 0);
    await flush();
    expect(h.store.getState().tourProgress.visitedWaypointIds).toContain(
      "wp-a",
    );
  });

  it("hides but keeps the model warm when dropping back to PREFETCHING", async () => {
    const h = setup();
    approach(h, 100, 0);
    await flush();
    const templatesWhileActive = h.adapter.liveTemplates.size;

    h.walkTo(20); // back outside the active radius, still inside prefetch
    await flush();
    expect(h.adapter.visible.has("wp-a")).toBe(false);
    expect(h.adapter.liveTemplates.size).toBe(templatesWhileActive);
    expect(h.adapter.liveVisuals.size).toBe(1); // the clone survives too
  });

  it("releases the clone when the waypoint goes IDLE", async () => {
    const h = setup();
    approach(h, 100, 0);
    await flush();
    approach(h, 0, 100);
    await flush();
    expect(h.adapter.liveVisuals.size).toBe(0);
  });

  it("only ACTIVE waypoints are tappable (plan A12)", async () => {
    const h = setup();
    h.walkTo(20);
    await flush();
    expect(h.adapter.pickTargetIds).toEqual([]); // prefetching = invisible = not pickable

    h.walkTo(5);
    await flush();
    expect(h.adapter.pickTargetIds).toEqual(["wp-a"]);
  });
});

describe("the parsed-model LRU (plan A9)", () => {
  it("parses a shared asset once for two waypoints", async () => {
    const shared: Tour = {
      ...TOUR,
      waypoints: [
        { ...TOUR.waypoints[0]!, content: { model: "asset-knight" } },
        {
          ...TOUR.waypoints[1]!,
          position: { lat: 1, lon: 1 },
          content: { model: "asset-knight" },
        },
      ],
    };
    // Both waypoints sit at the same world position, so one walk brings them
    // into range in the SAME update — the in-flight de-duplication case.
    const h = setup({
      tour: shared,
      positions: {
        "wp-a": new Vector3(0, 0, 0),
        "wp-b": new Vector3(0, 0, 0),
      },
    });
    approach(h, 100, 0);
    await flush();

    const parses = h.adapter.calls.filter((c) => c.kind === "buildTemplate");
    expect(parses).toHaveLength(1);
    expect(h.adapter.liveVisuals.size).toBe(2); // two clones, one template
    expect(h.provider.counts.get("asset-knight")).toBe(1);
  });

  it("keeps a template warm after IDLE, so walking back does not re-parse", async () => {
    const h = setup();
    approach(h, 100, 0);
    await flush();
    approach(h, 0, 100); // walk away → IDLE
    await flush();
    expect(h.adapter.liveTemplates.size).toBe(1); // still warm
    expect(h.provider.outstanding).toBe(1); // the cache entry owns the blob ref

    approach(h, 100, 0); // walk back
    await flush();
    expect(
      h.adapter.calls.filter((c) => c.kind === "buildTemplate"),
    ).toHaveLength(1); // no second parse
  });

  it("disposes and releases only on eviction", async () => {
    const h = setup({ modelLruCapacity: 0 }); // keep nothing warm
    approach(h, 100, 0);
    await flush();
    expect(h.provider.outstanding).toBe(1);

    approach(h, 0, 100);
    await flush();
    expect(h.adapter.liveTemplates.size).toBe(0);
    expect(h.provider.outstanding).toBe(0);
  });
});

describe("soft-fail on a bad asset (contract D14b)", () => {
  it("shows a fallback marker and keeps the tour running", async () => {
    const h = setup({
      failingProviderAssets: new Set(["asset-knight"]),
    });
    approach(h, 100, 0);
    await flush();
    expect(
      h.adapter.calls.some(
        (c) => c.kind === "buildFallbackVisual" && c.id === "wp-a",
      ),
    ).toBe(true);
    expect(h.adapter.visible.has("wp-a")).toBe(true);
    // A rejected getAssetUrl took no reference — releasing it would throw here.
    expect(h.provider.outstanding).toBe(0);
  });

  it("releases the blob when the PARSE fails after a successful fetch", async () => {
    const h = setup({ failingAssets: new Set(["blob:asset-knight"]) });
    approach(h, 100, 0);
    await flush();
    expect(h.provider.outstanding).toBe(0);
  });
});

describe("a breadcrumb-only stop with a transcript", () => {
  const TRANSCRIPT_ONLY_TOUR: Tour = {
    id: "tour-transcript-only",
    name: "Test",
    description: "",
    assets: [],
    waypoints: [
      {
        id: "wp-text",
        position: { lat: 1, lon: 1 },
        prefetchRadius: 25,
        activeRadius: 10,
        content: { transcript: "Nothing to see, only to read." },
      },
    ],
    breadcrumb: [],
  };
  const TRANSCRIPT_ONLY_POSITIONS: Readonly<Record<string, Vector3>> = {
    "wp-text": new Vector3(0, 0, 0),
  };

  it("skips the marker and shows the transcript centered in its slot", async () => {
    const h = setup({
      tour: TRANSCRIPT_ONLY_TOUR,
      positions: TRANSCRIPT_ONLY_POSITIONS,
    });
    approach(h, 100, 0);
    await flush();

    expect(
      h.adapter.calls.some(
        (c) => c.kind === "buildFallbackVisual" && c.id === "wp-text",
      ),
    ).toBe(false);
    expect(
      h.adapter.calls.some(
        (c) => c.kind === "buildFallbackVisual:noMarker" && c.id === "wp-text",
      ),
    ).toBe(true);
    expect(
      h.adapter.transcriptLog.some(
        (e) => e.startsWith("show:wp-text") && e.endsWith(":centered"),
      ),
    ).toBe(true);
  });
});

describe("the story session", () => {
  let h: Harness;
  beforeEach(async () => {
    h = setup();
    approach(h, 100, 0);
    await flush();
  });

  it("plays on tap and shows the transcript", async () => {
    h.adapter.emitTap({ waypointId: "wp-a", role: "visual" });
    await flush();
    expect(h.adapter.audioLog).toContain("play:wp-a:blob:asset-story");
    expect(h.adapter.transcriptLog.some((e) => e.startsWith("show:wp-a"))).toBe(
      true,
    );
  });

  it("toggles pause when the playing knight is tapped again", async () => {
    h.adapter.emitTap({ waypointId: "wp-a", role: "visual" });
    await flush();
    h.adapter.emitTap({ waypointId: "wp-a", role: "visual" });
    expect(h.adapter.audioLog).toContain("pause");
  });

  it("ignores taps on a waypoint that is not ACTIVE", () => {
    h.adapter.emitTap({ waypointId: "wp-b", role: "visual" });
    expect(h.adapter.audioLog).toEqual([]);
  });

  it("pages the transcript instead of restarting the story", () => {
    h.adapter.emitTap({ waypointId: "wp-a", role: "visual" });
    h.adapter.emitTap({ waypointId: "wp-a", role: "transcript" });
    expect(h.adapter.transcriptLog).toContain("page:wp-a");
  });

  it("stops the story when the visitor walks away", async () => {
    h.adapter.emitTap({ waypointId: "wp-a", role: "visual" });
    await flush();
    approach(h, 0, 20);
    expect(h.adapter.audioLog).toContain("stop");
  });

  it("clears the session when the audio ends", async () => {
    h.adapter.emitTap({ waypointId: "wp-a", role: "visual" });
    await flush();
    h.adapter.emitAudioEnded();
    expect(h.scene.debug().story.playingId).toBeNull();
  });
});

describe("audio gate (plan A16)", () => {
  it("surfaces a blocked AudioContext instead of failing silently", async () => {
    const store = createViewingStore();
    const adapter = createFakeSceneAdapter({
      positions: POSITIONS,
      audioReady: false,
    });
    const provider = createCountingAssetProvider();
    let blocked = 0;
    const scene = createTourScene({
      store,
      adapter,
      assetProvider: provider,
      hysteresisFraction: 0.15,
      onAudioBlocked: () => {
        blocked += 1;
      },
      log: () => {
        /* quiet */
      },
    });
    store.dispatch(loadTour(TOUR));
    for (let x = 100; x >= 0; x -= 5) {
      adapter.setUserPosition(new Vector3(x, 0, 0));
      scene.tick(1 / 60);
    }
    await flush();

    adapter.emitTap({ waypointId: "wp-a", role: "visual" });
    expect(blocked).toBe(1);
    expect(adapter.audioLog).toEqual([]);
    scene.dispose();
  });
});

describe("the breadcrumb trail", () => {
  it("shows only the orbs near the visitor", () => {
    const h = setup();
    // The fake maps lat→X and lon→Z. Breadcrumb points sit at z = 0, 5 and 200.
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1); // > the 0.25 s trail interval
    expect(h.adapter.orbCount).toBe(2); // the far point is outside the 15 m window
  });

  it("draws one orb for breadcrumbs stacked on the same spot, so their glow cannot sum to another colour", () => {
    const h = setup({
      tour: {
        ...TOUR,
        // z = 0, 0.2 (20 cm apart: overlapping orbs) and 5.
        breadcrumb: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 0.2 },
          { lat: 0, lon: 5 },
        ],
      },
    });
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1);
    expect(h.adapter.orbCount).toBe(2);
  });

  it("guides toward the nearest unvisited breadcrumb and marks it visited on arrival", () => {
    const h = setup();
    h.scene.setWayfindingEnabled(true);
    // Stand right on breadcrumb 0 (0,0,0) — within the 5 m arrival radius —
    // so it should be marked visited and the guide should advance to
    // breadcrumb 1 at (0,0,5).
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1); // > the 0.25 s trail interval

    expect(h.store.getState().breadcrumbProgress.visitedIndices).toEqual([0]);
    expect(h.adapter.wayfindingTarget).toEqual({
      kind: "breadcrumb",
      index: 1,
      coord: { lat: 0, lon: 5 },
    });
  });

  it("falls back to the next unvisited waypoint once no breadcrumb is within the give-up radius", () => {
    const h = setup();
    h.scene.setWayfindingEnabled(true);
    h.adapter.setUserPosition(new Vector3(0, 0, 0));

    // First tick: breadcrumb 0 (dist 0) is visited; the guide advances to
    // breadcrumb 1 (dist 5), still close enough to trust.
    h.scene.tick(1);
    expect(h.adapter.wayfindingTarget).toEqual({
      kind: "breadcrumb",
      index: 1,
      coord: { lat: 0, lon: 5 },
    });

    // Second tick, same spot: breadcrumb 1 is now within arrival radius too
    // and gets visited, leaving only breadcrumb 2 at 200 m — well past the
    // 50 m give-up radius — so the guide falls back to the first unvisited
    // waypoint (tour order, D8) instead of pointing at a hopelessly distant
    // breadcrumb.
    h.scene.tick(1);
    expect(h.store.getState().breadcrumbProgress.visitedIndices).toEqual([
      0, 1,
    ]);
    expect(h.adapter.wayfindingTarget).toEqual({
      kind: "waypoint",
      id: "wp-a",
      coord: { lat: 1, lon: 1 },
    });
  });

  it("never re-visits an already-visited breadcrumb, even standing on it again", () => {
    const h = setup();
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1);
    expect(h.store.getState().breadcrumbProgress.visitedIndices).toContain(0);

    // Walk away and back to the same spot.
    h.adapter.setUserPosition(new Vector3(50, 0, 0));
    h.scene.tick(1);
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1);

    // Index 0 appears exactly once no matter how many times the visitor
    // stands on it — the one-way latch (BW3), not exact-array-equality
    // (breadcrumb 1 sits exactly at the 5 m arrival boundary in this fixture
    // and legitimately gets swept in on this second pass too).
    const visited = h.store.getState().breadcrumbProgress.visitedIndices;
    expect(visited.filter((i) => i === 0)).toHaveLength(1);
  });
});

describe("the wayfinding guide toggle", () => {
  it("shows no guide target until setWayfindingEnabled(true) is called, even with a real target available", () => {
    const h = setup();
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1);

    // Progress still advances in the background — only the visual is gated.
    expect(h.store.getState().breadcrumbProgress.visitedIndices).toEqual([0]);
    expect(h.adapter.wayfindingTarget).toBeNull();
  });

  it("shows the guide target once enabled", () => {
    const h = setup();
    h.scene.setWayfindingEnabled(true);
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1);

    expect(h.adapter.wayfindingTarget).toEqual({
      kind: "breadcrumb",
      index: 1,
      coord: { lat: 0, lon: 5 },
    });
  });

  it("hides the guide again after being disabled", () => {
    const h = setup();
    h.scene.setWayfindingEnabled(true);
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1);
    expect(h.adapter.wayfindingTarget).not.toBeNull();

    h.scene.setWayfindingEnabled(false);
    h.adapter.setUserPosition(new Vector3(50, 0, 0));
    h.scene.tick(1);
    expect(h.adapter.wayfindingTarget).toBeNull();
  });

  it("reports every ACTIVE waypoint's world position to the adapter, for it to decide whether that content is actually in view", () => {
    const h = setup();
    h.scene.setWayfindingEnabled(true);

    // Far from every waypoint (wp-a's 10 m active radius sits at world
    // (0,0,0)).
    h.adapter.setUserPosition(new Vector3(0, 0, 40));
    h.scene.tick(1);
    expect(h.adapter.activeWaypointPositions).toEqual([]);

    // Step toward wp-a one metre at a time — the proximity machine is a
    // single-step state machine (contract), so a big jump only advances
    // one zone per tick; a gradual approach is what actually lands on
    // ACTIVE within this test, same as the `approach()` helper does along X.
    for (let z = 40; z >= 8; z -= 1) {
      h.adapter.setUserPosition(new Vector3(0, 0, z));
      h.scene.tick(1);
    }
    expect(h.store.getState().zones.byWaypointId["wp-a"]).toBe("ACTIVE");
    expect(h.adapter.activeWaypointPositions).toEqual([new Vector3(0, 0, 0)]);

    // Walking back out of range clears it again — deliberately NOT
    // asserting on `wayfindingTarget` here: whether the guide actually
    // hides while a waypoint is ACTIVE is the real adapter's decision
    // (it needs the camera to know if that content is actually in view),
    // covered in `breadcrumb-guide.test.ts`, not this fake's.
    for (let z = 8; z <= 40; z += 1) {
      h.adapter.setUserPosition(new Vector3(0, 0, z));
      h.scene.tick(1);
    }
    expect(h.adapter.activeWaypointPositions).toEqual([]);
  });
});

describe("dispose (plan §7.1)", () => {
  it("leaves no visuals, no templates and ZERO outstanding asset references", async () => {
    const h = setup();
    approach(h, 100, 0);
    await flush();
    h.adapter.emitTap({ waypointId: "wp-a", role: "visual" });
    await flush();
    expect(h.provider.outstanding).toBeGreaterThan(0);

    h.scene.dispose();
    await flush();
    expect(h.adapter.liveVisuals.size).toBe(0);
    expect(h.adapter.liveTemplates.size).toBe(0);
    expect(h.provider.outstanding).toBe(0);
  });

  it("is safe while a parse is still in flight", async () => {
    const h = setup({ manualParse: true });
    approach(h, 100, 20);
    await flush();

    h.scene.dispose();
    h.adapter.settleParse("blob:asset-knight"); // lands after teardown
    await flush();

    expect(h.adapter.liveVisuals.size).toBe(0);
    expect(h.provider.outstanding).toBe(0); // the late result released itself
  });

  it("is idempotent", async () => {
    const h = setup();
    approach(h, 100, 0);
    await flush();
    h.scene.dispose();
    expect(() => {
      h.scene.dispose();
    }).not.toThrow();
  });

  it("stops ticking after disposal", async () => {
    const h = setup();
    h.scene.dispose();
    const before = h.adapter.calls.length;
    h.walkTo(0);
    await flush();
    expect(h.adapter.calls.length).toBe(before);
  });
});
