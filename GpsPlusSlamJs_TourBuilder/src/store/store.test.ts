import { describe, expect, it } from "vitest";

import { validateTour, TourValidationError } from "./validate-tour.js";
import { sampleTour } from "./fixtures/sample-tour.js";
import { tourReducer, loadTour, clearTour } from "./tour-slice.js";
import {
  tourProgressReducer,
  markWaypointVisited,
} from "./tour-progress-slice.js";
import { zonesReducer, initZones, setWaypointZone } from "./zones-slice.js";
import {
  breadcrumbProgressReducer,
  markBreadcrumbVisited,
} from "./breadcrumb-progress-slice.js";
import {
  authoringReducer,
  setTourMeta,
  addWaypoint,
  updateWaypoint,
  removeWaypoint,
  moveWaypoint,
  attachAsset,
  removeAsset,
  addBreadcrumbPoint,
  clearAuthoring,
  DEFAULT_ACTIVE_RADIUS_M,
  DEFAULT_PREFETCH_RADIUS_M,
} from "./authoring-slice.js";
import {
  selectTour,
  selectOrderedWaypoints,
  selectNextUnvisitedWaypoint,
  selectTourProgress,
  selectWaypointZone,
  selectActiveWaypointIds,
  selectWaypointVisual,
  selectExportedTour,
  selectAssets,
  selectWaypointById,
  selectIsWaypointVisited,
  selectVisitedWaypointIds,
  selectVisitedBreadcrumbIndices,
  type ViewingStateShape,
  type AuthoringStateShape,
} from "./selectors.js";
import { createViewingStore } from "./viewing-store.js";
import { createAuthoringStore } from "./authoring-store.js";
import type { AssetEntry, Tour } from "./types.js";

// A raw (untyped) clone of the sample tour, as validateTour would receive it.
const raw = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(sampleTour)) as Record<string, unknown>;

// ── validateTour ─────────────────────────────────────────────────────────────

describe("validateTour", () => {
  it("accepts the sample fixture and round-trips it", () => {
    expect(validateTour(raw())).toEqual(sampleTour);
  });

  it("throws TourValidationError (not a bare Error) on garbage", () => {
    expect(() => validateTour(null)).toThrow(TourValidationError);
    expect(() => validateTour("nope")).toThrow(TourValidationError);
  });

  it("invariant 1: rejects a waypoint referencing an unknown asset", () => {
    const t = raw();
    (t.waypoints as { content: Record<string, unknown> }[])[0]!.content.audio =
      "asset-missing";
    expect(() => validateTour(t)).toThrow(/unknown asset/);
  });

  it("invariant 2: rejects a waypoint with both model and sprite", () => {
    const t = raw();
    // asset-gate is a sprite; reuse its id in the model slot to trip the rule.
    (t.waypoints as { content: Record<string, unknown> }[])[0]!.content.model =
      "asset-gate";
    expect(() => validateTour(t)).toThrow(/at most one/);
  });

  it("invariant 4: rejects duplicate waypoint ids", () => {
    const t = raw();
    (t.waypoints as { id: string }[])[1]!.id = "wp-1";
    expect(() => validateTour(t)).toThrow(/duplicate waypoint/);
  });

  it("invariant 4: rejects duplicate asset ids", () => {
    const t = raw();
    (t.assets as { id: string }[])[1]!.id = "asset-gate";
    expect(() => validateTour(t)).toThrow(/duplicate asset/);
  });

  it("invariant 5: rejects prefetchRadius <= activeRadius", () => {
    const t = raw();
    (t.waypoints as { prefetchRadius: number }[])[0]!.prefetchRadius = 5; // < activeRadius 10
    expect(() => validateTour(t)).toThrow(/prefetchRadius > activeRadius/);
  });

  it("invariant 5: rejects a non-positive activeRadius", () => {
    const t = raw();
    const wp = (t.waypoints as { activeRadius: number }[])[0]!;
    wp.activeRadius = 0;
    expect(() => validateTour(t)).toThrow(/prefetchRadius > activeRadius/);
  });

  it("shape: rejects a missing top-level field", () => {
    const t = raw();
    delete t.name;
    expect(() => validateTour(t)).toThrow(/name must be a string/);
  });

  it("shape: rejects a non-finite coordinate", () => {
    const t = raw();
    (t.waypoints as { position: Record<string, unknown> }[])[0]!.position.lat =
      Number.NaN;
    expect(() => validateTour(t)).toThrow(/must be a finite number/);
  });
});

// ── tour slice ───────────────────────────────────────────────────────────────

