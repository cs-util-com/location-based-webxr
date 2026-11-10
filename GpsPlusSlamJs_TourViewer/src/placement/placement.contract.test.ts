/**
 * Why these tests matter: the placement rows decide, per kind and view,
 * whether the 3D editor gives a thing handles, a turn knob and size
 * dots. A wrong row fails silently: a view that turns but is declared
 * facing loses its knob, a facing one declared turning gets a knob that
 * writes a rotation nothing shows, dots on a number the drawing ignores
 * change nothing on screen, and a posed view the editor cannot draw gets
 * a gizmo over empty ground. So each row is held here to the format (its
 * views, its bounds) and to the editor's own drawing (the stations
 * layer, through the same world door the page uses): a posed view is
 * drawn, a turning one's drawing changes with its heading and a facing
 * one's does not, and a size doubles the drawing. The last block holds
 * the new placeables to the gate they replace, frozen here as it was.
 */
import * as THREE from "three";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  TOUR_KINDS,
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_SIZE_M,
  TOUR_PICTURE_MAX_WIDTH_M,
  TOUR_PICTURE_MIN_WIDTH_M,
  type TourBlockKind,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import type {
  TourBlock,
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  itemGeoPose,
  tourFreeBlocks,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import type { TourStationChild } from "gps-plus-slam-app-framework/ar/tour-story";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { worldFromEcefAt } from "gps-plus-slam-globe/editor";

import type { FigureSource } from "../character-canvas.js";
import { characterWorld } from "../kinds/character/world.js";
import { buildLecternStand } from "../lectern-view.js";
import { worldPartOf } from "../play-kinds.js";
import { buildReadingSign } from "../reading-sign.js";
import { fakeCharacterPainters } from "../test-support/fake-character-painters.js";
import {
  createStationsLayer,
  type StationsLayerDeps,
} from "../editor3d/editor3d-stations.js";
import {
  BLOCK_PLACEMENT,
  CONTAINER_PLACEMENT,
  STATION_PLACEMENT,
  blockPlacement,
  type ViewPlacement,
} from "./placement-rows.js";
import { placeableOf, placeablesOf, posedBlocks } from "./placeables.js";

// The geodesy is licence-gated; the store's construction activates it.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

// --- the format ------------------------------------------------------------

/** Every (kind, view) of the format, as the rows must cover it. */
const KIND_VIEWS: readonly (readonly [TourBlockKind, string])[] = (
  Object.keys(TOUR_KINDS) as TourBlockKind[]
).flatMap((kind) =>
  TOUR_KINDS[kind].views.map((view) => [kind, view] as const),
);

/** The rows written out, so a row changed or a view added is classified
 *  on purpose here too: [kind, view, posed, turns, extent field]. */
const EXPECTED: readonly (readonly [
  string,
  string,
  boolean,
  boolean,
  string | null,
])[] = [
  ["shortText", "pin", true, false, null],
  ["shortText", "card", false, false, null],
  ["longText", "lectern", true, true, null],
  ["longText", "reading", true, false, null],
  ["longText", "card", false, false, null],
  ["picture", "plane", true, true, "widthM"],
  ["picture", "card", false, false, null],
  ["video", "card", false, false, null],
  ["audio", "spot", true, false, null],
  ["audio", "zone", true, false, null],
  ["audio", "card", false, false, null],
  ["model", "placed", true, true, "sizeM"],
  ["model", "ghost", true, true, "sizeM"],
  ["model", "hotspots", true, true, "sizeM"],
  ["model", "cutaway", true, true, "sizeM"],
  ["model", "toy", true, true, "sizeM"],
  ["model", "card", false, false, null],
  ["character", "bubble", true, true, null],
  ["character", "speak", true, true, null],
  ["character", "two-stations", true, true, null],
  ["character", "portrait", true, true, null],
  ["character", "popup", true, true, null],
  ["character", "card", false, false, null],
];

describe("the placement rows against the format", () => {
  it("have one row for every view of every kind, and none more", () => {
    for (const kind of Object.keys(TOUR_KINDS) as TourBlockKind[]) {
      expect(Object.keys(BLOCK_PLACEMENT[kind]).sort(), kind).toEqual(
        [...TOUR_KINDS[kind].views].sort(),
      );
    }
    expect(Object.keys(BLOCK_PLACEMENT).sort()).toEqual(
      Object.keys(TOUR_KINDS).sort(),
    );
  });

  it("say what the written-out table says, view by view", () => {
    expect(EXPECTED.map(([k, v]) => `${k}.${v}`)).toEqual(
      KIND_VIEWS.map(([k, v]) => `${k}.${v}`),
    );
    for (const [kind, view, posed, turns, field] of EXPECTED) {
      const row = blockPlacement(kind, view);
      expect(row, `${kind}.${view}`).toMatchObject({ posed, turns });
      expect(row?.extent?.field ?? null, `${kind}.${view}`).toBe(field);
    }
  });

  // The format's envelope: views that do not use the pose (`card`) ignore
  // it. Every view a FREE block may hold, but `card`, stands in the world.
  it("leave exactly the card views poseless, and pose every other free view", () => {
    for (const [kind, view] of KIND_VIEWS) {
      expect(blockPlacement(kind, view)?.posed, `${kind}.${view}`).toBe(
        view !== "card",
      );
    }
    for (const kind of Object.keys(TOUR_KINDS) as TourBlockKind[]) {
      const row = TOUR_KINDS[kind];
      for (const view of [...row.freeViews, ...row.worldViews]) {
        if (view === "card") continue;
        expect(blockPlacement(kind, view)?.posed, `${kind}.${view}`).toBe(true);
      }
    }
  });

  it("lift every block, and a poseless view neither turns nor has dots", () => {
    for (const [kind, view] of KIND_VIEWS) {
      const row = blockPlacement(kind, view)!;
      // A posed view: only its lift is pinned here; a poseless one whole.
      expect(row.posed ? { lifts: row.lifts } : row, `${kind}.${view}`).toEqual(
        row.posed
          ? { lifts: true }
          : { posed: false, turns: false, lifts: false },
      );
    }
  });

  it("bound each size by the format's own constants", () => {
    expect(BLOCK_PLACEMENT.picture.plane.extent).toMatchObject({
      kind: "size",
      min: TOUR_PICTURE_MIN_WIDTH_M,
      max: TOUR_PICTURE_MAX_WIDTH_M,
    });
    for (const view of TOUR_KINDS.model.worldViews) {
      expect(BLOCK_PLACEMENT.model[view].extent, view).toMatchObject({
        kind: "size",
        min: TOUR_MODEL_MIN_SIZE_M,
        max: TOUR_MODEL_MAX_SIZE_M,
      });
    }
  });

  it("know no kind or view the format does not", () => {
    expect(blockPlacement("hologram", "pin")).toBeNull();
    expect(blockPlacement("shortText", "hologram")).toBeNull();
    // Not a view, though every object has it.
    expect(blockPlacement("shortText", "toString")).toBeNull();
    expect(blockPlacement("toString", "pin")).toBeNull();
  });

  it("give a folder a scale and a station its found radius, the station not lifting", () => {
    expect(CONTAINER_PLACEMENT).toEqual({
      posed: true,
      turns: true,
      lifts: true,
      extent: {
        kind: "factor",
        field: "scale",
        label: "Scale",
        meaning: "How much larger it draws its items, and their distances",
        min: 0.1,
        max: 10,
      },
    });
    expect(STATION_PLACEMENT).toMatchObject({
      posed: true,
      turns: true,
      lifts: false,
      extent: { kind: "reach", field: "foundRadiusM", min: 2, max: 300 },
    });
  });
});

// --- the editor's drawing --------------------------------------------------

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

const ASSETS: TourManifest["assets"] = [
  { id: "pic", path: "content/pic.jpg", kind: "image" },
  { id: "snd", path: "content/snd.mp3", kind: "audio" },
  { id: "glb", path: "content/glb.glb", kind: "model" },
  { id: "knight", path: "content/knight.png", kind: "image" },
  { id: "vid", path: "content/vid.mp4", kind: "video" },
];

/** A block's own fields per kind, `value` its size where it has one. */
function fieldsOf(kind: TourBlockKind, value: number): object {
  switch (kind) {
    case "shortText":
      return { caption: "Gate" };
    case "longText":
      return { title: "The siege", body: "In 1632 the town was besieged." };
    case "picture":
      return { image: "pic", widthM: value };
    case "video":
      return { video: "vid" };
    case "audio":
      return { audio: "snd" };
    case "model":
      return { asset: "glb", sizeM: value };
    case "character":
      return { name: "Herald", image: "knight", caption: "Hear ye!" };
  }
}

/** `kind` in `view`, standing 2 m east of its station, turned
 *  `headingDeg` about up, its size `value`. */
function blockOf(
  kind: TourBlockKind,
  view: string,
  headingDeg: number,
  value = 1,
): TourBlock {
  const half = (headingDeg * Math.PI) / 360;
  return {
    id: "it",
    kind,
    view,
    createdAtIso: "2026-11-10T08:00:00Z",
    pose: {
      position: [0, 0, 2],
      rotation: [0, Math.sin(half), 0, Math.cos(half)],
    },
    ...fieldsOf(kind, value),
  } as unknown as TourBlock;
}

function stationOf(children: TourStationChild[]): TourStation {
  return {
    id: "a",
    title: "Station a",
    geo: { lat: ZERO.lat, lon: ZERO.lng, alt: 515 + N, rotation: [0, 0, 0, 1] },
    activateRadiusM: 30,
    foundRadiusM: 8,
    hint: "arrow",
    children,
  };
}

/** The stations layer as the page builds it, with drawings Node can
 *  make: a label is a flat card longer than it is high (the page's label
 *  is a camera-facing sprite: a drawing that turned it would show here),
 *  the stand and the sign are the page's own builders without a canvas,
 *  a model's file is a 2 x 4 x 1 m box, and a character's image a
 *  100 x 200 px figure painted without a canvas. */
function layerDeps(): StationsLayerDeps {
  const { painters } = fakeCharacterPainters();
  const decode = () =>
    Promise.resolve({
      width: 100,
      height: 200,
      close: () => undefined,
    } as unknown as FigureSource);
  return {
    parent: new THREE.Scene(),
    ellipsoid: ELLIPSOID,
    worldFromEcef: worldFromEcefAt(ELLIPSOID, ZERO, new THREE.Matrix4()),
    undulationAt: () => N,
    makeLabel: () => ({
      object: new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.05)),
      dispose: () => undefined,
    }),
    loadPhotoTexture: () => Promise.resolve(new THREE.Texture()),
    loadContent: () => Promise.resolve(new Blob([])),
    loadGlbModel: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1)));
      return Promise.resolve(g);
    },
    makeBillboard: () => new THREE.Sprite(),
    makeCodeSquare: (sizeM) =>
      new THREE.Mesh(new THREE.PlaneGeometry(sizeM, sizeM)),
    makeLectern: () => {
      const stand = buildLecternStand(null);
      return { object: stand.root, dispose: stand.dispose };
    },
    makeReadingSign: () => {
      const sign = buildReadingSign(null);
      return { object: sign.root, dispose: sign.dispose };
    },
    worldPart: (block, env) =>
      block.kind === "character"
        ? characterWorld(block, env, { decode, painters })
        : worldPartOf(block, env),
  };
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

