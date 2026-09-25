import { describe, expect, it, vi } from "vitest";

import type { FixInfo } from "../core/breadcrumb-gate.js";
import type { PositionSource } from "./gps-position-source.js";
import { createFilesAssetProvider } from "./files-asset-provider.js";
import { createAuthoringSession } from "./authoring-session.js";
import type { AuthoringSliceState } from "../../../store/authoring-slice.js";
import type { TourCoord } from "../../../store/types.js";

/**
 * Why this matters: this is the one piece of component 10 that actually
 * decides *when* the store gets touched — dropping a waypoint at the latest
 * known fix, sampling breadcrumb points only past the minimum distance from
 * the last one it dispatched (not the last raw fix), and registering a
 * picked File before the dispatched action can reference it.
 */

const POS_A: TourCoord = { lat: 50.7753, lon: 6.0839 };
/** ~10 m north of POS_A — clearly past MIN_BREADCRUMB_DISTANCE_M (3 m). */
const POS_B: TourCoord = { lat: 50.7754, lon: 6.0839 };

function emptyDraft(): AuthoringSliceState {
  return {
    name: "",
    description: "",
    assets: [],
    waypoints: [],
    breadcrumb: [],
  };
}

function fakePositionSource(): {
  source: PositionSource;
  deliver: (pos: TourCoord, fix?: FixInfo) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  let onPosition: ((pos: TourCoord, fix?: FixInfo) => void) | undefined;
  const unsubscribe = vi.fn();
  const source: PositionSource = {
    subscribe(cb) {
      onPosition = cb;
      return unsubscribe;
    },
  };
  return {
    source,
    deliver: (pos, fix) => onPosition?.(pos, fix),
    unsubscribe,
  };
}

/** ~111 m north of POS_A: far past any believable single step. */
const POS_FAR: TourCoord = { lat: 50.7763, lon: 6.0839 };
/** ~5.5 m north of POS_FAR: an ordinary step once you are standing there. */
const POS_FAR_NEXT: TourCoord = { lat: 50.77635, lon: 6.0839 };

function breadcrumbsIn(actions: readonly unknown[]): unknown[] {
  return actions
    .filter(
      (a): a is { type: string; payload: unknown } =>
        typeof a === "object" &&
        a !== null &&
        "type" in a &&
        a.type === "authoring/addBreadcrumbPoint",
    )
    .map((a) => a.payload);
}

function harness(draft: AuthoringSliceState = emptyDraft()) {
  const { source, deliver, unsubscribe } = fakePositionSource();
  const actions: unknown[] = [];
  const state = { authoring: draft };
  const session = createAuthoringSession({
    positionSource: source,
    dispatch: (action) => actions.push(action),
    getState: () => state,
    filesAssetProvider: createFilesAssetProvider({
      createObjectUrl: () => "blob:fake",
    }),
  });
  return { session, deliver, unsubscribe, actions };
}