describe("tour slice", () => {
  it("starts null", () => {
    expect(tourReducer(undefined, { type: "@@init" })).toEqual({ tour: null });
  });

  it("loadTour sets and clearTour resets", () => {
    const loaded = tourReducer(undefined, loadTour(sampleTour));
    expect(loaded.tour).toEqual(sampleTour);
    expect(tourReducer(loaded, clearTour())).toEqual({ tour: null });
  });
});

// ── tourProgress slice ───────────────────────────────────────────────────────

describe("tourProgress slice", () => {
  it("markWaypointVisited is idempotent", () => {
    let s = tourProgressReducer(undefined, markWaypointVisited("wp-1"));
    s = tourProgressReducer(s, markWaypointVisited("wp-1"));
    s = tourProgressReducer(s, markWaypointVisited("wp-2"));
    expect(s.visitedWaypointIds).toEqual(["wp-1", "wp-2"]);
  });

  it("resets on clearTour (cross-slice)", () => {
    const s = tourProgressReducer(undefined, markWaypointVisited("wp-1"));
    expect(tourProgressReducer(s, clearTour()).visitedWaypointIds).toEqual([]);
  });
});

// ── zones slice ──────────────────────────────────────────────────────────────

describe("zones slice", () => {
  it("initZones seeds every id to IDLE", () => {
    const s = zonesReducer(undefined, initZones(["wp-1", "wp-2"]));
    expect(s.byWaypointId).toEqual({ "wp-1": "IDLE", "wp-2": "IDLE" });
  });

  it("setWaypointZone updates one entry without touching others", () => {
    let s = zonesReducer(undefined, initZones(["wp-1", "wp-2"]));
    s = zonesReducer(s, setWaypointZone({ id: "wp-2", zone: "ACTIVE" }));
    expect(s.byWaypointId).toEqual({ "wp-1": "IDLE", "wp-2": "ACTIVE" });
  });

  it("resets on clearTour (cross-slice)", () => {
    const s = zonesReducer(undefined, initZones(["wp-1"]));
    expect(zonesReducer(s, clearTour()).byWaypointId).toEqual({});
  });
});

// ── breadcrumbProgress slice ─────────────────────────────────────────────────

describe("breadcrumbProgress slice", () => {
  it("marks an index visited idempotently", () => {
    let s = breadcrumbProgressReducer(undefined, markBreadcrumbVisited(2));
    s = breadcrumbProgressReducer(s, markBreadcrumbVisited(2));
    s = breadcrumbProgressReducer(s, markBreadcrumbVisited(5));
    expect(s.visitedIndices).toEqual([2, 5]);
  });

  it("resets to empty on clearTour", () => {
    const s = breadcrumbProgressReducer(undefined, markBreadcrumbVisited(2));
    expect(breadcrumbProgressReducer(s, clearTour()).visitedIndices).toEqual(
      [],
    );
  });
});

// ── authoring slice ──────────────────────────────────────────────────────────

const spriteAsset: AssetEntry = {
  id: "a-sprite",
  type: "sprite",
  filename: "assets/a-sprite.png",
};
const modelAsset: AssetEntry = {
  id: "a-model",
  type: "model",
  filename: "assets/a-model.glb",
};

