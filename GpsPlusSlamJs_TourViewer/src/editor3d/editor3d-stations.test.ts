/**
 * Why these tests matter: the stations layer is what the creator looks at
 * in the 3D view: every station's billboard over its point, the items of
 * the near and selected stations as the phone draws them, their placed
 * models at the format's size, their found radius, and the printed codes
 * at their true size and facing. A station drawn at the file's height
 * instead of the drawn one floats tens of metres up; a code turned the
 * wrong way faces the wall; a layer that re-renders every station each
 * frame (or never frees one) stalls a long tour. These drive the layer
 * with stub drawing (Node has no canvas) and a WGS84 ellipsoid written out
 * by hand.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  TourItem,
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { worldFromEcefAt } from "gps-plus-slam-globe/editor";

import fc from "fast-check";

import {
  BILLBOARD_LIFT_M,
  CODE_FLAT_GAP_M,
  CODE_SCREEN_PX,
  DEFAULT_CODE_SIZE_M,
  codeGrowth,
  focalPxOf,
  codeQuaternionNue,
  createStationsLayer,
  type StationsLayerDeps,
} from "./editor3d-stations.js";

// The geodesy is licence-gated; the store's construction activates it (the
// page's own store does at boot).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const A = 6_378_137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
function ecefOf(latRad: number, lonRad: number, h: number, out: THREE.Vector3) {
  const n = A / Math.sqrt(1 - E2 * Math.sin(latRad) ** 2);
  return out.set(
    (n + h) * Math.cos(latRad) * Math.cos(lonRad),
    (n + h) * Math.cos(latRad) * Math.sin(lonRad),
    (n * (1 - E2) + h) * Math.sin(latRad),
  );
}
type GlobeEllipsoid = Parameters<typeof worldFromEcefAt>[0];
const ELLIPSOID = {
  getCartographicToPosition: ecefOf,
} as unknown as GlobeEllipsoid;

const ZERO = { lat: 48.137393, lng: 11.575493 };
const N = 45.68;
const M_PER_DEG_LAT = 111_200;
const M_PER_DEG_LON = 111_320 * Math.cos((ZERO.lat * Math.PI) / 180);

function station(
  id: string,
  east: number,
  north: number,
  items: TourItem[] = [],
): TourStation {
  return {
    id,
    title: `Station ${id}`,
    geo: {
      lat: ZERO.lat + north / M_PER_DEG_LAT,
      lon: ZERO.lng + east / M_PER_DEG_LON,
      alt: 515 + N,
      rotation: [0, 0, 0, 1],
    },
    activateRadiusM: 30,
    foundRadiusM: 8,
    hint: "arrow",
    steps: [],
    items,
  };
}

function manifest(
  stations: TourStation[],
  assets: TourManifest["assets"] = [],
) {
  return {
    version: 3,
    minor: 2,
    order: "fixed",
    assets,
    stations,
  } as TourManifest;
}

const photo = (id: string): TourItem => ({
  kind: "photo",
  id,
  createdAtIso: "2026-10-22T08:00:00Z",
  image: `content/${id}.jpg`,
  imageWidth: 400,
  imageHeight: 300,
  pose: { position: [1, 1.5, 0], rotation: [0, 0, 0, 1] },
});

const model = (id: string, asset: string, sizeM: number): TourItem => ({
  kind: "model",
  id,
  createdAtIso: "2026-10-22T08:00:00Z",
  asset,
  sizeM,
  pose: { position: [0, 0, 2], rotation: [0, 0, 0, 1] },
});

function deps(over: Partial<StationsLayerDeps> = {}) {
  const parent = new THREE.Scene();
  const log = {
    labels: 0,
    photos: 0,
    squares: [] as number[],
    billboards: [] as string[],
  };
  const d: StationsLayerDeps = {
    parent,
    ellipsoid: ELLIPSOID,
    worldFromEcef: worldFromEcefAt(ELLIPSOID, ZERO, new THREE.Matrix4()),
    undulationAt: () => N,
    makeLabel: () => {
      log.labels++;
      return { object: new THREE.Object3D(), dispose: () => undefined };
    },
    loadPhotoTexture: () => {
      log.photos++;
      return Promise.resolve(new THREE.Texture());
    },
    loadContent: () => Promise.resolve(new Blob([])),
    loadGlbModel: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1)));
      return Promise.resolve(g);
    },
    makeBillboard: (number, title, selected) => {
      log.billboards.push(`${number} ${title}${selected ? " *" : ""}`);
      return new THREE.Sprite();
    },
    makeCodeSquare: (sizeM) => {
      log.squares.push(sizeM);
      return new THREE.Mesh(new THREE.PlaneGeometry(sizeM, sizeM));
    },
    ...over,
  };
  return { d, parent, log };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const view = (
  east: number,
  north: number,
  selected: string | null,
  standing = 1,
  stationSelected = false,
  // At the stations' drawn height over the centre: no code grows.
  camera = new THREE.Vector3(east, 516, -north),
) => ({
  centre: new THREE.Vector3(east, 0, -north),
  selectedStation: selected,
  stationSelected,
  standing,
  camera,
  // A 900 px high view through the editor's 50 degree lens.
  viewportPx: 900,
  fovDeg: 50,
});

describe("createStationsLayer", () => {
  // Why: a station's point is drawn at the file's height less N, where its
  // latitude and longitude are; the world is x east, y up, z south.
  it("places each station at its drawn height, where it stands", () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest([station("a", 0, 0), station("b", 100, 50)]),
      new Map(),
    );
    const a = layer.pointOf("a")!;
    const b = layer.pointOf("b")!;
    expect(a.x).toBeCloseTo(0, 3);
    expect(a.z).toBeCloseTo(0, 3);
    expect(a.y).toBeCloseTo(515, 3);
    expect(b.x).toBeCloseTo(100, 0);
    expect(-b.z).toBeCloseTo(50, 0);
    // 112 m out the ground has curved away by about a millimetre.
    expect(b.y).toBeCloseTo(515, 2);
    expect(layer.stats().stations).toBe(2);
  });

  // Why: only the five nearest to the camera's centre and the selected one
  // draw their items; a station leaving the set frees them, and an
  // unchanged tour handed again re-renders nothing.
  it("renders the near and selected stations only, and frees what leaves", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    const stations = Array.from({ length: 8 }, (_, i) =>
      station(`s${i}`, i * 40, 0, [photo(`p${i}`)]),
    );
    layer.setTour(manifest(stations), new Map());
    layer.update(view(0, 0, null));
    expect([...layer.stats().shown].sort()).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
    expect(layer.stats().renders).toBe(5);
    layer.update(view(0, 0, "s7"));
    expect(layer.stats().shown).toContain("s7");
    expect(layer.stats().renders).toBe(6);
    // The same frame again renders nothing more.
    layer.update(view(0, 0, "s7"));
    expect(layer.stats().renders).toBe(6);
    // The camera moves to the far end: the near five there.
    layer.update(view(280, 0, null));
    expect([...layer.stats().shown].sort()).toEqual([
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
    ]);
    await settle();
    layer.setTour(manifest(stations), new Map());
    layer.update(view(280, 0, null));
    expect(layer.stats().renders).toBe(8);
  });

  // Why: the billboards name every station (its number and name), the
  // selected one marked, and stand higher as the camera tilts up from
  // straight down (the morph).
  it("names every station on a billboard that rises with the morph", () => {
    const { d, log } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest([station("a", 0, 0), station("b", 40, 0)]),
      new Map(),
    );
    layer.update(view(0, 0, "b", 0));
    expect(log.billboards.sort()).toEqual(["1 Station a", "2 Station b *"]);
    const flat = layer.billboardOf("a")!.position.y;
    layer.update(view(0, 0, "b", 1));
    const upright = layer.billboardOf("a")!.position.y;
    expect(upright - flat).toBeCloseTo(BILLBOARD_LIFT_M, 6);
    expect(flat).toBeGreaterThan(layer.pointOf("a")!.y);
  });

  // Why: looking down, photos lie flat face up (they read like map
  // symbols); tilted up, they stand as the phone shows them.
  it("lays photos flat face up when looking down, upright when tilted", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(manifest([station("a", 0, 0, [photo("p")])]), new Map());
    layer.update(view(0, 0, null, 1));
    await settle();
    const plane = layer.photoPlanes("a")[0]!;
    const normal = () =>
      new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    layer.update(view(0, 0, null, 1));
    expect(normal().z).toBeCloseTo(1, 6);
    layer.update(view(0, 0, null, 0));
    expect(normal().y).toBeCloseTo(1, 6);
  });

  // Why: a placed model's `sizeM` is its largest side (the format's rule):
  // a 2 x 4 x 1 m model at 8 m is scaled by 2, at its local pose.
  it("draws a placed model at its size, at its pose in the station", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest(
        [station("a", 0, 0, [model("m", "horse", 8)])],
        [{ id: "horse", path: "content/horse.glb", kind: "model" }],
      ),
      new Map(),
    );
    layer.update(view(0, 0, null));
    await settle();
    const models = layer.models("a");
    expect(models).toHaveLength(1);
    expect(models[0]!.scale.x).toBeCloseTo(2, 9);
    expect(models[0]!.position.toArray()).toEqual([0, 0, 2]);
  });

  // Why: a model whose file is gone or broken leaves the station drawn;
  // the 2D view still lists it.
  it("leaves a model out whose file cannot be read", async () => {
    const { d } = deps({
      loadGlbModel: () => Promise.reject(new Error("bad")),
    });
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest(
        [station("a", 0, 0, [model("m", "horse", 8), photo("p")])],
        [{ id: "horse", path: "content/horse.glb", kind: "model" }],
      ),
      new Map(),
    );
    layer.update(view(0, 0, null));
    await settle();
    expect(layer.models("a")).toHaveLength(0);
    expect(layer.photoPlanes("a")).toHaveLength(1);
  });

  // Why: a printed code is drawn at its printed size (0.2 m when the tour
  // does not say), at its own point; a code with no position is not drawn.
  it("draws every code with a position as a square of its printed size", () => {
    const { d, log } = deps();
    const layer = createStationsLayer(d);
    const level = (geo: QrLevel["qr"]["geo"], physicalSizeM?: number) =>
      ({
        qr: { geo, ...(physicalSizeM === undefined ? {} : { physicalSizeM }) },
      }) as QrLevel;
    layer.setTour(
      manifest([station("a", 0, 0)]),
      new Map([
        [
          "c1",
          level(
            { lat: ZERO.lat, lon: ZERO.lng, alt: 516 + N, headingDeg: 0 },
            0.3,
          ),
        ],
        [
          "c2",
          level({ lat: ZERO.lat, lon: ZERO.lng, alt: 516 + N, headingDeg: 90 }),
        ],
        ["c3", level(undefined, 0.5)],
      ]),
    );
    expect(log.squares).toEqual([0.3, DEFAULT_CODE_SIZE_M]);
    expect(layer.stats().codes).toBe(2);
  });

  // Why: looking down, a code on a wall is a thin line; the editor lays it
  // flat face up by the same morph as the photos, so it reads from above,
  // and lays it in front of its anchor - on the side its face looks to,
  // its near edge CODE_FLAT_GAP_M off the anchor - never under the wall
  // it hangs on. Tilted up it stands where it was measured. Its point
  // (what a click flies to) does not move.
  it("lays a code flat face up in front of its anchor when looking down, upright when tilted", () => {
    const { d, parent } = deps();
    const layer = createStationsLayer(d);
    const sizeM = 0.3;
    layer.setTour(
      manifest([station("a", 0, 0)]),
      new Map([
        [
          "c1",
          {
            qr: {
              geo: {
                lat: ZERO.lat,
                lon: ZERO.lng,
                alt: 516 + N,
                headingDeg: 0,
              },
              physicalSizeM: sizeM,
            },
          } as QrLevel,
        ],
      ]),
    );
    let square: THREE.Object3D | undefined;
    parent.traverse((o) => {
      if (o.userData["pick"] === "c1") square = o;
    });
    const sq = square!;
    const normal = () =>
      new THREE.Vector3(0, 0, 1).applyQuaternion(sq.quaternion);
    const point = layer.codePointOf("c1")!;
    // Heading 0: the face looks east, +z in the code's north-up-east frame.
    layer.update(view(0, 0, null, 1));
    expect(normal().z).toBeCloseTo(1, 6);
    const upright = sq.position.clone();
    layer.update(view(0, 0, null, 0));
    expect(normal().y).toBeCloseTo(1, 6);
    // Its printed top edge points back at the wall (-east): the same flat
    // pose as a photo facing that way.
    expect(
      new THREE.Vector3(0, 1, 0).applyQuaternion(sq.quaternion).z,
    ).toBeCloseTo(-1, 6);
    const shift = sq.position.clone().sub(upright);
    expect(shift.z).toBeCloseTo(sizeM / 2 + CODE_FLAT_GAP_M, 6);
    expect(shift.x).toBeCloseTo(0, 6);
    expect(shift.y).toBeCloseTo(0, 6);
    // Halfway: half turned, half shifted.
    layer.update(view(0, 0, null, 0.5));
    expect(normal().angleTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(
      Math.PI / 4,
      6,
    );
    expect(sq.position.z - upright.z).toBeCloseTo(
      (sizeM / 2 + CODE_FLAT_GAP_M) / 2,
      6,
    );
    // And back.
    layer.update(view(0, 0, null, 1));
    expect(normal().z).toBeCloseTo(1, 6);
    expect(sq.position.distanceTo(upright)).toBeCloseTo(0, 9);
    expect(layer.codePointOf("c1")!.distanceTo(point)).toBe(0);
  });

  // Why: a code measured lying down (on a table, its full rotation) is
  // already flat: the morph must neither shift it nor spin it about the
  // vertical, or its printed pattern would turn as the camera tilts.
  it("leaves a code that lies face up as it lies", () => {
    const { d, parent } = deps();
    const layer = createStationsLayer(d);
    const lying = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7)
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          -Math.PI / 2,
        ),
      );
    layer.setTour(
      manifest([station("a", 0, 0)]),
      new Map([
        [
          "c1",
          {
            qr: {
              geo: {
                lat: ZERO.lat,
                lon: ZERO.lng,
                alt: 516 + N,
                rotation: [lying.x, lying.y, lying.z, lying.w],
              },
              physicalSizeM: 0.3,
            },
            // A level's other fields are not read by the layer.
          } as unknown as QrLevel,
        ],
      ]),
    );
    let square: THREE.Object3D | undefined;
    parent.traverse((o) => {
      if (o.userData["pick"] === "c1") square = o;
    });
    layer.update(view(0, 0, null, 1));
    const q = square!.quaternion.clone();
    const at = square!.position.clone();
    layer.update(view(0, 0, null, 0));
    expect(square!.quaternion.angleTo(q)).toBeCloseTo(0, 6);
    expect(square!.position.distanceTo(at)).toBeCloseTo(0, 9);
  });

  // Why: from high above, a 20 cm code at its printed size is a dot. Laid
  // flat, it is drawn at least CODE_SCREEN_PX on screen: grown with the
  // camera's distance, still beside its anchor - the gap grows with it, so
  // a grown code never covers the wall it hangs on - and picked where it
  // is drawn; at its printed size where that is larger on screen, and
  // tilted up. No cap: a cap of 8 times left a 20 cm code about 3 px wide.
  it("draws a code laid flat at least its size on screen, beside its anchor, and picks it where it is drawn", () => {
    const { d, parent } = deps();
    const layer = createStationsLayer(d);
    const sizeM = 0.2;
    layer.setTour(
      // Its station 50 m north: only the code is under the rays.
      manifest([station("a", 0, 50)]),
      new Map([
        [
          "c1",
          {
            qr: {
              geo: {
                lat: ZERO.lat,
                lon: ZERO.lng,
                alt: 516 + N,
                headingDeg: 0,
              },
              physicalSizeM: sizeM,
            },
          } as QrLevel,
        ],
      ]),
    );
    let square: THREE.Object3D | undefined;
    parent.traverse((o) => {
      if (o.userData["pick"] === "c1") square = o;
    });
    const sq = square!;
    const point = layer.codePointOf("c1")!;
    const above = (m: number) => point.clone().add(new THREE.Vector3(0, m, 0));
    layer.update(view(0, 0, null, 1));
    const upright = sq.position.clone();
    const shiftZ = () => sq.position.z - upright.z;
    const focal = focalPxOf(900, 50);
    /** The square's side on screen (px) from `m` straight above. */
    const px = (m: number) => (sizeM * sq.scale.x * focal) / m;

    layer.update(view(0, 0, null, 0, false, above(300)));
    expect(px(300)).toBeCloseTo(CODE_SCREEN_PX, 6);
    expect(sq.scale.y).toBeCloseTo(sq.scale.x, 9);
    expect(layer.stats().codeScales).toEqual([sq.scale.x]);
    // The whole flat layout grows: the near edge stays the grown gap off
    // the anchor.
    expect(shiftZ()).toBeCloseTo((sizeM / 2 + CODE_FLAT_GAP_M) * sq.scale.x, 6);

    // A ray straight down 0.3 m off the drawn middle meets the grown code
    // (half its side about 1.9 m) but not one at its printed size (0.1 m).
    const middle = sq.getWorldPosition(new THREE.Vector3());
    const down = (from: THREE.Vector3) => {
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      camera.position.copy(from).add(new THREE.Vector3(0.3, 300, 0.3));
      camera.up.set(0, 0, -1);
      camera.lookAt(camera.position.clone().setY(0));
      camera.updateMatrixWorld(true);
      const r = new THREE.Raycaster();
      r.setFromCamera(new THREE.Vector2(0, 0), camera);
      return r;
    };
    expect(layer.pick(down(middle))).toBe("c1");

    // Near enough that its printed size is larger on screen: that size.
    layer.update(view(0, 0, null, 0, false, above(10)));
    expect(sq.scale.x).toBe(1);
    expect(px(10)).toBeGreaterThan(CODE_SCREEN_PX);
    expect(shiftZ()).toBeCloseTo(sizeM / 2 + CODE_FLAT_GAP_M, 6);
    expect(
      layer.pick(down(sq.getWorldPosition(new THREE.Vector3()))),
    ).toBeNull();

    // Far off, still its size on screen (no cap); tilted up, its printed
    // size wherever.
    layer.update(view(0, 0, null, 0, false, above(5000)));
    expect(px(5000)).toBeCloseTo(CODE_SCREEN_PX, 6);
    expect(sq.scale.x).toBeGreaterThan(100);
    layer.update(view(0, 0, null, 1, false, above(5000)));
    expect(sq.scale.x).toBe(1);
    expect(sq.position.distanceTo(upright)).toBeCloseTo(0, 9);
    // Its point (what a click on its row flies to) never moves.
    expect(layer.codePointOf("c1")!.distanceTo(point)).toBe(0);

    // The drawn square's corners in the world (what the page projects to
    // measure the code on screen): its printed side times its growth.
    layer.update(view(0, 0, null, 0, false, above(300)));
    const corners = layer.codeCorners();
    expect(corners).toHaveLength(1);
    const [c0, c1, c2, c3] = corners[0]!;
    for (const [a, b] of [
      [c0, c1],
      [c1, c2],
      [c2, c3],
      [c3, c0],
    ] as const) {
      expect(a!.distanceTo(b!)).toBeCloseTo(sizeM * sq.scale.x, 6);
    }
    // Laid flat: all four at one height, the code's middle among them.
    for (const c of corners[0]!) expect(c.y).toBeCloseTo(c0!.y, 6);
    const mid = sq.getWorldPosition(new THREE.Vector3());
    expect(
      c0!.clone().add(c2!).multiplyScalar(0.5).distanceTo(mid),
    ).toBeLessThan(0.05);
  });

  // Why: the same size on screen in a smaller view. The layer reads the
  // view's height each frame (a phone turned, a window resized), so a
  // code is not drawn at the desktop's size in a landscape phone's 390 px.
  it("grows a code for the view's own height", () => {
    const { d, parent } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest([station("a", 0, 50)]),
      new Map([
        [
          "c1",
          {
            qr: {
              geo: {
                lat: ZERO.lat,
                lon: ZERO.lng,
                alt: 516 + N,
                headingDeg: 0,
              },
              physicalSizeM: 0.2,
            },
          } as QrLevel,
        ],
      ]),
    );
    let sq: THREE.Object3D | undefined;
    parent.traverse((o) => {
      if (o.userData["pick"] === "c1") sq = o;
    });
    const camera = layer.codePointOf("c1")!.add(new THREE.Vector3(0, 300, 0));
    layer.update({ ...view(0, 0, null, 0, false, camera), viewportPx: 390 });
    expect((0.2 * sq!.scale.x * focalPxOf(390, 50)) / 300).toBeCloseTo(
      CODE_SCREEN_PX,
      6,
    );
  });

  // Why: a click on an item's row or a code's row flies the camera there,
  // so the layer must say where each stands in the world - an item at its
  // pose in its station's frame (x north, y up, z east there; the world
  // is x east, y up, z south), whether or not its station draws its items
  // now - and must say nothing for an id the tour does not have.
  it("says where an item and a code stand, drawn or not", () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    const turned = station("t", 0, 0, [photo("p2")]);
    layer.setTour(
      manifest([
        station("a", 0, 0, [photo("p1")]),
        {
          ...turned,
          geo: {
            ...turned.geo,
            // A quarter turn about up: the station's north looks east.
            rotation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2],
          },
        },
      ]),
      new Map([
        [
          "c1",
          {
            qr: {
              geo: {
                lat: ZERO.lat,
                lon: ZERO.lng,
                alt: 517 + N,
                headingDeg: 0,
              },
            },
          } as QrLevel,
        ],
      ]),
    );
    const a = layer.pointOf("a")!;
    // The photo's pose is 1 m north and 1.5 m up of its station.
    const p1 = layer.itemPointOf("p1")!;
    expect(p1.x - a.x).toBeCloseTo(0, 3);
    expect(p1.y - a.y).toBeCloseTo(1.5, 3);
    expect(p1.z - a.z).toBeCloseTo(-1, 3);
    // In the turned station, 1 m along its north is 1 m east.
    const p2 = layer.itemPointOf("p2")!;
    expect(p2.x - a.x).toBeCloseTo(1, 3);
    expect(p2.z - a.z).toBeCloseTo(0, 3);
    const c1 = layer.codePointOf("c1")!;
    expect(c1.y - a.y).toBeCloseTo(2, 3);
    expect(layer.itemPointOf("gone")).toBeNull();
    expect(layer.codePointOf("gone")).toBeNull();
  });

  // Why: the layer chips turn the station names (billboards and their
  // poles) and the codes off and on again; a station rendered while its
  // name is off must stay without a billboard too.
  it("hides the names and the codes, and shows them again", () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest([station("a", 0, 0)]),
      new Map([
        [
          "c1",
          {
            qr: {
              geo: {
                lat: ZERO.lat,
                lon: ZERO.lng,
                alt: 517 + N,
                headingDeg: 0,
              },
            },
          } as QrLevel,
        ],
      ]),
    );
    layer.setShown({ names: false, codes: false });
    layer.update(view(0, 0, null));
    expect(layer.billboardOf("a")?.visible).toBe(false);
    expect(layer.codesVisible()).toBe(false);
    layer.setShown({ names: true, codes: true });
    layer.update(view(0, 0, null));
    expect(layer.billboardOf("a")?.visible).toBe(true);
    expect(layer.codesVisible()).toBe(true);
  });

  // Why: a selected station has no ring of its own in the gizmo - its
  // found-radius circle IS the ring its radius dots sit on - so the circle
  // must show the selection's amber, and a selected item's station a
  // lighter blue, or the creator cannot see which circle the dots resize.
  it("draws the selected station's circle in the selection's amber, and a selected item's station lighter", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest([station("a", 0, 0, [photo("p")]), station("b", 40, 0)]),
      new Map(),
    );
    const ringColour = (id: string) => {
      const at = layer.pointOf(id)!;
      let found: THREE.Mesh | null = null;
      layer.group.traverse((o) => {
        if (o.name !== "found-radius") return;
        o.updateWorldMatrix(true, false);
        const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        if (Math.hypot(p.x - at.x, p.z - at.z) < 1) found = o as THREE.Mesh;
      });
      if (found === null) throw new Error(`no circle for ${id}`);
      return (
        (found as THREE.Mesh).material as THREE.MeshBasicMaterial
      ).color.getHex();
    };
    layer.update(view(20, 0, "a", 1, true));
    await settle();
    expect(ringColour("a")).toBe(0xe9a23b);
    expect(ringColour("b")).toBe(0x6fa8dc);
    layer.update(view(20, 0, "a", 1, false));
    expect(ringColour("a")).toBe(0xa8c8ea);
    layer.update(view(20, 0, null));
    expect(ringColour("a")).toBe(0x6fa8dc);
    layer.dispose();
  });

  // Why: while a drag runs the station is drawn where the drag has it -
  // its items, its billboard and its found radius with it - without
  // rendering anything again (a re-render per frame would blink the
  // photos and stall); cleared, it is drawn where the tour has it.
  it("draws a station's preview where the drag has it, and back when cleared", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    const a = station("a", 0, 0, [photo("p")]);
    layer.setTour(manifest([a]), new Map());
    layer.update(view(0, 0, "a"));
    await settle();
    const plane = layer.photoPlanes("a")[0]!;
    const worldOf = (o: THREE.Object3D) => {
      o.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    };
    const ring = () => layer.group.getObjectByName("found-radius")!;
    const before = worldOf(plane);
    const billboardBefore = layer.billboardOf("a")!.position.clone();
    layer.setPreview({
      kind: "station",
      id: "a",
      geo: { ...a.geo, lat: a.geo.lat + 10 / M_PER_DEG_LAT },
      foundRadiusM: 16,
    });
    layer.update(view(0, 0, "a"));
    const moved = worldOf(plane);
    expect(moved.z - before.z).toBeCloseTo(-10, 1);
    expect(moved.x - before.x).toBeCloseTo(0, 1);
    expect(moved.y - before.y).toBeCloseTo(0, 2);
    expect(layer.billboardOf("a")!.position.z - billboardBefore.z).toBeCloseTo(
      -10,
      1,
    );
    expect(ring().scale.x).toBeCloseTo(2, 9);
    expect(layer.stats().renders).toBe(1);
    layer.setPreview(null);
    layer.update(view(0, 0, "a"));
    expect(worldOf(plane).distanceTo(before)).toBeLessThan(1e-6);
    expect(ring().scale.x).toBe(1);
    expect(layer.billboardOf("a")!.position.distanceTo(billboardBefore)).toBe(
      0,
    );
  });

  // Why: an item dragged, turned or (a model) resized is drawn at the
  // drag's pose in its station's frame - a photo keeps the flat-or-upright
  // morph, turned with it - and goes back when the drag is cleared.
  it("draws an item's and a model's preview, and back when cleared", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    const a = station("a", 0, 0, [photo("p"), model("m", "horse", 8)]);
    layer.setTour(
      manifest(
        [a],
        [{ id: "horse", path: "content/horse.glb", kind: "model" }],
      ),
      new Map(),
    );
    layer.update(view(0, 0, "a"));
    await settle();
    const plane = layer.photoPlanes("a")[0]!;
    const horse = layer.models("a")[0]!;
    const quarter = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -Math.PI / 2,
    );
    const turnedAway = (position: [number, number, number]) =>
      itemGeoPose(
        {
          position,
          rotation: [quarter.x, quarter.y, quarter.z, quarter.w],
        },
        a.geo,
      );
    layer.setPreview({
      kind: "item",
      id: "p",
      geo: turnedAway([1, 1.5, 3]),
      sizeM: null,
    });
    layer.update(view(0, 0, "a", 1));
    expect(plane.position.x).toBeCloseTo(1, 3);
    expect(plane.position.z).toBeCloseTo(3, 3);
    expect(plane.quaternion.angleTo(quarter)).toBeLessThan(1e-6);
    layer.setPreview({
      kind: "item",
      id: "m",
      geo: turnedAway([0, 0, 5]),
      sizeM: 16,
    });
    layer.update(view(0, 0, "a", 1));
    // The photo is back where the tour has it.
    expect(plane.position.toArray()).toEqual([1, 1.5, 0]);
    expect(plane.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    expect(horse.position.z).toBeCloseTo(5, 3);
    expect(horse.scale.x).toBeCloseTo(4, 9);
    layer.setPreview(null);
    layer.update(view(0, 0, "a", 1));
    expect(horse.position.toArray()).toEqual([0, 0, 2]);
    expect(horse.scale.x).toBeCloseTo(2, 9);
  });

  // Why: a click in the view selects what is under the pointer - a
  // station by its billboard, an item by its drawing (a placed model by
  // any of its parts), a code by its square; the ring and the pole are
  // no selection, and a click on nothing is none.
  it("says what is under a ray", async () => {
    const { d } = deps({
      makeBillboard: () => {
        const sprite = new THREE.Sprite();
        sprite.scale.set(4, 4, 1);
        return sprite;
      },
    });
    const layer = createStationsLayer(d);
    // The model 6 m west, behind the photo seen from the east.
    const west = {
      ...model("m", "horse", 8),
      pose: { position: [0, 0, -6], rotation: [0, 0, 0, 1] },
    } as TourItem;
    const a = station("a", 0, 0, [photo("p"), west]);
    layer.setTour(
      manifest(
        [a],
        [{ id: "horse", path: "content/horse.glb", kind: "model" }],
      ),
      new Map([
        [
          "c1",
          {
            qr: {
              geo: {
                lat: ZERO.lat + 30 / M_PER_DEG_LAT,
                lon: ZERO.lng,
                alt: 516 + N,
                headingDeg: 0,
              },
              physicalSizeM: 2,
            },
          } as QrLevel,
        ],
      ]),
    );
    layer.update(view(0, 0, "a", 1));
    await settle();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const ray = (from: THREE.Vector3, to: THREE.Vector3) => {
      camera.position.copy(from);
      camera.lookAt(to);
      camera.updateMatrixWorld(true);
      const r = new THREE.Raycaster();
      r.setFromCamera(new THREE.Vector2(0, 0), camera);
      return r;
    };
    const anchor = layer.pointOf("a")!;
    const look = (target: THREE.Vector3) =>
      ray(target.clone().add(new THREE.Vector3(0, 0, 20)), target);
    // The photo, 1 m north and 1.5 m up, facing east: seen from the east.
    const p = layer.itemPointOf("p")!;
    expect(layer.pick(ray(p.clone().add(new THREE.Vector3(20, 0, 0)), p))).toBe(
      "p",
    );
    // The model from the south: its box is 4 m by 8 m by 2 m.
    expect(
      layer.pick(look(layer.itemPointOf("m")!.add(new THREE.Vector3(0, 2, 0)))),
    ).toBe("m");
    expect(layer.pick(look(layer.billboardOf("a")!.position.clone()))).toBe(
      "station:a",
    );
    const code = layer.codePointOf("c1")!;
    expect(
      layer.pick(ray(code.clone().add(new THREE.Vector3(20, 0, 0)), code)),
    ).toBe("c1");
    expect(
      layer.pick(
        ray(
          anchor.clone().add(new THREE.Vector3(0, 0, 20)),
          anchor.clone().add(new THREE.Vector3(0, 0, 60)),
        ),
      ),
    ).toBeNull();
  });

  it("takes everything out of the scene when disposed", () => {
    const { d, parent } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(manifest([station("a", 0, 0)]), new Map());
    layer.update(view(0, 0, null));
    layer.dispose();
    expect(parent.children).toHaveLength(0);
  });
});

