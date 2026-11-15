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
import type { Camera, Intersection, Mesh, Object3D } from "three";
import { PerspectiveCamera, Raycaster, Vector3 } from "three";

import {
  type GltfObject,
  appendView,
  readGlb,
  writeGlb,
} from "./editor/asset-shelf/glb-file.js";

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

/** The field made smaller once: every test that reads a chain shares it,
 *  so the optimizer, the costly part, runs once per file. */
let made: Promise<Blob> | null = null;
const optimizedField = () => (made ??= bumpyField().then(optimized));

/** The optimized field's file with `change` made to its JSON (and
 *  views), as a file the loader reads. */
async function changed(
  change: (json: GltfObject, add: (bytes: Uint8Array) => number) => void,
): Promise<Blob> {
  const read = readGlb(
    new Uint8Array(await (await optimizedField()).arrayBuffer()),
  );
  if (!read.ok) throw new Error(read.reason);
  change(read.parts.json, (bytes) => appendView(read.parts, bytes));
  return blobOf(writeGlb(read.parts));
}

function lodOf(mesh: Mesh) {
  return mesh.geometry.userData["lod"] as {
    levels: { start: number; count: number }[];
  };
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
    const scene = await loadGlbModel(await optimizedField());
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

  // Why: three draws the shadow pass with the geometry's draw range too,
  // and a geometry several meshes share holds the range the last of them
  // set; the shadow must be cast by the level this mesh draws.
  it("casts its shadow with the level it draws", async () => {
    const mesh = onlyMesh(await loadGlbModel(await optimizedField()));
    mesh.parent!.updateMatrixWorld(true);
    const { levels } = lodOf(mesh);
    const last = levels.at(-1)!;
    frame(mesh, cameraAt(500));
    mesh.geometry.setDrawRange(0, 3); // another mesh drew last
    mesh.onBeforeShadow(
      null as never,
      null as never,
      cameraAt(500),
      cameraAt(500),
      mesh.geometry,
      null as never,
      null as never,
    );
    expect(mesh.geometry.drawRange).toEqual({
      start: last.start,
      count: last.count,
    });
  });

  // Why: a pick (a raycast) reads the draw range as well; it must hit the
  // author's level whatever level the last frame drew, and leave the
  // frame's range as it was.
  it("is picked at the author's level whatever level it draws", async () => {
    const mesh = onlyMesh(await loadGlbModel(await optimizedField()));
    mesh.parent!.updateMatrixWorld(true);
    const { levels } = lodOf(mesh);
    const last = levels.at(-1)!;
    const pick = (): Intersection[] => {
      const hits: Intersection[] = [];
      for (const [x, z] of [
        [0.31, 0.27],
        [0.52, 0.66],
        [0.73, 0.41],
      ] as const) {
        new Raycaster(
          new Vector3(x, 5, z),
          new Vector3(0, -1, 0),
        ).intersectObject(mesh, false, hits);
      }
      return hits;
    };
    const atAuthors = pick().map((h) => h.distance);
    frame(mesh, cameraAt(500));
    expect(mesh.geometry.drawRange.start).toBe(last.start);
    expect(pick().map((h) => h.distance)).toEqual(atAuthors);
    expect(mesh.geometry.drawRange).toEqual({
      start: last.start,
      count: last.count,
    });
  });

  // Why: an instanced mesh draws every instance with one range, so a
  // level picked for the instance at its origin would thin the near ones;
  // it draws the author's level, never through the chain.
  it("draws an instanced mesh at the author's level", async () => {
    const blob = await changed((json, add) => {
      const accessors = json["accessors"] as GltfObject[];
      const view = add(
        new Uint8Array(Float32Array.of(0, 0, 0, 400, 0, 0).buffer),
      );
      accessors.push({
        bufferView: view,
        componentType: 5126,
        count: 2,
        type: "VEC3",
      });
      const nodes = json["nodes"] as GltfObject[];
      const node = nodes.find((n) => n["mesh"] !== undefined)!;
      node["extensions"] = {
        EXT_mesh_gpu_instancing: {
          attributes: { TRANSLATION: accessors.length - 1 },
        },
      };
      json["extensionsUsed"] = [
        ...((json["extensionsUsed"] as string[] | undefined) ?? []),
        "EXT_mesh_gpu_instancing",
      ];
    });
    const mesh = onlyMesh(await loadGlbModel(blob));
    expect((mesh as { isInstancedMesh?: boolean }).isInstancedMesh).toBe(true);
    const range = { ...mesh.geometry.drawRange };
    frame(mesh, cameraAt(500));
    expect(mesh.geometry.drawRange).toEqual(range);
    expect(range.start).toBe(0);
  });

  // Why: the chain must be an index list; a float accessor named as the
  // chain is no index, and the file draws as if it had no chain.
  it("ignores a chain that is no integer list", async () => {
    let authors = 0;
    const blob = await changed((json, add) => {
      const accessors = json["accessors"] as GltfObject[];
      const prim = (
        (json["meshes"] as GltfObject[])[0]!["primitives"] as GltfObject[]
      )[0]!;
      const lod = (prim["extras"] as GltfObject)["lod"] as {
        indices: number;
        levels: { start: number; count: number }[];
      };
      const last = lod.levels.at(-1)!;
      const count = last.start + last.count;
      authors = accessors[prim["indices"] as number]!["count"] as number;
      const view = add(new Uint8Array(new Float32Array(count).buffer));
      accessors.push({
        bufferView: view,
        componentType: 5126,
        count,
        type: "SCALAR",
      });
      lod.indices = accessors.length - 1;
    });
    const mesh = onlyMesh(await loadGlbModel(blob));
    expect(mesh.geometry.index!.count).toBe(authors);
    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    frame(mesh, cameraAt(500));
    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: Infinity });
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