/**
 * The world box of what the editor draws for `block`, seen by one fixed
 * camera: after a frame that hands the parts the camera and runs every
 * drawing's own facing as a render would. Null when nothing is drawn.
 */
async function drawnBox(block: TourBlock): Promise<THREE.Box3 | null> {
  const d = layerDeps();
  const layer = createStationsLayer(d);
  layer.setTour(
    {
      version: 5,
      minor: 0,
      order: "fixed",
      assets: ASSETS,
      stations: [stationOf([block])],
    },
    new Map(),
  );
  const view = {
    centre: new THREE.Vector3(0, 0, 0),
    selectedStation: "a",
    stationSelected: false,
    standing: 1,
    camera: new THREE.Vector3(0, 516, 0),
    viewportPx: 900,
    fovDeg: 50,
  };
  layer.update(view);
  await settle();
  // The camera stands south-west of the item and above it, looking at it.
  const eye = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
  const drawn = layer.itemObjects(block.id);
  d.parent.updateMatrixWorld(true);
  const at = new THREE.Vector3();
  for (const o of drawn) at.add(o.getWorldPosition(new THREE.Vector3()));
  at.divideScalar(Math.max(1, drawn.length));
  eye.position.copy(at).add(new THREE.Vector3(-7, 4, 9));
  eye.lookAt(at);
  eye.updateMatrixWorld(true);
  for (let frame = 0; frame < 3; frame++) {
    layer.update({ ...view, eye });
    d.parent.updateMatrixWorld(true);
    for (const o of drawn) {
      o.traverse((part) => {
        const mesh = part as THREE.Mesh;
        part.onBeforeRender(
          null as unknown as THREE.WebGLRenderer,
          d.parent as THREE.Scene,
          eye,
          mesh.geometry,
          mesh.material as THREE.Material,
          null as unknown as THREE.Group,
        );
      });
    }
    d.parent.updateMatrixWorld(true);
  }
  const box = new THREE.Box3();
  // Precise: a flat circle turned keeps its box (a loose box is its
  // geometry's square, which a turn grows).
  for (const o of drawn) box.expandByObject(o, true);
  layer.dispose();
  return box.isEmpty() ? null : box;
}