describe("authoring slice", () => {
  it("setTourMeta and addWaypoint with default radii", () => {
    let s = authoringReducer(
      undefined,
      setTourMeta({ name: "T", description: "d" }),
    );
    s = authoringReducer(
      s,
      addWaypoint({ id: "wp-1", position: { lat: 1, lon: 2 } }),
    );
    expect(s.name).toBe("T");
    expect(s.description).toBe("d");
    expect(s.waypoints[0]).toEqual({
      id: "wp-1",
      position: { lat: 1, lon: 2 },
      prefetchRadius: DEFAULT_PREFETCH_RADIUS_M,
      activeRadius: DEFAULT_ACTIVE_RADIUS_M,
      content: {},
    });
  });

  it("attachAsset registers the entry and wires the slot", () => {
    let s = authoringReducer(
      undefined,
      addWaypoint({ id: "wp-1", position: { lat: 1, lon: 2 } }),
    );
    s = authoringReducer(
      s,
      attachAsset({ waypointId: "wp-1", slot: "sprite", asset: spriteAsset }),
    );
    expect(s.assets).toEqual([spriteAsset]);
    expect(s.waypoints[0]!.content.sprite).toBe("a-sprite");
  });

  it("attachAsset enforces model/sprite mutual exclusivity", () => {
    let s = authoringReducer(
      undefined,
      addWaypoint({ id: "wp-1", position: { lat: 1, lon: 2 } }),
    );
    s = authoringReducer(
      s,
      attachAsset({ waypointId: "wp-1", slot: "sprite", asset: spriteAsset }),
    );
    s = authoringReducer(
      s,
      attachAsset({ waypointId: "wp-1", slot: "model", asset: modelAsset }),
    );
    expect(s.waypoints[0]!.content.model).toBe("a-model");
    expect(s.waypoints[0]!.content.sprite).toBeUndefined();
  });

  it("removeAsset clears dangling waypoint references", () => {
    let s = authoringReducer(
      undefined,
      addWaypoint({ id: "wp-1", position: { lat: 1, lon: 2 } }),
    );
    s = authoringReducer(
      s,
      attachAsset({ waypointId: "wp-1", slot: "sprite", asset: spriteAsset }),
    );
    s = authoringReducer(s, removeAsset("a-sprite"));
    expect(s.assets).toEqual([]);
    expect(s.waypoints[0]!.content.sprite).toBeUndefined();
  });

  it("updateWaypoint merges content and fields; removeWaypoint drops it", () => {
    let s = authoringReducer(
      undefined,
      addWaypoint({ id: "wp-1", position: { lat: 1, lon: 2 } }),
    );
    s = authoringReducer(
      s,
      updateWaypoint({
        id: "wp-1",
        changes: { activeRadius: 5, content: { transcript: "hi" } },
      }),
    );
    expect(s.waypoints[0]!.activeRadius).toBe(5);
    expect(s.waypoints[0]!.content.transcript).toBe("hi");
    s = authoringReducer(s, removeWaypoint("wp-1"));
    expect(s.waypoints).toEqual([]);
  });

  it("moveWaypoint reorders the list by id, clamping out-of-range targets and no-op'ing an unknown id", () => {
    let s = authoringReducer(
      undefined,
      addWaypoint({ id: "wp-1", position: { lat: 1, lon: 1 } }),
    );
    s = authoringReducer(
      s,
      addWaypoint({ id: "wp-2", position: { lat: 2, lon: 2 } }),
    );
    s = authoringReducer(
      s,
      addWaypoint({ id: "wp-3", position: { lat: 3, lon: 3 } }),
    );
    expect(s.waypoints.map((w) => w.id)).toEqual(["wp-1", "wp-2", "wp-3"]);

    s = authoringReducer(s, moveWaypoint({ id: "wp-3", toIndex: 0 }));
    expect(s.waypoints.map((w) => w.id)).toEqual(["wp-3", "wp-1", "wp-2"]);

    s = authoringReducer(s, moveWaypoint({ id: "wp-1", toIndex: 99 }));
    expect(s.waypoints.map((w) => w.id)).toEqual(["wp-3", "wp-2", "wp-1"]);

    const unchanged = authoringReducer(
      s,
      moveWaypoint({ id: "does-not-exist", toIndex: 0 }),
    );
    expect(unchanged.waypoints).toBe(s.waypoints);
  });

  it("addBreadcrumbPoint appends; clearAuthoring resets", () => {
    let s = authoringReducer(undefined, addBreadcrumbPoint({ lat: 1, lon: 2 }));
    expect(s.breadcrumb).toEqual([{ lat: 1, lon: 2 }]);
    s = authoringReducer(s, clearAuthoring());
    expect(s).toEqual({
      name: "",
      description: "",
      assets: [],
      waypoints: [],
      breadcrumb: [],
    });
  });
});

// ── selectors ────────────────────────────────────────────────────────────────

const viewingState = (
  over: Partial<{
    tour: Tour | null;
    visited: string[];
    zones: Record<string, "IDLE" | "PREFETCHING" | "ACTIVE">;
    visitedBreadcrumbs: number[];
  }> = {},
): ViewingStateShape => ({
  tour: { tour: over.tour === undefined ? sampleTour : over.tour },
  tourProgress: { visitedWaypointIds: over.visited ?? [] },
  zones: { byWaypointId: over.zones ?? {} },
  breadcrumbProgress: { visitedIndices: over.visitedBreadcrumbs ?? [] },
});

