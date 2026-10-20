/**
 * The tour's photo planes: recorded photos placed at the SCENE ROOT in raw
 * GPS-world NUE - the framework's parenting rule for built-once geographic
 * content (`ar-scene-hierarchy.ts`: children of `arWorldGroup` would need
 * alignment-inverse coordinates instead, and writing raw NUE there
 * double-applies the alignment). Textures come decoded from the tour's own
 * streamed blobs (`decodeFrameTexture`, the framework's
 * orientation-correct decoder).
 */

import {
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
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

/**
 * One plane PER CAPTURED PHOTO at its capture position, ORIENTED AS THE
 * CAMERA FACED - the plane's quaternion is the capture's world-NUE rotation, so its
 * textured front points back toward where the photographer stood (a
 * PlaneGeometry's front is +Z, a camera looks down −Z: standing at the
 * capture spot looking the capture direction shows the photo as a window
 * back in time).
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
  // ONE geometry, scaled per mesh — this path places EVERY capture (D4),
  // and a geometry per plane is the unbounded allocation the recorder's
  // frame-tile visualizer already avoids the same way (milestone review,
  // finding 4). Aspect rides mesh.scale.y; dispose frees it once.
  const sharedGeometry = new PlaneGeometry(PLANE_WIDTH_M, PLANE_WIDTH_M);
  const count = Math.min(poses.length, textures.length);
  for (let i = 0; i < count; i += 1) {
    const texture = textures[i];
    const pose = poses[i];
    if (texture === undefined || pose === undefined) continue;
    const image = texture.image as
      { width?: number; height?: number } | null | undefined;
    const aspect =
      image != null &&
      typeof image.width === "number" &&
      typeof image.height === "number" &&
      image.height > 0
        ? image.width / image.height
        : FALLBACK_ASPECT;
    const mesh = new Mesh(
      sharedGeometry,
      new MeshBasicMaterial({ map: texture }),
    );
    mesh.scale.set(1, 1 / aspect, 1);
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
  return {
    count: meshes.length,
    dispose: () => {
      for (const mesh of meshes) {
        scene.remove(mesh);
        const material = mesh.material as MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
      }
      sharedGeometry.dispose();
      meshes.length = 0;
    },
  };
}
