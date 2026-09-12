/**
 * Leaflet Map Overlay Module
 *
 * A full Leaflet map embedded in 3D space via Three.js CSS3DObject
 * (it replaced the old single-tile MapOverlay, deleted 2026-07-11).
 * The Leaflet map provides native multi-tile rendering, pan/zoom, and
 * overlay support.
 *
 * The Leaflet map container (a real DOM element) is wrapped in a
 * CSS3DObject and positioned as a child of the camera or CameraFollower.
 * A CSS3DRenderer (managed externally) composites it with the WebGL scene.
 *
 * Trajectory layers (raw GPS path + accuracy circles, fused path, alignment
 * snapshots, user position) are drawn from a single resolved `MapData`
 * snapshot via the shared `drawMapData` routine (Phase 3 unification — the
 * same routine the 2D session-summary map uses), passed in through
 * {@link LeafletMapOverlay.render}. Reference-point markers are app-defined
 * and driven separately through the generic named-marker API
 * (`addCurrentMarker` / `addPriorMarker` / `clearPriorMarkers`).
 *
 * ARCHITECTURE:
 * - CSS3DObject is a child of mapParent (CameraFollower or camera)
 * - Position: (0, heightOffset, DEFAULT_Z_OFFSET) in parent-local space
 * - Rotation: -π/2 on X axis (faces up, XZ plane)
 * - Leaflet map handles all tile loading, caching, multi-tile rendering
 * - Store subscribers call setGpsPosition(lat, lon) for automatic centering
 */

import type * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import L from 'leaflet';
import type { LatLong } from 'gps-plus-slam-js';
import { VIS_COLORS } from './vis-colors';
import type { MapData } from './map-data';
import { drawMapData } from './map-overlay-draw';
import { headingUpQuat, viewAzimuthDeg } from './heading-up-rotation';
import { clampedAlpha, DEFAULT_LERP_RATE, lerpAngleDeg } from './lerp-utils';
import { createLogger } from '../utils/logger';

const log = createLogger('LeafletMapOverlay');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default pixel size of the Leaflet map container */
export const DEFAULT_LEAFLET_MAP_SIZE_PX = 600;

/**
 * Diameter (px) of the ref-point markers on the in-AR minimap.
 *
 * Enlarged 12 → 20 px (F5-A, 2026-06-16 user feedback): the field tester
 * reported the minimap "showed the user but not the marker". The markers WERE
 * rendered — they were just too small to notice on the small CSS3D minimap. A
 * bigger dot plus a thicker white halo and a drop shadow makes them the most
 * prominent feature on the minimap (the user-position marker stays 14 px).
 */
const REF_POINT_MARKER_SIZE_PX = 20;

/**
 * Map-plane placement defaults (re-fit 2026-07-04, F1 user feedback).
 *
 * The plane's parent is the CameraFollower — camera POSITION is followed,
 * rotation stays IDENTITY (GPS-world-aligned). CSS3D content crossing the
 * viewer plane (camera-space z ≥ 0) is cut off by the browser (an effective
 * near plane at 0 that camera.near cannot move), so the defaults must keep
 * every plane corner in front of the viewer plane for ALL camera yaws and
 * heading-up rotations at map-viewing pitches. Invariant (tests pin it):
 *
 *   |DEFAULT_Z_OFFSET| + DEFAULT_WORLD_SIZE/√2 + lag ≤ |h|·tan(θ*)
 *
 * with lag = 0.5 m (follower lerp) and design pitch θ* = 51°. Below θ* only
 * the region farther than |h|·tan(pitch) behind the camera is cut, shrinking
 * to nothing at θ*. Values 8 / −5 / 0 give θ* ≈ 51°; zOffset MUST stay 0 —
 * with a world-yaw-locked parent a non-zero offset is a fixed compass
 * direction, not "ahead of the user".
 */

/** Default world-space size in meters */
export const DEFAULT_WORLD_SIZE = 8;

/** Default height offset below camera (negative = below) */
export const DEFAULT_HEIGHT_OFFSET = -5;

/** Default offset from parent along world Z (keep 0 — see block comment) */
export const DEFAULT_Z_OFFSET = 0;

/** Default zoom level for the Leaflet map */
export const DEFAULT_ZOOM = 17;

/** Minimum allowed zoom level */
const MIN_ZOOM = 0;

/** Maximum allowed zoom level */
const MAX_ZOOM = 19;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration options for the Leaflet map overlay.
 */
