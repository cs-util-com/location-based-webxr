/**
 * The tour in the 3D editor's world. Every station gets a root at its own
 * point (`pointRootMatrix`: drawn N lower than its file's ellipsoidal
 * height) and a billboard with its number and name. The stations near the
 * camera's centre and the selected one (`nearStations`) also draw their
 * items as the phone does (`renderTourStation`: pins as labels, photos as
 * planes, long texts on their reading stands when the page gives
 * `makeLectern`), their placed models through the world door (plain, at
 * their tour size), their found radius as a ring (over the ground: `ringOf`) and a pole up to the
 * billboard. Every code with a
 * position is a square of its printed size, facing as printed.
 *
 * The morph (`standing`, 0 looking straight down to 1 tilted up): photos
 * and codes lie flat face up and stand up again - a code laid in front of
 * its anchor, on the side its face looks to, never under the wall it hangs
 * on - and the billboards and their poles rise. Models, reading stands
 * and the parts of the world door (`worldPart`, the visitor's, asked in
 * the editor's mode) keep their pose, and each frame a part with an
 * `update` is handed the camera (`StationsLayerView.eye`): a character's
 * card turns toward it, a sound's icon faces it at its least size;
 * pins (the phone's labels) stand. Laid flat, a code is drawn at least
 * `CODE_SCREEN_PX` on screen (`codeGrowth`): grown with the camera's
 * distance wherever its printed size would look smaller, its printed size
 * where that is larger, its gap from the anchor growing with it, and it is
 * picked where it is drawn. It shows where a code is and that it is a code
 * (its three finder squares); no view this small can show its pattern.
 *
 * The layer chips turn the station names (billboards and poles) and the
 * codes off and on (`setShown`); the camera's flights ask where a
 * station, an item or a code stands (`pointOf`, `itemPointOf`,
 * `codePointOf`), drawn or not.
 *
 * Read-only: nothing here edits the tour. The page hands the tour
 * (`setTour`) when the document changes and the camera (`update`) each
 * frame. A station's items are rendered when it enters the near set and
 * freed when it leaves; a tour handed again unchanged renders nothing, nor
 * does an edit of a model's notes or sections (drawn apart, by
 * `editor3d-model-parts.ts`): its file is not loaded again. A change of
 * its view draws it anew, as the visitor would see it.
 *
 * While a drag of the 3D view runs, `setPreview` draws the dragged
 * placeable - a station (its items, billboard and found radius with it)
 * or a block (a model at its dragged size) - where the drag has it, by moving what is
 * drawn - nothing is rendered again; cleared, everything is drawn where
 * the tour has it. `pick` says what a ray meets first: a station by its
 * billboard, an item by its drawing, a code by its square.
 *
 * @see editor3d-stations.ts.md
 */
import { tourStationBlocks } from "gps-plus-slam-app-framework/ar/tour-story";
import * as THREE from "three";

