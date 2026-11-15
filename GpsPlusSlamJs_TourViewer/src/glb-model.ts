/**
 * A tour's `.glb` model as a three scene: three's GLTFLoader, imported on
 * first use (no page pays for it until a model is drawn), parsing the
 * bytes with no base path, so the file reaches nothing outside itself. The
 * tour session has already checked the file inert (no external URIs, no
 * decoders: `checkGlbInert`). One loader for the phone (through
 * `seams.ts`) and the desktop editor's 3D view.
 *
 * A primitive the asset shelf gave coarser levels (`extras.lod`, read by
 * `glb-lod.ts`) draws through its chain: each frame picks the coarsest
 * level whose deviation stays under a pixel on screen. The shadow pass
 * casts the level the frame picked; a pick (raycast) hits the author's
 * level; an instanced mesh always draws the author's level.
 *
 * @see glb-model.ts.md
 */
import type {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Intersection,
  Mesh,
  Object3D,
  WebGLRenderer,
} from "three";

import {
  type LodLevel,
  levelsFit,
  lodOf,
  pickLevel,
  pixelsPerUnit,
} from "./glb-lod.js";

/** The model in `blob`; rejects when three cannot parse it. */
export async function loadGlbModel(blob: Blob): Promise<Object3D> {
  const { GLTFLoader } =
    await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(await blob.arrayBuffer(), "");
  // The clips ride on the scene, where a model view finds them.
  gltf.scene.animations = gltf.animations;
  await useSavedLevels(gltf.scene, (index) =>
    gltf.parser.getDependency("accessor", index),
  );
  return gltf.scene;
}

/** Each mesh with well-formed saved levels draws through its chain. A
 *  geometry several meshes share gets its chain once. */
async function useSavedLevels(
  scene: Object3D,
  accessor: (index: number) => Promise<unknown>,
): Promise<void> {
  const meshes: Mesh[] = [];
  scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  const chains = new Map<BufferGeometry, readonly LodLevel[] | null>();
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    if (!chains.has(geometry)) {
      chains.set(geometry, await chainOf(geometry, accessor));
    }
    const levels = chains.get(geometry);
    if (levels) drawThroughChain(mesh, levels);
  }
}

/** Hooks `mesh` to its chain. The draw range lives on the geometry, which
 *  several meshes may share and which the shadow pass and a raycast read
 *  too, so each of those sets the range it needs before it reads it. */
function drawThroughChain(mesh: Mesh, levels: readonly LodLevel[]): void {
  const authors = levels[0]!;
  // One range for every instance: a level picked for the instance at the
  // origin would thin the near ones, so an instanced mesh draws the
  // author's level.
  const instanced = (mesh as { isInstancedMesh?: boolean }).isInstancedMesh;
  let picked = authors;
  mesh.onBeforeRender = (renderer, _scene, camera, geometry) => {
    picked = instanced
      ? authors
      : levels[
          pickLevel(levels, pixelsPerDiagonal(mesh, camera, renderer, geometry))
        ]!;
    geometry.setDrawRange(picked.start, picked.count);
  };
  mesh.onBeforeShadow = (_r, _s, _c, _sc, geometry) => {
    geometry.setDrawRange(picked.start, picked.count);
  };
  const raycast = mesh.raycast.bind(mesh);
  mesh.raycast = (raycaster, hits: Intersection[]) => {
    const { start, count } = mesh.geometry.drawRange;
    mesh.geometry.setDrawRange(authors.start, authors.count);
    try {
      raycast(raycaster, hits);
    } finally {
      mesh.geometry.setDrawRange(start, count);
    }
  };
}

/** Sets `geometry`'s index to its saved chain, drawing the finest level;
 *  null (and nothing changed) when there is none or it does not fit. */
async function chainOf(
  geometry: BufferGeometry,
  accessor: (index: number) => Promise<unknown>,
): Promise<readonly LodLevel[] | null> {
  const lod = lodOf(geometry.userData["lod"]);
  if (lod === null || geometry.index === null) return null;
  const chain = (await accessor(lod.indices).catch(
    () => null,
  )) as BufferAttribute | null;
  if (
    !chain ||
    chain.itemSize !== 1 ||
    !isIndexList(chain.array) ||
    !levelsFit(lod.levels, chain.count)
  ) {
    return null;
  }
  const finest = lod.levels[0]!;
  geometry.setIndex(chain);
  geometry.setDrawRange(finest.start, finest.count);
  return lod.levels;
}

/** An index list is unsigned integers; a float accessor named as the
 *  chain is refused. */
function isIndexList(array: unknown): boolean {
  return (
    array instanceof Uint8Array ||
    array instanceof Uint16Array ||
    array instanceof Uint32Array
  );
}

/** Pixels the mesh's world-space box diagonal covers, at the distance
 *  from the camera to the near side of its bounding sphere (so a camera
 *  inside it gets the finest level). */
function pixelsPerDiagonal(
  mesh: Mesh,
  camera: Camera,
  renderer: WebGLRenderer,
  geometry: BufferGeometry,
): number {
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  const box = geometry.boundingBox!;
  const sphere = geometry.boundingSphere!;
  const m = mesh.matrixWorld.elements;
  const scale = mesh.matrixWorld.getMaxScaleOnAxis();
  const diagonal = box.min.distanceTo(box.max) * scale;
  const { x, y, z } = sphere.center;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
  const e = camera.matrixWorld.elements;
  const depth =
    Math.hypot(cx - e[12], cy - e[13], cz - e[14]) - sphere.radius * scale;
  const height =
    renderer.getRenderTarget()?.height ?? renderer.domElement.height;
  return (
    diagonal * pixelsPerUnit(camera.projectionMatrix.elements, height, depth)
  );
}
