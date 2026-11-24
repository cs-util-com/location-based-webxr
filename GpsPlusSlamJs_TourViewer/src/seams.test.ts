/**
 * Device seam — unit test.
 *
 * Why this matters: the DEV override that lets the e2e fake WebXR must be
 * PROD-INERT and inert during unit tests (`VITEST`). Here we confirm
 * `getSeams` returns the real seams and that the real surface exposes every
 * device function `main.ts` depends on — a missing key would only surface as
 * a runtime crash on device otherwise.
 */

import { Group } from "three";
import { describe, expect, it } from "vitest";
import { getArParentBinding } from "gps-plus-slam-app-framework/ar/ar-parent-target";

import { getSeams, realSeams } from "./seams";

describe("getSeams", () => {
  it("returns the real seams under VITEST (override is inert)", () => {
    expect(getSeams()).toBe(realSeams);
  });

  // Every device function main.ts wires is a key of TourViewerSeams, so tsc
  // already refuses a missing one; what is left is the one seam whose
  // answer in node is the claim.
  it("has no XR projection without a camera", () => {
    // The radar view cone: the XR camera's
    // P[0]; null without a camera (node has none), so the fallback cone.
    expect(realSeams.xrProjection0()).toBeNull();
  });

  // Why: in production stations become deferred anchors under the AR world
  // group; the parent seam must be that group itself, not a stand-in that
  // happens to read null in node (a seam returning null would keep every
  // station on the scene root on the phone too).
  it("anchors stations under the AR world group", async () => {
    const { getArWorldGroup } = await import("gps-plus-slam-app-framework/ar");
    expect(realSeams.getStationAnchorParent).toBe(getArWorldGroup);
  });
});

/** Run `body` with the page address `search`. */
function withSearch(search: string, body: () => void): void {
  const g = globalThis as { location?: unknown };
  const before = g.location;
  g.location = { search };
  try {
    body();
  } finally {
    g.location = before;
  }
}

/** What the real alignment seam hands the framework for an address. */
function alignmentFor(search: string): {
  defers: boolean;
  jumpedM: number;
} {
  let out = { defers: true, jumpedM: 0 };
  withSearch(search, () => {
    const group = new Group();
    // A store with no alignment yet: T is the jump alone.
    const store = {
      getState: () => ({}),
      subscribe: () => () => undefined,
    } as unknown as Parameters<
      typeof realSeams.enableArWorldGroupAlignment
    >[0]["store"];
    const handle = realSeams.enableArWorldGroupAlignment({
      store,
      arWorldGroup: group,
    }) as { dispose(): void };
    try {
      const target = getArParentBinding(group)!.target;
      target.tick(0);
      // The dev jump's period is 10 s: one jump by then.
      target.tick(10);
      out = {
        defers: target.defersAnchors(),
        jumpedM: target.target().elements[12],
      };
    } finally {
      handle.dispose();
    }
  });
  return out;
}

// Why: the e2e fakes replace this seam, so only this test sees that the
// field-test switches reach the framework from the real one: with debug=1
// on a visitor's page, and never without it.
describe("the alignment seam", () => {
  it("passes the field-test switches with debug=1 on a visitor's page", () => {
    expect(alignmentFor("?qr=x&debug=1&anchors=0&devWorldJumpM=2")).toEqual({
      defers: false,
      jumpedM: 2,
    });
  });

  it("passes none of them without debug=1", () => {
    expect(alignmentFor("?qr=x&anchors=0&devWorldJumpM=2")).toEqual({
      defers: true,
      jumpedM: 0,
    });
  });
});