describe("createAuthoringSession", () => {
  it("dropWaypoint before any fix returns null and dispatches nothing", () => {
    const { session, actions } = harness();
    expect(session.dropWaypoint()).toBeNull();
    expect(actions).toEqual([]);
  });

  it("dropWaypoint after a fix dispatches addWaypoint at that exact position with a fresh id", () => {
    const { session, deliver, actions } = harness();
    deliver(POS_A);

    const id = session.dropWaypoint();

    expect(id).toBe("wp-1");
    expect(actions).toContainEqual({
      type: "authoring/addWaypoint",
      payload: { id: "wp-1", position: POS_A },
    });
  });

  it("dropWaypoint(position) drops at the given position instead of the latest GPS fix — the map-click flow", () => {
    const { session, deliver, actions } = harness();
    deliver(POS_A);
    const clicked: TourCoord = { lat: 1, lon: 2 };

    const id = session.dropWaypoint(clicked);

    expect(id).toBe("wp-1");
    expect(actions).toContainEqual({
      type: "authoring/addWaypoint",
      payload: { id: "wp-1", position: clicked },
    });
  });

  it("dropWaypoint(position) works even before any GPS fix has arrived", () => {
    const { session, actions } = harness();
    const clicked: TourCoord = { lat: 1, lon: 2 };

    expect(session.dropWaypoint(clicked)).toBe("wp-1");
    expect(actions).toContainEqual({
      type: "authoring/addWaypoint",
      payload: { id: "wp-1", position: clicked },
    });
  });

  it("seeds the next waypoint id from existing waypoints in state", () => {
    const draft = {
      ...emptyDraft(),
      waypoints: [
        {
          id: "wp-1",
          position: POS_A,
          prefetchRadius: 25,
          activeRadius: 10,
          content: {},
        },
      ],
    };
    const { session, deliver } = harness(draft);
    deliver(POS_A);

    expect(session.dropWaypoint()).toBe("wp-2");
  });

  it("dispatches a breadcrumb point on the first fix", () => {
    const { deliver, actions } = harness();
    deliver(POS_A);

    expect(actions).toContainEqual({
      type: "authoring/addBreadcrumbPoint",
      payload: POS_A,
    });
  });

  it("does not dispatch a second breadcrumb point closer than the minimum distance", () => {
    const { deliver, actions } = harness();
    deliver(POS_A);
    const countAfterFirst = actions.length;
    deliver(POS_A); // identical fix — zero distance

    expect(actions.length).toBe(countAfterFirst);
  });

  it("dispatches a new breadcrumb point once moved past the minimum distance", () => {
    const { deliver, actions } = harness();
    deliver(POS_A);
    deliver(POS_B);

    expect(actions).toContainEqual({
      type: "authoring/addBreadcrumbPoint",
      payload: POS_B,
    });
  });

  it("does not record a breadcrumb for a fix that reports poor accuracy", () => {
    const { deliver, actions } = harness();
    deliver(POS_A, { accuracy: 500 });

    expect(breadcrumbsIn(actions)).toEqual([]);
  });

  it("does not record a jump whose timestamps imply an impossible speed", () => {
    const { deliver, actions } = harness();
    deliver(POS_A, { accuracy: 5, timestamp: 0 });
    deliver(POS_B, { accuracy: 5, timestamp: 1_000 }); // ~11 m in 1 s

    expect(breadcrumbsIn(actions)).toEqual([POS_A]);
  });

  it("does not record a far jump, but does once a waypoint is dropped at the live position", () => {
    const { session, deliver, actions } = harness();
    deliver(POS_A);
    deliver(POS_FAR); // rejected: ~111 m from the last recorded point
    expect(breadcrumbsIn(actions)).toEqual([POS_A]);

    session.dropWaypoint(); // author is standing at POS_FAR: trust it again
    deliver(POS_FAR_NEXT);

    expect(breadcrumbsIn(actions)).toEqual([POS_A, POS_FAR_NEXT]);
  });

  it("a waypoint placed by map click says nothing about where the author is, so it does not re-anchor", () => {
    const { session, deliver, actions } = harness();
    deliver(POS_A);
    deliver(POS_FAR);

    session.dropWaypoint(POS_FAR);
    deliver(POS_FAR_NEXT);

    expect(breadcrumbsIn(actions)).toEqual([POS_A]);
  });

  it("attachAsset registers the file before dispatching attachAsset", () => {
    const { session, actions } = harness();
    const file = new File(["knight"], "knight.glb");

    session.attachAsset("wp-1", "model", file);

    const dispatched = actions.find(
      (a): a is { type: string; payload: unknown } =>
        typeof a === "object" && a !== null && "type" in a,
    );
    expect(dispatched?.type).toBe("authoring/attachAsset");
    expect(actions).toContainEqual({
      type: "authoring/attachAsset",
      payload: {
        waypointId: "wp-1",
        slot: "model",
        asset: { id: "asset-1", type: "model", filename: "assets/asset-1.glb" },
      },
    });
  });

  it("destroy() unsubscribes — a fix delivered after destroy dispatches nothing", () => {
    const { session, deliver, actions, unsubscribe } = harness();
    session.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    deliver(POS_A);
    expect(actions).toEqual([]);
  });
});
