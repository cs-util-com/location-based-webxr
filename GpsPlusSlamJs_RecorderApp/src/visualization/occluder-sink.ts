/**
 * The recorder's persistent occluder (live AR and replay): the framework's
 * `createOccluderSink` - lifted there from this file 2026-10-13 (Tour Viewer
 * polish round M5a, DEC-H3) - fed from the recorder's validated `occupancy`
 * option group, with the recorder's own mesh worker.
 *
 * @see occluder-sink.ts.md for detailed documentation
 */

import {
  createOccluderSink as createFrameworkOccluderSink,
  type OccluderMeshWorker,
  type OccluderSink,
  type OccluderSinkHandle,
} from 'gps-plus-slam-app-framework/visualization/occluder-sink';
import type { OcclusionMesh } from 'gps-plus-slam-app-framework/visualization';
import type { Object3D } from 'three';
import type { OccupancyOptions } from '../state/recording-options';
import { createOccluderMeshWorker } from './occluder-mesh-worker-client';

export type { OccluderSink, OccluderSinkHandle };

/** Injectable constructors (tests only — production uses the real ones). */
export interface OccluderSinkDeps {
  readonly createMesh?: (
    parent: Object3D,
    opts: { mode: OccupancyOptions['occluderMeshMode'] }
  ) => OcclusionMesh;
  readonly createWorker?: () => OccluderMeshWorker;
}

/**
 * Build the persistent-occluder resources for one AR/replay session. The
 * caller decides WHETHER (the `occupancy.persistentOcclusion` flag); the
 * framework owns HOW, from the mesher style, debug style, radius and
 * min-confidence floor of the validated `occupancy` group, so live and
 * replay can never silently diverge.
 */
export function createOccluderSink(
  parent: Object3D,
  occupancy: OccupancyOptions,
  deps: OccluderSinkDeps = {}
): OccluderSinkHandle {
  const { createMesh } = deps;
  const createWorker =
    deps.createWorker ?? ((): OccluderMeshWorker => createOccluderMeshWorker());
  return createFrameworkOccluderSink(
    parent,
    {
      meshMode: occupancy.occluderMeshMode,
      debugStyle: occupancy.occluderDebugStyle,
      radiusM: occupancy.occluderRadiusM,
      minConfidence: occupancy.minConfidence,
    },
    createMesh === undefined
      ? { createWorker }
      : {
          // The recorder's modes are a subset of the framework's; the mode
          // the framework passes back is the recorder's own.
          createMesh: (meshParent: Object3D) =>
            createMesh(meshParent, { mode: occupancy.occluderMeshMode }),
          createWorker,
        }
  );
}