describe("viewing selectors", () => {
  it("selectTour / selectOrderedWaypoints / selectAssets", () => {
    const s = viewingState();
    expect(selectTour(s)).toEqual(sampleTour);
    expect(selectOrderedWaypoints(s).map((w) => w.id)).toEqual([
      "wp-1",
      "wp-2",
      "wp-3",
    ]);
    expect(selectAssets(s).map((a) => a.id)).toEqual([
      "asset-gate",
      "asset-intro",
    ]);
  });

  it("selectOrderedWaypoints is [] when no tour is loaded", () => {
    expect(selectOrderedWaypoints(viewingState({ tour: null }))).toEqual([]);
  });

  it("selectNextUnvisitedWaypoint walks in order", () => {
    expect(selectNextUnvisitedWaypoint(viewingState())?.id).toBe("wp-1");
    expect(
      selectNextUnvisitedWaypoint(viewingState({ visited: ["wp-1"] }))?.id,
    ).toBe("wp-2");
    expect(
      selectNextUnvisitedWaypoint(
        viewingState({ visited: ["wp-1", "wp-2", "wp-3"] }),
      ),
    ).toBeNull();
  });

  it("selectTourProgress ignores stale ids", () => {
    const s = viewingState({ visited: ["wp-1", "ghost"] });
    expect(selectTourProgress(s)).toEqual({ visited: 1, total: 3 });
  });

  it("selectWaypointZone defaults to IDLE; selectActiveWaypointIds filters", () => {
    const s = viewingState({
      zones: { "wp-1": "ACTIVE", "wp-2": "PREFETCHING" },
    });
    expect(selectWaypointZone(s, "wp-1")).toBe("ACTIVE");
    expect(selectWaypointZone(s, "wp-unknown")).toBe("IDLE");
    expect(selectActiveWaypointIds(s)).toEqual(["wp-1"]);
  });

  it("selectWaypointById / selectIsWaypointVisited / selectVisitedWaypointIds", () => {
    const s = viewingState({ visited: ["wp-2"] });
    expect(selectWaypointById(s, "wp-2")?.id).toBe("wp-2");
    expect(selectWaypointById(s, "nope")).toBeUndefined();
    expect(selectIsWaypointVisited(s, "wp-2")).toBe(true);
    expect(selectIsWaypointVisited(s, "wp-1")).toBe(false);
    expect(selectVisitedWaypointIds(s)).toEqual(["wp-2"]);
  });

  it("selectVisitedBreadcrumbIndices reads the breadcrumbProgress slice", () => {
    const s = viewingState({ visitedBreadcrumbs: [1, 3] });
    expect(selectVisitedBreadcrumbIndices(s)).toEqual([1, 3]);
  });

  it("selectWaypointVisual resolves sprite / model / empty", () => {
    const [wp1, , wp3] = sampleTour.waypoints;
    expect(selectWaypointVisual(wp1!)).toEqual({
      kind: "sprite",
      assetId: "asset-gate",
    });
    expect(selectWaypointVisual(wp3!)).toBeNull();
    expect(selectWaypointVisual({ ...wp3!, content: { model: "m" } })).toEqual({
      kind: "model",
      assetId: "m",
    });
  });
});

describe("selectExportedTour", () => {
  it("assembles a draft into a Tour that passes validateTour", () => {
    let a = authoringReducer(
      undefined,
      setTourMeta({ name: "Castle Walk", description: "d" }),
    );
    a = authoringReducer(
      a,
      addWaypoint({ id: "wp-1", position: { lat: 1, lon: 2 } }),
    );
    a = authoringReducer(
      a,
      attachAsset({ waypointId: "wp-1", slot: "sprite", asset: spriteAsset }),
    );
    const state: AuthoringStateShape = { authoring: a };
    const exported = selectExportedTour(state);
    expect(exported.id).toBe("tour-castle-walk");
    expect(() =>
      validateTour(JSON.parse(JSON.stringify(exported))),
    ).not.toThrow();
  });
});

// ── factory smoke tests ──────────────────────────────────────────────────────

describe("store factories", () => {
  it("createViewingStore constructs and exposes its slices", () => {
    const store = createViewingStore();
    const keys = Object.keys(store.getState());
    expect(keys).toEqual(
      expect.arrayContaining(["tour", "tourProgress", "zones", "gpsData"]),
    );
    store.dispatch(loadTour(sampleTour));
    expect((store.getState() as ViewingStateShape).tour.tour).toEqual(
      sampleTour,
    );
  });

  it("createAuthoringStore constructs and exposes its slice", () => {
    const store = createAuthoringStore();
    const keys = Object.keys(store.getState());
    expect(keys).toEqual(
      expect.arrayContaining(["authoring", "gpsData", "recording"]),
    );
    store.dispatch(setTourMeta({ name: "n", description: "d" }));
    expect((store.getState() as AuthoringStateShape).authoring.name).toBe("n");
  });
});
