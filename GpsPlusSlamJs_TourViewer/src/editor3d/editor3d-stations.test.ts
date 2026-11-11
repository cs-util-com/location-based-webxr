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
  TourBlock,
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
  RING_ITEM_OUT,
  RING_RENDER_ORDER,
  codeGrowth,
  focalPxOf,
  codeQuaternionNue,
  createStationsLayer,
  type StationsLayerDeps,
} from "./editor3d-stations.js";
import { isInterfacePart } from "./globe-interface-pass.js";
import { pickOnlyOnPill } from "./editor3d-marks.js";
import { buildLecternStand } from "../lectern-view.js";
import { buildReadingSign } from "../reading-sign.js";
import { renderTourStation } from "../content-placement.js";
import { worldBlocks } from "../tour-document.js";
import {
  mountedWorldParts,
  worldEnv,
  type WorldEnv,
  type WorldPart,
} from "../world-part.js";
import { worldPartOf } from "../play-kinds.js";
import {
  stationContent,
  stationBlocks,
} from "../test-support/station-content.js";

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
  items: TourBlock[] = [],
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
    ...stationContent(items),
  };
}

/** A tour of `stations` listing `assets` and each picture's photo
 *  (`content/<image>.jpg`), as a file holding captured photos does. */
function manifest(
  stations: TourStation[],
  assets: TourManifest["assets"] = [],
): TourManifest {
  const photos = stations.flatMap((s) =>
    stationBlocks(s).flatMap((b) =>
      b.kind === "picture"
        ? [
            {
              id: b.image,
              path: `content/${b.image}.jpg`,
              kind: "image" as const,
            },
          ]
        : [],
    ),
  );
  return {
    version: 5,
    minor: 0,
    order: "fixed",
    assets: [...assets, ...photos],
    stations,
  };
}

const photo = (id: string): TourBlock => ({
  kind: "picture",
  view: "plane",
  id,
  createdAtIso: "2026-10-22T08:00:00Z",
  image: id,
  widthM: 1,
  pose: { position: [1, 1.5, 0], rotation: [0, 0, 0, 1] },
});

