/**
 * GPS Event Markers Visualizer
 *
 * Creates and manages Three.js meshes for visualizing GPS events
 * in the 3D AR scene. Shows two types of markers:
 * - Raw GPS markers (yellow): Where GPS readings were received — added to scene root
 * - Fused markers (cyan): AR odometry positions — added to arWorldGroup so that
 *   scene-graph propagation (arWorldGroup.matrix × odomPos) handles alignment
 *
 * ARCHITECTURE NOTE:
 * - Raw GPS markers are in scene root (GPS world space), fixed forever
 * - Fused markers are children of arWorldGroup with position = raw odom coords;
 *   when applyAlignmentMatrix() updates arWorldGroup.matrix, all fused markers'
 *   world positions update automatically via Three.js scene-graph propagation.
 */

import * as THREE from 'three';
import { getScene, getArWorldGroup } from '../ar/webxr-session';
import type { LatLong, Vector3 } from 'gps-plus-slam-js';
import { createLogger } from '../utils/logger';
import { disposeMeshArray } from './three-dispose';
import { VIS_COLORS } from './vis-colors';

const log = createLogger('GpsEventVisualizer');

/**
 * Sphere radius in meters for the raw-GPS / fused debug markers.
 *
 * Halved 0.08 → 0.04 (D5, 2026-06-16 user feedback): these "different colours"
 * tracking spheres were cluttering the AR scene and hiding the ref-point
 * markers. They now shrink while the ref-point marker spheres grow (×2), so the
 * marker the user cares about stands out. This is a framework-level constant
 * rendered in BOTH live recording and replay, so replays of older recordings
 * also show the smaller debug spheres — intended and accepted (requester
 * decision); a plain constant change is correct (no live-vs-replay flag).
 */
const GPS_MARKER_RADIUS = 0.04;

/** Slightly larger radius for alignment snapshots to stand out (halved 0.1 → 0.05 with the GPS markers, D5). */
const SNAPSHOT_MARKER_RADIUS = 0.05;

/**
 * Default opacity for the yellow raw-GPS sphere when it is rendered at the
 * legacy fixed 8 cm radius (no accuracy passed). Matches the original 30 %
 * value so live recording sessions look unchanged.
 */
const RAW_GPS_FIXED_OPACITY = 0.3;

/**
 * Reduced opacity for the yellow raw-GPS sphere when it is scaled by GPS
 * accuracy (replay mode). At metre-scale ellipsoids the sphere can land on
 * top of the cyan fused / red snapshot markers; a lower alpha keeps those
 * smaller markers visible inside the ellipsoid.
 */
const RAW_GPS_ACCURACY_OPACITY = 0.13;

/**
 * Where the visualizer resolves its scene graph from.
 *
 * By default markers are parented into the LIVE AR session's scene
 * (`webxr-session.ts` getters). Non-live consumers (desktop replay, offline
 * e2e fixtures) point the visualizer at their own scene via
 * {@link GpsEventVisualizer.setSceneSource} instead of injecting their scene
 * into the webxr-session singleton (the deleted replay-mode "Risk R1" setters
 * — see the 2026-07-11 webxr-session surface-reduction plan, step 2).
 *
 * Both functions may return `null` (e.g. before `initAR()`); the visualizer
 * then warns and skips the affected marker, exactly as before.
 */
export interface GpsMarkerSceneSource {
  /** Scene root — parents raw-GPS (yellow) and snapshot (red) markers. */
  getScene: () => THREE.Scene | null;
  /** AR world group — parents fused (cyan) markers so they ride the alignment. */
  getArWorldGroup: () => THREE.Group | null;
}

/** Default source: the live AR session's scene graph. */
const LIVE_SCENE_SOURCE: GpsMarkerSceneSource = { getScene, getArWorldGroup };

/**
 * Optional GPS-accuracy hints used by {@link GpsEventVisualizer.addGpsEvent}
 * to render the raw-GPS marker as a non-uniform-scaled ellipsoid.
 *
 * Both fields are optional — missing or non-positive values fall back to the
 * legacy fixed 8 cm sphere (same defensive policy as `preview-map.ts`).
 */
