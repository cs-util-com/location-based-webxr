/**
 * The tour in the 3D editor's world. Every station gets a root at its own
 * point (`pointRootMatrix`: drawn N lower than its file's ellipsoidal
 * height) and a billboard with its number and name. The stations near the
 * camera's centre and the selected one (`nearStations`) also draw their
 * items as the phone does (`renderTourStation`: pins as labels, photos as
 * planes), their placed models at the format's size (`modelScale`), their
 * found radius as a ring and a pole up to the billboard. Every code with a
 * position is a square of its printed size, facing as printed.
 *
 * The morph (`standing`, 0 looking straight down to 1 tilted up): photos
 * and codes lie flat face up and stand up again - a code laid in front of
 * its anchor, on the side its face looks to, never under the wall it hangs
 * on - and the billboards and their poles rise. Models keep their pose;
 * pins (the phone's labels) stand. Laid flat, a code is drawn larger the
 * farther the camera is (`codeGrowth`: its printed size within about
 * 71 m, up to 8 times it from about 571 m), its gap from the anchor with
 * it, and it is picked where it is drawn. Between those distances it
 * keeps the size on screen it has at 71 m, a few pixels for a 20 cm code:
 * it shows where a code is, it does not make it readable from high above.
 *
 * The layer chips turn the station names (billboards and poles) and the
 * codes off and on (`setShown`); the camera's flights ask where a
 * station, an item or a code stands (`pointOf`, `itemPointOf`,
 * `codePointOf`), drawn or not.
 *
 * Read-only: nothing here edits the tour. The page hands the tour
 * (`setTour`) when the document changes and the camera (`update`) each
 * frame. A station's items are rendered when it enters the near set and
 * freed when it leaves; a tour handed again unchanged renders nothing.
 *
 * While a drag of the 3D view runs, `setPreview` draws the dragged
 * station (its items, billboard and found radius with it) or item (a
 * model at its dragged size) where the drag has it, by moving what is
 * drawn - nothing is rendered again; cleared, everything is drawn where
 * the tour has it. `pick` says what a ray meets first: a station by its
 * billboard, an item by its drawing, a code by its square.
 *
 * @see editor3d-stations.ts.md
 */
import * as THREE from "three";

import { localPlaneToEnu } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import type {
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  objectPoseNue,
  renderTourStation,
  type RenderedTourObjects,
} from "../content-placement.js";
import {
  modelScale,
  pointRootMatrix,
  type GlobeEllipsoid,
} from "./editor3d-tour-root.js";
import { NEAR_STATIONS, nearStations } from "./editor3d-visibility.js";

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
 * The camera distance (m) within which a code laid flat is drawn at its
 * printed size: past it, it grows in proportion to the distance (the
 * storyboard prototype's 0.014 per metre, so about 71 m), keeping the size
 * on screen it has here, about 2.7 px for a 20 cm code on a 900 px high
 * view.
 */
export const CODE_GROWTH_FROM_M = 1 / 0.014;

/** The most a code laid flat grows (times its printed size). */
export const CODE_GROWTH_MAX = 8;

/**
 * How many times its printed size a code is drawn: the camera's distance
 * over `CODE_GROWTH_FROM_M`, between 1 and `CODE_GROWTH_MAX`, as far as the
 * code lies flat (`standing` 0 looking straight down: all of it; 1 tilted
 * up: its printed size). A distance or morph that is not a finite number
 * (or a negative distance) draws it at its printed size; a morph past 0
 * or 1 is taken at that end.
 */
export function codeGrowth(distanceM: number, standing: number): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 1;
  if (!Number.isFinite(standing)) return 1;
  const flat = 1 - Math.min(1, Math.max(0, standing));
  const far = Math.min(
    CODE_GROWTH_MAX,
    Math.max(1, distanceM / CODE_GROWTH_FROM_M),
  );
  return 1 + (far - 1) * flat;
}

/** How much higher a billboard stands upright than flat (m): the pole. */
export const BILLBOARD_LIFT_M = 4.6;

/** A billboard's height over its station when flat (m). */
const BILLBOARD_BASE_M = 0.6;

/** What a drag shows: a station at another pose and found radius, or an
 *  item at another pose (a model at another size). */
export type LayerPreview =
  | {
      readonly kind: "station";
      readonly id: string;
      readonly geo: QrGeoPose;
      readonly foundRadiusM: number;
    }
  | {
      readonly kind: "item";
      readonly id: string;
      readonly geo: QrGeoPose;
      readonly sizeM: number | null;
    };

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