const model = (id: string, asset: string, sizeM: number): TourBlock => ({
  kind: "model",
  view: "placed",
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
    // The visitor's door, as the page gives it: models stand through it.
    worldPart: worldPartOf,
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
  // a 2 x 4 x 1 m model at 8 m is scaled by 2, at its local pose. It
  // stands through the visitor's world door: the part is placed, the
  // model in it scaled.
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
    expect(models[0]!.parent?.position.toArray()).toEqual([0, 0, 2]);
    layer.dispose();
  });

  // Why: the 3D view draws a model by its file, pose, size and view; its
  // notes and sections are drawn apart (`editor3d-model-parts.ts`). An
  // edit of those must not load the file again: while it loads, the model
  // is not drawn and a click waited for on it meets nothing. A new view
  // or pose draws it anew, as the visitor would see it.
  it("keeps a model drawn through an edit of its notes or sections, and draws it anew when its view or pose changes", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    const assets = [
      { id: "horse", path: "content/horse.glb", kind: "model" as const },
    ];
    const placed = model("m", "horse", 8);
    layer.setTour(manifest([station("a", 0, 0, [placed])], assets), new Map());
    layer.update(view(0, 0, null));
    await settle();
    const drawn = layer.modelObject("m");
    expect(drawn).not.toBeNull();
    const annotated = {
      ...placed,
      annotations: [{ position: [0, 1, 0], normal: [0, 1, 0], title: "Top" }],
      sections: [{ name: "Cut", position: [0, 0, 0], normal: [1, 0, 0] }],
    } as TourBlock;
    layer.setTour(
      manifest([station("a", 0, 0, [annotated])], assets),
      new Map(),
    );
    layer.update(view(0, 0, null));
    expect(layer.modelObject("m")).toBe(drawn);
    expect(layer.stats().renders).toBe(1);
    const viewed = { ...annotated, view: "hotspots" } as TourBlock;
    layer.setTour(manifest([station("a", 0, 0, [viewed])], assets), new Map());
    layer.update(view(0, 0, null));
    await settle();
    expect(layer.stats().renders).toBe(2);
    expect(layer.modelObject("m")).not.toBe(drawn);
    const moved = {
      ...viewed,
      pose: { position: [0, 0, 3], rotation: [0, 0, 0, 1] },
    } as TourBlock;
    layer.setTour(manifest([station("a", 0, 0, [moved])], assets), new Map());
    layer.update(view(0, 0, null));
    await settle();
    expect(layer.stats().renders).toBe(3);
    expect(layer.modelObject("m")?.parent?.position.toArray()).toEqual([
      0, 0, 3,
    ]);
    layer.dispose();
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

  // Why: a free model in the card or stage view stands nothing in the
  // station's world for a visitor (the card is a panel, the stage is the
  // story's), and the editor's 3D view draws what the visitor sees, so
  // it draws none either - and does not read its file.
  it("draws no free model in the card or stage view, and reads no file for it", async () => {
    let parsed = 0;
    const { d } = deps({
      loadGlbModel: () => {
        parsed += 1;
        return Promise.resolve(new THREE.Mesh(new THREE.BoxGeometry()));
      },
    });
    const layer = createStationsLayer(d);
    const card = { ...model("c", "horse", 8), view: "card" } as TourBlock;
    const stage = { ...model("s", "horse", 8), view: "stage" } as TourBlock;
    layer.setTour(
      manifest(
        [station("a", 0, 0, [card, stage, photo("p")])],
        [{ id: "horse", path: "content/horse.glb", kind: "model" }],
      ),
      new Map(),
    );
    layer.update(view(0, 0, null));
    await settle();
    expect(layer.models("a")).toHaveLength(0);
    expect(layer.modelObject("c")).toBeNull();
    expect(layer.modelObject("s")).toBeNull();
    expect(parsed).toBe(0);
    expect(layer.photoPlanes("a")).toHaveLength(1);
    layer.dispose();
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

  // Why: what is drawn over everything (a billboard, a sound's icon) shows
  // in front of a nearer item with a depth test, so a click on what the
  // creator sees there must select it, not the item hidden behind it on
  // the screen. A ray meeting only the item still selects the item.
  it("picks what is seen: a part drawn over everything before a nearer depth-tested one", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest(
        [station("a", 0, 0, [model("m", "box", 2)])],
        [{ id: "box", path: "content/box.glb", kind: "model" }],
      ),
      new Map(),
    );
    layer.update(view(0, 0, null, 1));
    await settle();
    layer.update(view(0, 0, null, 1));
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const ray = (from: THREE.Vector3, to: THREE.Vector3) => {
      camera.position.copy(from);
      camera.lookAt(to);
      camera.updateMatrixWorld(true);
      const r = new THREE.Raycaster();
      r.setFromCamera(new THREE.Vector2(0, 0), camera);
      return r;
    };
    d.parent.updateMatrixWorld(true);
    const board = layer.billboardOf("a")!.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3()
      .setFromObject(layer.modelObject("m")!)
      .getCenter(new THREE.Vector3());
    // From beyond the box, through it, to the billboard behind it.
    const from = box
      .clone()
      .add(box.clone().sub(board).normalize().multiplyScalar(20));
    const kinds = ray(from, board)
      .intersectObject(d.parent, true)
      .map((h) => (h.object instanceof THREE.Sprite ? "sprite" : "mesh"));
    // The box is met first, the billboard after it.
    expect(kinds[0]).toBe("mesh");
    expect(kinds).toContain("sprite");
    expect(layer.pick(ray(from, board))).toBe("station:a");
    // From its side, away from the billboard: the box alone.
    const side = box.clone().add(new THREE.Vector3(0, 0, 20));
    expect(layer.pick(ray(side, box))).toBe("m");
    layer.dispose();
  });

  // Why: a billboard's sprite is its whole 512 x 128 canvas, but its pill
  // is drawn only `width` px wide, centred, with transparent rows above and
  // below. A click on a model seen through the transparent margin must
  // select the model; a click on the pill over it still selects the station.
  it("picks a billboard only on its drawn pill, not on its transparent margin", async () => {
    const { d } = deps({
      makeBillboard: () => {
        const s = new THREE.Sprite();
        // 0.4 m wide for the canvas's 512 px, a pill 128 px wide drawn on
        // it: the pill spans 0.1 m, the margin the 0.15 m either side.
        s.scale.set(0.4, 0.1, 1);
        pickOnlyOnPill(s, 128);
        return s;
      },
    });
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest(
        [station("a", 0, 0, [model("m", "box", 2)])],
        [{ id: "box", path: "content/box.glb", kind: "model" }],
      ),
      new Map(),
    );
    layer.update(view(0, 0, null, 1));
    await settle();
    layer.update(view(0, 0, null, 1));
    d.parent.updateMatrixWorld(true);
    const board = layer.billboardOf("a")!.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3()
      .setFromObject(layer.modelObject("m")!)
      .getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.copy(
      box.clone().add(box.clone().sub(board).normalize().multiplyScalar(20)),
    );
    camera.lookAt(board);
    camera.updateMatrixWorld(true);
    const right = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      0,
    );
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    /** A ray from the camera through `at` on the billboard. */
    const through = (at: THREE.Vector3) => {
      const r = new THREE.Raycaster();
      const ndc = at.clone().project(camera);
      r.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      return r;
    };
    const kindsOf = (r: THREE.Raycaster) =>
      r
        .intersectObject(d.parent, true)
        .map((h) => (h.object instanceof THREE.Sprite ? "sprite" : "mesh"));
    // Through the side margin (uv x 0.875): the box alone, no billboard.
    const margin = through(board.clone().addScaledVector(right, 0.15));
    expect(kindsOf(margin)[0]).toBe("mesh");
    expect(kindsOf(margin)).not.toContain("sprite");
    expect(layer.pick(margin)).toBe("m");
    // Through the transparent rows above the pill (uv y 0.95): the box.
    const above = through(board.clone().addScaledVector(up, 0.045));
    expect(kindsOf(above)[0]).toBe("mesh");
    expect(layer.pick(above)).toBe("m");
    // Through the pill, over the box: the station.
    const pill = through(board.clone().addScaledVector(right, 0.03));
    expect(kindsOf(pill)[0]).toBe("mesh");
    expect(kindsOf(pill)).toContain("sprite");
    expect(layer.pick(pill)).toBe("station:a");
    layer.dispose();
  });

  // Why: where two parts drawn over everything overlap on the screen, the
  // one drawn last (the higher render order) is the one seen, so a click
  // there selects it even when the other is nearer; between equal orders
  // the nearer one wins.
  it("between overlapping parts drawn over everything, picks the higher render order, then the nearer", () => {
    const { d } = deps({
      makeBillboard: (_number, _title, selected) => {
        const s = new THREE.Sprite();
        s.renderOrder = selected ? 31 : 30;
        return s;
      },
    });
    const layer = createStationsLayer(d);
    // b stands 10 m north of a, behind it seen from the south.
    layer.setTour(
      manifest([station("a", 0, 0), station("b", 0, 10)]),
      new Map(),
    );
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const pickFromSouth = () => {
      d.parent.updateMatrixWorld(true);
      const a = layer.billboardOf("a")!.getWorldPosition(new THREE.Vector3());
      camera.position.set(a.x, a.y, a.z + 30);
      camera.lookAt(a);
      camera.updateMatrixWorld(true);
      const r = new THREE.Raycaster();
      r.setFromCamera(new THREE.Vector2(0, 0), camera);
      const sprites = r
        .intersectObject(d.parent, true)
        .filter((h) => h.object instanceof THREE.Sprite);
      expect(sprites.length).toBe(2);
      return layer.pick(r);
    };
    // b selected (31) behind a (30): b is drawn over a.
    layer.update(view(0, 0, "b"));
    expect(pickFromSouth()).toBe("station:b");
    // a selected: the higher order and the nearer.
    layer.update(view(0, 0, "a"));
    expect(pickFromSouth()).toBe("station:a");
    // Equal orders: the nearer, a.
    layer.update(view(0, 0, null));
    expect(pickFromSouth()).toBe("station:a");
    layer.dispose();
  });

  // Why: on the globe view the visibility rule hides a station too small
  // or too crowded on screen, and a code too small, one by one; what is
  // hidden must not draw (its billboard, its root with its items) nor be
  // picked through, and the chips' own choice must still hold over it.
  it("hides single stations and codes, and nothing hidden is picked", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest([station("a", 0, 0, [photo("p")]), station("b", 40, 0)]),
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
              physicalSizeM: 2,
            },
          } as QrLevel,
        ],
      ]),
    );
    layer.update(view(0, 0, null, 1));
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
    const look = (target: THREE.Vector3) =>
      ray(target.clone().add(new THREE.Vector3(0, 0, 20)), target);
    const code = layer.codePointOf("c1")!;
    const codeRay = () =>
      ray(code.clone().add(new THREE.Vector3(20, 0, 0)), code);
    const p = layer.itemPointOf("p")!;
    const photoRay = () => ray(p.clone().add(new THREE.Vector3(20, 0, 0)), p);
    expect(layer.pick(photoRay())).toBe("p");
    expect(layer.pick(codeRay())).toBe("c1");

    layer.setHidden(new Set(["a"]), new Set(["c1"]));
    layer.update(view(0, 0, null, 1));
    expect(layer.billboardOf("a")?.visible).toBe(false);
    expect(layer.billboardOf("b")?.visible).toBe(true);
    expect(layer.pick(photoRay())).toBeNull();
    expect(layer.pick(codeRay())).toBeNull();
    expect(layer.pick(look(layer.billboardOf("a")!.position.clone()))).toBe(
      null,
    );
    expect(layer.pick(look(layer.billboardOf("b")!.position.clone()))).toBe(
      "station:b",
    );

    // Shown again by the rule, but the chips have the codes off.
    layer.setShown({ names: true, codes: false });
    layer.setHidden(new Set(), new Set());
    layer.update(view(0, 0, null, 1));
    expect(layer.billboardOf("a")?.visible).toBe(true);
    expect(layer.pick(photoRay())).toBe("p");
    expect(layer.pick(codeRay())).toBeNull();
    layer.setShown({ names: true, codes: true });
    expect(layer.pick(codeRay())).toBe("c1");
    layer.dispose();
  });

  // Why: the globe view stages each station's first upload (its materials
  // compiled, its textures uploaded) and needs every object the station
  // draws - its root and its billboard, which hangs beside it - or a part
  // left out would still upload in the first frame.
  it("hands a station's drawn objects (its root and its billboard), null for none", () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest([station("a", 0, 0, [photo("p")]), station("b", 40, 0)]),
      new Map(),
    );
    layer.update(view(0, 0, null));
    const objects = layer.stationObjects("a");
    expect(objects).not.toBeNull();
    expect(objects).toContain(layer.billboardOf("a"));
    const names: string[] = [];
    for (const o of objects ?? []) o.traverse((c) => names.push(c.name));
    expect(names).toContain("found-radius");
    // The globe's interface pass finds the pole by this name.
    expect(names).toContain("pole");
    expect(layer.stationObjects("nowhere")).toBeNull();
    layer.dispose();
  });

  // Why: the ring lies flat at the station's height, so on a slope the
  // relief above that height covered it (seen on a phone). A flat ring
  // cannot follow a slope, so it is drawn over the ground, and as an
  // overlay it is also what the globe's interface pass lifts.
  it("draws the found radius over the ground, whatever the relief's height", () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(manifest([station("a", 0, 0)]), new Map());
    layer.update(view(0, 0, null));
    const ring = layer.group.getObjectByName("found-radius") as THREE.Mesh;
    const material = ring.material as THREE.MeshBasicMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(ring.renderOrder).toBe(RING_RENDER_ORDER);
    expect(isInterfacePart(ring)).toBe(true);
    layer.dispose();
  });

  // Why: the globe view's arrival pops each station in by scaling it
  // about its own point; the point must stay where it is (a pop that
  // scales about the root would sink the station into the Earth), the
  // other stations must not move, and a growth of 1 must give back the
  // tour's own matrix exactly.
  it("grows a station about its point and puts it back exactly", () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    layer.setTour(
      manifest([station("a", 0, 0, [photo("p")]), station("b", 40, 0)]),
      new Map(),
    );
    layer.update(view(0, 0, null));
    const [rootA] = layer.stationObjects("a")!;
    const [rootB] = layer.stationObjects("b")!;
    const baseA = rootA!.matrix.clone();
    const baseB = rootB!.matrix.clone();
    const pointA = layer.pointOf("a")!.clone();
    const alt = 515 + N;
    const local = new THREE.Vector3(0, alt, 0);
    layer.setGrowth(new Map([["a", 0.5]]));
    rootA!.updateWorldMatrix(true, false);
    const grownPoint = local.clone().applyMatrix4(rootA!.matrixWorld);
    const basePoint = local
      .clone()
      .applyMatrix4(rootA!.parent!.matrixWorld.clone().multiply(baseA));
    expect(grownPoint.distanceTo(basePoint)).toBeLessThan(1e-6);
    // A unit step up from the point is half as long, grown by a half.
    const up = new THREE.Vector3(0, alt + 1, 0).applyMatrix4(
      rootA!.matrixWorld,
    );
    expect(up.distanceTo(grownPoint)).toBeCloseTo(0.5, 6);
    expect(rootB!.matrix.equals(baseB)).toBe(true);
    expect(layer.pointOf("a")!.equals(pointA)).toBe(true);
    layer.setGrowth(new Map());
    expect(rootA!.matrix.equals(baseA)).toBe(true);
    layer.dispose();
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

  // Why: in the globe view the layer hangs under the tour's frame, whose
  // place in the world changes each time the world frame recentres on the
  // camera. A station moved by a drag is drawn anew when the tour carries
  // the move; its point (the billboard's place, the near set, the globe's
  // visibility and flights) must be in the layer's frame like every other
  // station's. Read from the world instead, it carried the recentre's
  // offset: once the station was deselected (no longer drawn as selected)
  // it showed somewhere else entirely. The same for an item's and a code's
  // point, read from the world too.
  it("keeps a moved station, its items and the codes where they are after the world frame moved, also once deselected", () => {
    // The globe's nesting: the Earth-centred group, the tour's frame in
    // it, the layer in that.
    const scene = new THREE.Scene();
    const earth = new THREE.Group();
    const tourFrame = new THREE.Group();
    scene.add(earth);
    earth.add(tourFrame);
    const { d } = deps({ parent: tourFrame });
    const layer = createStationsLayer(d);
    const a = station("a", 0, 0, [photo("p")]);
    const b = station("b", 40, 0);
    const code = new Map([
      [
        "c1",
        {
          qr: {
            geo: { lat: ZERO.lat, lon: ZERO.lng, alt: 517 + N, headingDeg: 0 },
          },
        } as QrLevel,
      ],
    ]);
    // Opened before the first frame is drawn.
    layer.setTour(manifest([a, b]), code);
    // The world frame recentred on the camera, 400 m away: the renderer
    // brings every world matrix up to date before it draws.
    earth.position.set(-400, 3, 120);
    scene.updateMatrixWorld(true);
    layer.update(view(0, 0, "a", 1, true));
    // Dragged 10 m east and let go: the tour carries the move, then the
    // preview is dropped (the input's order).
    const moved = { ...a.geo, lon: a.geo.lon + 10 / M_PER_DEG_LON };
    layer.setPreview({ kind: "station", id: "a", geo: moved, foundRadiusM: 8 });
    layer.update(view(0, 0, "a", 1, true));
    layer.setTour(manifest([{ ...a, geo: moved }, b]), code);
    layer.setPreview(null);
    layer.update(view(0, 0, "a", 1, true));
    scene.updateMatrixWorld(true);
    // Deselected.
    layer.update(view(0, 0, null));
    const at = layer.pointOf("a")!;
    expect(at.x).toBeCloseTo(10, 1);
    expect(at.z).toBeCloseTo(0, 1);
    expect(at.y).toBeCloseTo(515, 1);
    const billboard = layer.billboardOf("a")!.position;
    expect(billboard.x).toBeCloseTo(10, 1);
    expect(billboard.z).toBeCloseTo(0, 1);
    // The photo's pose is 1 m north and 1.5 m up of its station.
    const p = layer.itemPointOf("p")!;
    expect(p.x).toBeCloseTo(10, 1);
    expect(p.z).toBeCloseTo(-1, 1);
    expect(p.y).toBeCloseTo(516.5, 1);
    const c1 = layer.codePointOf("c1")!;
    expect(c1.x).toBeCloseTo(0, 1);
    expect(c1.z).toBeCloseTo(0, 1);
    expect(c1.y).toBeCloseTo(517, 1);
    layer.dispose();
  });

  // Why: a move keeps an item in its station however far it goes, so the
  // ring is the one thing that tells the creator it is out while there is
  // still time to bring it back; by the Problems list's own measure, so
  // the ring and the list never disagree.
  it("turns the ring the warning colour while a drag has its item out", async () => {
    const { d } = deps();
    const layer = createStationsLayer(d);
    const a = station("a", 0, 0, [photo("p")]);
    layer.setTour(manifest([a], []), new Map());
    layer.update(view(0, 0, "a", 1));
    await settle();
    const ring = () => {
      let found: THREE.Mesh | null = null;
      layer.group.traverse((o) => {
        if (o.name === "found-radius") found = o as THREE.Mesh;
      });
      if (found === null) throw new Error("no circle");
      return (found as THREE.Mesh).material as THREE.MeshBasicMaterial;
    };
    const normal = ring().color.getHex();
    const at = (position: [number, number, number]) => ({
      kind: "item" as const,
      id: "p",
      geo: itemGeoPose({ position, rotation: [0, 0, 0, 1] }, a.geo),
      sizeM: null,
    });
    layer.setPreview(at([0, 1.5, a.foundRadiusM - 1]));
    layer.update(view(0, 0, "a", 1));
    expect(ring().color.getHex()).toBe(normal);
    layer.setPreview(at([a.foundRadiusM + 1, 1.5, 0]));
    layer.update(view(0, 0, "a", 1));
    expect(ring().color.getHex()).toBe(RING_ITEM_OUT);
    expect(ring().opacity).toBe(1);
    layer.setPreview(null);
    layer.update(view(0, 0, "a", 1));
    expect(ring().color.getHex()).toBe(normal);
    layer.dispose();
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
    expect(horse.parent?.position.z).toBeCloseTo(5, 3);
    expect(horse.scale.x).toBeCloseTo(4, 9);
    layer.setPreview(null);
    layer.update(view(0, 0, "a", 1));
    expect(horse.parent?.position.toArray()).toEqual([0, 0, 2]);
    expect(horse.scale.x).toBeCloseTo(2, 9);
    layer.dispose();
  });

  // Why: a free long text stands in the world on its reading stand
  // (format minor 3). The 3D editor drew none, so the creator could
  // neither see nor click it. Drawn by the page's builder, it keeps its
  // pose through the morph (a stand is no photo plane), a click on it
  // selects it, and a drag's preview moves and turns it.
  it("draws a long text's reading stand, picks it, and moves and turns it with a preview", async () => {
    const titles: string[] = [];
    const { d } = deps({
      makeLectern: (block) => {
        titles.push(block.title);
        const stand = buildLecternStand(null);
        return { object: stand.root, dispose: stand.dispose };
      },
    });
    const layer = createStationsLayer(d);
    const stand = {
      id: "l",
      kind: "longText",
      view: "lectern",
      title: "The siege",
      body: "In 1632 the town was besieged.",
      createdAtIso: "2026-10-22T08:00:00Z",
      pose: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
    } as unknown as TourBlock;
    const a = station("a", 0, 0, [photo("p"), stand]);
    layer.setTour(manifest([a]), new Map());
    layer.update(view(0, 0, "a", 1));
    await settle();
    expect(titles).toEqual(["The siege"]);
    expect(layer.photoPlanes("a")).toHaveLength(1);
    const root = d.parent.getObjectByName("lectern")!;
    expect(root).toBeDefined();
    // Looking straight down, the photo lies flat; the stand stays upright.
    layer.update(view(0, 0, "a", 0));
    expect(root.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    // Its page faces east (its local +z, the station's east): seen from
    // the east, a click on it selects the long text.
    const page = d.parent.getObjectByName("lectern-page")!;
    page.updateMatrixWorld(true);
    const at = page.getWorldPosition(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.copy(at).add(new THREE.Vector3(10, 0, 0));
    camera.lookAt(at);
    camera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    expect(layer.pick(ray)).toBe("l");
    // A drag's preview moves and turns it; cleared, it is back.
    const quarter = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -Math.PI / 2,
    );
    layer.setPreview({
      kind: "item",
      id: "l",
      geo: itemGeoPose(
        {
          position: [3, 0, 4],
          rotation: [quarter.x, quarter.y, quarter.z, quarter.w],
        },
        a.geo,
      ),
      sizeM: null,
    });
    layer.update(view(0, 0, "a", 1));
    expect(root.position.z).toBeCloseTo(4, 3);
    expect(root.quaternion.angleTo(quarter)).toBeLessThan(1e-6);
    layer.setPreview(null);
    layer.update(view(0, 0, "a", 1));
    expect(root.position.toArray()).toEqual([3, 0, 0]);
    expect(root.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });

  // Why: a free long text may stand as a short reading sign (format
  // minor 4). The editor draws it through the page's builder, keeps it
  // upright through the morph like a stand (it is no photo plane), and a
  // click on its plate selects the long text.
  it("draws a long text's reading sign, keeps it upright, and picks it", async () => {
    const titles: string[] = [];
    const { d } = deps({
      makeReadingSign: (block) => {
        titles.push(block.title);
        const sign = buildReadingSign(null);
        return { object: sign.root, dispose: sign.dispose };
      },
    });
    const layer = createStationsLayer(d);
    const sign = {
      id: "r",
      kind: "longText",
      view: "reading",
      title: "The siege",
      body: "In 1632 the town was besieged.",
      createdAtIso: "2026-10-22T08:00:00Z",
      pose: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
    } as unknown as TourBlock;
    const a = station("a", 0, 0, [photo("p"), sign]);
    layer.setTour(manifest([a]), new Map());
    layer.update(view(0, 0, "a", 1));
    await settle();
    expect(titles).toEqual(["The siege"]);
    expect(layer.photoPlanes("a")).toHaveLength(1);
    const root = d.parent.getObjectByName("reading-sign")!;
    expect(root).toBeDefined();
    layer.update(view(0, 0, "a", 0));
    expect(root.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    const plate = d.parent.getObjectByName("reading-sign-plate")!;
    plate.updateMatrixWorld(true);
    const at = plate.getWorldPosition(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    // Unturned, it faces its local +z, the station's east (as a stand).
    camera.position.copy(at).add(new THREE.Vector3(10, 0, 0));
    camera.lookAt(at);
    camera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    expect(layer.pick(ray)).toBe("r");
  });

  // Why: a stand keeps only its pose's turn about up, wherever it is
  // drawn (`uprightTurn`): a pitch or roll in its pose would tilt it off
  // its feet. The phone's drawing applied that rule and the editor's drag
  // preview did not, so a drag (or a cancelled one, which draws the tour's
  // pose again) showed a stand leaning over.
  it("keeps a reading stand upright through a drag's preview and after it, for a tilted pose", async () => {
    const { d } = deps({
      makeLectern: () => {
        const stand = buildLecternStand(null);
        return { object: stand.root, dispose: stand.dispose };
      },
    });
    const layer = createStationsLayer(d);
    const turn = (yawDeg: number, pitchDeg: number) =>
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(pitchDeg),
          THREE.MathUtils.degToRad(yawDeg),
          0,
          "YXZ",
        ),
      );
    const tilted = turn(40, 25);
    const stand = {
      id: "lamp",
      kind: "longText",
      view: "lectern",
      title: "The lamp",
      body: "Lit every evening.",
      createdAtIso: "2026-10-22T08:00:00Z",
      pose: {
        position: [3, 0, 0],
        rotation: [tilted.x, tilted.y, tilted.z, tilted.w],
      },
    } as unknown as TourBlock;
    const a = station("a", 0, 0, [stand]);
    layer.setTour(manifest([a]), new Map());
    layer.update(view(0, 0, "a", 1));
    await settle();
    const root = d.parent.getObjectByName("lectern")!;
    expect(root.quaternion.angleTo(turn(40, 0))).toBeLessThan(1e-6);
    const dragged = turn(-70, -35);
    layer.setPreview({
      kind: "item",
      id: "lamp",
      geo: itemGeoPose(
        {
          position: [3, 0, 4],
          rotation: [dragged.x, dragged.y, dragged.z, dragged.w],
        },
        a.geo,
      ),
      sizeM: null,
    });
    layer.update(view(0, 0, "a", 1));
    expect(root.quaternion.angleTo(turn(-70, 0))).toBeLessThan(1e-6);
    layer.setPreview(null);
    layer.update(view(0, 0, "a", 1));
    expect(root.quaternion.angleTo(turn(40, 0))).toBeLessThan(1e-6);
  });

  // Why: the editor shows an item through the same world door as the
  // visitor's page, built in the editor's mode: a second preview path
  // would let the two drift apart. The part stands where play stands it
  // (the block's pose as it is, tilt included), keeps that pose through
  // the morph (it is no photo plane), is selected by a click, moved and
  // turned by a drag's preview, and freed with the layer.
  describe("an item's part from the world door", () => {
    const tilt = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.3, 0.8, -0.2, "YXZ"),
    );
    /** A free sound at `rotation` (default: `tilt`). */
    const spotAt = (rotation: THREE.Quaternion = tilt) =>
      ({
        id: "song",
        kind: "audio",
        view: "spot",
        audio: "snd",
        transcript: "t",
        createdAtIso: "2026-10-22T08:00:00Z",
        pose: {
          position: [3, 0.5, -2],
          rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        },
      }) as unknown as TourBlock;
    const spot = spotAt();
    /** Turns a pose may carry: none, a yaw alone, pitch and roll, a pitch
     *  near the vertical, upside down, and the mixed `tilt`. */
    const TURNS: readonly (readonly [string, THREE.Quaternion])[] = [
      ["none", new THREE.Quaternion()],
      ["yaw", new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 2.4, 0))],
      [
        "pitch and roll",
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0.9)),
      ],
      [
        "near vertical",
        new THREE.Quaternion().setFromEuler(new THREE.Euler(1.55, 0.4, 0)),
      ],
      [
        "upside down",
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0.7, 0)),
      ],
      ["mixed", tilt],
    ];
    const assets: TourManifest["assets"] = [
      { id: "snd", path: "content/snd.mp3", kind: "audio" },
    ];

    /** The door both pages are given: a one metre box for the block. */
    function door() {
      const asked: { block: TourBlock; env: WorldEnv }[] = [];
      const freed: string[] = [];
      const made: WorldPart[] = [];
      const part = (block: TourBlock, env: WorldEnv): WorldPart | null => {
        // A model stands through the visitor's own part (its file, size
        // and view); the box stands for every other kind.
        if (block.kind === "model") return worldPartOf(block, env);
        asked.push({ block, env });
        const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        const made1: WorldPart = {
          object,
          tapTarget: object,
          dispose: () => freed.push(block.id),
        };
        made.push(made1);
        return made1;
      };
      return { part, asked, freed, made };
    }

    it("builds it in the editor's mode, from the block play builds it from", async () => {
      const read: string[] = [];
      const editor = door();
      const { d } = deps({
        worldPart: editor.part,
        loadContent: (path) => {
          read.push(path);
          return Promise.resolve(new Blob([]));
        },
      });
      const layer = createStationsLayer(d);
      const a = station("a", 0, 0, [photo("p"), spot]);
      layer.setTour(manifest([a], assets), new Map());
      layer.update(view(0, 0, "a", 1));
      await settle();
      expect(editor.asked).toHaveLength(1);
      const [{ block, env }] = editor.asked as [(typeof editor.asked)[0]];
      expect(env.mode).toBe("edit");
      await env.loadAsset("snd");
      expect(read).toEqual(["content/snd.mp3"]);
      expect(block).toEqual(spot);
      layer.dispose();
    });

    // Why: a part's look may hang on the camera - the editor's speaker
    // icon keeps its least size on the screen and faces the camera, a
    // character card turns toward it. Nothing ticked parts in the editor
    // before, so this pins that each frame hands them the camera, its
    // lens and the viewer in the part's parent frame, as play does.
    it("hands each part the camera, its lens and the viewer every frame it is given a camera", async () => {
      const editor = door();
      const frames: Parameters<NonNullable<WorldPart["update"]>>[0][] = [];
      const ticking = (block: TourBlock, env: WorldEnv): WorldPart | null => {
        const made = editor.part(block, env);
        if (made === null) return null;
        return { ...made, update: (frame) => frames.push(frame) };
      };
      const { d } = deps({ worldPart: ticking });
      const layer = createStationsLayer(d);
      const a = station("a", 0, 0, [spot]);
      layer.setTour(manifest([a], assets), new Map());
      layer.update(view(0, 0, "a", 1));
      await settle();
      // Without a camera nothing is ticked.
      layer.update(view(0, 0, "a", 1));
      expect(frames).toHaveLength(0);
      const eye = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
      eye.position.set(10, 540, -4);
      layer.update({ ...view(0, 0, "a", 1), eye });
      expect(frames).toHaveLength(1);
      const frame = frames[0]!;
      expect(frame.camera).toBe(eye);
      // The editor's 50 degree lens over a 900 px view.
      expect(frame.metresPerPxAtOneM).toBeCloseTo(
        (2 * Math.tan((25 * Math.PI) / 180)) / 900,
        12,
      );
      // The viewer in the part's parent frame: where the camera stands
      // seen from the part's own parent.
      const parent = editor.made[0]!.object.parent!;
      const local = parent.worldToLocal(eye.position.clone());
      expect(frame.viewer[0]).toBeCloseTo(local.x, 6);
      expect(frame.viewer[1]).toBeCloseTo(local.y, 6);
      expect(frame.viewer[2]).toBeCloseTo(local.z, 6);
      layer.dispose();
    });

    // Not only "the editor agrees with play" (both place the part with
    // the same pose, so that alone would pass a shared mistake): each is
    // held to the block's own pose, in its station's frame, over turns
    // from none to upside down.
    it.each(TURNS)(
      "stands it at the block's own pose, as play does, turned %s",
      async (_name, turn) => {
        const editor = door();
        const { d } = deps({ worldPart: editor.part });
        const layer = createStationsLayer(d);
        const a = station("a", 0, 0, [spotAt(turn)]);
        layer.setTour(manifest([a], assets), new Map());
        layer.update(view(0, 0, "a", 1));
        await settle();
        const play = door();
        const shown = await renderTourStation(a, {
          assets,
          scene: new THREE.Group(),
          zero: { lat: a.geo.lat, lon: a.geo.lon },
          makeLabel: () => ({
            object: new THREE.Object3D(),
            dispose: () => {},
          }),
          loadPhotoTexture: () => Promise.resolve(new THREE.Texture()),
          worldPart: (b) =>
            play.part(
              b,
              worldEnv("play", assets, () =>
                Promise.reject(new Error("unread")),
              ),
            ),
        });
        const edited = editor.made[0]!.object;
        const played = play.made[0]!.object;
        for (const [who, object] of [
          ["editor", edited],
          ["play", played],
        ] as const) {
          expect(object.position.toArray(), who).toEqual([3, 0.5, -2]);
          expect(object.quaternion.angleTo(turn), who).toBeLessThan(1e-6);
        }
        shown.dispose();
        layer.dispose();
      },
    );

    it("keeps its pose through the morph, is picked, follows a drag's preview, and is freed with the layer", async () => {
      const editor = door();
      const { d } = deps({ worldPart: editor.part });
      const layer = createStationsLayer(d);
      const a = station("a", 0, 0, [photo("p"), spot]);
      layer.setTour(manifest([a], assets), new Map());
      layer.update(view(0, 0, "a", 1));
      await settle();
      const part = editor.made[0]!;
      expect(mountedWorldParts()).toContain(part);
      // The photo alone is a photo plane; looking down, the part keeps
      // its pose.
      expect(layer.photoPlanes("a")).toHaveLength(1);
      layer.update(view(0, 0, "a", 0));
      expect(part.object.quaternion.angleTo(tilt)).toBeLessThan(1e-6);
      // Seen from 20 m above it, a click on it selects the item.
      part.object.updateMatrixWorld(true);
      const at = part.object.getWorldPosition(new THREE.Vector3());
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      camera.position.copy(at).add(new THREE.Vector3(0, 20, 0));
      camera.lookAt(at);
      camera.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      expect(layer.pick(ray)).toBe("song");
      // Located where it stands (the view flies to it), and a gesture's
      // target: the gizmo moves the world blocks (the rows that say
      // `inWorld`, `editor3d-editing.ts` `targetOf`), and a free sound is
      // one, so its circle or zone is moved and turned like a pin.
      const located = layer.itemPointOf("song");
      expect(located?.distanceTo(at)).toBeLessThan(1e-6);
      expect(worldBlocks(a).map((b) => b.id)).toEqual(["p", "song"]);
      // A drag's preview moves it and turns it as the pose says, tilt
      // included; cleared, it is back.
      const dragged = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-0.4, -1.1, 0.1, "YXZ"),
      );
      layer.setPreview({
        kind: "item",
        id: "song",
        geo: itemGeoPose(
          {
            position: [3, 0.5, 4],
            rotation: [dragged.x, dragged.y, dragged.z, dragged.w],
          },
          a.geo,
        ),
        sizeM: null,
      });
      layer.update(view(0, 0, "a", 1));
      expect(part.object.position.z).toBeCloseTo(4, 3);
      expect(part.object.quaternion.angleTo(dragged)).toBeLessThan(1e-6);
      layer.setPreview(null);
      layer.update(view(0, 0, "a", 1));
      expect(part.object.position.toArray()).toEqual([3, 0.5, -2]);
      expect(part.object.quaternion.angleTo(tilt)).toBeLessThan(1e-6);
      layer.dispose();
      expect(editor.freed).toEqual(["song"]);
      expect(mountedWorldParts()).not.toContain(part);
    });

    /** A door whose parts' dispose throws, after counting the free. */
    function brokenDoor() {
      const asked: string[] = [];
      const freed: string[] = [];
      const part = (block: TourBlock): WorldPart => {
        asked.push(block.id);
        const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        return {
          object,
          dispose: () => {
            freed.push(block.id);
            throw new Error(`broken ${block.id}`);
          },
        };
      };
      return { part, asked, freed };
    }

    /** How many objects hang under `parent`. */
    const countUnder = (parent: THREE.Object3D): number => {
      let n = 0;
      parent.traverse(() => {
        n += 1;
      });
      return n;
    };

    // Why: a part dispose rethrown by the
    // renderer left the station's ring and pole in the scene and its
    // content set, so it was never drawn again when the view came back.
    it("a part whose dispose throws leaves the station freed and drawn again later", async () => {
      const editor = brokenDoor();
      const { d, parent } = deps({ worldPart: editor.part });
      const layer = createStationsLayer(d);
      const far = [0, 1, 2, 3, 4].map((i) => station(`f${i}`, 1000 + i, 0));
      const a = station("a", 0, 0, [spot]);
      layer.setTour(manifest([a, ...far], assets), new Map());
      // Away first: "a" is not drawn, so this is the scene without it.
      layer.update(view(1002, 0, null, 1));
      await settle();
      const without = countUnder(parent);
      layer.update(view(0, 0, null, 1));
      await settle();
      expect(editor.asked).toEqual(["song"]);
      expect(countUnder(parent)).toBeGreaterThan(without);
      expect(() => layer.update(view(1002, 0, null, 1))).toThrow("broken song");
      // The frame that threw ended early; the next one finishes it and
      // finds nothing left to free.
      layer.update(view(1002, 0, null, 1));
      await settle();
      expect(countUnder(parent)).toBe(without);
      expect(mountedWorldParts()).toEqual([]);
      layer.update(view(0, 0, null, 1));
      await settle();
      expect(editor.asked).toEqual(["song", "song"]);
      editor.freed.length = 0;
      expect(() => layer.dispose()).toThrow("broken song");
    });

    // Why: the layer's dispose stopped at the
    // first station whose part threw, abandoning every later station.
    it("frees every station when one station's part dispose throws", async () => {
      const editor = brokenDoor();
      const { d, parent } = deps({ worldPart: editor.part });
      const layer = createStationsLayer(d);
      const a = station("a", 0, 0, [spot]);
      const b = station("b", 5, 0, [{ ...spot, id: "song-b" }]);
      layer.setTour(manifest([a, b], assets), new Map());
      layer.update(view(0, 0, null, 1));
      await settle();
      expect(editor.asked.sort()).toEqual(["song", "song-b"]);
      expect(() => layer.dispose()).toThrow(/broken song/);
      expect(editor.freed.sort()).toEqual(["song", "song-b"]);
      expect(mountedWorldParts()).toEqual([]);
      expect(parent.children).toHaveLength(0);
    });

    // Why: a model whose free throws must not skip the rest of the
    // station's free (`rendered.dispose()` unmounts the station's parts
    // and frees its labels and textures).
    it("a model whose free throws still frees the station's parts", async () => {
      const editor = door();
      const { d, parent } = deps({
        worldPart: editor.part,
        loadGlbModel: () => {
          const geometry = new THREE.BoxGeometry(2, 4, 1);
          geometry.dispose = () => {
            throw new Error("model free broke");
          };
          const g = new THREE.Group();
          g.add(new THREE.Mesh(geometry));
          return Promise.resolve(g);
        },
      });
      const layer = createStationsLayer(d);
      const a = station("a", 0, 0, [spot, model("m", "horse", 2)]);
      layer.setTour(
        manifest(
          [a],
          [
            ...assets,
            { id: "horse", path: "content/horse.glb", kind: "model" },
          ],
        ),
        new Map(),
      );
      layer.update(view(0, 0, null, 1));
      await settle();
      expect(editor.made).toHaveLength(1);
      // The box part and the model's part.
      expect(mountedWorldParts()).toHaveLength(2);
      expect(() => layer.dispose()).toThrow("model free broke");
      expect(editor.freed).toEqual(["song"]);
      expect(mountedWorldParts()).toEqual([]);
      expect(parent.children).toHaveLength(0);
    });

    // Why: a model is a tree of meshes; a throwing geometry dispose inside
    // one model aborted the traverse and stranded every mesh after it, its
    // GPU buffers and materials included.
    it("a mesh whose geometry free throws still frees the model's other meshes", async () => {
      const freed: string[] = [];
      const { d } = deps({
        loadGlbModel: () => {
          const broken = new THREE.BoxGeometry(1, 1, 1);
          broken.dispose = () => {
            throw new Error("mesh free broke");
          };
          const fine = new THREE.BoxGeometry(1, 1, 1);
          fine.dispose = () => {
            freed.push("geometry");
          };
          const material = new THREE.MeshBasicMaterial();
          material.dispose = () => {
            freed.push("material");
          };
          const g = new THREE.Group();
          g.add(new THREE.Mesh(broken), new THREE.Mesh(fine, material));
          return Promise.resolve(g);
        },
      });
      const layer = createStationsLayer(d);
      const a = station("a", 0, 0, [spot, model("m", "horse", 2)]);
      layer.setTour(
        manifest(
          [a],
          [
            ...assets,
            { id: "horse", path: "content/horse.glb", kind: "model" },
          ],
        ),
        new Map(),
      );
      layer.update(view(0, 0, null, 1));
      await settle();
      expect(() => layer.dispose()).toThrow("mesh free broke");
      expect(freed).toEqual(["geometry", "material"]);
    });
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
    } as TourBlock;
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