import { localPlaneToEnu } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import {
  composeTourFolderPath,
  decomposeTourFolderPath,
} from "gps-plus-slam-app-framework/ar/tour-folder-pose";
import {
  localPoseOf,
  tourFreeBlocks,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import type {
  TourAsset,
  TourBlock,
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  objectPoseNue,
  renderTourStation,
  uprightTurn,
  type RenderedTourObjects,
} from "../content-placement.js";
import { worldEnv, type WorldEnv, type WorldPart } from "../world-part.js";
import { pointRootMatrix, type GlobeEllipsoid } from "./editor3d-tour-root.js";
import { NEAR_STATIONS, nearStations } from "./editor3d-visibility.js";
import { posedEntries, type PlaceRef } from "../placement/placeables.js";
import { drawAtExtent, drawInherited } from "../placement/place-scale.js";
import { folderChains } from "../tour-document.js";
import { viewHeightAtOneM } from "./gizmo-maths.js";
import { isInterfacePart } from "./globe-interface-pass.js";

/** What the layer needs from the page (the drawing is the page's: Node,
 *  where the tests run, has no canvas). */
export interface StationsLayerDeps {
  /** Where the layer's objects go (the scene). */
  readonly parent: THREE.Object3D;
  readonly ellipsoid: GlobeEllipsoid;
  /** The globe's world frame: ECEF to the world. */
  readonly worldFromEcef: THREE.Matrix4;
  /** The geoid's N (m) at a place. */
  undulationAt(place: { lat: number; lon: number }): number;
  /** A pin's label (the phone's recipe). */
  makeLabel(text: string): { object: THREE.Object3D; dispose(): void };
  loadPhotoTexture(entryName: string): Promise<THREE.Texture | null>;
  /** A long text's reading stand (`lectern-view.ts`: a canvas page, so
   *  the page's). Absent: no stand is drawn (Node, where the tests run). */
  makeLectern?(block: {
    readonly id: string;
    readonly title: string;
    readonly body: string;
  }): { object: THREE.Object3D; dispose(): void };
  /** A long text's reading sign (`reading-sign.ts`, the page's).
   *  Absent: no sign is drawn. */
  makeReadingSign?(block: {
    readonly id: string;
    readonly title: string;
    readonly body: string;
  }): { object: THREE.Object3D; dispose(): void };
  /** Any other item's part in the world: the visitor's door
   *  (`play-kinds.ts` `worldPartOf`), asked in the editor's mode with
   *  the tour's files read through `loadContent`. Absent: no part is
   *  drawn. */
  worldPart?(block: TourBlock, env: WorldEnv): WorldPart | null;
  /** A content entry's bytes, by its path in the tour. */
  loadContent(entryName: string): Promise<Blob>;
  loadGlbModel(blob: Blob): Promise<THREE.Object3D>;
  /** A station's billboard: its 1-based number and its name. */
  makeBillboard(number: number, title: string, selected: boolean): THREE.Sprite;
  /** A code's square, `sizeM` on a side, its printed face +z. */
  makeCodeSquare(sizeM: number): THREE.Object3D;
}

/** The camera, as the layer reads it each frame. */
export interface StationsLayerView {
  /** The orbit's centre in the world (m: x east, z south). */
  readonly centre: THREE.Vector3;
  /** The selected station's id (or the station of the selected item). */
  readonly selectedStation: string | null;
  /** Whether the selection is that station itself, not an item in it:
   *  its found-radius circle is then drawn as selected. */
  readonly stationSelected: boolean;
  /** How upright pins and photos stand (`morphStanding`). */
  readonly standing: number;
  /** The camera's position in the world: laid flat, a code grows with
   *  its distance from it (`codeGrowth`). */
  readonly camera: THREE.Vector3;
  /** The view's height (CSS px) and the camera's vertical lens (degrees):
   *  what a code's size on screen is worked out from (`focalPxOf`). */
  readonly viewportPx: number;
  readonly fovDeg: number;
  /** The camera drawing the view: handed with its lens to each drawn
   *  world part that has an `update`. Absent: no part is ticked. */
  readonly eye?: THREE.Camera;
  /** The editor's selection, handed to each ticked part (a character
   *  opens his bubble while selected). */
  readonly selected?: string | null;
}

/** A code's printed side when the tour does not say (m). */
export const DEFAULT_CODE_SIZE_M = 0.2;

/**
 * The gap (m) between a code's anchor and the near edge of the code laid
 * flat: the storyboard prototype's rule, its 0.4 m from the anchor to the
 * flat poster's middle less the half of its 0.66 m poster.
 */
export const CODE_FLAT_GAP_M = 0.07;

/**
 * The least side (CSS px) a code laid flat is drawn on screen. 12 px shows
 * its three finder squares at about 3.4 px each; the storyboard prototype's
 * code read at about 9 to 15 px. The sweep behind the choice (9, 12 and
 * 15 px, from 10 m to the camera's 1100 m, at three window sizes) is in the
 * sidecar.
 */
export const CODE_SCREEN_PX = 12;

/**
 * Pixels per radian straight ahead (the focal length in px) of a view
 * `viewportPx` tall seen through a vertical lens of `fovDeg`: an object
 * `s` m across at `d` m is about `s * focalPxOf(...) / d` px on screen.
 */
export function focalPxOf(viewportPx: number, fovDeg: number): number {
  return viewportPx / viewHeightAtOneM(fovDeg);
}

/**
 * How many times its printed size a code is drawn: laid flat (`standing`
 * 0, looking straight down), as many as make it `CODE_SCREEN_PX` on screen
 * at `distanceM` from the camera - `CODE_SCREEN_PX * distanceM / (sizeM *
 * focalPx)` - but never fewer than 1, so a code nearer than where its
 * printed size reads that large keeps its printed size; tilted up
 * (`standing` 1), its printed size; between, in proportion. No cap: the
 * size on screen holds to the camera's farthest. A distance, size or focal
 * length that is not a positive finite number (a distance of 0 is near:
 * 1), or a morph that is not a number, draws it at its printed size; a
 * morph past 0 or 1 is taken at that end.
 */
export function codeGrowth(
  distanceM: number,
  standing: number,
  sizeM: number,
  focalPx: number,
): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 1;
  if (!Number.isFinite(standing)) return 1;
  if (!Number.isFinite(sizeM) || sizeM <= 0) return 1;
  if (!Number.isFinite(focalPx) || focalPx <= 0) return 1;
  const flat = 1 - Math.min(1, Math.max(0, standing));
  const far = Math.max(1, (CODE_SCREEN_PX * distanceM) / (sizeM * focalPx));
  return 1 + (far - 1) * flat;
}

/** How much higher a billboard stands upright than flat (m): the pole. */
export const BILLBOARD_LIFT_M = 4.6;

/** A billboard's height over its station when flat (m). */
const BILLBOARD_BASE_M = 0.6;

/** What a drag shows: a placeable at another pose, its dots at another
 *  value (a station's found radius, a model's size, a picture's width, a
 *  folder's scale; null: as the tour has it). */
export interface LayerPreview {
  readonly ref: PlaceRef;
  readonly geo: QrGeoPose;
  readonly value: number | null;
}

/** The names `buildLecternStand` and `buildReadingSign` give a reading
 *  stand's and a reading sign's root: drawn upright, never as a photo. */
const STANDS: ReadonlySet<string> = new Set(["lectern", "reading-sign"]);

/** Whether `object` is a reading stand or sign, or part of one. */
function inStand(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o !== null; o = o.parent) {
    if (STANDS.has(o.name)) return true;
  }
  return false;
}

/** The selection an object of the layer stands for (`pick`), on it or
 *  on an ancestor: a billboard's `station:<id>` and a code's level id
 *  (`userData.pick`), an item's id (`userData.objectId`). */
function pickOf(object: THREE.Object3D | null): string | null {
  for (let o = object; o !== null; o = o.parent) {
    const pick: unknown = o.userData["pick"] ?? o.userData["objectId"];
    if (typeof pick === "string") return pick;
  }
  return null;
}

/** The found-radius ring's place in the draw order: after everything drawn
 *  in the scene's default order, before the gizmo (its lowest part is 21),
 *  whose dots sit on it. */
export const RING_RENDER_ORDER = 20;

const RING_COLOUR = 0x6fa8dc;
/** The selected station's circle (the gizmo's amber: its dots sit on it). */
const RING_SELECTED = 0xe9a23b;
/** The circle of the station a selected item is in. */
const RING_CONTEXT = 0xa8c8ea;
/** While a drag has an item out of its station's circle: the Problems
 *  warning's colour (`--s-warn`, `editor-shell.css`). */
export const RING_ITEM_OUT = 0xe9b86b;
const POLE_COLOUR = 0xdfe3ea;