describe("codeQuaternionNue", () => {
  const axes = (q: THREE.Quaternion) => ({
    x: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    z: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
  });

  // Why: a vertical poster at heading h has its +x along h and faces
  // h + 90 degrees (the framework's convention); in the north-up-east
  // frame heading 0 is +x north with the face to the east.
  it("turns a poster by its heading", () => {
    const at0 = axes(
      codeQuaternionNue({ lat: 0, lon: 0, alt: 0, headingDeg: 0 }),
    );
    expect(at0.x.toArray().map((v) => Math.round(v * 1e9) / 1e9)).toEqual([
      1, 0, 0,
    ]);
    expect(at0.z.z).toBeCloseTo(1, 9);
    const at90 = axes(
      codeQuaternionNue({ lat: 0, lon: 0, alt: 0, headingDeg: 90 }),
    );
    expect(at90.x.z).toBeCloseTo(1, 9);
    // Facing south: -north.
    expect(at90.z.x).toBeCloseTo(-1, 9);
  });

  // Why: a 6-DoF code carries its full rotation; the square takes it as
  // it is (a code lying on a table faces up).
  it("takes a full rotation as it is", () => {
    const flat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -Math.PI / 2,
    );
    const q = codeQuaternionNue({
      lat: 0,
      lon: 0,
      alt: 0,
      rotation: [flat.x, flat.y, flat.z, flat.w],
    });
    expect(axes(q).z.y).toBeCloseTo(1, 9);
  });
});