export interface GpsEventAccuracy {
  /** Horizontal 1σ accuracy in metres (applied to both X and Z axes). */
  horizontal?: number | undefined;
  /** Vertical 1σ accuracy in metres (applied to the Y axis). */
  vertical?: number | undefined;
}

/**
 * Validate a {@link GpsEventAccuracy} hint and return the concrete
 * {horizontal, vertical} scale when both axes are usable, or `null` to signal
 * "fall back to the legacy fixed 8 cm sphere". A half-populated, non-positive,
 * or non-finite (`NaN`/`Infinity`) accuracy must NOT produce an ellipsoid:
 * a degenerate or infinite axis would corrupt the mesh transform and can
 * crash Three.js rendering.
 */
function resolveEllipsoidScale(
  accuracy: GpsEventAccuracy | undefined
): { horizontal: number; vertical: number } | null {
  // `== null` catches BOTH `undefined` and `null`. Although the parameter type
  // forbids `null`, this is exported library API: a non-TS caller (or a
  // nullable API response forwarded verbatim) could pass `null`, and
  // destructuring `null` on the next line would throw a TypeError. Reject it
  // here and fall back to the legacy fixed sphere — same defensive stance as
  // the NaN/Infinity/half-populated guards below.
  if (accuracy == null) return null;
  const { horizontal, vertical } = accuracy;
  // `typeof === 'number'` narrows `number | undefined` to `number`, so the
  // finite/range checks below operate on a non-nullable value without any
  // `!` assertions.
  if (typeof horizontal !== 'number' || typeof vertical !== 'number') {
    return null;
  }
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) {
    return null;
  }
  if (horizontal <= 0 || vertical <= 0) return null;
  return { horizontal, vertical };
}

/**
 * Manager for GPS event visualization
 */
export class GpsEventVisualizer {
  private rawGpsMarkers: THREE.Mesh[] = [];
  private fusedMarkers: THREE.Mesh[] = [];
  private snapshotMarkers: THREE.Mesh[] = [];
  private zeroRef: LatLong | null = null;
  private eventCounter = 0;
  private snapshotCounter = 0;
  /**
   * Whether the debug markers are drawn. Toggled by {@link setVisible} for the
   * recorder's `visualization.gpsAlignmentMarkers` opt-out (Finding B). Applied
   * to every marker at creation so events spawned later by the live
   * store-subscriber inherit the current state instead of popping into view.
   * Default `true` — the markers render exactly as before until opted out.
   */
  private markersVisible = true;

  /**
   * Scene graph the markers are parented into. Defaults to the live AR
   * session ({@link LIVE_SCENE_SOURCE}); replay / offline consumers override
   * it via {@link setSceneSource}. Not reset by {@link clearAll} — the owner
   * of the non-live scene (e.g. replay-mode's dispose) restores the default.
   */
  private sceneSource: GpsMarkerSceneSource = LIVE_SCENE_SOURCE;

  /**
   * Point the visualizer at a non-live scene graph (desktop replay, offline
   * e2e fixture). Pass `null` to restore the live-session default. The caller
   * that overrides the source is responsible for restoring it when its scene
   * is disposed, so a later live AR session parents markers correctly again.
   */
  setSceneSource(source: GpsMarkerSceneSource | null): void {
    this.sceneSource = source ?? LIVE_SCENE_SOURCE;
  }

  /**
   * Set the GPS zero reference (origin for coordinate conversion).
   * Must be called before adding GPS events.
   *
   * @param zero - GPS coordinates of the origin
   */
  setZeroRef(zero: LatLong): void {
    this.zeroRef = zero;
  }

  /**
   * Get the current zero reference
   */
  getZeroRef(): LatLong | null {
    return this.zeroRef;
  }