/** How far two boxes differ, against the first's largest side. */
function boxChange(a: THREE.Box3, b: THREE.Box3): number {
  const size = a.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  const corners = [
    a.min.x - b.min.x,
    a.min.y - b.min.y,
    a.min.z - b.min.z,
    a.max.x - b.max.x,
    a.max.y - b.max.y,
    a.max.z - b.max.z,
  ];
  return Math.max(...corners.map(Math.abs)) / largest;
}

/** The largest side of a box. */
function largestSide(box: THREE.Box3): number {
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}

/** Every posed (kind, view) with its row. */
const POSED: readonly (readonly [TourBlockKind, string, ViewPlacement])[] =
  KIND_VIEWS.flatMap(([kind, view]) => {
    const row = blockPlacement(kind, view);
    return row?.posed === true ? [[kind, view, row] as const] : [];
  });

/** A turn's change above this shows; a facing drawing's stays under the
 *  other bound (each against the drawing's largest side). */
const TURN_SHOWS = 0.02;
const TURN_HIDDEN = 0.01;

describe("the placement rows against the editor's drawing", () => {
  it.each(POSED.map(([k, v, row]) => [`${k}.${v}`, k, v, row] as const))(
    "%s is drawn, and its drawing turns with its heading exactly when its row says it turns",
    async (_name, kind, view, row) => {
      const still = await drawnBox(blockOf(kind, view, 0));
      expect(still, "a posed view the editor draws nothing for").not.toBeNull();
      // Turned round in steps: a drawing that swings toward the camera (a
      // character) follows its heading only where the camera is far
      // enough round, so the largest change over the turns is the one
      // that tells.
      let largest = 0;
      for (let headingDeg = 30; headingDeg < 360; headingDeg += 30) {
        const turned = await drawnBox(blockOf(kind, view, headingDeg));
        expect(turned).not.toBeNull();
        largest = Math.max(largest, boxChange(still!, turned!));
      }
      // One assertion for both rows, its message carrying the change.
      const shows = row.turns
        ? largest > TURN_SHOWS
        : !(largest >= TURN_HIDDEN);
      expect(
        shows,
        `${kind}.${view} (turns: ${String(row.turns)}) changes ${String(largest)}`,
      ).toBe(true);
    },
    // Thirteen drawings of a model or a character: seconds on a loaded
    // machine, so the default five would time out, not fail.
    60_000,
  );

  it.each(
    POSED.filter(([, , row]) => row.extent?.kind === "size").map(
      ([k, v, row]) => [`${k}.${v}`, k, v, row] as const,
    ),
  )(
    "%s is drawn twice as large at twice its size",
    async (_name, kind, view, row) => {
      const spec = row.extent!;
      // The size written where the ROW says it lives, the field the dots
      // and the inspector write: a row naming a field the drawing ignores
      // draws the same at both sizes and fails here.
      const sized = (value: number): TourBlock => ({
        ...blockOf(kind, view, 0),
        [spec.field]: value,
      });
      // Over the range: from the least size to well inside the largest.
      for (const value of [spec.min, 1, spec.max / 4]) {
        const once = await drawnBox(sized(value));
        const twice = await drawnBox(sized(2 * value));
        const ratio = largestSide(twice!) / largestSide(once!);
        expect(Math.abs(ratio - 2), `at ${String(value)}`).toBeLessThan(0.02);
      }
    },
  );
});

