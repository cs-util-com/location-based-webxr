import fc from "fast-check";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";

import {
  splitWalkHudTargets,
  startWalkHuds,
  type WalkHudLook,
} from "./walk-hud";

/**
 * Why these tests matter: the walk marks the station it is about in its
 * orange, larger, and the other nearest stations in white, by running two
 * of the framework's HUDs over the guide's one list of targets. A target
 * in both would draw two markers on one station; one in neither would
 * lose a marker the single HUD showed; a split that reorders or invents
 * targets would change which stations are marked. So the two halves are
 * disjoint, their union is the guide's list in its own order, and the
 * focus's half holds at most the focus.
 */

function target(id: string, north = 0): WayfindingTarget {
  return {
    id,
    position: new Vector3(north, 0, 0),
    distanceMin: 5,
    distanceMax: 7,
  };
}

const FIVE = ["a", "b", "c", "d", "e"].map((id, i) => target(id, 10 * i));

describe("splitWalkHudTargets", () => {
  it("puts the focus in the focus's half and the other four in the others', in their order", () => {
    const split = splitWalkHudTargets(FIVE, "c");
    expect(split.focus.map((t) => t.id)).toEqual(["c"]);
    expect(split.others.map((t) => t.id)).toEqual(["a", "b", "d", "e"]);
  });

  it("without a focus, or with one that is not among the targets, every target is the others'", () => {
    expect(splitWalkHudTargets(FIVE, null).focus).toEqual([]);
    expect(splitWalkHudTargets(FIVE, null).others).toHaveLength(5);
    // A chosen station farther than the nearest five has no marker, as
    // with one HUD.
    const far = splitWalkHudTargets(FIVE, "far");
    expect(far.focus).toEqual([]);
    expect(far.others.map((t) => t.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(splitWalkHudTargets([], "a")).toEqual({ focus: [], others: [] });
  });

  it("the two halves are disjoint, never more than the targets, and their union is the targets in order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "e", "f", "g"), {
          maxLength: 5,
        }),
        fc.option(fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "x"), {
          nil: null,
        }),
        (ids, focusId) => {
          const targets = ids.map((id) => target(id));
          const { focus, others } = splitWalkHudTargets(targets, focusId);
          expect(focus.length).toBeLessThanOrEqual(1);
          expect(focus.every((t) => t.id === focusId)).toBe(true);
          const all = [...focus, ...others];
          expect(all).toHaveLength(targets.length);
          expect(new Set(all)).toEqual(new Set(targets));
          // The others keep the guide's order.
          expect(others).toEqual(targets.filter((t) => t.id !== focusId));
          const listed = targets.some((t) => t.id === focusId);
          expect(focus.length).toBe(listed ? 1 : 0);
        },
      ),
    );
  });
});

describe("startWalkHuds", () => {
  function fakes() {
    const started: {
      look: WalkHudLook;
      getTargets: () => WayfindingTarget[];
      disposed: boolean;
    }[] = [];
    let fail: WalkHudLook | null = null;
    const create = (options: {
      getTargets: () => WayfindingTarget[];
      look: WalkHudLook;
    }) => {
      if (options.look === fail) return null;
      const hud = { ...options, disposed: false };
      started.push(hud);
      return {
        dispose: () => {
          hud.disposed = true;
        },
      };
    };
    return {
      started,
      create,
      failOn: (look: WalkHudLook | null) => (fail = look),
    };
  }

  // Why: each HUD polls its own half every frame, so a focus that moves
  // shows up in the next frame in both HUDs, without a restart.
  it("starts one HUD per look, each polling its half of the guide's targets and focus now", () => {
    const f = fakes();
    let focus: string | null = "b";
    const handle = startWalkHuds({
      create: f.create,
      targets: () => FIVE,
      focusId: () => focus,
    });
    expect(handle).not.toBeNull();
    const byLook = (look: WalkHudLook) =>
      f.started.find((h) => h.look === look)!;
    expect(
      byLook("focus")
        .getTargets()
        .map((t) => t.id),
    ).toEqual(["b"]);
    expect(
      byLook("others")
        .getTargets()
        .map((t) => t.id),
    ).toEqual(["a", "c", "d", "e"]);
    focus = "e";
    expect(
      byLook("focus")
        .getTargets()
        .map((t) => t.id),
    ).toEqual(["e"]);
    expect(byLook("others").getTargets()).toHaveLength(4);
    handle!.dispose();
    expect(f.started.every((h) => h.disposed)).toBe(true);
  });

  // Why: the guide retries the start while there is no camera; a half
  // start would leave one HUD running that the retry starts again.
  it("is null while either cannot start, the other disposed again", () => {
    for (const look of ["focus", "others"] as const) {
      const f = fakes();
      f.failOn(look);
      expect(
        startWalkHuds({
          create: f.create,
          targets: () => FIVE,
          focusId: () => null,
        }),
      ).toBeNull();
      expect(f.started.every((h) => h.disposed)).toBe(true);
    }
  });
});
