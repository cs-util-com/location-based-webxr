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
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { worldFromEcefAt } from "gps-plus-slam-globe/editor";

import {
  BILLBOARD_LIFT_M,
  DEFAULT_CODE_SIZE_M,
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
) => ({
  centre: new THREE.Vector3(east, 0, -north),
  selectedStation: selected,
  standing,
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