// --- the placeables against the gate they replace ---------------------------

/**
 * The gate before placeables, frozen here as it was: a station's free
 * blocks of the kinds whose row said they stand in the world (pins, long
 * texts, pictures, sounds, models), each at its pose composed through its
 * folders. Written before `placeables.ts`, and independent of it.
 */
const OLD_WORLD_KINDS: ReadonlySet<string> = new Set([
  "shortText",
  "longText",
  "picture",
  "audio",
  "model",
]);
function oldWorldBlocks(station: TourStation): TourBlock[] {
  return tourFreeBlocks(station).filter((b) => OLD_WORLD_KINDS.has(b.kind));
}

/** A free block of any kind in any free view it may hold, with a random
 *  pose. */
const freeBlockArb = (id: string): fc.Arbitrary<TourBlock> =>
  fc
    .tuple(
      fc.constantFrom(...(Object.keys(TOUR_KINDS) as TourBlockKind[])),
      fc.nat(),
      fc.tuple(
        fc.double({ min: -40, max: 40, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -40, max: 40, noNaN: true }),
      ),
      fc.double({ min: -180, max: 180, noNaN: true }),
    )
    .map(([kind, pick, position, headingDeg]) => {
      const views = TOUR_KINDS[kind].freeViews;
      const view = views[pick % views.length];
      if (view === undefined) throw new Error("every kind has a free view");
      const block = blockOf(kind, view, headingDeg, 1.5);
      return {
        ...block,
        id,
        pose: { ...block.pose, position },
      };
    });