interface StationContent {
  alive: boolean;
  rendered: RenderedTourObjects | null;
  readonly ring: THREE.Mesh;
  readonly pole: THREE.Mesh;
  /** Each photo plane and its upright quaternion (a drag's preview
   *  turns it). */
  readonly photos: { mesh: THREE.Mesh; upright: THREE.Quaternion }[];
  /** The world parts drawn for it that take a frame (`update`). */
  readonly parts: WorldPart[];
}

interface StationEntry {
  readonly id: string;
  readonly index: number;
  readonly key: string;
  /** The station as the tour has it now (an edit that leaves its drawing
   *  as it is still updates it). */
  station: TourStation;
  readonly root: THREE.Group;
  /** The root's matrix where the tour has the station (a preview moves
   *  the root; clearing it puts this back). */
  readonly base: THREE.Matrix4;
  /** The station's point in the layer's frame (`layerPoint`). */
  readonly point: THREE.Vector3;
  /** Where its billboard stands: the point, or a preview's. */
  readonly shownPoint: THREE.Vector3;
  billboard: THREE.Sprite | null;
  billboardSelected: boolean;
  content: StationContent | null;
}

/** A model block's fields the layer does not draw anew: its notes and
 *  sections are the model parts' (`editor3d-model-parts.ts`). Its view
 *  is drawn (the world part wears it), so a change of view redraws. */
const UNDRAWN_MODEL_FIELDS = ["annotations", "sections"] as const;

/** A record as the layer's drawing reads it: a model block without its
 *  undrawn fields (a JSON.stringify replacer). */
function drawnFields(_key: string, value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { kind?: unknown }).kind !== "model"
  ) {
    return value;
  }
  const kept: Record<string, unknown> = { ...value };
  for (const field of UNDRAWN_MODEL_FIELDS) delete kept[field];
  return kept;
}

/** What a station's drawing depends on: its place in the list and its
 *  whole record but a model's undrawn fields. */
const keyOf = (s: TourStation, index: number): string =>
  `${String(index)}|${JSON.stringify(s, drawnFields)}`;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const flatTurn = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2);
const facing = new THREE.Vector3();
const flatQ = new THREE.Quaternion();
const local = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const unit = new THREE.Vector3(1, 1, 1);
const previewFrame = new THREE.Matrix4();
const tourFrame = new THREE.Matrix4();
const faceUp = new THREE.Quaternion();
const normal = new THREE.Vector3();
const eyeLocal = new THREE.Vector3();

/** A code's square as the morph moves it: its pose where it was measured,
 *  and where its middle goes as it lies flat. */
interface CodeSquare {
  readonly square: THREE.Object3D;
  readonly upright: THREE.Quaternion;
  readonly base: THREE.Vector3;
  /** The level offset (m, in its root's frame) the middle moves to when
   *  flat at its printed size: along its face's direction, half the code
   *  plus the gap (grown, both grow). */
  readonly flatShift: THREE.Vector3;
  /** Its anchor in the layer's frame (`layerPoint`): the camera's
   *  distance from it grows it. */
  readonly point: THREE.Vector3;
  /** Its printed side (m). */
  readonly sizeM: number;
}

/** The quaternion that lays a plane whose upright pose is `upright` flat,
 *  face up, its heading kept. */
function flatOf(
  upright: THREE.Quaternion,
  out: THREE.Quaternion,
): THREE.Quaternion {
  facing.set(0, 0, 1).applyQuaternion(upright);
  const yaw = Math.atan2(facing.x, facing.z);
  return out.setFromAxisAngle(Y_AXIS, yaw).multiply(flatTurn);
}

/** The quaternion that lays a plane whose pose is `upright` face up by
 *  the shortest turn: for an upright poster the same as `flatOf`, and a
 *  plane already face up (a code on a table) keeps its pose - its printed
 *  pattern never spins as the camera tilts. */
function faceUpOf(
  upright: THREE.Quaternion,
  out: THREE.Quaternion,
): THREE.Quaternion {
  normal.set(0, 0, 1).applyQuaternion(upright);
  return out.setFromUnitVectors(normal, Y_AXIS).multiply(upright);
}

/** Where a flat code's middle goes (m, level): along the horizontal part of
 *  its face's direction, `distanceM` out; none for a face up or down. */
function flatShiftOf(
  upright: THREE.Quaternion,
  distanceM: number,
): THREE.Vector3 {
  const level = new THREE.Vector3(0, 0, 1).applyQuaternion(upright).setY(0);
  return level.lengthSq() < 1e-12
    ? new THREE.Vector3()
    : level.normalize().multiplyScalar(distanceM);
}

/**
 * A code's rotation in its own north-up-east frame (x north, y up, z
 * east), for a square whose printed face is +z: its full rotation when
 * it carries one, else the vertical poster of its heading - +x along the
 * heading (`localPlaneToEnu`, the framework's one convention), +y up, the
 * face at the heading plus 90 degrees.
 */
export function codeQuaternionNue(geo: QrGeoPose): THREE.Quaternion {
  if (geo.rotation !== undefined) {
    return new THREE.Quaternion(...geo.rotation).normalize();
  }
  const along = localPlaneToEnu(1, 0, geo.headingDeg ?? 0);
  const x = new THREE.Vector3(along.north, along.up, along.east);
  const z = new THREE.Vector3().crossVectors(x, Y_AXIS);
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, Y_AXIS, z),
  );
}

/**
 * A found radius's ring, flat on the station's level. Flat, it cannot follow
 * a sloped ground, so no depth test: the relief above the station's height
 * would hide it. Like the labels, it shows through a building or a hill.
 */
function ringOf(radiusM: number): THREE.Mesh {
  const width = Math.min(0.45, radiusM / 4);
  const geometry = new THREE.RingGeometry(radiusM - width, radiusM, 96);
  // Flat on the station's ground plane (y up in its frame).
  geometry.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: RING_COLOUR,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.name = "found-radius";
  ring.renderOrder = RING_RENDER_ORDER;
  return ring;
}

