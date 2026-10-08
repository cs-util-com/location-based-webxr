/**
 * The city as three.js objects: the buildings' chunks as meshes and the trees
 * as instanced meshes, plus the disposal both need.
 *
 * WHY A SUBPATH. The package's core is pure data with no three.js (its
 * builders return typed arrays). When the globe lab became its second
 * consumer (globe city plan 2026-10-05-0040 §14 L5, the owner's D-K6), the
 * three.js conversion OsmDemo's `mesh-layers.ts` held for buildings and trees
 * was the part both apps needed, so it moved here, behind
 * `gps-plus-slam-osm/three`, with three.js an optional peer: a consumer of
 * the data alone never loads it.
 *
 * @see city-objects.ts.md
 */

import * as THREE from "three";

import type { MeshChunk } from "../mesh/chunk-meshes.js";
import type { MeshData } from "../mesh/mesh-data.js";
import {
  packInstances,
  type TreePlacement,
  type TreeVariant,
} from "../mesh/trees.js";

/**
 * Wraps a builder's buffers in a geometry. The buffers are already validated.
 *
 * - `colors`: per-vertex RGB, when the layer is coloured per feature. A chunk
 *   is ONE draw call and stays one, so a chunk holding a hundred buildings of
 *   twelve classes cannot use a per-material colour; per-vertex keeps both.
 * - `shell`: the AR shell shader's two per-vertex inputs. Attached whenever
 *   present, not only while AR runs: the geometry is reused across an AR
 *   entry and exit, so attaching them lazily would mean rebuilding the city
 *   to switch material.
 */
export function geometryFrom(
  data: MeshData,
  colors?: Float32Array,
  shell?: {
    height01?: Float32Array | undefined;
    featureRand?: Float32Array | undefined;
  },
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(data.positions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  if (colors !== undefined) {
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  if (shell?.height01 !== undefined) {
    geometry.setAttribute(
      "aHeight01",
      new THREE.BufferAttribute(shell.height01, 1),
    );
  }
  if (shell?.featureRand !== undefined) {
    geometry.setAttribute(
      "aFeatureRand",
      new THREE.BufferAttribute(shell.featureRand, 1),
    );
  }
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geometry;
}

/**
 * One mesh per building chunk, each frustum-culled on its own.
 *
 * A MATERIAL PER CHUNK, deliberately: identical materials share one compiled
 * program in three, so the cost is a small object per chunk and never a draw
 * call. A hoisted shared material is either disposed on the first refresh or
 * drags a chunk's own geometry into a leak (`disposeCityObjects` skips an
 * object wholesale when it carries `sharedResources`).
 *
 * The material, as OsmDemo settled it:
 * - WHITE plus VERTEX COLOURS: the class and material palette arrives per
 *   vertex; a non-white base would tint every colour in it.
 * - `userData.neutralSurface`: the target of OsmDemo's noon brightening.
 * - SINGLE-SIDED: the winding is proved (`mesh-orientation.test.ts`), so
 *   double-siding would only hide a genuinely missing floor, at twice the
 *   fragment work on the largest mesh in the scene.
 * - Flat-shaded, roughness 0.55 and metalness 0: facades catch a highlight as
 *   the sun moves, and stay clear of the ground's 0.42 (a guard keeps
 *   buildings above 0.5 so they never read as glass).
 *
 * Each mesh carries `userData.solid`: a blocker for picking (a click on a
 * facade resolves to nothing rather than to the ground behind it). Per chunk,
 * so it cannot say which building in it is passable (a canopy is drawn and
 * still swallows the click; filed in OsmDemo).
 */
export function buildingObjects(chunks: readonly MeshChunk[]): THREE.Mesh[] {
  return chunks.map((chunk) => {
    const object = new THREE.Mesh(
      geometryFrom(chunk.mesh, chunk.colors, {
        height01: chunk.height01,
        featureRand: chunk.featureRand,
      }),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        userData: { neutralSurface: true },
        vertexColors: true,
        side: THREE.FrontSide,
        flatShading: true,
        roughness: 0.55,
        metalness: 0,
      }),
    );
    object.userData["solid"] = true;
    return object;
  });
}

/** The trees' shared geometry per variant and material, made on first use. */
let treeResources:
  | {
      readonly geometry: Record<TreeVariant, THREE.BufferGeometry>;
      readonly material: THREE.MeshStandardMaterial;
    }
  | undefined;

