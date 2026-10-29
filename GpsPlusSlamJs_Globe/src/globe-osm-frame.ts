/**
 * The OSM map's step each frame (G1 6), moved out of the globe lab: the
 * overlay is attached the first time the map is on (its plugin registered,
 * `onAttach` shows its credit), then it is switched and faded by the
 * page's settings and given the camera's pose: its height over the drawn
 * ground (NaN where the relief draws nothing or has no ground under the
 * camera) and its speed in the Earth's frame (the world is recentred under
 * the camera, so a world-space speed would read the recentring).
 *
 * @see globe-osm-frame.ts.md
 */

import type * as THREE from "three";

import type {
  GlobeOsmOverlay,
  OsmCameraPose,
  OsmOverlayTerrain,
} from "./globe-osm-overlay.js";

/** The overlay's part the step drives. */
export type OsmFrameOverlay = Pick<
  GlobeOsmOverlay,
  "attach" | "setEnabled" | "setFadeM" | "update"
>;

export interface OsmFrameOptions {
  osm: OsmFrameOverlay;
  terrain: OsmOverlayTerrain;
  ellipsoid: { getPositionElevation(position: THREE.Vector3): number };
  /** The globe's frame: the camera's world position into ECEF. */
  group: THREE.Object3D;
  camera: THREE.Camera;
  /** Called once, right after the overlay was attached. */
  onAttach?: () => void;
}

/** One frame's inputs from the page. */
interface OsmFrameInput {
  /** `osm=1`. */
  on: boolean;
  /** The fade distance (m). */
  fadeM: number;
  /** The drawn ground under the camera (m), null without. */
  groundUnderCameraM: number | null;
  /** The relief's share of the pixels. */
  bandShare: number;
}

export interface OsmFrameStep {
  /** The step at `nowMs` (the page's clock). Nothing before the map is on. */
  (nowMs: number, input: OsmFrameInput): void;
  /** Whether the overlay has been attached. */
  attached(): boolean;
  /** The pose given last (without the position), null before. */
  pose(): Omit<OsmCameraPose, "position" | "nowMs"> | null;
}

/** The OSM map's step for a page's frame. */
export function createOsmFrameStep({
  osm,
  terrain,
  ellipsoid,
  group,
  camera,
  onAttach = () => {},
}: OsmFrameOptions): OsmFrameStep {
  let attached = false;
  let last: { at: THREE.Vector3; t: number } | null = null;
  let pose: Omit<OsmCameraPose, "position" | "nowMs"> | null = null;
  const step = (nowMs: number, input: OsmFrameInput) => {
    if (input.on && !attached) {
      osm.attach(terrain);
      attached = true;
      onAttach();
    }
    if (!attached) return;
    osm.setEnabled(input.on);
    osm.setFadeM(input.fadeM);
    const at = group.worldToLocal(camera.position.clone());
    const speedMps = last
      ? at.distanceTo(last.at) / Math.max((nowMs - last.t) / 1000, 1e-3)
      : 0;
    last = { at, t: nowMs };
    const altitude = ellipsoid.getPositionElevation(at);
    pose = {
      aboveGroundM:
        input.groundUnderCameraM === null || input.bandShare <= 0
          ? Number.NaN
          : altitude - input.groundUnderCameraM,
      speedMps,
    };
    osm.update({ position: camera.position, ...pose, nowMs });
  };
  return Object.assign(step, {
    attached: () => attached,
    pose: () => pose,
  });
}
