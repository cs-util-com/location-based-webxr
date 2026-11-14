/**
 * Street furniture as three.js objects: one instanced mesh per model (mast
 * lamp, wall lamp, hung lamp, bollard, bench, bin) on shared geometry and
 * material, drawing only the items within a cut around the eye.
 *
 * WHY A CUT. A city has hundreds of lamps and bollards, each a few
 * centimetres of screen beyond a street or two. Drawing all of them costs
 * vertices for nothing; the items within the cut are packed to the front of
 * each mesh and `count` is set, which is work over a few hundred matrices
 * and never over geometry.
 *
 * WHY THE EYE IS TAKEN IN THE MESH'S OWN FRAME. A consumer may move or turn
 * the city under a parent (OsmDemo's content root). The cut is a distance in
 * the city's ENU metres, so the camera is converted into the mesh's local
 * frame before measuring; the world position would cut the wrong street.
 *
 * WHY `frustumCulled` IS OFF. `count` changes under three, so its bounding
 * sphere is never right; and `onBeforeRender`, where the repack runs, is
 * only called for an object that was not culled.
 *
 * @see street-furniture.ts.md
 */

import * as THREE from "three";

import type { MeshData } from "../mesh/mesh-data.js";
import { poiModelFor } from "../mesh/poi-models.js";
import { box, composed, postWithHead, prism } from "../mesh/poi-primitives.js";
import {
  FURNITURE_DEFAULT_HEIGHT_M,
  furnitureWithinCut,
  type FurnitureModel,
  type FurniturePlacement,
} from "../mesh/street-furniture.js";
import type { EnuPoint } from "../mesh/enu.js";
import { geometryFrom } from "./city-objects.js";

/** Items further than this from the eye are not drawn, metres. */
export const FURNITURE_CUT_M = 80;
/** The eye must move this far before the items are repacked, metres. */
export const FURNITURE_REPACK_M = 4;

/** The lamps' fixed colour, a dark steel grey (packed sRGB). */
const LAMP_RGB = 0x5a6167;
/** The bollards' fixed colour, a lighter steel grey (packed sRGB). */
const BOLLARD_RGB = 0x676d73;

export interface StreetFurnitureOptions {
  /** Default `FURNITURE_CUT_M`; `Infinity` draws every item. Positive. */
  readonly cutM?: number;
  /** Default `FURNITURE_REPACK_M`. Positive. */
  readonly repackM?: number;
}

/** A model's mesh, colour, and the height it is built at (stretched from). */
interface FurnitureModelSource {
  readonly mesh: MeshData;
  readonly colour: number;
  /** Built height for a stretchable model; undefined draws at own size. */
  readonly heightM: number | undefined;
}

function modelSource(model: FurnitureModel): FurnitureModelSource {
  const H = FURNITURE_DEFAULT_HEIGHT_M;
  switch (model) {
    case "lamp":
      return {
        mesh: composed((b) => postWithHead(b, H.lamp, 0.07, 0.36, 0.16)),
        colour: LAMP_RGB,
        heightM: H.lamp,
      };
    case "lamp-wall":
      return {
        mesh: composed((b) => box(b, 0.32, 0.16, 0.32, H["lamp-wall"] - 0.16)),
        colour: LAMP_RGB,
        heightM: H["lamp-wall"],
      };
    case "lamp-suspended":
      return {
        mesh: composed((b) =>
          box(b, 0.4, 0.16, 0.4, H["lamp-suspended"] - 0.16),
        ),
        colour: LAMP_RGB,
        heightM: H["lamp-suspended"],
      };
    case "bollard":
      return {
        mesh: composed((b) => prism(b, 0.1, 0.085, H.bollard, 6)),
        colour: BOLLARD_RGB,
        heightM: H.bollard,
      };
    case "bench":
    case "bin":
      return poiSource(
        model === "bench" ? "amenity=bench" : "amenity=waste_basket",
      );
  }
}

function poiSource(kind: string): FurnitureModelSource {
  const model = poiModelFor(kind);
  if (model === undefined) throw new Error(`no POI model for ${kind}`);
  return { mesh: model.mesh, colour: model.colour, heightM: undefined };
}

/** Shared per model, made on first use; borrowed by every city. */
const resources = new Map<
  FurnitureModel,
  {
    readonly geometry: THREE.BufferGeometry;
    readonly material: THREE.MeshStandardMaterial;
    readonly heightM: number | undefined;
  }
>();