function poleOf(): THREE.Mesh {
  // One metre tall, its foot at the origin: scaled to the billboard.
  const geometry = new THREE.CylinderGeometry(0.06, 0.06, 1, 8).translate(
    0,
    0.5,
    0,
  );
  const pole = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color: POLE_COLOUR }),
  );
  // The interface's name: the globe draws it after the clouds' shadow.
  pole.name = "pole";
  return pole;
}

/** Free an object's geometries and materials, and their maps unless a
 *  mesh says its map is shared (`userData.sharedMap`: a code's face). */
function freeObject(object: THREE.Object3D): void {
  object.removeFromParent();
  // Each geometry and material freed under its own guard: one that throws
  // strands none of the rest of the tree.
  const frees: (() => void)[] = [];
  object.traverse((o) => {
    const mesh = o as Partial<THREE.Mesh>;
    const geometry = mesh.geometry;
    if (geometry !== undefined) frees.push(() => geometry.dispose());
    const material = mesh.material;
    const list = Array.isArray(material)
      ? material
      : material === undefined
        ? []
        : [material];
    for (const m of list) {
      frees.push(() => {
        if (o.userData["sharedMap"] !== true) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
        }
        m.dispose();
      });
    }
  });
  freeEach(frees);
}

/** Runs every one of `frees`: one that throws strands none after it, and
 *  the first throw then reaches the caller. */
function freeEach(frees: Iterable<() => void>): void {
  let failed: { error: unknown } | null = null;
  for (const free of frees) {
    try {
      free();
    } catch (error) {
      failed ??= { error };
    }
  }
  if (failed !== null) throw failed.error;
}

function freeSprite(sprite: THREE.Sprite): void {
  sprite.removeFromParent();
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

/** The model a part drew (the object under it carrying `tourScale`,
 *  `kinds/model/world.ts`), or null. */
function modelIn(object: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  object.traverse((o) => {
    if (found === null && typeof o.userData["tourScale"] === "number") {
      found = o;
    }
  });
  return found;
}

/** Whether `object` and every ancestor up to `top` is visible: a hidden
 *  root hides its items from the picking as from the drawing. */
function drawnInGroup(object: THREE.Object3D, top: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o !== null; o = o.parent) {
    if (!o.visible) return false;
    if (o === top) return true;
  }
  return true;
}

/**
 * The layer, its group added to `deps.parent`. `setTour(manifest, levels)`
 * places every station and code; `update(view)` each frame renders the
 * near stations' items, frees the rest, applies the morph and keeps the
 * billboards over their stations.
 */