export interface LeafletMapOverlayOptions {
  /** Pixel dimensions of the Leaflet map container (default: 600). */
  readonly mapSizePx?: number;
  /** World-space size in meters (default: 10). */
  readonly worldSize?: number;
  /** Height offset below parent in meters (default: -4). */
  readonly heightOffset?: number;
  /** Initial Leaflet zoom level (default: 17). */
  readonly zoomLevel?: number;
  /** Tile server URL template (default: OSM). */
  readonly tileServerUrl?: string;
  /**
   * Object3D to attach the CSS3DObject to instead of the camera.
   * Use CameraFollower.object3D for GPS-world-aligned map.
   */
  readonly mapParent?: THREE.Object3D;
  /** Called when a map tile fails to load (e.g., offline, server error). */
  readonly onTileError?: (error: unknown) => void;
  /**
   * DOM element to append the off-screen Leaflet container to.
   * Defaults to `document.body`. In multi-instance or shadow-DOM scenarios
   * pass a scoped element to avoid injecting nodes into `<body>`.
   */
  readonly offscreenRoot?: HTMLElement;
  /**
   * Start in heading-up mode: rotate the whole map so the user's view direction
   * always points up/forward (car-navigation style) instead of the fixed
   * north-up. Default `false` (north-up). Can be toggled later via
   * {@link LeafletMapOverlay.setHeadingUpEnabled}. See the
   * 2026-06-29 heading-up plan.
   */
  readonly headingUp?: boolean;
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class LeafletMapOverlay {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private readonly mapParent: THREE.Object3D;
  private readonly worldSize: number;
  private readonly heightOffset: number;
  private readonly mapSizePx: number;
  private readonly tileServerUrl: string;
  private readonly onTileError?: ((error: unknown) => void) | undefined;
  private readonly offscreenRoot: HTMLElement;

  private zoomLevel: number;
  private gpsPosition: LatLong | null = null;
  private visible = false;

  // Heading-up rotation state. When enabled, the CSS3DObject is yawed each
  // frame so `currentHeadingDeg` (smoothed toward the ~1 Hz `targetHeadingDeg`)
  // points up. `null` current = not yet sampled (snap on first update); `null`
  // target = heading undefined (hold the last orientation). See the 2026-06-29
  // heading-up plan.
  private headingUp: boolean;
  private targetHeadingDeg: number | null = null;
  private currentHeadingDeg: number | null = null;

  // Leaflet state
  private mapContainer: HTMLDivElement | null = null;
  private leafletMap: L.Map | null = null;
  private tileLayer: L.TileLayer | null = null;

  // CSS3D state
  private cssObject: CSS3DObject | null = null;

  // Latest trajectory snapshot (buffered — data can arrive before show()).
  // Drawn via the shared `drawMapData` routine; replaced wholesale on each
  // `render()` so the live fused path "snaps" as the alignment matrix improves.
  private latestMapData: MapData | null = null;
  // Leaflet layers created by the last `drawMapData` call, kept for cleanup.
  private trajectoryLayers: L.Layer[] = [];

  // Generic named markers (e.g., recorder ref-point markers). Buffered so
  // entries added before `show()` are still rendered when the Leaflet map
  // is created. `isPrior` selects color + label decoration.
  private namedMarkers: Array<{
    lat: number;
    lng: number;
    name: string;
    isPrior: boolean;
    marker: L.Marker | null;
  }> = [];

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    options: LeafletMapOverlayOptions = {}
  ) {
    this.scene = scene;
    this.camera = camera;
    this.mapParent = options.mapParent ?? camera;
    this.worldSize = options.worldSize ?? DEFAULT_WORLD_SIZE;
    this.heightOffset = options.heightOffset ?? DEFAULT_HEIGHT_OFFSET;
    this.mapSizePx = options.mapSizePx ?? DEFAULT_LEAFLET_MAP_SIZE_PX;
    this.zoomLevel = options.zoomLevel ?? DEFAULT_ZOOM;
    this.tileServerUrl =
      options.tileServerUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    this.onTileError = options.onTileError;
    this.offscreenRoot = options.offscreenRoot ?? document.body;
    this.headingUp = options.headingUp ?? false;
  }

  // -------------------------------------------------------------------------
  // GPS position
  // -------------------------------------------------------------------------

  setGpsPosition(lat: number, lon: number): void {
    this.gpsPosition = { lat, lon };

    if (this.leafletMap) {
      this.leafletMap.setView([lat, lon], this.zoomLevel);
    }
  }

