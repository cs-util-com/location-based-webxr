/**
 * The trunk-and-crown trees: an option beside the crown-only default (the
 * owner's "crown only (no trunk) as the default"). The woodland
 * prototype's look: a crown lifted onto a 5-sided trunk, drawn in two
 * levels by distance.
 *
 * WHY TWO LEVELS. A trunk adds triangles to every tree, so the trees within
 * `TREE_LOD_NEAR_M` of the eye get the finer crown (7 sides) and trunk
 * (5 sides), the rest a coarser pair (5 and 3): per tree 52 / 26 triangles
 * for a broad or untagged crown, 38 / 16 for a needle crown.
 *
 * WHY A RE-SORT RATHER THAN A SWAP PER FRAME. Each form has a near and a far
 * instanced mesh for its crowns and for its trunks; the trees are written
 * into the level their distance gives them, and that sort runs only when the
 * eye has moved `TREE_LOD_REPACK_M` since the last one: work over the
 * instance matrices, never over geometry, and none for a still camera.
 *
 * THE SAME MECHANICS AS THE STREET FURNITURE (`street-furniture.ts`): the
 * sort runs in `onBeforeRender` with the camera taken in the mesh's own
 * frame (a consumer may move the city under a parent), and `frustumCulled`
 * is off because `count` changes under three.
 *
 * THE WOODS SHARE. For invented trees only the first `ceil(total x share)`
 * trees in rank order take part in the sort (`setTreeLodShare`), so the
 * governor thins this form exactly as it thins the crown-only one.
 *
 * @see trunk-trees.ts.md
 */

import * as THREE from "three";

import {
  packInstances,
  type TreePlacement,
  type TreeVariant,
} from "../mesh/trees.js";
import { crownHull } from "./crown-hull.js";

/** Trees nearer than this to the eye are drawn in the near level, metres. */
export const TREE_LOD_NEAR_M = 120;
/** The eye must move this far before the levels are re-sorted, metres. */
export const TREE_LOD_REPACK_M = 2;

type Level = "near" | "far";
type Profile = readonly (readonly [number, number])[];

/**
 * The woodland prototype's crown profiles over the crown's own height,
 * `[y, radius]` at a unit DIAMETER (the prototype drew them at a unit
 * radius; halved here, as `city-objects.ts` scales by the crown diameter).
 * The far crowns are the crown-only forms.
 */
const PROFILES: Record<TreeVariant, Record<Level, Profile>> = {
  broadleaved: {
    near: [
      [0.22, 0.41],
      [0.52, 0.5],
      [0.82, 0.4],
    ],
    far: [
      [0.3, 0.45],
      [0.72, 0.43],
    ],
  },
  unknown: {
    near: [
      [0.24, 0.35],
      [0.56, 0.4],
      [0.85, 0.26],
    ],
    far: [
      [0.3, 0.38],
      [0.72, 0.33],
    ],
  },
  needleleaved: {
    near: [
      [0.1, 0.5],
      [0.48, 0.3],
    ],
    far: [[0.12, 0.5]],
  },
};
const CROWN_SIDES: Record<Level, number> = { near: 7, far: 5 };
const TRUNK_SIDES: Record<Level, number> = { near: 5, far: 3 };
/** Where the crown starts, as a share of the tree's height (as prototyped). */
const CROWN_BASE: Record<TreeVariant, number> = {
  broadleaved: 0.35,
  unknown: 0.33,
  needleleaved: 0.18,
};
/** How far the trunk runs into the crown, as a share of the crown's height. */
const TRUNK_INTO_CROWN = 0.25;
/** The trunks' colour, a muted bark grey-brown (packed sRGB, as prototyped). */
const TRUNK_RGB = 0x5e564d;

/** The trunk radius from the height: OSM rarely tags a girth (the prototyped rule). */
function trunkRadiusM(heightM: number): number {
  return Math.min(0.35, Math.max(0.1, 0.012 * heightM + 0.06));
}

/** An open prism from y 0 to 1 at radius 1: 2 x sides triangles. */
function prism(sides: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, sides, 1, true);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