/** A station's children: blocks and plain folders (posed or not) up to
 *  two deep. */
const childrenArb = (
  prefix: string,
  depth: number,
): fc.Arbitrary<TourStationChild[]> =>
  fc.array(fc.boolean(), { maxLength: 5 }).chain((kinds) =>
    fc.tuple(
      ...kinds.map((folder, i): fc.Arbitrary<TourStationChild> => {
        const id = `${prefix}-${String(i)}`;
        if (!folder || depth === 0) return freeBlockArb(id);
        return fc
          .tuple(
            childrenArb(id, depth - 1),
            fc.option(
              fc.tuple(
                fc.double({ min: -20, max: 20, noNaN: true }),
                fc.double({ min: -180, max: 180, noNaN: true }),
              ),
            ),
          )
          .map(([children, pose]) => ({
            id: `f${id}`,
            kind: "folder" as const,
            children: children as never,
            ...(pose === null
              ? {}
              : {
                  pose: {
                    position: [pose[0], 0.5, -pose[0]] as [
                      number,
                      number,
                      number,
                    ],
                    rotation: [
                      0,
                      Math.sin((pose[1] * Math.PI) / 360),
                      0,
                      Math.cos((pose[1] * Math.PI) / 360),
                    ] as [number, number, number, number],
                  },
                }),
          }));
      }),
    ),
  );

