import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
} from "gps-plus-slam-app-framework/core";
import { nueToArLocal } from "gps-plus-slam-app-framework/visualization/frame-conversions";
import {
  createGpsAnchor,
  type GpsAnchor,
} from "gps-plus-slam-app-framework/visualization/gps-anchor";

import { createArSeams, type AnchorFactoryLike } from "./ar-seams.js";

const ZERO = { lat: 48.0, lon: 11.0 };
/** A deliberately non-identity alignment: catches frame mistakes an identity hides. */
const ALIGNMENT: readonly number[] = new Matrix4()
  .makeRotationY(Math.PI / 3)
  .setPosition(4, 0, -7)
  .toArray();

/** Minimal stand-in for the framework's `GpsAnchor`. */
function fakeAnchor(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    phase: "anchored" as const,
    // What a REAL `skipBootstrap: true` anchor reports from frame one — the
    // whole reason the wrapper exists (plan R2/VC21).
    isFullyAnchored: true,
    gpsPoint: { lat: 48.0001, lon: 11.0001 },
    markMovedExternally: vi.fn(),
    setGpsPoint: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

interface Harness {
  alignment: readonly number[] | null;
  zeroRef: { lat: number; lon: number } | null;
  arWorldGroup: Group | null;
  camera: PerspectiveCamera | null;
}

function setup(
  partial: Partial<Harness> = {},
  anchorFactory?: AnchorFactoryLike,
) {
  const state: Harness = {
    alignment: ALIGNMENT,
    zeroRef: ZERO,
    arWorldGroup: new Group(),
    camera: new PerspectiveCamera(),
    ...partial,
  };
  const created: { object3D: Object3D; options: Record<string, unknown> }[] =
    [];
  const seams = createArSeams({
    getAlignmentMatrix: () => state.alignment,
    getGpsZeroRef: () => state.zeroRef,
    getArWorldGroup: () => state.arWorldGroup,
    getCamera: () => state.camera,
    createGpsAnchor:
      anchorFactory ??
      ((options) => {
        created.push({
          object3D: options.object3D,
          options: options as unknown as Record<string, unknown>,
        });
        return fakeAnchor();
      }),
  });
  return { seams, state, created };
}

/**
 * The visitor's floor in GPS-world metres for the default harness: the AR
 * frame's own floor (`y = 0`, from the `local-floor` reference space) and
 * `ALIGNMENT` has no vertical component.
 */
const DEFAULT_FLOOR_ALTITUDE = 0;

/** The target the framework's own anchor math would compute for `coord`,
 *  placed at the visitor's floor as contract D6 requires. */
function expectedWorld(
  group: Group,
  coord: { lat: number; lon: number },
): Vector3 {
  const nue = calcRelativeCoordsInMeters(
    ZERO,
    coord,
    DEFAULT_FLOOR_ALTITUDE,
    0,
  );
  const local = nueToArLocal(ALIGNMENT, [nue[0], nue[1], nue[2]]);
  group.updateWorldMatrix(true, false);
  return group.localToWorld(local.clone());
}

describe("toWorld", () => {
  it("returns null while no alignment matrix exists", () => {
    const { seams } = setup({ alignment: null });

    expect(seams.toWorld({ lat: 48.001, lon: 11.001 })).toBeNull();
  });

  it("returns null while no GPS zero reference exists", () => {
    const { seams } = setup({ zeroRef: null });

    expect(seams.toWorld({ lat: 48.001, lon: 11.001 })).toBeNull();
  });

  it("returns null when the AR world group does not exist yet", () => {
    const { seams } = setup({ arWorldGroup: null });

    expect(seams.toWorld({ lat: 48.001, lon: 11.001 })).toBeNull();
  });

  it("agrees with the framework's own NUE -> AR-local -> world math", () => {
    const { seams, state } = setup();
    const coord = { lat: 48.0012, lon: 11.0009 };

    const actual = seams.toWorld(coord)!;

    expect(
      actual.distanceTo(expectedWorld(state.arWorldGroup!, coord)),
    ).toBeLessThan(1e-6);
  });

  // Distances between converted points, not positions relative to the world
  // origin: the alignment is a rigid transform (rotation + translation), so
  // the zero reference does NOT land on the origin — but every metric
  // relationship between coordinates must survive the conversion, which is
  // the property the proximity machine actually depends on.
  it("preserves metric distance: ~100 m apart in geo is ~100 m apart in world", () => {
    const { seams } = setup();
    const a = { lat: ZERO.lat, lon: ZERO.lon };
    const b = { lat: ZERO.lat + 0.0008993, lon: ZERO.lon }; // ~100 m north

    const distance = seams.toWorld(a)!.distanceTo(seams.toWorld(b)!);

    expect(distance).toBeGreaterThan(95);
    expect(distance).toBeLessThan(105);
  });

  it("maps the zero reference where the framework's own inverse-alignment math does", () => {
    const { seams, state } = setup();

    const actual = seams.toWorld({ ...ZERO })!;

    expect(
      actual.distanceTo(expectedWorld(state.arWorldGroup!, ZERO)),
    ).toBeLessThan(1e-6);
  });

  // Contract D6: altitude is persisted but not consumed. In a live session
  // GPS-world `y` is ABSOLUTE altitude, so neither the stored value (one noisy
  // fix) nor a missing one (y = 0, the ellipsoid) is a usable height.
  it.each([
    ["a stored altitude", { lat: 48.0012, lon: 11.0009, altitude: 500 }],
    ["no altitude", { lat: 48.0012, lon: 11.0009 }],
  ])("places a point with %s at the visitor's floor (D6)", (_label, coord) => {
    const { seams, state } = setup();
    state.camera!.position.set(0, 1.6, 0);
    state.camera!.updateMatrixWorld(true);

    const actual = seams.toWorld(coord)!;

    expect(actual.y).toBeCloseTo(0, 6);
  });

  it("does not depend on how high the phone is held", () => {
    const { seams, state } = setup();
    const coord = { lat: 48.0012, lon: 11.0009 };
    const at = (height: number) => {
      state.camera!.position.set(0, height, 0);
      state.camera!.updateMatrixWorld(true);
      return seams.toWorld(coord)!.y;
    };

    const low = at(0.9);
    const high = at(1.9);

    expect(high).toBeCloseTo(low, 6);
  });

  it("returns null before a camera exists, since the floor is unknown", () => {
    const { seams } = setup({ camera: null });

    expect(seams.toWorld({ lat: 48.001, lon: 11.001 })).toBeNull();
  });
});

describe("getUserWorldPos", () => {
  it("returns null before a camera exists", () => {
    const { seams } = setup({ camera: null });

    expect(seams.getUserWorldPos()).toBeNull();
  });

  it("returns the camera's world position", () => {
    const { seams, state } = setup();
    state.camera!.position.set(3, 1, -2);
    state.camera!.updateMatrixWorld(true);

    expect(
      seams.getUserWorldPos()!.distanceTo(new Vector3(3, 1, -2)),
    ).toBeLessThan(1e-6);
  });
});

describe("createAnchor", () => {
  it("passes skipBootstrap so the authored coordinate is never overwritten", () => {
    // R1: without this the anchor bootstraps from the OBJECT's own pose and
    // commits that median as its gpsPoint — silently relocating the waypoint.
    const { seams, created } = setup();
    const object = new Object3D();

    seams.createAnchor(object, { lat: 48.002, lon: 11.002 });

    expect(created).toHaveLength(1);
    expect(created[0]!.options.skipBootstrap).toBe(true);
  });

  it("wires the alignment matrix and zero reference through to the anchor", () => {
    const { seams, created } = setup();

    seams.createAnchor(new Object3D(), { lat: 48.002, lon: 11.002 });

    const options = created[0]!.options;
    expect((options.getAlignmentMatrix as () => unknown)()).toBe(ALIGNMENT);
    expect((options.getGpsZeroRef as () => unknown)()).toBe(ZERO);
  });

  it("delegates setGpsPoint / markMovedExternally / dispose to the framework anchor", () => {
    const base = fakeAnchor();
    const { seams } = setup({}, () => base);

    const anchor = seams.createAnchor(new Object3D(), {
      lat: 48.002,
      lon: 11.002,
    });
    anchor.setGpsPoint({ lat: 48.003, lon: 11.003 });
    anchor.markMovedExternally();
    anchor.dispose();

    expect(base.setGpsPoint).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 48.003, lon: 11.003 }),
    );
    expect(base.markMovedExternally).toHaveBeenCalledOnce();
    expect(base.dispose).toHaveBeenCalledOnce();
  });
});

