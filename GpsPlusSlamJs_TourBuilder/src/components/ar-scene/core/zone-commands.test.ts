import { describe, expect, it } from "vitest";

import {
  diffZones,
  selectVisibleWaypointIds,
  type ZoneMap,
} from "./zone-commands.js";

describe("diffZones", () => {
  it("emits nothing when nothing changed", () => {
    const zones: ZoneMap = { a: "ACTIVE", b: "IDLE" };
    expect(diffZones(zones, zones)).toEqual([]);
  });

  it("maps each legal single-step edge to its command", () => {
    expect(diffZones({ a: "IDLE" }, { a: "PREFETCHING" })).toEqual([
      { kind: "build", id: "a" },
    ]);
    expect(diffZones({ a: "PREFETCHING" }, { a: "ACTIVE" })).toEqual([
      { kind: "show", id: "a" },
    ]);
    expect(diffZones({ a: "ACTIVE" }, { a: "PREFETCHING" })).toEqual([
      { kind: "hide", id: "a" },
    ]);
    expect(diffZones({ a: "PREFETCHING" }, { a: "IDLE" })).toEqual([
      { kind: "teardown", id: "a" },
    ]);
  });

  it("treats a first-seen waypoint as coming from IDLE", () => {
    expect(diffZones({}, { a: "PREFETCHING" })).toEqual([
      { kind: "build", id: "a" },
    ]);
  });

  it("expands an illegal upward skip into build-then-show, in that order", () => {
    // Component 4 never emits this, but a scene that still renders correctly
    // beats one that throws — and the ordering is what hides the parse jank.
    expect(diffZones({ a: "IDLE" }, { a: "ACTIVE" })).toEqual([
      { kind: "build", id: "a" },
      { kind: "show", id: "a" },
    ]);
  });

  it("expands an illegal downward skip into hide-then-teardown", () => {
    expect(diffZones({ a: "ACTIVE" }, { a: "IDLE" })).toEqual([
      { kind: "hide", id: "a" },
      { kind: "teardown", id: "a" },
    ]);
  });

  it("tears down waypoints that vanish from the snapshot (tour cleared)", () => {
    expect(diffZones({ a: "ACTIVE", b: "PREFETCHING", c: "IDLE" }, {})).toEqual(
      [
        { kind: "hide", id: "a" },
        { kind: "teardown", id: "a" },
        { kind: "teardown", id: "b" },
      ],
    );
  });

  it("diffs several waypoints in one pass", () => {
    const commands = diffZones(
      { a: "IDLE", b: "ACTIVE" },
      { a: "PREFETCHING", b: "PREFETCHING" },
    );
    expect(commands).toContainEqual({ kind: "build", id: "a" });
    expect(commands).toContainEqual({ kind: "hide", id: "b" });
    expect(commands).toHaveLength(2);
  });
});

describe("selectVisibleWaypointIds", () => {
  it("returns exactly the ACTIVE waypoints", () => {
    expect(
      selectVisibleWaypointIds({ a: "ACTIVE", b: "PREFETCHING", c: "IDLE" }),
    ).toEqual(["a"]);
  });

  it("returns nothing for an empty snapshot", () => {
    expect(selectVisibleWaypointIds({})).toEqual([]);
  });
});
