import { describe, expect, it } from "vitest";

import { computeMarkerViewModels } from "./map-marker-state.js";
import type { Waypoint } from "../../../store/types.js";

function wp(id: string, lat: number, lon: number): Waypoint {
  return {
    id,
    position: { lat, lon },
    prefetchRadius: 25,
    activeRadius: 10,
    content: {},
  };
}

describe("computeMarkerViewModels", () => {
  it("returns an empty array for no waypoints", () => {
    expect(computeMarkerViewModels([], [], null)).toEqual([]);
  });

  it("assigns visited / next / unvisited correctly for a mix", () => {
    const waypoints = [wp("wp-1", 1, 1), wp("wp-2", 2, 2), wp("wp-3", 3, 3)];

    const result = computeMarkerViewModels(waypoints, ["wp-1"], "wp-2");

    expect(result).toEqual([
      { id: "wp-1", position: { lat: 1, lon: 1 }, status: "visited", order: 1 },
      { id: "wp-2", position: { lat: 2, lon: 2 }, status: "next", order: 2 },
      {
        id: "wp-3",
        position: { lat: 3, lon: 3 },
        status: "unvisited",
        order: 3,
      },
    ]);
  });

  it("numbers waypoints by their list position, independent of visited/next/unvisited status", () => {
    const waypoints = [wp("wp-1", 1, 1), wp("wp-2", 2, 2), wp("wp-3", 3, 3)];

    const result = computeMarkerViewModels(waypoints, ["wp-2"], "wp-3");

    expect(result.map((m) => m.order)).toEqual([1, 2, 3]);
  });

  it("assigns no 'next' status when nextId is null (all visited)", () => {
    const waypoints = [wp("wp-1", 1, 1), wp("wp-2", 2, 2)];

    const result = computeMarkerViewModels(waypoints, ["wp-1", "wp-2"], null);

    expect(result.map((m) => m.status)).toEqual(["visited", "visited"]);
  });

  it("preserves waypoint input order", () => {
    const waypoints = [wp("wp-3", 3, 3), wp("wp-1", 1, 1), wp("wp-2", 2, 2)];

    const result = computeMarkerViewModels(waypoints, [], null);

    expect(result.map((m) => m.id)).toEqual(["wp-3", "wp-1", "wp-2"]);
  });
});