const RING_COLOUR = 0x6fa8dc;
/** The selected station's circle (the gizmo's amber: its dots sit on it). */
const RING_SELECTED = 0xe9a23b;
/** The circle of the station a selected item is in. */
const RING_CONTEXT = 0xa8c8ea;
const POLE_COLOUR = 0xdfe3ea;

interface StationContent {
  alive: boolean;
  rendered: RenderedTourObjects | null;
  readonly models: THREE.Object3D[];
  readonly ring: THREE.Mesh;
  readonly pole: THREE.Mesh;
  /** Each photo plane and its upright quaternion (a drag's preview
   *  turns it). */
  readonly photos: { mesh: THREE.Mesh; upright: THREE.Quaternion }[];
}

interface StationEntry {
  readonly id: string;
  readonly index: number;
  readonly key: string;
  readonly station: TourStation;
  readonly root: THREE.Group;
  /** The root's matrix where the tour has the station (a preview moves
   *  the root; clearing it puts this back). */
  readonly base: THREE.Matrix4;
  /** The station's point in the world. */
  readonly point: THREE.Vector3;
  /** Where its billboard stands: the point, or a preview's. */
  readonly shownPoint: THREE.Vector3;
  billboard: THREE.Sprite | null;
  billboardSelected: boolean;
  content: StationContent | null;
}

/** What a station's drawing depends on: its place in the list and its
 *  whole record. */
const keyOf = (s: TourStation, index: number): string =>
  `${String(index)}|${JSON.stringify(s)}`;

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
  /** Its anchor in the world: the camera's distance from it grows it. */
  readonly point: THREE.Vector3;
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
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.name = "found-radius";
  return ring;
}

function poleOf(): THREE.Mesh {
  // One metre tall, its foot at the origin: scaled to the billboard.
  const geometry = new THREE.CylinderGeometry(0.06, 0.06, 1, 8).translate(
    0,
    0.5,
    0,
  );
  return new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color: POLE_COLOUR }),
  );
}

/** Free an object's geometries and materials, and their maps unless a
 *  mesh says its map is shared (`userData.sharedMap`: a code's face). */
function freeObject(object: THREE.Object3D): void {
  object.removeFromParent();
  object.traverse((o) => {
    const mesh = o as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    const list = Array.isArray(material)
      ? material
      : material === undefined
        ? []
        : [material];
    for (const m of list) {
      if (o.userData["sharedMap"] !== true) {
        (m as THREE.MeshBasicMaterial).map?.dispose();
      }
      m.dispose();
    }
  });
}

