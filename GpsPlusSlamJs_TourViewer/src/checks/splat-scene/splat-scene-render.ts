/**
 * Renders the synthetic splat scene (`splat-scene.ts`) with three.js at
 * given poses and returns each view as JPEG bytes, drawn with exactly the
 * projection the walk's depth samples record. Unlit textures, so a
 * surface has the same colour from every camera, as a splat's colour
 * assumes. Needs WebGL; a software renderer is enough.
 *
 * @see splat-scene-render.ts.md
 */
import type { Matrix4 } from "gps-plus-slam-app-framework/core";
import * as THREE from "three";

import {
  SCENE_BOXES,
  surfaceTexture,
  type SceneBox,
  type ScenePose,
} from "./splat-scene.js";

/** The texture's side in pixels, and how many metres one tile covers. */
const TEXTURE_PX = 256;
const TILE_M = 2;

/** The photos' JPEG quality, as a phone's camera roughly writes them. */
const JPEG_QUALITY = 0.9;

/**
 * Render the scene at each pose into `width` x `height` JPEGs with
 * `projection`, in pose order. `onFrame` hears each finished frame's
 * index (for a progress line). Rejects when WebGL or JPEG encoding is not
 * available; the renderer and every texture are freed either way.
 */
export async function renderSceneFrames(
  poses: readonly ScenePose[],
  width: number,
  height: number,
  projection: Matrix4,
  onFrame: (index: number) => void = () => {},
): Promise<Uint8Array<ArrayBuffer>[]> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [renderer];
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    scene.background = new THREE.Color(0x000000);
    for (const box of SCENE_BOXES) {
      const mesh = boxMesh(box);
      disposables.push(mesh.geometry, mesh.material);
      if (mesh.material.map !== null) disposables.push(mesh.material.map);
      scene.add(mesh);
    }
    const camera = new THREE.PerspectiveCamera();
    camera.projectionMatrix.fromArray([...projection]);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    const out: Uint8Array<ArrayBuffer>[] = [];
    for (const [i, pose] of poses.entries()) {
      camera.position.set(...pose.position);
      camera.quaternion.set(...pose.rotation);
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
      out.push(await jpegOf(canvas));
      onFrame(i);
    }
    return out;
  } finally {
    for (const d of disposables) d.dispose();
  }
}

/** A box with its texture tiled every `TILE_M` metres of its longest side. */
function boxMesh(
  box: SceneBox,
): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> {
  const size = [0, 1, 2].map((k) => (box.max[k] ?? 0) - (box.min[k] ?? 0));
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const texture = new THREE.DataTexture(
    surfaceTexture(box.kind, box.seed, TEXTURE_PX),
    TEXTURE_PX,
    TEXTURE_PX,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const tiles = Math.max(1, Math.round(Math.max(...size) / TILE_M));
  texture.repeat.set(tiles, tiles);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  mesh.position.set(
    ((box.min[0] ?? 0) + (box.max[0] ?? 0)) / 2,
    ((box.min[1] ?? 0) + (box.max[1] ?? 0)) / 2,
    ((box.min[2] ?? 0) + (box.max[2] ?? 0)) / 2,
  );
  return mesh;
}

function jpegOf(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error("The browser could not encode a JPEG"));
          return;
        }
        blob
          .arrayBuffer()
          .then((bytes) => resolve(new Uint8Array(bytes)), reject);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
