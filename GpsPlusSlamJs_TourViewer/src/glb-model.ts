/**
 * A tour's `.glb` model as a three scene: three's GLTFLoader, imported on
 * first use (no page pays for it until a model is drawn), parsing the
 * bytes with no base path, so the file reaches nothing outside itself. The
 * tour session has already checked the file inert (no external URIs, no
 * decoders: `checkGlbInert`). One loader for the phone (through
 * `seams.ts`) and the desktop editor's 3D view.
 *
 * @see glb-model.ts.md
 */
import type { Object3D } from "three";

/** The model in `blob`; rejects when three cannot parse it. */
export async function loadGlbModel(blob: Blob): Promise<Object3D> {
  const { GLTFLoader } =
    await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(await blob.arrayBuffer(), "");
  // The clips ride on the scene, where a model view finds them.
  gltf.scene.animations = gltf.animations;
  return gltf.scene;
}