describe("createAnchor — the isFullyAnchored gate (R2/VC21)", () => {
  /**
   * The failure this pins: a `skipBootstrap` anchor reports
   * `isFullyAnchored === true` from frame one, while its object still sits at
   * the AR origin and no alignment exists. Component 8 feeds exactly the
   * anchors reporting anchored to the proximity driver — so unwrapped, every
   * waypoint would be "at the visitor" on session entry and the whole tour
   * would activate (and be marked visited) in the first second.
   */
  const COORD = { lat: 48.0012, lon: 11.0009 };

  function anchoredCase(partial: Partial<Harness> = {}) {
    const base = fakeAnchor({ gpsPoint: COORD });
    const { seams, state } = setup(partial, () => base);
    const object = new Object3D();
    state.arWorldGroup?.add(object);
    const anchor = seams.createAnchor(object, COORD);
    return { anchor, object, state };
  }

  it("is NOT anchored while alignment is missing, even though the base anchor claims it is", () => {
    const { anchor } = anchoredCase({ alignment: null });

    expect(anchor.isFullyAnchored).toBe(false);
  });

  it("is NOT anchored while the object still sits at the origin, un-committed", () => {
    const { anchor } = anchoredCase();

    // Object left at (0,0,0) — i.e. on top of the visitor.
    expect(anchor.isFullyAnchored).toBe(false);
  });

  it("becomes anchored once the object has been committed to its target", () => {
    const { anchor, object, state } = anchoredCase();
    const target = expectedWorld(state.arWorldGroup!, COORD);
    object.position.copy(state.arWorldGroup!.worldToLocal(target.clone()));
    object.updateMatrixWorld(true);

    expect(anchor.isFullyAnchored).toBe(true);
  });

  it("stays un-anchored when the base anchor itself is still bootstrapping", () => {
    const base = fakeAnchor({ isFullyAnchored: false, gpsPoint: COORD });
    const { seams, state } = setup({}, () => base);
    const object = new Object3D();
    state.arWorldGroup!.add(object);
    const anchor = seams.createAnchor(object, COORD);
    const target = expectedWorld(state.arWorldGroup!, COORD);
    object.position.copy(state.arWorldGroup!.worldToLocal(target.clone()));
    object.updateMatrixWorld(true);

    expect(anchor.isFullyAnchored).toBe(false);
  });

  it("follows the anchor's CURRENT gps point, not the construction coordinate", () => {
    // Breadcrumb orbs are recycled via setGpsPoint; the gate must track that.
    const moved = { lat: 48.0025, lon: 11.0018 };
    const base = fakeAnchor({ gpsPoint: COORD });
    base.setGpsPoint.mockImplementation((point: typeof COORD) => {
      base.gpsPoint = point;
    });
    const { seams, state } = setup({}, () => base);
    const object = new Object3D();
    state.arWorldGroup!.add(object);
    const anchor = seams.createAnchor(object, COORD);

    // Park the object at the ORIGINAL coordinate, then re-point the anchor.
    object.position.copy(
      state.arWorldGroup!.worldToLocal(
        expectedWorld(state.arWorldGroup!, COORD),
      ),
    );
    object.updateMatrixWorld(true);
    expect(anchor.isFullyAnchored).toBe(true);

    anchor.setGpsPoint(moved);
    expect(anchor.isFullyAnchored).toBe(false);
  });
});