  getGpsPosition(): LatLong | null {
    return this.gpsPosition;
  }

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  show(): void {
    if (!this.gpsPosition) {
      log.warn('Cannot show map — no GPS position set');
      return;
    }

    if (this.visible) {
      return;
    }

    this.createLeafletMap();
    this.createCssObject();
    this.applyBufferedOverlays();
    this.visible = true;
    log.info('Leaflet map overlay shown');
  }

  hide(): void {
    if (!this.visible) {
      return;
    }
    this.removeCssObject();
    this.visible = false;
    log.info('Leaflet map overlay hidden');
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  // -------------------------------------------------------------------------
  // Trajectory rendering (full-snapshot)
  // -------------------------------------------------------------------------

  /**
   * Render a full trajectory snapshot.
   *
   * Replaces the previous incremental `addRawGpsPoint` / `addFusedPoint` /
   * `addAlignmentSnapshot` API with a single full-snapshot path: the caller
   * builds a {@link MapData} (via the shared `buildMapData`) from the latest
   * store slices and hands it here. The trajectory layers are redrawn
   * wholesale through the shared {@link drawMapData} routine, so the live map
   * stays pixel-identical to the 2D session-summary map and the fused path
   * recomputes (D2) as the alignment matrix improves.
   *
   * Buffered when the map is not yet shown; applied on `show()`.
   */
  render(data: MapData): void {
    this.latestMapData = data;
    // Cache the heading-up rotation target (~1 Hz). `updatePosition` smooths
    // the actual map yaw toward it each frame. Absent/undefined OR non-finite
    // (NaN/Infinity) → null = the heading is currently undefined (hold the last
    // orientation). Normalizing non-finite values here keeps a bad sample from
    // smoothing a NaN into `cssObject.quaternion.set(...)` downstream.
    this.targetHeadingDeg =
      typeof data.userHeadingDeg === 'number' &&
      Number.isFinite(data.userHeadingDeg)
        ? data.userHeadingDeg
        : null;
    if (this.leafletMap) {
      this.drawTrajectory();
    }
  }

  // -------------------------------------------------------------------------
  // Generic named markers (generic, app-defined: e.g., recorder ref-points)
  // -------------------------------------------------------------------------

  /** Add a "current" named marker (red). Buffered if map is not yet shown. */
  addCurrentMarker(lat: number, lon: number, name: string): void {
    const marker = this.leafletMap
      ? this.createNamedMarker(lat, lon, name, false)
      : null;
    this.namedMarkers.push({ lat, lng: lon, name, isPrior: false, marker });
  }

  /** Add a "prior" named marker (green, decorated). Buffered if not shown. */
  addPriorMarker(lat: number, lon: number, name: string): void {
    const marker = this.leafletMap
      ? this.createNamedMarker(lat, lon, name, true)
      : null;
    this.namedMarkers.push({ lat, lng: lon, name, isPrior: true, marker });
  }

  /** Bulk add prior markers. */
  addPriorMarkers(
    markers: Array<{ lat: number; lon: number; name: string }>
  ): void {
    for (const m of markers) {
      this.addPriorMarker(m.lat, m.lon, m.name);
    }
  }

  /** Remove all prior markers; current markers are unaffected. */
  clearPriorMarkers(): void {
    this.namedMarkers = this.namedMarkers.filter((m) => {
      if (m.isPrior) {
        m.marker?.remove();
        return false;
      }
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  setZoomLevel(zoom: number): void {
    this.zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    if (this.leafletMap) {
      this.leafletMap.setZoom(this.zoomLevel);
    }
  }

  getZoomLevel(): number {
    return this.zoomLevel;
  }

  /** Increment zoom level by 1 (clamped at MAX_ZOOM). */
  zoomIn(): void {
    this.setZoomLevel(this.zoomLevel + 1);
  }

  /** Decrement zoom level by 1 (clamped at MIN_ZOOM). */
  zoomOut(): void {
    this.setZoomLevel(this.zoomLevel - 1);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getWorldSize(): number {
    return this.worldSize;
  }

  getHeightOffset(): number {
    return this.heightOffset;
  }

  getMapSizePx(): number {
    return this.mapSizePx;
  }

  /** Expose the Leaflet map instance for testing and advanced usage. */
  getLeafletMap(): L.Map | null {
    return this.leafletMap;
  }

  /**
   * Enable/disable heading-up rotation at runtime (e.g. from a settings flag
   * read at Enter-AR). When disabled, the map snaps back to the north-up
   * baseline immediately. Position follows the parent via the scene graph, so
   * this only governs the in-plane yaw.
   */
  setHeadingUpEnabled(enabled: boolean): void {
    this.headingUp = enabled;
    if (!enabled) {
      this.currentHeadingDeg = null;
      // Restore the north-up baseline tilt (no yaw).
      this.cssObject?.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  /** Whether heading-up rotation is currently enabled. */
  isHeadingUpEnabled(): boolean {
    return this.headingUp;
  }

  /**
   * Per-frame update driving the heading-up rotation. Positioning is handled by
   * Three.js scene-graph propagation (the CSS3DObject is a child of the parent),
   * so this only sets the in-plane yaw.
   *
   * The minimap is world-locked but composited through the **live head-tracked
   * camera**, so the camera already rotates the map's on-screen appearance as
   * the user turns. The local yaw must therefore be expressed RELATIVE to the
   * camera — `headingUpQuat(viewAzimuth − userHeading)` — otherwise the camera's
   * rotation is double-counted and the GPS↔scene alignment offset leaks in (the
   * map then only points forward at a single heading). `userHeading` is smoothed
   * toward the latest ~1 Hz target; `viewAzimuth` is read live from the camera
   * each frame so the projection cancels exactly (no lag).
   *
   * A no-op when heading-up is disabled, the map is not shown, the camera is
   * absent, or the heading is undefined (the last orientation is held).
   *
   * @param dtSeconds Seconds since the previous frame (drives heading smoothing).
   * @param camera The live render camera (the same one compositing the CSS3D
   *   overlay). Required for heading-up; omitted callers leave the map as-is.
   */
  updatePosition(dtSeconds = 0, camera?: THREE.Camera): void {
    // `hide()` only detaches the CSS3DObject (`removeCssObject`) — it never nulls
    // `cssObject` — so `!this.cssObject` alone does not honor the documented
    // "no-op when the map is not shown" contract. Guard on `visible` too, or a
    // frame loop that keeps calling this while hidden wastes per-frame work and
    // rotates a detached object.
    if (!this.headingUp || !this.visible || !this.cssObject || !camera) {
      return;
    }
    const target = this.targetHeadingDeg;
    if (target === null) {
      // Heading undefined (e.g. camera near-vertical / before first solve):
      // hold the current orientation rather than snapping to north.
      return;
    }
    if (this.currentHeadingDeg === null) {
      // First sample — snap so the map doesn't spin up from north on show.
      this.currentHeadingDeg = target;
    } else {
      const alpha = clampedAlpha(DEFAULT_LERP_RATE, dtSeconds);
      this.currentHeadingDeg = lerpAngleDeg(
        this.currentHeadingDeg,
        target,
        alpha
      );
    }
    // Live camera azimuth (raw, not smoothed) so the camera's own on-screen
    // rotation cancels exactly; the smoothed heading removes the alignment offset.
    camera.updateMatrixWorld();
    const viewAz = viewAzimuthDeg(camera.matrixWorld.elements);
    this.cssObject.quaternion.set(
      ...headingUpQuat(viewAz - this.currentHeadingDeg)
    );
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  dispose(): void {
    this.hide();
    this.destroyLeafletMap();

    // Clear buffered data
    this.latestMapData = null;
    this.trajectoryLayers = [];
    this.namedMarkers = [];
    this.targetHeadingDeg = null;
    this.currentHeadingDeg = null;

    this.cssObject = null;

    log.info('Leaflet map overlay disposed');
  }

  // -------------------------------------------------------------------------
  // Private — Leaflet map lifecycle
  // -------------------------------------------------------------------------

  private createLeafletMap(): void {
    if (this.leafletMap) {
      return;
    }

    // Create off-screen container for Leaflet
    this.mapContainer = document.createElement('div');
    this.mapContainer.style.width = `${this.mapSizePx}px`;
    this.mapContainer.style.height = `${this.mapSizePx}px`;
    this.mapContainer.style.background = 'white';

    // Leaflet needs the container in the DOM for sizing
    // Position it off-screen; the CSS3DRenderer handles actual placement
    this.mapContainer.style.position = 'fixed';
    this.mapContainer.style.left = '-9999px';
    this.mapContainer.style.top = '-9999px';
    this.mapContainer.style.pointerEvents = 'none';
    this.offscreenRoot.appendChild(this.mapContainer);

    // Create Leaflet map
    const pos = this.gpsPosition!;
    this.leafletMap = L.map(this.mapContainer, {
      center: [pos.lat, pos.lon],
      zoom: this.zoomLevel,
      zoomControl: false,
      attributionControl: false,
    });

    // Add tile layer
    this.tileLayer = L.tileLayer(this.tileServerUrl, {
      maxZoom: MAX_ZOOM,
    });
    this.tileLayer.on('tileerror', (e: L.TileErrorEvent) => {
      log.error('Failed to load map tile:', e.error);
      this.onTileError?.(e.error);
    });
    this.tileLayer.addTo(this.leafletMap);
  }

  private destroyLeafletMap(): void {
    // Remove all overlay layers
    for (const layer of this.trajectoryLayers) {
      layer.remove();
    }
    this.trajectoryLayers = [];
    for (const m of this.namedMarkers) {
      m.marker?.remove();
      m.marker = null;
    }

    // Destroy Leaflet map
    if (this.leafletMap) {
      this.leafletMap.remove();
      this.leafletMap = null;
    }

    // Remove container from DOM
    if (this.mapContainer?.parentElement) {
      this.mapContainer.parentElement.removeChild(this.mapContainer);
    }
    this.mapContainer = null;
    this.tileLayer = null;
  }

  // -------------------------------------------------------------------------
  // Private — CSS3DObject lifecycle
  // -------------------------------------------------------------------------

  private createCssObject(): void {
    if (!this.mapContainer) {
      return;
    }

    if (this.cssObject) {
      // Re-add existing object
      this.mapParent.add(this.cssObject);
      return;
    }

    // Clear the off-screen positioning set during createLeafletMap().
    // CSS3DRenderer handles placement via CSS transforms, which are
    // visual-only offsets from the element's layout position. Retaining
    // position:fixed + left/top:-9999px would push the element off-screen
    // because the transform applies on top of that extreme offset.
    this.mapContainer.style.position = '';
    this.mapContainer.style.left = '';
    this.mapContainer.style.top = '';

    this.cssObject = new CSS3DObject(this.mapContainer);

    // Scale: the DOM element is mapSizePx pixels wide, but should appear
    // as worldSize meters in 3D space. CSS3DRenderer maps 1 px = 1 unit,
    // so we scale by worldSize / mapSizePx.
    const scale = this.worldSize / this.mapSizePx;
    this.cssObject.scale.set(scale, scale, scale);

    // Position in parent-local space
    this.cssObject.position.set(0, this.heightOffset, DEFAULT_Z_OFFSET);

    // Rotate to face up (XZ plane)
    this.cssObject.rotation.x = -Math.PI / 2;

    this.mapParent.add(this.cssObject);
  }

  private removeCssObject(): void {
    if (this.cssObject) {
      this.mapParent.remove(this.cssObject);
    }
  }

  // -------------------------------------------------------------------------
  // Private — Overlay rendering
  // -------------------------------------------------------------------------

  private applyBufferedOverlays(): void {
    if (!this.leafletMap) {
      return;
    }

    // Trajectory layers (raw GPS + circles, fused, snapshots, user position).
    this.drawTrajectory();

    // Named markers — only create markers for entries that don't have one
    for (const m of this.namedMarkers) {
      if (!m.marker) {
        m.marker = this.createNamedMarker(m.lat, m.lng, m.name, m.isPrior);
      }
    }
  }

  /**
   * Redraw the trajectory layers from {@link latestMapData} via the shared
   * {@link drawMapData} routine, removing any layers from the previous draw.
   */
  private drawTrajectory(): void {
    if (!this.leafletMap || !this.latestMapData) {
      return;
    }
    for (const layer of this.trajectoryLayers) {
      layer.remove();
    }
    this.trajectoryLayers = drawMapData(this.leafletMap, this.latestMapData, {
      showUserPosition: true,
    }).layers;
  }

  private createNamedMarker(
    lat: number,
    lon: number,
    name: string,
    isPrior: boolean
  ): L.Marker {
    const color = isPrior
      ? VIS_COLORS.PRIOR_REF_POINT.css
      : VIS_COLORS.CURRENT_REF_POINT.css;
    const opacity = isPrior ? 'opacity:0.8;' : '';
    const label = isPrior ? `📌 ${name} (prior)` : name;

    // F5-A: a large dot with a thick white halo + drop shadow so the ref-point
    // marker is unmistakable on the small CSS3D minimap (was a 12 px dot the
    // tester could not see).
    const size = REF_POINT_MARKER_SIZE_PX;
    const anchor = size / 2;
    return L.marker([lat, lon], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:3px solid white;box-shadow:0 0 4px rgba(0,0,0,0.7);${opacity}"></div>`,
        iconSize: [size, size],
        iconAnchor: [anchor, anchor],
      }),
    })
      .bindPopup(label)
      .addTo(this.leafletMap!);
  }
}