describe("the placeables against the old gate", () => {
  // The old gate plus exactly the free characters, each at the same
  // pose in the world; the station first, with its own found radius.
  it("are the old world blocks plus exactly the free characters, at the same poses", () => {
    fc.assert(
      fc.property(childrenArb("b", 2), (children) => {
        const station = stationOf(children);
        const placed = posedBlocks(station);
        const old = oldWorldBlocks(station);
        const free = tourFreeBlocks(station);
        expect(
          placed
            .filter((p) => {
              const b = free.find((f) => f.id === p.ref.id)!;
              return b.kind !== "character";
            })
            .map((p) => p.ref.id),
        ).toEqual(old.map((b) => b.id));
        expect(
          placed
            .filter(
              (p) => free.find((f) => f.id === p.ref.id)!.kind === "character",
            )
            .map((p) => p.ref.id),
        ).toEqual(free.filter((b) => b.kind === "character").map((b) => b.id));
        for (const p of placed) {
          const b = free.find((f) => f.id === p.ref.id)!;
          expect(p.geo).toEqual(itemGeoPose(b.pose, station.geo));
          expect(p.selection).toBe(b.id);
          expect(p.stationId).toBe("a");
          expect(p.members).toEqual([b.id]);
          expect(p.locked).toBe(false);
          expect(p.inheritedScale).toBe(1);
        }
        const tour = { stations: [station] };
        const all = placeablesOf(tour, { stationLocked: () => true });
        expect(all[0]).toMatchObject({
          ref: { kind: "station", id: "a" },
          selection: "station:a",
          geo: station.geo,
          local: null,
          locked: true,
          turns: true,
          lifts: false,
          members: [],
          extent: { kind: "reach", field: "foundRadiusM", value: 8 },
        });
        expect(all.slice(1)).toEqual(placed);
      }),
      { numRuns: 200 },
    );
    // Two hundred generated stations: seconds on a loaded machine.
  }, 60_000);

  it("keep each block's pose in its holder and name its folders, outermost first", () => {
    const inner = blockOf("model", "placed", 30, 3);
    const station = stationOf([
      {
        id: "outer",
        kind: "folder",
        pose: { position: [5, 0, 0], rotation: [0, 0, 0, 1] },
        children: [
          {
            id: "inner",
            kind: "folder",
            pose: { position: [0, 1, 0], rotation: [0, 0.7071, 0, 0.7071] },
            children: [inner],
          },
        ],
      } as unknown as TourStationChild,
    ]);
    const [p] = posedBlocks(station);
    expect(p?.local).toEqual(inner.pose);
    expect(p?.folderPath).toEqual(["outer", "inner"]);
    expect(p?.extent).toMatchObject({ kind: "size", field: "sizeM", value: 3 });
    expect(p?.turns).toBe(true);
  });

  it("find the selection's placeable, and none for a card or an unknown id", () => {
    const pin = { ...blockOf("shortText", "pin", 0), id: "pin" } as TourBlock;
    const video = { ...blockOf("video", "card", 0), id: "vid" } as TourBlock;
    const tour = { stations: [stationOf([pin, video])] };
    expect(placeableOf(tour, "pin")?.ref).toEqual({ kind: "block", id: "pin" });
    expect(placeableOf(tour, "pin")?.turns).toBe(false);
    expect(placeableOf(tour, "vid")).toBeNull();
    expect(placeableOf(tour, "nothing")).toBeNull();
    expect(placeableOf(tour, "station:a")?.locked).toBe(false);
    expect(placeableOf(tour, "station:zz")).toBeNull();
  });
});