function resourcesFor(model: FurnitureModel) {
  const cached = resources.get(model);
  if (cached !== undefined) return cached;
  const source = modelSource(model);
  const colours = source.mesh.colours;
  const made = {
    geometry: geometryFrom(source.mesh, colours),
    // The colour is sRGB; three converts a material colour to its working
    // space. Per-face paint (a bench's seat) multiplies it.
    material: new THREE.MeshStandardMaterial({
      color: source.colour,
      ...(colours === undefined ? {} : { vertexColors: true }),
      roughness: 0.75,
      metalness: 0,
      flatShading: true,
    }),
    heightM: source.heightM,
  };
  resources.set(model, made);
  return made;
}

/** Per mesh: its items, their matrices, the cut and the last packed eye. */
interface PackState {
  readonly items: readonly FurniturePlacement[];
  readonly matrices: readonly THREE.Matrix4[];
  readonly cutM: number;
  readonly repackM: number;
  packedAt: EnuPoint | undefined;
}

const packStates = new WeakMap<THREE.InstancedMesh, PackState>();

function positive(value: number, name: string): number {
  if (!(value > 0)) {
    throw new RangeError(`${name} must be positive, got ${value}`);
  }
  return value;
}

/**
 * One instanced mesh per model present in `placements`, in first-seen
 * order, each drawing nothing until its first repack (before its first
 * render, or `repackFurniture`). Each carries `userData`:
 * `sharedResources` (never dispose), `cityLayer: "furniture"`,
 * `furnitureModel`, and `guessed` (per instance, what the map did not say).
 * RangeError for a cut or repack distance that is not positive.
 */
export function streetFurnitureObjects(
  placements: readonly FurniturePlacement[],
  options: StreetFurnitureOptions = {},
): THREE.InstancedMesh[] {
  const cutM = positive(options.cutM ?? FURNITURE_CUT_M, "cutM");
  const repackM = positive(options.repackM ?? FURNITURE_REPACK_M, "repackM");
  const byModel = new Map<FurnitureModel, FurniturePlacement[]>();
  for (const item of placements) {
    const list = byModel.get(item.model) ?? [];
    list.push(item);
    byModel.set(item.model, list);
  }
  const objects: THREE.InstancedMesh[] = [];
  for (const [model, items] of byModel) {
    const { geometry, material, heightM } = resourcesFor(model);
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.userData = {
      sharedResources: true,
      cityLayer: "furniture",
      furnitureModel: model,
      guessed: items.map((item) => ({ key: item.key, fields: item.guessed })),
    };
    packStates.set(mesh, {
      items,
      matrices: items.map((item) => matrixOf(item, heightM)),
      cutM,
      repackM,
      packedAt: undefined,
    });
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      repackFurniture(mesh, eyeInFrame(mesh, camera));
    };
    objects.push(mesh);
  }
  return objects;
}

const UP = new THREE.Vector3(0, 1, 0);

function matrixOf(
  item: FurniturePlacement,
  builtHeightM: number | undefined,
): THREE.Matrix4 {
  const stretch =
    builtHeightM !== undefined && item.heightM !== undefined
      ? item.heightM / builtHeightM
      : 1;
  return new THREE.Matrix4().compose(
    // ENU north to scene -z, as every city buffer.
    new THREE.Vector3(item.position.x, item.groundHeightM, -item.position.y),
    new THREE.Quaternion().setFromAxisAngle(UP, item.yawRad),
    new THREE.Vector3(1, stretch, 1),
  );
}

const cameraWorld = new THREE.Vector3();

/** The camera's plan position in the mesh's own ENU frame. */
function eyeInFrame(mesh: THREE.Object3D, camera: THREE.Camera): EnuPoint {
  camera.getWorldPosition(cameraWorld);
  const local = mesh.worldToLocal(cameraWorld);
  return { x: local.x, y: -local.z };
}

/**
 * Packs the items within the cut of `eye` (the mesh's own ENU metres) to
 * the front and sets `count`, unless the eye is within the repack distance
 * of the last packed eye. True when it repacked. A mesh this module did not
 * make is left alone (false).
 */
export function repackFurniture(
  mesh: THREE.InstancedMesh,
  eye: EnuPoint,
): boolean {
  const state = packStates.get(mesh);
  if (state === undefined) return false;
  const last = state.packedAt;
  if (
    last !== undefined &&
    Math.hypot(eye.x - last.x, eye.y - last.y) < state.repackM
  ) {
    return false;
  }
  state.packedAt = { x: eye.x, y: eye.y };
  const keep = furnitureWithinCut(state.items, eye, state.cutM);
  keep.forEach((index, slot) => {
    mesh.setMatrixAt(slot, state.matrices[index] as THREE.Matrix4);
  });
  mesh.count = keep.length;
  mesh.instanceMatrix.needsUpdate = true;
  return true;
}