/**
 * The real framework anchor, not a fake: its distance-scaled move threshold
 * and off-screen gate are exactly what the fakes above cannot reproduce.
 *
 * The alignment carries a vertical translation, as a live one does — GPS-world
 * `y` is absolute altitude — and `arWorldGroup.matrix` holds it, as
 * `enableArWorldGroupAlignment` makes it (without the lerp).
 */
describe("createAnchor — with the real framework anchor", () => {
  const GROUND_ALTITUDE = 95;
  const CAMERA_LOCAL_Y = 1.6;
  const alignmentAt = (north: number, up: number, east: number) =>
    new Matrix4().makeTranslation(north, up, east).toArray();
  /** Due north of the zero reference: off to the camera's side, never in view. */
  const northOf = (metres: number, extra: { altitude?: number } = {}) => ({
    ...calcGpsCoords(ZERO, [metres, 0, 0]),
    ...extra,
  });

  function realCase(coord: { lat: number; lon: number; altitude?: number }) {
    const group = new Group();
    group.matrixAutoUpdate = false;
    const camera = new PerspectiveCamera();
    camera.position.set(0, CAMERA_LOCAL_Y, 0);
    group.add(camera);
    let alignment: readonly number[] = alignmentAt(0, GROUND_ALTITUDE, 0);
    const setAlignment = (next: readonly number[]) => {
      alignment = next;
      group.matrix.fromArray(next);
      group.updateMatrixWorld(true);
    };
    setAlignment(alignment);

    let base: GpsAnchor | null = null;
    const seams = createArSeams({
      getAlignmentMatrix: () => alignment,
      getGpsZeroRef: () => ZERO,
      getArWorldGroup: () => group,
      getCamera: () => camera,
      createGpsAnchor: (options) => (base = createGpsAnchor(options)),
    });
    const object = new Group();
    // A built visual: the anchor's off-screen check treats an object without
    // geometry as always in view, which would block every later correction.
    object.add(new Mesh(new BoxGeometry(1, 1, 1)));
    group.add(object);
    const anchor = seams.createAnchor(object, coord);

    let elapsed = 0;
    const frames = (count: number) => {
      for (let i = 0; i < count; i++) {
        seams.update?.();
        base!.__tickForTests(0.016, (elapsed += 1));
        group.updateMatrixWorld(true);
      }
    };
    const objectWorld = () => object.getWorldPosition(new Vector3());
    const cameraWorldY = () => camera.getWorldPosition(new Vector3()).y;
    return { anchor, seams, frames, setAlignment, objectWorld, cameraWorldY };
  }

  it.each([
    ["a stored altitude", northOf(30, { altitude: 34 })],
    ["no altitude", northOf(30)],
  ])(
    "anchors a waypoint with %s at the visitor's floor (D6)",
    (_label, coord) => {
      const c = realCase(coord);

      c.frames(1);

      expect(c.objectWorld().y).toBeCloseTo(
        c.cameraWorldY() - CAMERA_LOCAL_Y,
        4,
      );
      expect(c.objectWorld().x).toBeCloseTo(30, 3);
    },
  );

  it("keeps the waypoint on the floor when the anchor applies a later correction", () => {
    const c = realCase(northOf(30));
    c.frames(1);

    // 12 m north: beyond the anchor's 8 m threshold at 30 m, so it commits.
    // 3 m up: without a floor refresh the commit would carry the stale height.
    c.setAlignment(alignmentAt(-12, GROUND_ALTITUDE + 3, 0));
    c.frames(1);

    expect(c.objectWorld().x).toBeCloseTo(30, 3);
    expect(c.objectWorld().y).toBeCloseTo(c.cameraWorldY() - CAMERA_LOCAL_Y, 4);
  });

  it("stays anchored through a small alignment correction", () => {
    // 3 m east at 30 m: above the gate's 2 m tolerance, so the anchor follows
    // it and must keep reporting anchored throughout.
    const c = realCase(northOf(30));
    c.frames(1);
    expect(c.anchor.isFullyAnchored).toBe(true);

    c.setAlignment(alignmentAt(0, GROUND_ALTITUDE, 3));
    c.frames(3);

    expect(c.anchor.isFullyAnchored).toBe(true);
  });

  // The framework anchor only re-solves once its position error passes
  // 2 m x (1 + 0.1 x distance), so a far waypoint keeps a stale position after
  // a heading refinement (8 deg at 300 m is ~42 m, under the ~62 m gate). The
  // trail (`toWorld`) always follows the current alignment, so the two
  // disagree: the waypoint's zone and the wayfinding distance are wrong.
  it("keeps a far waypoint where the current alignment puts it after a heading refinement", () => {
    const c = realCase(northOf(300));
    c.frames(1);

    const headingRefined = new Matrix4()
      .makeRotationY((8 * Math.PI) / 180)
      .setPosition(0, GROUND_ALTITUDE, 0);
    c.setAlignment(headingRefined.toArray());
    c.frames(3);

    const truth = c.seams.toWorld(northOf(300))!;
    const horizontalError = Math.hypot(
      c.objectWorld().x - truth.x,
      c.objectWorld().z - truth.z,
    );
    expect(horizontalError).toBeLessThan(1);
  });

  it("re-checks placement after the anchor is re-pointed", () => {
    const c = realCase(northOf(30));
    c.frames(1);
    expect(c.anchor.isFullyAnchored).toBe(true);

    c.anchor.setGpsPoint(northOf(60));
    expect(c.anchor.isFullyAnchored).toBe(false);

    c.frames(1);
    expect(c.anchor.isFullyAnchored).toBe(true);
  });
});
