/**
 * Why these tests matter: the shelf saves a model's coarser levels in
 * `primitive.extras.lod`, and only the loader turns them into something
 * the frame uses: the chain as the index list, the finest level drawn
 * until a frame says otherwise, and a coarser level for a far camera. A
 * file without levels must load exactly as before. Run through the real
 * optimizer and three's real GLTFLoader, so the quantized child node's
 * scale is part of what is measured.
 */
import { describe, expect, it } from "vitest";
import type { Camera, Mesh, Object3D } from "three";
import { PerspectiveCamera } from "three";

import { optimizeModel } from "./editor/asset-shelf/model-step.js";
import { OPTIMIZER_SETTINGS } from "./editor/asset-shelf/optimizer-settings.js";
import { fakePictureDevice } from "./editor/asset-shelf/test-support/fake-picture-device.js";
import { buildModel } from "./editor/asset-shelf/test-support/glb-fixtures.js";
import { heightField } from "./editor/asset-shelf/test-support/meshes.js";
import { loadGlbModel } from "./glb-model.js";

async function bumpyField(): Promise<Uint8Array> {
  const mesh = heightField(
    48,
    (u, v) =>
      0.08 * Math.sin(7 * u) * Math.cos(5 * v) + 0.02 * Math.sin(23 * u),
  );
  return buildModel({
    meshes: [
      {
        name: "field",
        positions: mesh.positions as Float32Array<ArrayBuffer>,
        normals: mesh.normals as Float32Array<ArrayBuffer>,
        texcoords: mesh.uvs as Float32Array<ArrayBuffer>,
        indices: mesh.indices as Uint32Array<ArrayBuffer>,
      },
    ],
  });
}

const blobOf = (bytes: Uint8Array) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" });

async function optimized(source: Uint8Array): Promise<Blob> {
  const answer = await optimizeModel(
    blobOf(source),
    OPTIMIZER_SETTINGS,
    { signal: new AbortController().signal, progress: () => {} },
    fakePictureDevice().device,
  );
  if (answer.type !== "done") throw new Error(answer.type);
  return answer.blob;
}

function onlyMesh(scene: Object3D): Mesh {
  const meshes: Mesh[] = [];
  scene.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  expect(meshes).toHaveLength(1);
  return meshes[0]!;
}

/** What a frame does before drawing `mesh` from `camera`. */
function frame(mesh: Mesh, camera: Camera, height = 1000): void {
  const renderer = {
    getRenderTarget: () => null,
    domElement: { height },
  };
  mesh.onBeforeRender(
    renderer as never,
    null as never,
    camera,
    mesh.geometry,
    mesh.material as never,
    null as never,
  );
}

function cameraAt(distance: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 0.01, 1e5);
  camera.position.set(0.5, distance, 0.5);
  camera.lookAt(0.5, 0, 0.5);
  camera.updateMatrixWorld(true);
  return camera;
}

describe("loadGlbModel", { timeout: 30_000 }, () => {
  it("draws a saved chain: the finest level first and up close, a coarser one far away", async () => {
    const scene = await loadGlbModel(await optimized(await bumpyField()));
    scene.updateMatrixWorld(true);
    const mesh = onlyMesh(scene);
    const geometry = mesh.geometry;
    const lod = geometry.userData["lod"] as {
      levels: { start: number; count: number }[];
    };
    expect(lod.levels.length).toBeGreaterThan(1);
    const last = lod.levels.at(-1)!;
    expect(geometry.index!.count).toBe(last.start + last.count);
    expect(geometry.drawRange).toEqual({
      start: 0,
      count: lod.levels[0]!.count,
    });

    frame(mesh, cameraAt(0.3));
    expect(geometry.drawRange.count).toBe(lod.levels[0]!.count);
    frame(mesh, cameraAt(500));
    expect(geometry.drawRange).toEqual({
      start: last.start,
      count: last.count,
    });
    // and back when the camera returns
    frame(mesh, cameraAt(0.3));
    expect(geometry.drawRange).toEqual({
      start: 0,
      count: lod.levels[0]!.count,
    });
  });

  it("loads a file without saved levels as before", async () => {
    const source = await bumpyField();
    const scene = await loadGlbModel(blobOf(source));
    const mesh = onlyMesh(scene);
    expect(mesh.geometry.userData["lod"]).toBeUndefined();
    expect(mesh.geometry.index!.count).toBe(48 * 48 * 2 * 3);
    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    frame(mesh, cameraAt(500));
    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: Infinity });
  });
});
