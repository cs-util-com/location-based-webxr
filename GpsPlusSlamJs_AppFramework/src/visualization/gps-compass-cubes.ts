/**
 * GPS Compass Cubes Module
 *
 * Creates colored cubes at ±1 m along each axis with text labels
 * (N, E, S, W) to visualize GPS/NUE orientation in the 3D scene.
 *
 * NUE convention: X = North, Y = Up, Z = East.
 *
 * Designed to be added as children of a CameraFollower so they
 * stay near the camera but always GPS-world-aligned.
 *
 * @see docs/2026-03-12-user-feedback.md Issue 8
 */

import * as THREE from 'three';
import { createTextSprite } from './text-sprite';
import { disposeObject3D } from './three-dispose';
import { VIS_COLORS } from './vis-colors';

/** Side length of each compass cube in metres. */
export const COMPASS_CUBE_SIZE = 0.1;

/** Distance from origin to each compass cube in metres. */
export const COMPASS_CUBE_DISTANCE = 1;

export interface GpsCompassCubes {
  /** The container Group — add this (or its parent) to the scene. */
  readonly group: THREE.Group;
  /** Remove the group from its parent and dispose resources. */
  dispose(): void;
}

interface CubeSpec {
  name: string;
  color: number;
  position: [number, number, number];
  label?: string;
}

const CUBE_SPECS: readonly CubeSpec[] = [
  {
    name: 'compass-north',
    color: VIS_COLORS.COMPASS_NORTH.hex,
    position: [COMPASS_CUBE_DISTANCE, 0, 0],
    label: 'N',
  },
  {
    name: 'compass-east',
    color: VIS_COLORS.COMPASS_EAST.hex,
    position: [0, 0, COMPASS_CUBE_DISTANCE],
    label: 'E',
  },
  {
    name: 'compass-south',
    color: VIS_COLORS.COMPASS_SOUTH.hex,
    position: [-COMPASS_CUBE_DISTANCE, 0, 0],
    label: 'S',
  },
  {
    name: 'compass-west',
    color: VIS_COLORS.COMPASS_WEST.hex,
    position: [0, 0, -COMPASS_CUBE_DISTANCE],
    label: 'W',
  },
  {
    name: 'compass-up',
    color: VIS_COLORS.COMPASS_UP.hex,
    position: [0, COMPASS_CUBE_DISTANCE, 0],
  },
];

/**
 * Create a static glyph label above a cube via the shared text-sprite helper
 * (64×64 canvas defaults: centered white text on transparent background).
 */
function createCubeLabel(text: string): THREE.Sprite {
  const { sprite } = createTextSprite({ text });
  sprite.name = `label-${text}`;
  // Position above the cube
  sprite.position.set(0, COMPASS_CUBE_SIZE * 1.5, 0);
  sprite.scale.set(0.4, 0.4, 0.4);
  return sprite;
}

/**
 * Create compass cubes and attach them to a parent Object3D.
 *
 * @param parent The Object3D to anchor the compass group to
 *               (typically the CameraFollower).
 */
export function createGpsCompassCubes(parent: THREE.Object3D): GpsCompassCubes {
  const group = new THREE.Group();
  group.name = 'gps-compass-cubes';

  const geometry = new THREE.BoxGeometry(
    COMPASS_CUBE_SIZE,
    COMPASS_CUBE_SIZE,
    COMPASS_CUBE_SIZE
  );

  for (const spec of CUBE_SPECS) {
    const material = new THREE.MeshBasicMaterial({ color: spec.color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = spec.name;
    mesh.position.set(...spec.position);

    if (spec.label) {
      mesh.add(createCubeLabel(spec.label));
    }

    group.add(mesh);
  }

  parent.add(group);

  return {
    group,
    dispose(): void {
      if (group.parent) {
        group.parent.remove(group);
      }
      disposeObject3D(group);
    },
  };
}