export function createStationsLayer(deps: StationsLayerDeps) {
  const group = new THREE.Group();
  group.name = "tour";
  deps.parent.add(group);
  const stations = new Map<string, StationEntry>();
  let tourAssets: readonly TourAsset[] = [];
  /** What a world part reads the tour's files through: the editor's. */
  const editEnv = (): WorldEnv =>
    worldEnv("edit", tourAssets, (path) => deps.loadContent(path), {
      parseModel: (blob) => deps.loadGlbModel(blob),
    });
  let env = editEnv();
  /** The objects of the parts the door built: drawn at their pose as it
   *  stands, never as a photo plane. */
  const partObjects = new WeakSet<THREE.Object3D>();
  const inPart = (object: THREE.Object3D): boolean => {
    for (let o: THREE.Object3D | null = object; o !== null; o = o.parent) {
      if (partObjects.has(o)) return true;
    }
    return false;
  };
  let codes: THREE.Group[] = [];
  /** Each code's square and its morph. */
  let codeSquares: CodeSquare[] = [];
  /** Each code's point in the world, by its level id. */
  let codePoints = new Map<string, THREE.Vector3>();
  let shownNames = true;
  let shownCodes = true;
  /** Each code root's level id, in the order of `codes`. */
  let codeIds: string[] = [];
  /** What the globe view's visibility rule hides (`setHidden`). */
  let hiddenStations: ReadonlySet<string> = new Set();
  let hiddenCodes: ReadonlySet<string> = new Set();
  const codeShown = (levelId: string) =>
    shownCodes && !hiddenCodes.has(levelId);
  let shown = new Set<string>();
  let renders = 0;
  /** What a drag shows now (`setPreview`). */
  let preview: LayerPreview | null = null;

  // The arrival's growth about a station's point (`setGrowth`).
  const growth = new THREE.Matrix4();
  const growthScale = new THREE.Matrix4();
  const growthBack = new THREE.Matrix4();

  const rootAt = (geo: { lat: number; lon: number }): THREE.Group => {
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    pointRootMatrix(
      {
        ellipsoid: deps.ellipsoid,
        worldFromEcef: deps.worldFromEcef,
        place: { lat: geo.lat, lon: geo.lon },
        undulationM: deps.undulationAt({ lat: geo.lat, lon: geo.lon }),
      },
      root.matrix,
    );
    group.add(root);
    root.updateMatrixWorld(true);
    return root;
  };

  /** The point `y` metres up a root's axis, in the layer's frame (the
   *  parent's: the layer's group stays at its origin). Read from the
   *  root's own matrix, never its world one: under the globe the world
   *  frame moves on each recentre, and a point read through it would carry
   *  that move into the layer's frame. */
  const layerPoint = (root: THREE.Object3D, y: number): THREE.Vector3 =>
    new THREE.Vector3(0, y, 0).applyMatrix4(root.matrix);

  const freeContent = (entry: StationEntry) => {
    const content = entry.content;
    if (content === null) return;
    content.alive = false;
    // Cleared first, and every free run whatever another throws (the
    // renderer's dispose rethrows a part's; only it unmounts the parts and
    // frees the labels and textures): the station is freed either way and
    // drawn anew when it is near.
    entry.content = null;
    freeEach([
      () => content.rendered?.dispose(),
      () => freeObject(content.ring),
      () => freeObject(content.pole),
    ]);
  };

  const freeStation = (entry: StationEntry) => {
    try {
      freeContent(entry);
    } finally {
      if (entry.billboard !== null) freeSprite(entry.billboard);
      entry.billboard = null;
      entry.root.removeFromParent();
    }
  };

  /** Frees each of `entries`; one that throws abandons none after it, and
   *  the first throw then reaches the caller. */
  const freeStations = (entries: Iterable<StationEntry>) =>
    freeEach([...entries].map((entry) => () => freeStation(entry)));

  const renderContent = (entry: StationEntry) => {
    const alt = entry.station.geo.alt;
    const ring = ringOf(entry.station.foundRadiusM);
    ring.position.set(0, alt + 0.05, 0);
    const pole = poleOf();
    pole.position.set(0, alt, 0);
    entry.root.add(ring, pole);
    const content: StationContent = {
      alive: true,
      rendered: null,
      ring,
      pole,
      photos: [],
      parts: [],
    };
    entry.content = content;
    renders++;
    void renderTourStation(entry.station, {
      assets: tourAssets,
      scene: entry.root,
      zero: { lat: entry.station.geo.lat, lon: entry.station.geo.lon },
      alive: () => content.alive,
      makeLabel: (text) => deps.makeLabel(text),
      loadPhotoTexture: (entryName) => deps.loadPhotoTexture(entryName),
      ...(deps.makeLectern === undefined
        ? {}
        : { makeLectern: deps.makeLectern.bind(deps) }),
      ...(deps.makeReadingSign === undefined
        ? {}
        : { makeReadingSign: deps.makeReadingSign.bind(deps) }),
      ...(deps.worldPart === undefined
        ? {}
        : {
            worldPart: (block: TourBlock) => {
              const part = deps.worldPart?.(block, env) ?? null;
              if (part !== null) {
                partObjects.add(part.object);
                if (part.update !== undefined) content.parts.push(part);
              }
              return part;
            },
          }),
    })
      .then((rendered) => {
        if (!content.alive) {
          rendered.dispose();
          return;
        }
        content.rendered = rendered;
        rendered.root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          // A stand's and a part's meshes keep their pose: they are no
          // photo planes.
          if (mesh.isMesh && !inStand(mesh) && !inPart(mesh)) {
            content.photos.push({ mesh, upright: mesh.quaternion.clone() });
          }
        });
      })
      .catch(() => {
        // A station whose items cannot be drawn keeps its billboard and
        // ring; the 2D view still lists them.
      });
  };

  const setCodes = (levels: ReadonlyMap<string, QrLevel>) => {
    for (const code of codes) freeObject(code);
    codes = [];
    codeIds = [];
    codeSquares = [];
    codePoints = new Map();
    for (const [levelId, level] of levels) {
      const geo = level.qr.geo;
      if (geo === undefined) continue;
      const root = rootAt(geo);
      root.visible = codeShown(levelId);
      const point = layerPoint(root, geo.alt);
      codePoints.set(levelId, point);
      const sizeM = level.qr.physicalSizeM ?? DEFAULT_CODE_SIZE_M;
      const square = deps.makeCodeSquare(sizeM);
      square.userData["pick"] = levelId;
      square.position.set(0, geo.alt, 0);
      const upright = codeQuaternionNue(geo);
      square.quaternion.copy(upright);
      root.add(square);
      codes.push(root);
      codeIds.push(levelId);
      codeSquares.push({
        square,
        upright,
        base: square.position.clone(),
        flatShift: flatShiftOf(upright, sizeM / 2 + CODE_FLAT_GAP_M),
        point: point.clone(),
        sizeM,
      });
    }
  };

  const colourRing = (entry: StationEntry, view: StationsLayerView) => {
    const material = entry.content?.ring.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    const mine = entry.id === view.selectedStation;
    const selected = mine && view.stationSelected;
    const out = itemOutOf(entry);
    material.color.setHex(
      out
        ? RING_ITEM_OUT
        : selected
          ? RING_SELECTED
          : mine
            ? RING_CONTEXT
            : RING_COLOUR,
    );
    material.opacity = selected || out ? 1 : 0.85;
  };

  /** Whether a drag has one of `entry`'s items outside its circle now. */
  const itemOutOf = (entry: StationEntry): boolean => {
    if (
      preview?.ref.kind !== "block" ||
      entryOfItem(preview.ref.id) !== entry
    ) {
      return false;
    }
    const [north, , east] = localPoseOf(
      preview.geo,
      entry.station.geo,
    ).position;
    return Math.hypot(north, east) > entry.station.foundRadiusM;
  };

  const placeBillboard = (entry: StationEntry, view: StationsLayerView) => {
    const selected = entry.id === view.selectedStation;
    if (entry.billboard === null || entry.billboardSelected !== selected) {
      if (entry.billboard !== null) freeSprite(entry.billboard);
      entry.billboard = deps.makeBillboard(
        entry.index + 1,
        entry.station.title ?? `Station ${String(entry.index + 1)}`,
        selected,
      );
      entry.billboardSelected = selected;
      entry.billboard.userData["pick"] = `station:${entry.id}`;
      group.add(entry.billboard);
    }
    const rise = BILLBOARD_BASE_M + BILLBOARD_LIFT_M * view.standing;
    entry.billboard.position
      .copy(entry.shownPoint)
      .setY(entry.shownPoint.y + rise);
    const hidden = hiddenStations.has(entry.id);
    entry.root.visible = !hidden;
    entry.billboard.visible = shownNames && !hidden;
    if (entry.content !== null) {
      entry.content.pole.scale.set(1, rise, 1);
      entry.content.pole.visible = shownNames && !hidden;
    }
  };

  /** A station's frame in the world at `geo`: its root's matrix there
   *  times its pose in that root (as `renderTourStation` places it). */
  const frameAt = (geo: QrGeoPose, out: THREE.Matrix4): THREE.Matrix4 => {
    pointRootMatrix(
      {
        ellipsoid: deps.ellipsoid,
        worldFromEcef: deps.worldFromEcef,
        place: { lat: geo.lat, lon: geo.lon },
        undulationM: deps.undulationAt({ lat: geo.lat, lon: geo.lon }),
      },
      out,
    );
    const pose = objectPoseNue(geo, { lat: geo.lat, lon: geo.lon });
    return out.multiply(
      local.compose(
        position.set(...pose.positionNue),
        rotation.set(...pose.rotationNue),
        unit,
      ),
    );
  };

  const entryOfItem = (id: string): StationEntry | null => {
    for (const entry of stations.values()) {
      if (tourStationBlocks(entry.station).some((i) => i.id === id)) {
        return entry;
      }
    }
    return null;
  };

  /** Each drawn object of an item (its label or plane, a model). */
  const drawnOf = (entry: StationEntry, id: string): THREE.Object3D[] => {
    const found: THREE.Object3D[] = [];
    entry.content?.rendered?.root.traverse((o) => {
      if (o.userData["objectId"] === id) found.push(o);
    });
    return found;
  };

  /** Put an item's drawing at `pose` in its station, at the extent
   *  `value` (a model's size, a picture's width; null: as the tour has
   *  it), scaled from what was drawn (`placement/place-scale.ts`). */
  const poseDrawn = (
    entry: StationEntry,
    id: string,
    pose: {
      readonly position: readonly [number, number, number];
      readonly rotation: readonly [number, number, number, number];
    },
    value: number | null,
  ) => {
    const turned = new THREE.Quaternion(...pose.rotation);
    for (const o of drawnOf(entry, id)) {
      o.position.set(...pose.position);
      const photo = entry.content?.photos.find((p) => p.mesh === o);
      if (photo !== undefined) {
        photo.upright.copy(turned);
        drawAtExtent(o, value);
        continue;
      }
      if (partObjects.has(o)) {
        // As the renderer draws a part: the pose's rotation as it is; a
        // model in it at the dragged size.
        o.quaternion.copy(turned);
        drawAtExtent(o, value);
        continue;
      }
      if (STANDS.has(o.name)) {
        // Upright, as the renderer draws it: its turn about up only.
        uprightTurn(pose.rotation, o.quaternion);
      }
    }
  };

  const entryOfFolder = (id: string): StationEntry | null => {
    for (const entry of stations.values()) {
      if (folderChains(entry.station).has(id)) return entry;
    }
    return null;
  };

  /** Draw the items of the plain folder `folderId` as if its origin stood
   *  at `geo` and its scale were `scale` (null: as the tour has them):
   *  each through the folders inside it, then the folder at its new
   *  frame, then its holders, drawn that much larger. */
  const poseFolderDrawn = (
    entry: StationEntry,
    folderId: string,
    geo: QrGeoPose | null,
    scale: number | null,
  ) => {
    const chains = folderChains(entry.station);
    const chain = chains.get(folderId);
    const folder = chain?.at(-1);
    if (chain === undefined || folder === undefined) return;
    const holders = chain.slice(0, -1);
    const own = folder.scale ?? 1;
    const pose =
      geo === null
        ? folder.pose
        : decomposeTourFolderPath(holders, localPoseOf(geo, entry.station.geo));
    const frame = {
      ...(pose === undefined ? {} : { pose }),
      scale: scale ?? own,
    };
    for (const { block, place } of posedEntries(entry.station)) {
      if (!place.folderPath.includes(folderId)) continue;
      const innermost = chains.get(place.folderPath.at(-1) ?? "") ?? chain;
      const within = composeTourFolderPath(
        innermost.slice(chain.length),
        block.pose,
      );
      poseDrawn(
        entry,
        block.id,
        composeTourFolderPath([...holders, frame], within),
        null,
      );
      for (const o of drawnOf(entry, block.id)) {
        drawInherited(o, (place.inheritedScale * frame.scale) / own);
      }
    }
  };

  /** Draw `p` where the drag has it. */
  const applyPreview = (p: LayerPreview) => {
    if (p.ref.kind === "station") {
      const entry = stations.get(p.ref.id);
      if (entry === undefined) return;
      const shift = frameAt(p.geo, previewFrame).multiply(
        frameAt(entry.station.geo, tourFrame).invert(),
      );
      entry.root.matrix.multiplyMatrices(shift, entry.base);
      entry.root.updateMatrixWorld(true);
      entry.shownPoint.copy(entry.point).applyMatrix4(shift);
      const k =
        (p.value ?? entry.station.foundRadiusM) / entry.station.foundRadiusM;
      entry.content?.ring.scale.set(k, 1, k);
      return;
    }
    if (p.ref.kind === "folder") {
      const entry = entryOfFolder(p.ref.id);
      if (entry !== null) poseFolderDrawn(entry, p.ref.id, p.geo, p.value);
      return;
    }
    const { id } = p.ref;
    const entry = entryOfItem(id);
    if (entry === null) return;
    poseDrawn(entry, id, localPoseOf(p.geo, entry.station.geo), p.value);
  };

  /** Draw what `p` showed where the tour has it again. */
  const clearPreview = (p: LayerPreview) => {
    if (p.ref.kind === "station") {
      const entry = stations.get(p.ref.id);
      if (entry === undefined) return;
      entry.root.matrix.copy(entry.base);
      entry.root.updateMatrixWorld(true);
      entry.shownPoint.copy(entry.point);
      entry.content?.ring.scale.set(1, 1, 1);
      return;
    }
    if (p.ref.kind === "folder") {
      const entry = entryOfFolder(p.ref.id);
      if (entry !== null) poseFolderDrawn(entry, p.ref.id, null, null);
      return;
    }
    const { id } = p.ref;
    const entry = entryOfItem(id);
    if (entry === null) return;
    // Any free block drawn (a part from the door too), as `itemPointOf`
    // reads them: whichever placeable a drag showed is put back the same
    // way.
    const item = tourFreeBlocks(entry.station).find((i) => i.id === id);
    if (item === undefined) return;
    poseDrawn(entry, id, item.pose, null);
  };

  /** Each drawn part that takes a frame, of a station shown: the page
   *  clock, the camera's position in the part's parent frame (as the
   *  visitor's `tickWorldParts` gives it), the camera and its lens. A
   *  part a failed load took out (no parent) is skipped. */
  const tickParts = (
    eye: THREE.Camera,
    metresPerPxAtOneM: number,
    selected: string | null,
  ) => {
    const seconds = performance.now() / 1000;
    eye.updateMatrixWorld();
    for (const entry of stations.values()) {
      if (entry.content === null || !entry.root.visible) continue;
      for (const part of entry.content.parts) {
        const parent = part.object.parent;
        if (parent === null) continue;
        parent.updateWorldMatrix(true, false);
        eye.getWorldPosition(eyeLocal);
        parent.worldToLocal(eyeLocal);
        part.update?.({
          seconds,
          viewer: [eyeLocal.x, eyeLocal.y, eyeLocal.z],
          camera: eye,
          metresPerPxAtOneM,
          selected,
        });
      }
    }
  };

  return {
    group,
    /** Place every station and code of `manifest` (null: none). */
    setTour(
      manifest: TourManifest | null,
      levels: ReadonlyMap<string, QrLevel>,
    ) {
      tourAssets = manifest?.assets ?? [];
      env = editEnv();
      const keep = new Set<string>();
      // Freed once the new tour is in place: a free that throws then
      // leaves no station of it unplaced.
      const freed: StationEntry[] = [];
      (manifest?.stations ?? []).forEach((station, index) => {
        keep.add(station.id);
        const key = keyOf(station, index);
        const old = stations.get(station.id);
        if (old?.key === key) {
          old.station = station;
          return;
        }
        if (old !== undefined) freed.push(old);
        const root = rootAt(station.geo);
        const point = layerPoint(root, station.geo.alt);
        stations.set(station.id, {
          id: station.id,
          index,
          key,
          station,
          root,
          base: root.matrix.clone(),
          point,
          shownPoint: point.clone(),
          billboard: null,
          billboardSelected: false,
          content: null,
        });
      });
      for (const [id, entry] of stations) {
        if (keep.has(id)) continue;
        freed.push(entry);
        stations.delete(id);
      }
      try {
        freeStations(freed);
      } finally {
        setCodes(levels);
      }
    },
    /** Each frame: the near set, the morph and the billboards. */
    update(view: StationsLayerView) {
      const spots = [...stations.values()].map((e) => ({
        id: e.id,
        east: e.point.x,
        north: -e.point.z,
      }));
      shown = nearStations(
        spots,
        { east: view.centre.x, north: -view.centre.z },
        NEAR_STATIONS,
        view.selectedStation,
      );
      for (const entry of stations.values()) {
        const near = shown.has(entry.id);
        if (near && entry.content === null) renderContent(entry);
        if (!near && entry.content !== null) freeContent(entry);
      }
      // Each frame: a station drawn anew, or items that arrived since,
      // take the drag's preview too.
      if (preview !== null) applyPreview(preview);
      for (const entry of stations.values()) {
        placeBillboard(entry, view);
        if (entry.content !== null) colourRing(entry, view);
        for (const photo of entry.content?.photos ?? []) {
          photo.mesh.quaternion.slerpQuaternions(
            flatOf(photo.upright, flatQ),
            photo.upright,
            view.standing,
          );
        }
      }
      const focal = focalPxOf(view.viewportPx, view.fovDeg);
      for (const code of codeSquares) {
        const grown = codeGrowth(
          view.camera.distanceTo(code.point),
          view.standing,
          code.sizeM,
          focal,
        );
        code.square.quaternion.slerpQuaternions(
          faceUpOf(code.upright, faceUp),
          code.upright,
          view.standing,
        );
        // Grown, the square and its gap grow together: a picked square
        // is the one drawn.
        code.square.scale.setScalar(grown);
        code.square.position
          .copy(code.flatShift)
          .multiplyScalar((1 - view.standing) * grown)
          .add(code.base);
      }
      if (view.eye !== undefined) {
        tickParts(view.eye, 1 / focal, view.selected ?? null);
      }
    },
    /** Draw a drag's preview (null: none; what the last one showed is
     *  drawn where the tour has it again). */
    setPreview(next: LayerPreview | null) {
      if (preview !== null) clearPreview(preview);
      preview = next;
      if (next !== null) applyPreview(next);
    },
    /** The selection the ray meets first (`station:<id>`, an item's
     *  id, a code's level id), or null; rings and poles are none. What
     *  is drawn over everything (`isInterfacePart`: a billboard, a
     *  sound's icon) comes before a nearer part with a depth test, as it
     *  shows in front of it: a click selects what is seen. Between such
     *  parts the one drawn last (the highest render order) is seen, and
     *  between equal orders the nearer. */
    pick(raycaster: THREE.Raycaster): string | null {
      group.updateMatrixWorld();
      let nearest: string | null = null;
      let top: { pick: string; order: number } | null = null;
      // Hits come nearest first, so a farther one replaces only on a
      // strictly higher order.
      for (const hit of raycaster.intersectObject(group, true)) {
        if (!drawnInGroup(hit.object, group)) continue;
        const pick = pickOf(hit.object);
        if (pick === null) continue;
        if (isInterfacePart(hit.object)) {
          const order = hit.object.renderOrder;
          if (top === null || order > top.order) top = { pick, order };
        } else nearest ??= pick;
      }
      return top?.pick ?? nearest;
    },
    /** For the page's checks: the stations and what is drawn. */
    stats() {
      return {
        stations: stations.size,
        codes: codes.length,
        // Each code's drawn size over its printed one (`codeGrowth`).
        codeScales: codeSquares.map((c) => c.square.scale.x),
        shown: [...shown],
        renders,
      };
    },
    /** For the page's checks: each code's drawn square as its four
     *  corners in the world, in order around it (the page projects them
     *  to measure the code on screen). */
    codeCorners(): THREE.Vector3[][] {
      group.updateMatrixWorld();
      return codeSquares.map(({ square, sizeM }) => {
        const h = sizeM / 2;
        return [
          [-h, -h],
          [h, -h],
          [h, h],
          [-h, h],
        ].map(([x, y]) =>
          new THREE.Vector3(x, y, 0).applyMatrix4(square.matrixWorld),
        );
      });
    },
    /** A station's point in the layer's frame (the world for a layer in
     *  the scene; the globe moves it with `layerToWorld`), or null. */
    pointOf(id: string): THREE.Vector3 | null {
      return stations.get(id)?.point.clone() ?? null;
    },
    /** A station's found radius (m), or null. */
    radiusOf(id: string): number | null {
      return stations.get(id)?.station.foundRadiusM ?? null;
    },
    /** Where an item of the tour stands in the layer's frame (its pose in
     *  its station's frame), whether its station draws its items now or
     *  not; null for an id no station holds. Any free block, as
     *  `clearPreview` reads them: a part from the door is located too
     *  (the view flies to it), though only world blocks are a gesture's
     *  target (`editor3d-editing.ts`). */
    itemPointOf(id: string): THREE.Vector3 | null {
      for (const entry of stations.values()) {
        const item = tourFreeBlocks(entry.station).find((i) => i.id === id);
        if (item === undefined) continue;
        const { geo } = entry.station;
        const frame = objectPoseNue(geo, { lat: geo.lat, lon: geo.lon });
        return new THREE.Vector3(...item.pose.position)
          .applyQuaternion(new THREE.Quaternion(...frame.rotationNue))
          .add(new THREE.Vector3(...frame.positionNue))
          .applyMatrix4(entry.root.matrix);
      }
      return null;
    },
    /** Where a code with a position stands in the layer's frame, or
     *  null. */
    codePointOf(levelId: string): THREE.Vector3 | null {
      return codePoints.get(levelId)?.clone() ?? null;
    },
    /** The layer chips: the station names (billboards and their poles)
     *  and the codes shown or hidden. */
    setShown(layers: { readonly names: boolean; readonly codes: boolean }) {
      shownNames = layers.names;
      shownCodes = layers.codes;
      codes.forEach((code, i) => {
        code.visible = codeShown(codeIds[i] ?? "");
      });
    },
    /**
     * The globe view's visibility rule: these stations (their billboard,
     * pole, ring and items) and these codes are not drawn and not picked,
     * whatever the chips say; the rest follow the chips. A station's
     * billboard takes it on the next `update`.
     */
    setHidden(stationIds: ReadonlySet<string>, levelIds: ReadonlySet<string>) {
      hiddenStations = new Set(stationIds);
      hiddenCodes = new Set(levelIds);
      for (const entry of stations.values()) {
        entry.root.visible = !hiddenStations.has(entry.id);
      }
      codes.forEach((code, i) => {
        code.visible = codeShown(codeIds[i] ?? "");
      });
    },
    /**
     * The globe view's arrival: each station of `scales` drawn at that
     * scale about its point (a pop-in), every other one as the tour has it.
     * A station a drag previews keeps the preview. A scale is held above
     * zero (a degenerate matrix breaks the picking rays); the caller hides
     * a station not grown yet.
     */
    setGrowth(scales: ReadonlyMap<string, number>) {
      for (const entry of stations.values()) {
        if (preview?.ref.kind === "station" && preview.ref.id === entry.id) {
          continue;
        }
        const s = scales.get(entry.id);
        if (s === undefined || s === 1 || !Number.isFinite(s)) {
          entry.root.matrix.copy(entry.base);
        } else {
          const alt = entry.station.geo.alt;
          const k = Math.max(1e-3, s);
          growth
            .makeTranslation(0, alt, 0)
            .multiply(growthScale.makeScale(k, k, k))
            .multiply(growthBack.makeTranslation(0, -alt, 0));
          entry.root.matrix.multiplyMatrices(entry.base, growth);
        }
        entry.root.updateMatrixWorld(true);
      }
    },
    /** Whether the codes show (the page's checks). */
    codesVisible(): boolean {
      return shownCodes;
    },
    billboardOf(id: string): THREE.Sprite | null {
      return stations.get(id)?.billboard ?? null;
    },
    /** Every object a station draws: its root (ring, pole and items) and
     *  its billboard once made (it hangs in the layer's group, not under
     *  the root); null for an id the tour does not hold. The globe view
     *  stages each station's first upload through these. */
    stationObjects(id: string): THREE.Object3D[] | null {
      const entry = stations.get(id);
      if (entry === undefined) return null;
      return entry.billboard === null
        ? [entry.root]
        : [entry.root, entry.billboard];
    },
    photoPlanes(id: string): THREE.Mesh[] {
      return (stations.get(id)?.content?.photos ?? []).map((p) => p.mesh);
    },
    /** Each drawn object of an item (its label or plane, a model): none
     *  for one not drawn now (a selected folder's outline boxes them). */
    itemObjects(id: string): THREE.Object3D[] {
      const entry = entryOfItem(id);
      return entry === null ? [] : drawnOf(entry, id);
    },
    /** An item's drawn model (the glb in its part, under its pose and
     *  size), or null for one not drawn now. */
    modelObject(id: string): THREE.Object3D | null {
      const entry = entryOfItem(id);
      if (entry === null) return null;
      for (const o of drawnOf(entry, id)) {
        const model = modelIn(o);
        if (model !== null) return model;
      }
      return null;
    },
    /** The models a station draws now. */
    models(id: string): THREE.Object3D[] {
      const found: THREE.Object3D[] = [];
      stations.get(id)?.content?.rendered?.root.traverse((o) => {
        if (typeof o.userData["tourScale"] === "number") found.push(o);
      });
      return found;
    },
    dispose() {
      try {
        freeStations([...stations.values()]);
      } finally {
        stations.clear();
        for (const code of codes) freeObject(code);
        codes = [];
        codeIds = [];
        codeSquares = [];
        group.removeFromParent();
      }
    },
  };
}