function freeSprite(sprite: THREE.Sprite): void {
  sprite.removeFromParent();
  sprite.material.map?.dispose();
  sprite.material.dispose();
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
  let assets = new Map<string, string>();
  let codes: THREE.Group[] = [];
  /** Each code's square and its morph. */
  let codeSquares: CodeSquare[] = [];
  /** Each code's point in the world, by its level id. */
  let codePoints = new Map<string, THREE.Vector3>();
  let shownNames = true;
  let shownCodes = true;
  let shown = new Set<string>();
  let renders = 0;
  /** What a drag shows now (`setPreview`). */
  let preview: LayerPreview | null = null;

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

  const freeContent = (entry: StationEntry) => {
    const content = entry.content;
    if (content === null) return;
    content.alive = false;
    for (const model of content.models) freeObject(model);
    content.rendered?.dispose();
    freeObject(content.ring);
    freeObject(content.pole);
    entry.content = null;
  };

  const freeStation = (entry: StationEntry) => {
    freeContent(entry);
    if (entry.billboard !== null) freeSprite(entry.billboard);
    entry.billboard = null;
    entry.root.removeFromParent();
  };

  const placeModels = async (entry: StationEntry, content: StationContent) => {
    for (const item of entry.station.items) {
      if (item.kind !== "model") continue;
      const path = assets.get(item.asset);
      if (path === undefined) continue;
      const model = await deps
        .loadContent(path)
        .then((blob) => deps.loadGlbModel(blob))
        .catch((): null => null);
      if (model === null) continue;
      if (!content.alive || content.rendered === null) {
        freeObject(model);
        return;
      }
      const scale = modelScale(model, item.sizeM);
      model.scale.setScalar(scale);
      model.position.set(...item.pose.position);
      model.quaternion.set(...item.pose.rotation);
      // Picked by its id; a preview of another size scales from here.
      model.userData["objectId"] = item.id;
      model.userData["tourScale"] = scale;
      model.userData["tourSizeM"] = item.sizeM;
      // In the station's frame, as its pins and photos are.
      content.rendered.root.add(model);
      content.models.push(model);
    }
  };

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
      models: [],
      ring,
      pole,
      photos: [],
    };
    entry.content = content;
    renders++;
    void renderTourStation(entry.station, {
      scene: entry.root,
      zero: { lat: entry.station.geo.lat, lon: entry.station.geo.lon },
      alive: () => content.alive,
      makeLabel: (text) => deps.makeLabel(text),
      loadPhotoTexture: (entryName) => deps.loadPhotoTexture(entryName),
    })
      .then(async (rendered) => {
        if (!content.alive) {
          rendered.dispose();
          return;
        }
        content.rendered = rendered;
        rendered.root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            content.photos.push({ mesh, upright: mesh.quaternion.clone() });
          }
        });
        await placeModels(entry, content);
      })
      .catch(() => {
        // A station whose items cannot be drawn keeps its billboard and
        // ring; the 2D view still lists them.
      });
  };

  const setCodes = (levels: ReadonlyMap<string, QrLevel>) => {
    for (const code of codes) freeObject(code);
    codes = [];
    codeSquares = [];
    codePoints = new Map();
    for (const [levelId, level] of levels) {
      const geo = level.qr.geo;
      if (geo === undefined) continue;
      const root = rootAt(geo);
      root.visible = shownCodes;
      const point = new THREE.Vector3(0, geo.alt, 0).applyMatrix4(
        root.matrixWorld,
      );
      codePoints.set(levelId, point);
      const sizeM = level.qr.physicalSizeM ?? DEFAULT_CODE_SIZE_M;
      const square = deps.makeCodeSquare(sizeM);
      square.userData["pick"] = levelId;
      square.position.set(0, geo.alt, 0);
      const upright = codeQuaternionNue(geo);
      square.quaternion.copy(upright);
      root.add(square);
      codes.push(root);
      codeSquares.push({
        square,
        upright,
        base: square.position.clone(),
        flatShift: flatShiftOf(upright, sizeM / 2 + CODE_FLAT_GAP_M),
        point: point.clone(),
      });
    }
  };

  const colourRing = (entry: StationEntry, view: StationsLayerView) => {
    const material = entry.content?.ring.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    const mine = entry.id === view.selectedStation;
    const selected = mine && view.stationSelected;
    material.color.setHex(
      selected ? RING_SELECTED : mine ? RING_CONTEXT : RING_COLOUR,
    );
    material.opacity = selected ? 1 : 0.85;
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
    entry.billboard.visible = shownNames;
    if (entry.content !== null) {
      entry.content.pole.scale.set(1, rise, 1);
      entry.content.pole.visible = shownNames;
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
      if (entry.station.items.some((i) => i.id === id)) return entry;
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

  /** Put an item's drawing at `pose` in its station (a model at `sizeM`;
   *  null: its tour size). */
  const poseDrawn = (
    entry: StationEntry,
    id: string,
    pose: {
      readonly position: readonly [number, number, number];
      readonly rotation: readonly [number, number, number, number];
    },
    sizeM: number | null,
  ) => {
    const turned = new THREE.Quaternion(...pose.rotation);
    for (const o of drawnOf(entry, id)) {
      o.position.set(...pose.position);
      const photo = entry.content?.photos.find((p) => p.mesh === o);
      if (photo !== undefined) {
        photo.upright.copy(turned);
        continue;
      }
      const tourScale: unknown = o.userData["tourScale"];
      const tourSizeM: unknown = o.userData["tourSizeM"];
      if (typeof tourScale !== "number" || typeof tourSizeM !== "number") {
        continue;
      }
      o.quaternion.copy(turned);
      o.scale.setScalar(tourScale * ((sizeM ?? tourSizeM) / tourSizeM));
    }
  };

  /** Draw `p` where the drag has it. */
  const applyPreview = (p: LayerPreview) => {
    if (p.kind === "station") {
      const entry = stations.get(p.id);
      if (entry === undefined) return;
      const shift = frameAt(p.geo, previewFrame).multiply(
        frameAt(entry.station.geo, tourFrame).invert(),
      );
      entry.root.matrix.multiplyMatrices(shift, entry.base);
      entry.root.updateMatrixWorld(true);
      entry.shownPoint.copy(entry.point).applyMatrix4(shift);
      const k = p.foundRadiusM / entry.station.foundRadiusM;
      entry.content?.ring.scale.set(k, 1, k);
      return;
    }
    const entry = entryOfItem(p.id);
    if (entry === null) return;
    poseDrawn(entry, p.id, localPoseOf(p.geo, entry.station.geo), p.sizeM);
  };

  /** Draw what `p` showed where the tour has it again. */
  const clearPreview = (p: LayerPreview) => {
    if (p.kind === "station") {
      const entry = stations.get(p.id);
      if (entry === undefined) return;
      entry.root.matrix.copy(entry.base);
      entry.root.updateMatrixWorld(true);
      entry.shownPoint.copy(entry.point);
      entry.content?.ring.scale.set(1, 1, 1);
      return;
    }
    const entry = entryOfItem(p.id);
    const item = entry?.station.items.find((i) => i.id === p.id);
    if (entry === null || item === undefined) return;
    poseDrawn(entry, p.id, item.pose, null);
  };

  return {
    group,
    /** Place every station and code of `manifest` (null: none). */
    setTour(
      manifest: TourManifest | null,
      levels: ReadonlyMap<string, QrLevel>,
    ) {
      assets = new Map((manifest?.assets ?? []).map((a) => [a.id, a.path]));
      const keep = new Set<string>();
      (manifest?.stations ?? []).forEach((station, index) => {
        keep.add(station.id);
        const key = keyOf(station, index);
        const old = stations.get(station.id);
        if (old?.key === key) return;
        if (old !== undefined) freeStation(old);
        const root = rootAt(station.geo);
        const point = new THREE.Vector3(0, station.geo.alt, 0).applyMatrix4(
          root.matrixWorld,
        );
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
        freeStation(entry);
        stations.delete(id);
      }
      setCodes(levels);
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
      for (const code of codeSquares) {
        const grown = codeGrowth(
          view.camera.distanceTo(code.point),
          view.standing,
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
    },
    /** Draw a drag's preview (null: none; what the last one showed is
     *  drawn where the tour has it again). */
    setPreview(next: LayerPreview | null) {
      if (preview !== null) clearPreview(preview);
      preview = next;
      if (next !== null) applyPreview(next);
    },
    /** The selection the ray meets first (`station:<id>`, an item's
     *  id, a code's level id), or null; rings and poles are none. */
    pick(raycaster: THREE.Raycaster): string | null {
      group.updateMatrixWorld();
      for (const hit of raycaster.intersectObject(group, true)) {
        if (!hit.object.visible) continue;
        const pick = pickOf(hit.object);
        if (pick !== null) return pick;
      }
      return null;
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
    /** A station's point in the world, or null. */
    pointOf(id: string): THREE.Vector3 | null {
      return stations.get(id)?.point.clone() ?? null;
    },
    /** A station's found radius (m), or null. */
    radiusOf(id: string): number | null {
      return stations.get(id)?.station.foundRadiusM ?? null;
    },
    /** Where an item of the tour stands in the world (its pose in its
     *  station's frame), whether its station draws its items now or not;
     *  null for an id no station holds. */
    itemPointOf(id: string): THREE.Vector3 | null {
      for (const entry of stations.values()) {
        const item = entry.station.items.find((i) => i.id === id);
        if (item === undefined) continue;
        const { geo } = entry.station;
        const frame = objectPoseNue(geo, { lat: geo.lat, lon: geo.lon });
        return new THREE.Vector3(...item.pose.position)
          .applyQuaternion(new THREE.Quaternion(...frame.rotationNue))
          .add(new THREE.Vector3(...frame.positionNue))
          .applyMatrix4(entry.root.matrixWorld);
      }
      return null;
    },
    /** Where a code with a position stands in the world, or null. */
    codePointOf(levelId: string): THREE.Vector3 | null {
      return codePoints.get(levelId)?.clone() ?? null;
    },
    /** The layer chips: the station names (billboards and their poles)
     *  and the codes shown or hidden. */
    setShown(layers: { readonly names: boolean; readonly codes: boolean }) {
      shownNames = layers.names;
      shownCodes = layers.codes;
      for (const code of codes) code.visible = shownCodes;
    },
    /** Whether the codes show (the page's checks). */
    codesVisible(): boolean {
      return shownCodes;
    },
    billboardOf(id: string): THREE.Sprite | null {
      return stations.get(id)?.billboard ?? null;
    },
    photoPlanes(id: string): THREE.Mesh[] {
      return (stations.get(id)?.content?.photos ?? []).map((p) => p.mesh);
    },
    models(id: string): THREE.Object3D[] {
      return [...(stations.get(id)?.content?.models ?? [])];
    },
    dispose() {
      for (const entry of stations.values()) freeStation(entry);
      stations.clear();
      for (const code of codes) freeObject(code);
      codes = [];
      codeSquares = [];
      group.removeFromParent();
    },
  };
}
