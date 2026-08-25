/**
 * The tour's image planes (QD-3): a handful of streamed images placed ONCE
 * at the SCENE ROOT in raw GPS-world NUE — the framework's parenting rule
 * for built-once geographic content (`ar-scene-hierarchy.ts`: children of
 * `arWorldGroup` would need alignment-inverse coordinates instead, and
 * writing raw NUE there double-applies the alignment).
 *
 * Positions come from `imagePlaneRingNue` (qr-viewer-mode); textures come
 * decoded from the tour's own streamed blobs (`decodeFrameTexture` — the
 * framework's orientation-correct decoder). Each plane faces the ring
 * centre, so a visitor standing at the relocalized code sees the images
 * around them.
 */

import {
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Object3D,
  type Texture,
} from "three";

export interface PlacedImagePlanes {
  count: number;
  /** Remove from the scene and free geometry/material/texture. */
  dispose(): void;
}

const PLANE_WIDTH_M = 1;
const FALLBACK_ASPECT = 4 / 3;

export function placeImagePlanes(options: {
  scene: Object3D;
  positionsNue: readonly (readonly [number, number, number])[];
  textures: readonly Texture[];
  centerNue: readonly [number, number, number];
}): PlacedImagePlanes {
  const { scene, positionsNue, textures, centerNue } = options;
  const meshes: Mesh[] = [];
  const count = Math.min(positionsNue.length, textures.length);
  for (let i = 0; i < count; i += 1) {
    const texture = textures[i];
    const position = positionsNue[i];
    if (texture === undefined || position === undefined) continue;
    const image = texture.image as
      | { width?: number; height?: number }
      | null
      | undefined;
    // `!= null` on purpose: a bare `new Texture()` carries `image: null`
    // (found by the facing test — the undefined-only guard crashed).
    const aspect =
      image != null &&
      typeof image.width === "number" &&
      typeof image.height === "number" &&
      image.height > 0
        ? image.width / image.height
        : FALLBACK_ASPECT;
    const mesh = new Mesh(
      new PlaneGeometry(PLANE_WIDTH_M, PLANE_WIDTH_M / aspect),
      // DoubleSide-free on purpose: each plane is turned to face the ring
      // centre, so the textured front is the side the visitor sees.
      new MeshBasicMaterial({ map: texture }),
    );
    mesh.position.set(position[0], position[1], position[2]);
    mesh.lookAt(new Vector3(centerNue[0], position[1], centerNue[2]));
    scene.add(mesh);
    meshes.push(mesh);
  }
  return {
    count: meshes.length,
    dispose: () => {
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        const material = mesh.material as MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
      }
      meshes.length = 0;
    },
  };
}