describe("focalPxOf", () => {
  // Why: a code's size on screen is worked out from the view's height and
  // lens as a billboard's is: a 900 px high view through 50 degrees is
  // about 965 px per radian straight ahead.
  it("is the view's half height over the tangent of half the lens", () => {
    expect(focalPxOf(900, 50)).toBeCloseTo(
      450 / Math.tan((25 * Math.PI) / 180),
      9,
    );
    expect(focalPxOf(900, 50)).toBeCloseTo(965, 0);
    expect(focalPxOf(390, 50)).toBeCloseTo(418, 0);
  });
});

describe("codeGrowth", () => {
  const F = focalPxOf(900, 50);
  /** The code's side on screen (px) for a growth `k`. */
  const px = (k: number, m: number, sizeM = 0.2) => (sizeM * k * F) / m;

  // Why: laid flat, a code is drawn CODE_SCREEN_PX on screen wherever its
  // printed size would be smaller - for a 20 cm code from about 16 m up on
  // a 900 px high view - and at its printed size nearer, where that is
  // larger. No cap: under a cap of 8 a 20 cm code stayed about 3 px.
  it("draws a code its size on screen from where its printed size is smaller, and its printed size nearer", () => {
    expect(CODE_SCREEN_PX).toBe(12);
    for (const m of [17, 50, 100, 300, 1100, 5000]) {
      expect(px(codeGrowth(m, 0, 0.2, F), m), `${m} m`).toBeCloseTo(
        CODE_SCREEN_PX,
        9,
      );
    }
    for (const m of [0, 2.5, 10, 16]) {
      expect(codeGrowth(m, 0, 0.2, F), `${m} m`).toBe(1);
    }
    // A larger code starts growing farther off: a 66 cm poster from 53 m.
    expect(codeGrowth(50, 0, 0.66, F)).toBe(1);
    expect(px(codeGrowth(100, 0, 0.66, F), 100, 0.66)).toBeCloseTo(
      CODE_SCREEN_PX,
      9,
    );
  });

  // Why: the code grows only as far as it lies flat: tilted up it stands
  // at its printed size where it was measured, and halfway it is halfway.
  it("grows only as far as the code lies flat", () => {
    const far = codeGrowth(300, 0, 0.2, F);
    expect(far).toBeGreaterThan(10);
    expect(codeGrowth(300, 1, 0.2, F)).toBe(1);
    expect(codeGrowth(300, 0.5, 0.2, F)).toBeCloseTo(1 + (far - 1) * 0.5, 12);
    expect(codeGrowth(300, 0.25, 0.2, F)).toBeCloseTo(1 + (far - 1) * 0.75, 12);
  });

  // Why: a camera, a morph, a size or a view that is not a usable number
  // (a view not set up yet, a code without a size) draws the code at its
  // printed size, never at no size, an endless one or a NaN one.
  it("is 1 for a distance, morph, size or view that is not a usable number", () => {
    for (const [m, s, size, f] of [
      [Number.NaN, 0, 0.2, F],
      [Number.POSITIVE_INFINITY, 0, 0.2, F],
      [-5, 0, 0.2, F],
      [300, Number.NaN, 0.2, F],
      [300, 0, 0, F],
      [300, 0, -0.2, F],
      [300, 0, Number.NaN, F],
      [300, 0, 0.2, 0],
      [300, 0, 0.2, Number.NaN],
      [300, 0, 0.2, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(codeGrowth(m, s, size, f), `${m}, ${s}, ${size}, ${f}`).toBe(1);
    }
    // A morph past either end is taken at that end.
    expect(codeGrowth(300, -1, 0.2, F)).toBeCloseTo(
      codeGrowth(300, 0, 0.2, F),
      12,
    );
    expect(codeGrowth(300, 2, 0.2, F)).toBe(1);
  });

  // Why: whatever the camera does, a code is never drawn smaller than
  // printed, and laid flat it is exactly the larger of its printed size
  // on screen and CODE_SCREEN_PX; it grows (or stays) as the camera goes
  // farther and shrinks (or stays) as the view tilts up - no jump the eye
  // catches.
  it("is at least 1, the larger of its printed and its screen size laid flat, grows with distance, shrinks as the view tilts up", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 20_000, noNaN: true }),
        fc.double({ min: 0.5, max: 20_000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.02, max: 2, noNaN: true }),
        fc.double({ min: 100, max: 3000, noNaN: true }),
        (m1, m2, s1, s2, size, f) => {
          const k = codeGrowth(m1, s1, size, f);
          expect(k).toBeGreaterThanOrEqual(1);
          const printedPx = (size * f) / m1;
          const flatPx = (size * codeGrowth(m1, 0, size, f) * f) / m1;
          expect(flatPx).toBeCloseTo(Math.max(printedPx, CODE_SCREEN_PX), 6);
          const [near, far] = m1 <= m2 ? [m1, m2] : [m2, m1];
          expect(codeGrowth(far, s1, size, f)).toBeGreaterThanOrEqual(
            codeGrowth(near, s1, size, f),
          );
          const [low, high] = s1 <= s2 ? [s1, s2] : [s2, s1];
          expect(codeGrowth(m1, high, size, f)).toBeLessThanOrEqual(
            codeGrowth(m1, low, size, f),
          );
        },
      ),
    );
  });
});