/** Shared geometry and materials, made on first use; borrowed by every city. */
let resources:
  | {
      readonly crowns: Record<TreeVariant, Record<Level, THREE.BufferGeometry>>;
      readonly trunks: Record<Level, THREE.BufferGeometry>;
      readonly crownMaterial: THREE.MeshStandardMaterial;
      readonly trunkMaterial: THREE.MeshStandardMaterial;
    }
  | undefined;

function shared(): NonNullable<typeof resources> {
  if (resources !== undefined) return resources;
  const crowns = {} as Record<TreeVariant, Record<Level, THREE.BufferGeometry>>;
  for (const variant of Object.keys(PROFILES) as TreeVariant[]) {
    crowns[variant] = {
      near: crownHull(CROWN_SIDES.near, PROFILES[variant].near),
      far: crownHull(CROWN_SIDES.far, PROFILES[variant].far),
    };
  }
  resources = {
    crowns,
    trunks: { near: prism(TRUNK_SIDES.near), far: prism(TRUNK_SIDES.far) },
    // As the crown-only trees: white, vertex-coloured, flat.
    crownMaterial: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      flatShading: true,
      roughness: 0.9,
      metalness: 0,
    }),
    trunkMaterial: new THREE.MeshStandardMaterial({
      color: TRUNK_RGB,
      flatShading: true,
      roughness: 0.95,
      metalness: 0,
    }),
  };
  return resources;
}

/** Per mesh: its trees' matrices and centres, its level and the last sort. */
interface LodState {
  readonly level: Level;
  readonly part: "crown" | "trunk";
  readonly total: number;
  /** 16 per tree, shared by the near and far mesh of one part. */
  readonly matrices: Float32Array;
  /** Linear RGB per tree, crowns only. */
  readonly colours: Float32Array | undefined;
  /** x, y, z of each tree's middle, for the distance. */
  readonly centres: Float32Array;
  share: number;
  sortedAt: { x: number; y: number; z: number } | undefined;
}

const lodStates = new WeakMap<THREE.InstancedMesh, LodState>();

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const colour = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const cameraWorld = new THREE.Vector3();

/** One form's trees, laid out once for all four of its meshes. */
interface FormLayout {
  readonly total: number;
  readonly crownMatrices: Float32Array;
  readonly trunkMatrices: Float32Array;
  readonly colours: Float32Array;
  readonly centres: Float32Array;
}

/** `packInstances`' arrays for one form, as crown and trunk matrices. */
function layOut(
  variant: TreeVariant,
  packed: {
    readonly positions: Float32Array;
    readonly rotations: Float32Array;
    readonly scales: Float32Array;
    readonly colours: Float32Array;
  },
): FormLayout {
  const total = packed.rotations.length;
  const layout: FormLayout = {
    total,
    crownMatrices: new Float32Array(total * 16),
    trunkMatrices: new Float32Array(total * 16),
    colours: new Float32Array(total * 3),
    centres: new Float32Array(total * 3),
  };
  for (let i = 0; i < total; i++) {
    const [x, ground, z] = [0, 1, 2].map(
      (k) => packed.positions[i * 3 + k] ?? 0,
    ) as [number, number, number];
    const heightM = packed.scales[i * 2] ?? 1;
    const crownM = packed.scales[i * 2 + 1] ?? 1;
    const crownBaseM = heightM * CROWN_BASE[variant];
    const crownHeightM = heightM - crownBaseM;
    quaternion.setFromAxisAngle(UP, packed.rotations[i] ?? 0);
    position.set(x, ground + crownBaseM, z);
    scale.set(crownM, crownHeightM, crownM);
    matrix
      .compose(position, quaternion, scale)
      .toArray(layout.crownMatrices, i * 16);
    const r = trunkRadiusM(heightM);
    position.set(x, ground, z);
    scale.set(r, crownBaseM + crownHeightM * TRUNK_INTO_CROWN, r);
    matrix
      .compose(position, quaternion, scale)
      .toArray(layout.trunkMatrices, i * 16);
    colour
      .fromArray(packed.colours, i * 3)
      .setRGB(colour.r, colour.g, colour.b, THREE.SRGBColorSpace)
      .toArray(layout.colours, i * 3);
    layout.centres.set([x, ground + heightM / 2, z], i * 3);
  }
  return layout;
}

