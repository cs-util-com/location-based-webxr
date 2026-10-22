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
 * lie flat face up and stand up again, and the billboards and their poles
 * rise. Models keep their pose.
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
 * @see editor3d-stations.ts.md
 */
import * as THREE from "three";

import { localPlaneToEnu } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
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
  /** How upright pins and photos stand (`morphStanding`). */
  readonly standing: number;
}

/** A code's printed side when the tour does not say (m). */
export const DEFAULT_CODE_SIZE_M = 0.2;

/** How much higher a billboard stands upright than flat (m): the pole. */
export const BILLBOARD_LIFT_M = 4.6;

/** A billboard's height over its station when flat (m). */
const BILLBOARD_BASE_M = 0.6;

const RING_COLOUR = 0x6fa8dc;
const POLE_COLOUR = 0xdfe3ea;

interface StationContent {
  alive: boolean;
  rendered: RenderedTourObjects | null;
  readonly models: THREE.Object3D[];
  readonly ring: THREE.Mesh;
  readonly pole: THREE.Mesh;
  /** Each photo plane and its upright quaternion. */
  readonly photos: { mesh: THREE.Mesh; upright: THREE.Quaternion }[];
}

interface StationEntry {
  readonly id: string;
  readonly index: number;
  readonly key: string;
  readonly station: TourStation;
  readonly root: THREE.Group;
  /** The station's point in the world. */
  readonly point: THREE.Vector3;
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
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: RING_COLOUR,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
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
  /** Each code's point in the world, by its level id. */
  let codePoints = new Map<string, THREE.Vector3>();
  let shownNames = true;
  let shownCodes = true;
  let shown = new Set<string>();
  let renders = 0;

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
      model.scale.setScalar(modelScale(model, item.sizeM));
      model.position.set(...item.pose.position);
      model.quaternion.set(...item.pose.rotation);
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
    codePoints = new Map();
    for (const [levelId, level] of levels) {
      const geo = level.qr.geo;
      if (geo === undefined) continue;
      const root = rootAt(geo);
      root.visible = shownCodes;
      codePoints.set(
        levelId,
        new THREE.Vector3(0, geo.alt, 0).applyMatrix4(root.matrixWorld),
      );
      const square = deps.makeCodeSquare(
        level.qr.physicalSizeM ?? DEFAULT_CODE_SIZE_M,
      );
      square.position.set(0, geo.alt, 0);
      square.quaternion.copy(codeQuaternionNue(geo));
      root.add(square);
      codes.push(root);
    }
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
      group.add(entry.billboard);
    }
    const rise = BILLBOARD_BASE_M + BILLBOARD_LIFT_M * view.standing;
    entry.billboard.position.copy(entry.point).setY(entry.point.y + rise);
    entry.billboard.visible = shownNames;
    if (entry.content !== null) {
      entry.content.pole.scale.set(1, rise, 1);
      entry.content.pole.visible = shownNames;
    }
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
          point,
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
        placeBillboard(entry, view);
        for (const photo of entry.content?.photos ?? []) {
          photo.mesh.quaternion.slerpQuaternions(
            flatOf(photo.upright, flatQ),
            photo.upright,
            view.standing,
          );
        }
      }
    },
    /** For the page's checks: the stations and what is drawn. */
    stats() {
      return {
        stations: stations.size,
        codes: codes.length,
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
      group.removeFromParent();
    },
  };
}
