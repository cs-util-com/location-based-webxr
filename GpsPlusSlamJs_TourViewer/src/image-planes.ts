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
  Quaternion,
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
  return disposer(scene, meshes);
}

/**
 * The capture-time variant (geo-join plan Rev 2, D3/D4): one plane PER
 * CAPTURED PHOTO at its capture position, ORIENTED AS THE CAMERA FACED —
 * the plane's quaternion is the capture's world-NUE rotation, so its
 * textured front points back toward where the photographer stood (a
 * PlaneGeometry's front is +Z, a camera looks down −Z: standing at the
 * capture spot looking the capture direction shows the photo as a window
 * back in time). Same scene-root/raw-NUE parenting rule and the same
 * dispose contract as the ring.
 */
export function placeCapturedImagePlanes(options: {
  scene: Object3D;
  poses: readonly {
    positionNue: readonly [number, number, number];
    rotationNue: readonly [number, number, number, number];
  }[];
  textures: readonly Texture[];
}): PlacedImagePlanes {
  const { scene, poses, textures } = options;
  const meshes: Mesh[] = [];
  const count = Math.min(poses.length, textures.length);
  for (let i = 0; i < count; i += 1) {
    const texture = textures[i];
    const pose = poses[i];
    if (texture === undefined || pose === undefined) continue;
    const image = texture.image as
      | { width?: number; height?: number }
      | null
      | undefined;
    const aspect =
      image != null &&
      typeof image.width === "number" &&
      typeof image.height === "number" &&
      image.height > 0
        ? image.width / image.height
        : FALLBACK_ASPECT;
    const mesh = new Mesh(
      new PlaneGeometry(PLANE_WIDTH_M, PLANE_WIDTH_M / aspect),
      new MeshBasicMaterial({ map: texture }),
    );
    mesh.position.set(
      pose.positionNue[0],
      pose.positionNue[1],
      pose.positionNue[2],
    );
    mesh.quaternion.copy(
      new Quaternion(
        pose.rotationNue[0],
        pose.rotationNue[1],
        pose.rotationNue[2],
        pose.rotationNue[3],
      ),
    );
    scene.add(mesh);
    meshes.push(mesh);
  }
  return disposer(scene, meshes);
}

function disposer(scene: Object3D, meshes: Mesh[]): PlacedImagePlanes {
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