  /**
   * Add a GPS event to the visualization.
   * Creates both a raw GPS marker and a fused alignment marker.
   *
   * @param gpsCoords - GPS position as [x, y, z] meters from zero reference
   * @param odomPosition - AR odometry position at the time of GPS reading
   * @param accuracy - Optional 1σ GPS accuracy. When both fields are positive,
   *   the raw-GPS marker is rendered as a non-uniform-scaled ellipsoid:
   *   `mesh.scale.set(horizontal, vertical, horizontal)` over a unit sphere.
   *   When missing, zero, or negative, the marker falls back to the legacy
   *   fixed 8 cm sphere (same defensive policy as `preview-map.ts`).
   *   Cyan fused and red snapshot markers are never affected by this argument.
   */
  addGpsEvent(
    gpsCoords: Vector3,
    odomPosition: Vector3,
    accuracy?: GpsEventAccuracy
  ): void {
    if (!this.zeroRef) {
      log.warn('No zero reference set');
      return;
    }

    const scene = this.sceneSource.getScene();
    if (!scene) {
      log.warn('Scene not available');
      return;
    }

    const eventId = this.eventCounter++;

    // Defensive: only treat accuracy as usable when BOTH axes are present and
    // strictly positive. Otherwise fall back to the fixed 8 cm sphere so a
    // half-populated accuracy field can't produce a degenerate ellipsoid.
    const ellipsoidScale = resolveEllipsoidScale(accuracy);

    // Create raw GPS marker (yellow) at GPS coordinates — added to scene root.
    // Replay-mode ellipsoid uses a unit-radius sphere scaled non-uniformly;
    // legacy recording-mode marker uses the fixed 8 cm radius.
    const rawMesh = this.createMarkerMesh(
      VIS_COLORS.RAW_GPS.hex,
      'raw-gps',
      eventId,
      ellipsoidScale ? 1 : GPS_MARKER_RADIUS,
      ellipsoidScale ? RAW_GPS_ACCURACY_OPACITY : RAW_GPS_FIXED_OPACITY
    );
    rawMesh.position.set(gpsCoords[0], gpsCoords[1], gpsCoords[2]);
    if (ellipsoidScale) {
      rawMesh.scale.set(
        ellipsoidScale.horizontal,
        ellipsoidScale.vertical,
        ellipsoidScale.horizontal
      );
      // Render large translucent ellipsoids before smaller markers so the
      // cyan / red spheres remain visible inside them. Negative renderOrder
      // pushes these to the front of the transparent draw queue.
      rawMesh.renderOrder = -1;
    }
    scene.add(rawMesh);
    this.rawGpsMarkers.push(rawMesh);

    // Create fused marker (cyan) at raw odom position — added to arWorldGroup
    // Scene-graph propagation: world pos = arWorldGroup.matrix × odomPos
    const arWorldGroup = this.sceneSource.getArWorldGroup();
    if (!arWorldGroup) {
      log.warn('arWorldGroup not available, skipping fused marker');
      return;
    }

    const fusedMesh = this.createMarkerMesh(
      VIS_COLORS.FUSED_VIO.hex,
      'fused',
      eventId
    );
    fusedMesh.position.set(odomPosition[0], odomPosition[1], odomPosition[2]);
    arWorldGroup.add(fusedMesh);
    this.fusedMarkers.push(fusedMesh);

    log.debug(
      `Added GPS event ${eventId}: raw=[${gpsCoords.join(',')}] odom=[${odomPosition.join(',')}]`
    );
  }

  /**
   * Add an alignment snapshot marker at the given NUE position.
   * Snapshots represent the system's best GPS estimate at each alignment update.
   * Added to scene root (GPS world space), not arWorldGroup.
   */
  addAlignmentSnapshot(nuePosition: Vector3): void {
    const scene = this.sceneSource.getScene();
    if (!scene) {
      log.warn('Scene not available for alignment snapshot');
      return;
    }

    const id = this.snapshotCounter++;
    const mesh = this.createMarkerMesh(
      VIS_COLORS.ALIGNMENT_SNAPSHOT.hex,
      'alignment-snapshot',
      id,
      SNAPSHOT_MARKER_RADIUS,
      0.5
    );
    mesh.position.set(nuePosition[0], nuePosition[1], nuePosition[2]);
    scene.add(mesh);
    this.snapshotMarkers.push(mesh);

    log.debug(`Added alignment snapshot ${id}: pos=[${nuePosition.join(',')}]`);
  }