/**
 * The shared tree resources, created on the first call rather than at import,
 * so importing this module costs nothing.
 *
 * Unit geometries scaled per instance: a cone for needleleaved (and unknown,
 * which keeps what was drawn before the leaf type was read), a level-0
 * icosahedron for broadleaved. Segment counts are low on purpose: this is an
 * AR overlay before it is a desktop scene, so a thousand trees stay
 * affordable, and the flat-shaded low-polygon look is the house style.
 */
function trees(): NonNullable<typeof treeResources> {
  if (treeResources !== undefined) return treeResources;
  // Radius 0.5 and height 1, translated up by half: x,z in [-0.5, 0.5], y in
  // [0, 1], a unit cube's worth, scaled per tree.
  const needle = new THREE.ConeGeometry(0.5, 1, 6);
  needle.translate(0, 0.5, 0);
  const broad = new THREE.IcosahedronGeometry(0.5, 0);
  broad.translate(0, 0.5, 0);
  treeResources = {
    geometry: { needleleaved: needle, broadleaved: broad, unknown: needle },
    material: new THREE.MeshStandardMaterial({
      color: 0x3f7d4a,
      flatShading: true,
      roughness: 0.8,
    }),
  };
  return treeResources;
}

const treeMatrix = new THREE.Matrix4();
const treePosition = new THREE.Vector3();
const treeQuaternion = new THREE.Quaternion();
const treeScale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Writes each tree's instance matrix from `packInstances`' arrays: the
 * position (already reflected to scene axes), a rotation about the vertical,
 * and a (crown, height, crown) scale. `scales` is [heightM, crownDiameterM]
 * per instance; the unit crown spans x,z in [-0.5, 0.5], so the diameter is
 * the horizontal scale.
 */
function setTreeMatrices(
  instanced: THREE.InstancedMesh,
  packed: {
    readonly positions: Float32Array;
    readonly rotations: Float32Array;
    readonly scales: Float32Array;
  },
): void {
  for (let i = 0; i < instanced.count; i++) {
    treePosition.set(
      packed.positions[i * 3] ?? 0,
      packed.positions[i * 3 + 1] ?? 0,
      packed.positions[i * 3 + 2] ?? 0,
    );
    const heightM = packed.scales[i * 2] ?? 1;
    const crownM = packed.scales[i * 2 + 1] ?? 1;
    treeScale.set(crownM, heightM, crownM);
    treeQuaternion.setFromAxisAngle(UP, packed.rotations[i] ?? 0);
    instanced.setMatrixAt(
      i,
      treeMatrix.compose(treePosition, treeQuaternion, treeScale),
    );
  }
}

/**
 * One instanced mesh per tree variant present. `packInstances` groups by
 * variant and applies the ENU-to-scene reflection itself. Each carries
 * `userData.sharedResources`: its geometry and material serve every later
 * city, and three.js does not throw for a disposed geometry, it silently draws
 * nothing.
 */
export function treeObjects(
  placements: readonly TreePlacement[],
): THREE.InstancedMesh[] {
  const objects: THREE.InstancedMesh[] = [];
  if (placements.length === 0) return objects;
  const { geometry, material } = trees();
  for (const [variant, packed] of packInstances(placements)) {
    const count = packed.rotations.length;
    if (count === 0) continue;
    const instanced = new THREE.InstancedMesh(
      geometry[variant],
      material,
      count,
    );
    setTreeMatrices(instanced, packed);
    instanced.instanceMatrix.needsUpdate = true;
    instanced.userData = { sharedResources: true };
    objects.push(instanced);
  }
  return objects;
}

/** The buildings and trees of a city (`buildCity`), as three.js objects. */
export function cityObjects(city: {
  readonly buildings: readonly MeshChunk[];
  readonly trees: readonly TreePlacement[];
}): THREE.Object3D[] {
  return [...buildingObjects(city.buildings), ...treeObjects(city.trees)];
}

/**
 * Frees what each object owns: its geometry and material(s). An object
 * carrying `userData.sharedResources` is skipped whole, because what it
 * holds is shared with every later city.
 */
export function disposeCityObjects(objects: Iterable<THREE.Object3D>): void {
  for (const object of objects) {
    if (object.userData["sharedResources"] === true) continue;
    if (!(object instanceof THREE.Mesh)) continue;
    // `instanceof` narrows to three's `Mesh<any, any>`; name the types.
    const mesh = object as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material | THREE.Material[]
    >;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) material.dispose();
  }
}