/** One of a form's four meshes, registered for its sorts. */
function lodMesh(
  variant: TreeVariant,
  layout: FormLayout,
  part: "crown" | "trunk",
  level: Level,
): THREE.InstancedMesh {
  const { crowns, trunks, crownMaterial, trunkMaterial } = shared();
  const crown = part === "crown";
  const mesh = new THREE.InstancedMesh(
    crown ? crowns[variant][level] : trunks[level],
    crown ? crownMaterial : trunkMaterial,
    layout.total,
  );
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.userData = {
    sharedResources: true,
    treeForm: "trunk",
    treePart: part,
    treeLevel: level,
  };
  lodStates.set(mesh, {
    level,
    part,
    total: layout.total,
    matrices: crown ? layout.crownMatrices : layout.trunkMatrices,
    colours: crown ? layout.colours : undefined,
    centres: layout.centres,
    share: 1,
    sortedAt: undefined,
  });
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(cameraWorld);
    repackTreeLod(mesh, mesh.worldToLocal(cameraWorld));
  };
  return mesh;
}

/**
 * Four instanced meshes per form present (crown and trunk, near and far),
 * each drawing nothing until its first sort (before its first render, or
 * `repackTreeLod`). Each carries `userData`: `sharedResources` (never
 * dispose), `treeForm: "trunk"`, `treePart` and `treeLevel`.
 */
export function trunkTreeObjects(
  placements: readonly TreePlacement[],
): THREE.InstancedMesh[] {
  const objects: THREE.InstancedMesh[] = [];
  for (const [variant, packed] of packInstances(placements)) {
    if (packed.rotations.length === 0) continue;
    const layout = layOut(variant, packed);
    for (const part of ["crown", "trunk"] as const) {
      for (const level of ["near", "far"] as const) {
        objects.push(lodMesh(variant, layout, part, level));
      }
    }
  }
  return objects;
}

/** Whether `eye` is within the re-sort distance of the last sort. */
function stillNear(
  last: { x: number; y: number; z: number } | undefined,
  eye: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  return (
    last !== undefined &&
    Math.hypot(eye.x - last.x, eye.y - last.y, eye.z - last.z) <
      TREE_LOD_REPACK_M
  );
}

/**
 * Writes the trees whose level is this mesh's into it, unless the eye (the
 * mesh's own frame, metres) is within `TREE_LOD_REPACK_M` of the last sort.
 * True when it sorted; false for a mesh this module did not make.
 */
export function repackTreeLod(
  mesh: THREE.InstancedMesh,
  eye: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  const state = lodStates.get(mesh);
  if (state === undefined) return false;
  if (stillNear(state.sortedAt, eye)) return false;
  state.sortedAt = { x: eye.x, y: eye.y, z: eye.z };
  const { centres, matrices, colours } = state;
  const wantNear = state.level === "near";
  const taking = Math.ceil(state.total * state.share);
  let slot = 0;
  for (let i = 0; i < taking; i++) {
    const distance = Math.hypot(
      (centres[i * 3] ?? 0) - eye.x,
      (centres[i * 3 + 1] ?? 0) - eye.y,
      (centres[i * 3 + 2] ?? 0) - eye.z,
    );
    if (distance < TREE_LOD_NEAR_M !== wantNear) continue;
    mesh.instanceMatrix.array.set(
      matrices.subarray(i * 16, i * 16 + 16),
      slot * 16,
    );
    if (colours !== undefined) {
      colour.fromArray(colours, i * 3);
      mesh.setColorAt(slot, colour);
    }
    slot += 1;
  }
  mesh.count = slot;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  return true;
}

/**
 * Sets the share of a trunk-form mesh's trees that take part in its sort,
 * and makes the next sort run whatever the eye did. The trees this share
 * draws, counted once per form (on its near crown mesh, 0 on the other
 * three), or undefined for a mesh this module did not make. `share` is
 * validated by the caller (`applyWoodsShare`).
 */
export function setTreeLodShare(
  mesh: THREE.InstancedMesh,
  share: number,
): number | undefined {
  const state = lodStates.get(mesh);
  if (state === undefined) return undefined;
  state.share = share;
  state.sortedAt = undefined;
  return state.part === "crown" && state.level === "near"
    ? Math.ceil(state.total * share)
    : 0;
}