  /**
   * Get the NUE positions of all alignment snapshot markers.
   * Used at session end to convert to GPS coordinates for the summary map.
   */
  getAlignmentSnapshotPositions(): Vector3[] {
    return this.snapshotMarkers.map(
      (m) => [m.position.x, m.position.y, m.position.z] as Vector3
    );
  }

  /**
   * Create a sphere marker mesh with the given color and name.
   */
  private createMarkerMesh(
    color: number,
    namePrefix: string,
    eventId: number,
    radius: number = GPS_MARKER_RADIUS,
    opacity: number = 0.3
  ): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(radius, 12, 12);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${namePrefix}-${eventId}`;
    // Inherit the current visibility so markers spawned while the operator has
    // the overlay toggled off (Finding B) do not pop into view.
    mesh.visible = this.markersVisible;
    return mesh;
  }

  /**
   * Show or hide ALL debug markers — raw GPS (yellow), fused (cyan), and
   * alignment-snapshot (red) — and remember the state so markers added later
   * inherit it. Used by the recorder's `visualization.gpsAlignmentMarkers`
   * opt-out, read once at Enter-AR (live only; replay keeps markers visible).
   *
   * This only changes rendering: capture, GPS-event recording, counts, and the
   * snapshot positions read back at session end are all unaffected.
   */
  setVisible(visible: boolean): void {
    this.markersVisible = visible;
    for (const mesh of this.rawGpsMarkers) mesh.visible = visible;
    for (const mesh of this.fusedMarkers) mesh.visible = visible;
    for (const mesh of this.snapshotMarkers) mesh.visible = visible;
  }

  /**
   * Clear all markers from the scene and reset state.
   */
  clearAll(): void {
    const scene = this.sceneSource.getScene();
    const arWorldGroup = this.sceneSource.getArWorldGroup();

    disposeMeshArray(this.rawGpsMarkers, scene);
    disposeMeshArray(this.fusedMarkers, arWorldGroup);
    disposeMeshArray(this.snapshotMarkers, scene);

    // Reset state
    this.zeroRef = null;
    this.eventCounter = 0;
    this.snapshotCounter = 0;
    // Return to pristine (visible) state. The visualizer is a singleton shared
    // by live + replay; resetting here means a live session's
    // `setVisible(false)` opt-out never leaks into a subsequent replay (which
    // never calls setVisible and must always show the captured markers). The
    // live Enter-AR path re-applies the option explicitly after this reset.
    this.markersVisible = true;
  }

  /**
   * Get count of visible markers.
   */
  getCounts(): { raw: number; fused: number; snapshots: number } {
    return {
      raw: this.rawGpsMarkers.length,
      fused: this.fusedMarkers.length,
      snapshots: this.snapshotMarkers.length,
    };
  }

  /**
   * Diagnostic accessor: returns the world-space size (`THREE.Box3.setFromObject`)
   * of each raw-GPS marker, in insertion order.
   *
   * Used by the rec31 accuracy-ellipsoid Playwright spec (§3c) to verify the
   * relative scaling of two events with different `latLongAccuracy`. This is
   * the size of the rendered ellipsoid in scene units (= metres in replay
   * mode), not the underlying geometry radius — so it correctly reflects the
   * `mesh.scale.set(h, v, h)` applied for accuracy-aware markers.
   *
   * @returns array of `{ x, y, z }` sizes — empty array if there are no markers.
   */
  getRawMarkerWorldSizes(): Array<{ x: number; y: number; z: number }> {
    const tmpBox = new THREE.Box3();
    return this.rawGpsMarkers.map((mesh) => {
      tmpBox.setFromObject(mesh);
      const size = tmpBox.getSize(new THREE.Vector3());
      return { x: size.x, y: size.y, z: size.z };
    });
  }
}

/**
 * Singleton instance for global use.
 * Import this to visualize GPS events.
 */
export const gpsEventVisualizer = new GpsEventVisualizer();
