/**
 * GPS Event Markers Visualizer Tests
 *
 * Why these tests matter:
 * - Verify raw GPS markers (yellow) are added to scene root at GPS coords
 * - Verify fused markers (cyan) are added to arWorldGroup at raw odom position
 *   so that scene-graph propagation (arWorldGroup.matrix × odomPos) produces
 *   the correct world-space fused position automatically
 * - Validate proper cleanup on clearAll
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GpsEventVisualizer } from './gps-event-markers';
import type { LatLong, Vector3 } from 'gps-plus-slam-js';
import * as THREE from 'three';

// Mock the webxr-session module
vi.mock('../ar/webxr-session', () => ({
  getScene: vi.fn(),
  getArWorldGroup: vi.fn(),
}));

import { getScene, getArWorldGroup } from '../ar/webxr-session';

describe('GpsEventVisualizer', () => {
  let visualizer: GpsEventVisualizer;
  let mockScene: THREE.Scene;
  let mockArWorldGroup: THREE.Group;

  beforeEach(() => {
    visualizer = new GpsEventVisualizer();
    mockScene = new THREE.Scene();
    mockArWorldGroup = new THREE.Group();
    mockArWorldGroup.name = 'ar-world';
    mockScene.add(mockArWorldGroup);
    vi.mocked(getScene).mockReturnValue(mockScene);
    vi.mocked(getArWorldGroup).mockReturnValue(mockArWorldGroup);
  });

  describe('setZeroRef / getZeroRef', () => {
    it('stores the zero reference', () => {
      const zero: LatLong = { lat: 48.8566, lon: 2.3522 };

      visualizer.setZeroRef(zero);

      expect(visualizer.getZeroRef()).toEqual(zero);
    });
  });

  describe('setSceneSource (replay / offline scene ownership)', () => {
    /**
     * Why this test matters (surface-reduction step 2):
     * Replay mode used to inject its scene into the webxr-session singleton
     * (`setScene`/`setArWorldGroup` — the deleted Risk R1 setters) so this
     * visualizer would find it via the live getters. Now replay points the
     * visualizer at its OWN scene via setSceneSource; markers must land in
     * that scene even though the live getters return null (no AR session).
     */
    it('parents markers into the override scene, not the live getters', () => {
      vi.mocked(getScene).mockReturnValue(null);
      vi.mocked(getArWorldGroup).mockReturnValue(null);

      const replayScene = new THREE.Scene();
      const replayGroup = new THREE.Group();
      replayScene.add(replayGroup);
      visualizer.setSceneSource({
        getScene: () => replayScene,
        getArWorldGroup: () => replayGroup,
      });
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      expect(visualizer.getCounts()).toEqual({
        raw: 1,
        fused: 1,
        snapshots: 0,
      });
      expect(
        replayScene.children.some((c) => c.name.startsWith('raw-gps-'))
      ).toBe(true);
      expect(
        replayGroup.children.some((c) => c.name.startsWith('fused-'))
      ).toBe(true);
    });

    /**
     * Why this test matters:
     * setSceneSource(null) must restore the live-session default so a live AR
     * session started after a replay parents markers into the live scene
     * again — the override must not leak across scene lifetimes.
     */
    it('setSceneSource(null) restores the live-session default', () => {
      const replayScene = new THREE.Scene();
      const replayGroup = new THREE.Group();
      replayScene.add(replayGroup);
      visualizer.setSceneSource({
        getScene: () => replayScene,
        getArWorldGroup: () => replayGroup,
      });

      visualizer.setSceneSource(null);
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      // Markers landed in the (mocked) LIVE scene, not the replay scene.
      expect(
        mockScene.children.some((c) => c.name.startsWith('raw-gps-'))
      ).toBe(true);
      expect(replayScene.children).toHaveLength(1); // only replayGroup
      expect(replayGroup.children).toHaveLength(0);
    });

    /**
     * Why this test matters:
     * clearAll() must remove markers from the scene the source currently
     * points at (replay dispose clears before restoring the default).
     */
    it('clearAll removes markers from the override scene', () => {
      const replayScene = new THREE.Scene();
      const replayGroup = new THREE.Group();
      replayScene.add(replayGroup);
      visualizer.setSceneSource({
        getScene: () => replayScene,
        getArWorldGroup: () => replayGroup,
      });
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      visualizer.clearAll();

      expect(visualizer.getCounts()).toEqual({
        raw: 0,
        fused: 0,
        snapshots: 0,
      });
      expect(
        replayScene.children.some((c) => c.name.startsWith('raw-gps-'))
      ).toBe(false);
      expect(replayGroup.children).toHaveLength(0);
    });
  });

  describe('addGpsEvent', () => {
    it('does not create markers if zero ref not set', () => {
      const gpsCoords: Vector3 = [10, 5, 20]; // meters from zero
      const odomPosition: Vector3 = [1, 2, 3];

      const childrenBefore = mockScene.children.length;
      visualizer.addGpsEvent(gpsCoords, odomPosition);

      // No new children added to scene or arWorldGroup
      expect(mockScene.children.length).toBe(childrenBefore);
      expect(
        mockArWorldGroup.children.filter((c) => c.name.startsWith('fused-'))
      ).toHaveLength(0);
      expect(visualizer.getCounts().raw).toBe(0);
      expect(visualizer.getCounts().fused).toBe(0);
    });

    it('does not create markers if scene unavailable', () => {
      vi.mocked(getScene).mockReturnValue(null);
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const gpsCoords: Vector3 = [10, 5, 20];
      const odomPosition: Vector3 = [1, 2, 3];

      visualizer.addGpsEvent(gpsCoords, odomPosition);

      expect(visualizer.getCounts().raw).toBe(0);
    });

    it('does not create fused marker if arWorldGroup unavailable', () => {
      // Why: arWorldGroup may not be initialized in headless/test paths.
      // Raw GPS marker should still be created; fused marker skipped.
      vi.mocked(getArWorldGroup).mockReturnValue(null);
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      // Raw marker created in scene root
      expect(visualizer.getCounts().raw).toBe(1);
      // Fused marker NOT created (no arWorldGroup)
      expect(visualizer.getCounts().fused).toBe(0);
    });

    it('creates yellow sphere for raw GPS position in scene root', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const gpsCoords: Vector3 = [10, 5, 20];
      const odomPosition: Vector3 = [1, 2, 3];

      visualizer.addGpsEvent(gpsCoords, odomPosition);

      // Raw GPS marker added to scene root (not arWorldGroup)
      const rawMarker = mockScene.children.find((c) =>
        c.name.startsWith('raw-gps-')
      ) as THREE.Mesh;
      expect(rawMarker).toBeDefined();
      const rawMaterial = rawMarker.material as THREE.MeshBasicMaterial;
      expect(rawMaterial.color.getHex()).toBe(0xffff00); // Yellow

      // Verify position matches GPS coords
      expect(rawMarker.position.x).toBeCloseTo(10);
      expect(rawMarker.position.y).toBeCloseTo(5);
      expect(rawMarker.position.z).toBeCloseTo(20);
    });

    it('creates cyan sphere for fused position in arWorldGroup at raw odom coords', () => {
      // Why: fused markers live in arWorldGroup so scene-graph propagation
      // (arWorldGroup.matrix × odomPos) produces the correct world position.
      // The marker's local position is the RAW odometry position — no manual
      // matrix transform needed.
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const gpsCoords: Vector3 = [10, 5, 20];
      const odomPosition: Vector3 = [1, 2, 3];

      visualizer.addGpsEvent(gpsCoords, odomPosition);

      // Fused marker should be a child of arWorldGroup, NOT scene root
      const fusedMarker = mockArWorldGroup.children.find((c) =>
        c.name.startsWith('fused-')
      ) as THREE.Mesh;
      expect(fusedMarker).toBeDefined();
      const fusedMaterial = fusedMarker.material as THREE.MeshBasicMaterial;
      expect(fusedMaterial.color.getHex()).toBe(0x00ffff); // Cyan

      // Position is raw odom coords (no alignment transform applied manually)
      expect(fusedMarker.position.x).toBeCloseTo(1);
      expect(fusedMarker.position.y).toBeCloseTo(2);
      expect(fusedMarker.position.z).toBeCloseTo(3);

      // Verify it is NOT in scene root's direct children
      const fusedInScene = mockScene.children.find((c) =>
        c.name.startsWith('fused-')
      );
      expect(fusedInScene).toBeUndefined();
    });

    it('increments counts for each GPS event added', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);
      expect(visualizer.getCounts()).toEqual({
        raw: 1,
        fused: 1,
        snapshots: 0,
      });

      visualizer.addGpsEvent([15, 6, 25], [4, 5, 6]);
      expect(visualizer.getCounts()).toEqual({
        raw: 2,
        fused: 2,
        snapshots: 0,
      });

      visualizer.addGpsEvent([20, 7, 30], [7, 8, 9]);
      expect(visualizer.getCounts()).toEqual({
        raw: 3,
        fused: 3,
        snapshots: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Accuracy-aware raw-GPS ellipsoid (rec31 altitude-drop investigation §3)
  // ---------------------------------------------------------------------------
  // Why these tests matter:
  // - In replay mode we want the yellow sphere to encode GPS 1σ accuracy via
  //   non-uniform scale. The scale must be passed BOTH-axes-or-nothing — a
  //   half-populated accuracy field would otherwise produce a degenerate
  //   ellipsoid (zero or NaN axis).
  // - The cyan fused / red snapshot markers must remain a uniform fixed-size
  //   sphere regardless of the new accuracy argument.
  describe('addGpsEvent accuracy-aware ellipsoid (§3)', () => {
    const setupZero = () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
    };
    const findRaw = (): THREE.Mesh =>
      mockScene.children.find((c) =>
        c.name.startsWith('raw-gps-')
      ) as THREE.Mesh;
    const findFused = (): THREE.Mesh =>
      mockArWorldGroup.children.find((c) =>
        c.name.startsWith('fused-')
      ) as THREE.Mesh;

    it('applies non-uniform mesh.scale when both accuracies are positive', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: 4.5,
        vertical: 12,
      });

      const raw = findRaw();
      // Unit sphere scaled by accuracy: (h, v, h)
      const geo = raw.geometry as THREE.SphereGeometry;
      expect(geo.parameters.radius).toBeCloseTo(1);
      expect(raw.scale.x).toBeCloseTo(4.5);
      expect(raw.scale.y).toBeCloseTo(12);
      expect(raw.scale.z).toBeCloseTo(4.5);
    });

    it('falls back to legacy fixed 4 cm sphere when accuracy is omitted', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      const raw = findRaw();
      const geo = raw.geometry as THREE.SphereGeometry;
      expect(geo.parameters.radius).toBeCloseTo(0.04);
      // Identity scale
      expect(raw.scale.x).toBeCloseTo(1);
      expect(raw.scale.y).toBeCloseTo(1);
      expect(raw.scale.z).toBeCloseTo(1);
    });

    it('treats horizontal ≤ 0 as missing (no scale applied)', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: 0,
        vertical: 12,
      });

      const raw = findRaw();
      expect(
        (raw.geometry as THREE.SphereGeometry).parameters.radius
      ).toBeCloseTo(0.04);
      expect(raw.scale.x).toBeCloseTo(1);
      expect(raw.scale.y).toBeCloseTo(1);
      expect(raw.scale.z).toBeCloseTo(1);
    });

    it('treats vertical ≤ 0 as missing (no scale applied)', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: 4.5,
        vertical: -1,
      });

      const raw = findRaw();
      expect(
        (raw.geometry as THREE.SphereGeometry).parameters.radius
      ).toBeCloseTo(0.04);
      expect(raw.scale.x).toBeCloseTo(1);
    });

    it('treats undefined fields as missing (no scale applied)', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: 4.5,
        // vertical omitted
      });

      const raw = findRaw();
      expect(
        (raw.geometry as THREE.SphereGeometry).parameters.radius
      ).toBeCloseTo(0.04);
      expect(raw.scale.x).toBeCloseTo(1);
    });

    // Why this test matters: although the `accuracy` parameter is typed
    // `GpsEventAccuracy | undefined`, this is exported library API. A non-TS
    // caller (or a nullable API response forwarded verbatim) could pass `null`.
    // Before the `== null` guard, the `=== undefined` check let `null` through
    // and the subsequent destructuring (`const { horizontal, vertical } =
    // accuracy`) threw a TypeError, crashing the marker render. This asserts
    // `null` falls back to the legacy fixed 4 cm sphere instead of throwing.
    it('treats explicit null accuracy as missing (no crash, legacy sphere)', () => {
      setupZero();

      expect(() =>
        visualizer.addGpsEvent(
          [10, 5, 20],
          [1, 2, 3],
          null as unknown as undefined
        )
      ).not.toThrow();

      const raw = findRaw();
      expect(
        (raw.geometry as THREE.SphereGeometry).parameters.radius
      ).toBeCloseTo(0.04);
      expect(raw.scale.x).toBeCloseTo(1);
      expect(raw.scale.y).toBeCloseTo(1);
      expect(raw.scale.z).toBeCloseTo(1);
    });

    // A non-finite accuracy (Infinity/NaN) must fall back to the fixed sphere:
    // scaling a Three.js mesh by Infinity corrupts its world matrix and can
    // crash rendering. `Infinity > 0` is true, so the positive-value guard
    // alone would let it through — this asserts the Number.isFinite guard.
    it('treats Infinity accuracy as missing (no scale applied)', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: Infinity,
        vertical: 12,
      });

      const raw = findRaw();
      expect(
        (raw.geometry as THREE.SphereGeometry).parameters.radius
      ).toBeCloseTo(0.04);
      expect(raw.scale.x).toBeCloseTo(1);
      expect(raw.scale.y).toBeCloseTo(1);
      expect(raw.scale.z).toBeCloseTo(1);
    });

    it('treats NaN accuracy as missing (no scale applied)', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: 4.5,
        vertical: NaN,
      });

      const raw = findRaw();
      expect(
        (raw.geometry as THREE.SphereGeometry).parameters.radius
      ).toBeCloseTo(0.04);
      expect(raw.scale.x).toBeCloseTo(1);
    });

    it('lowers raw-GPS opacity when ellipsoid mode is active (so cyan/red stay visible inside)', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: 4.5,
        vertical: 12,
      });

      const raw = findRaw();
      const mat = raw.material as THREE.MeshBasicMaterial;
      // Picked from plan range 0.12–0.15.
      expect(mat.opacity).toBeLessThan(0.16);
      expect(mat.opacity).toBeGreaterThan(0.1);
    });

    it('keeps raw-GPS opacity at the legacy 0.3 when no accuracy is passed', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      const raw = findRaw();
      const mat = raw.material as THREE.MeshBasicMaterial;
      expect(mat.opacity).toBeCloseTo(0.3);
    });

    it('cyan fused marker is NOT scaled by accuracy', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: 4.5,
        vertical: 12,
      });

      const fused = findFused();
      const geo = fused.geometry as THREE.SphereGeometry;
      // Cyan keeps the fixed 4 cm radius and identity scale.
      expect(geo.parameters.radius).toBeCloseTo(0.04);
      expect(fused.scale.x).toBeCloseTo(1);
      expect(fused.scale.y).toBeCloseTo(1);
      expect(fused.scale.z).toBeCloseTo(1);
    });

    it('red snapshot marker is NOT affected by addGpsEvent accuracy', () => {
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: 4.5,
        vertical: 12,
      });
      visualizer.addAlignmentSnapshot([10, 5, 20]);

      const snap = mockScene.children.find((c) =>
        c.name.startsWith('alignment-snapshot-')
      ) as THREE.Mesh;
      const geo = snap.geometry as THREE.SphereGeometry;
      expect(geo.parameters.radius).toBeCloseTo(0.05);
      expect(snap.scale.x).toBeCloseTo(1);
      expect(snap.scale.y).toBeCloseTo(1);
      expect(snap.scale.z).toBeCloseTo(1);
    });

    it('raw-GPS ellipsoid gets renderOrder < 0 so cyan/red draw on top', () => {
      // Why: large translucent ellipsoids must render before smaller markers
      // so the cyan / red spheres inside them remain visible.
      setupZero();

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3], {
        horizontal: 4.5,
        vertical: 12,
      });

      const raw = findRaw();
      expect(raw.renderOrder).toBeLessThan(0);
    });
  });

  describe('scene-graph propagation (alignment via arWorldGroup)', () => {
    it('fused markers get correct world position when arWorldGroup has alignment matrix', () => {
      // Why: this verifies the core architectural change — fused markers are
      // children of arWorldGroup, so their world position is automatically
      // arWorldGroup.matrix × localPosition. No manual updateAlignment needed.
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 0, 0]);

      const fusedMarker = mockArWorldGroup.children.find((c) =>
        c.name.startsWith('fused-')
      ) as THREE.Mesh;

      // Local position is raw odom
      expect(fusedMarker.position.x).toBeCloseTo(1);
      expect(fusedMarker.position.y).toBeCloseTo(0);
      expect(fusedMarker.position.z).toBeCloseTo(0);

      // Now simulate alignment: translate arWorldGroup by (5, 10, 15)
      mockArWorldGroup.matrixAutoUpdate = false;
      mockArWorldGroup.matrix.makeTranslation(5, 10, 15);
      mockArWorldGroup.updateMatrixWorld(true);

      // World position should be alignment + odom = (6, 10, 15)
      const worldPos = new THREE.Vector3();
      fusedMarker.getWorldPosition(worldPos);
      expect(worldPos.x).toBeCloseTo(6);
      expect(worldPos.y).toBeCloseTo(10);
      expect(worldPos.z).toBeCloseTo(15);
    });

    it('all fused markers update world position when arWorldGroup alignment changes', () => {
      // Why: scene-graph propagation must work for ALL children, not just the latest
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [0, 0, 0]);
      visualizer.addGpsEvent([15, 6, 25], [1, 0, 0]);
      visualizer.addGpsEvent([20, 7, 30], [2, 0, 0]);

      // Apply alignment translation of (100, 0, 0) to arWorldGroup
      mockArWorldGroup.matrixAutoUpdate = false;
      mockArWorldGroup.matrix.makeTranslation(100, 0, 0);
      mockArWorldGroup.updateMatrixWorld(true);

      const fusedMarkers = mockArWorldGroup.children.filter((c) =>
        c.name.startsWith('fused-')
      ) as THREE.Mesh[];
      expect(fusedMarkers).toHaveLength(3);

      const worldPos = new THREE.Vector3();
      fusedMarkers[0].getWorldPosition(worldPos);
      expect(worldPos.x).toBeCloseTo(100);
      fusedMarkers[1].getWorldPosition(worldPos);
      expect(worldPos.x).toBeCloseTo(101);
      fusedMarkers[2].getWorldPosition(worldPos);
      expect(worldPos.x).toBeCloseTo(102);
    });

    it('raw GPS markers are NOT affected by arWorldGroup alignment', () => {
      // Why: raw GPS markers are in scene root, outside arWorldGroup
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [0, 0, 0]);

      const rawMarker = mockScene.children.find((c) =>
        c.name.startsWith('raw-gps-')
      ) as THREE.Mesh;

      // Apply alignment to arWorldGroup
      mockArWorldGroup.matrixAutoUpdate = false;
      mockArWorldGroup.matrix.makeTranslation(100, 100, 100);
      mockArWorldGroup.updateMatrixWorld(true);

      // Raw marker world position unchanged (it's in scene root)
      const worldPos = new THREE.Vector3();
      rawMarker.getWorldPosition(worldPos);
      expect(worldPos.x).toBeCloseTo(10);
      expect(worldPos.y).toBeCloseTo(5);
      expect(worldPos.z).toBeCloseTo(20);
    });
  });

  describe('clearAll', () => {
    it('removes all markers from scene and arWorldGroup', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);
      visualizer.addGpsEvent([15, 6, 25], [4, 5, 6]);

      // 2 raw in scene root + arWorldGroup = 3 direct scene children
      // 2 fused in arWorldGroup
      expect(
        mockArWorldGroup.children.filter((c) => c.name.startsWith('fused-'))
      ).toHaveLength(2);
      expect(
        mockScene.children.filter((c) => c.name.startsWith('raw-gps-'))
      ).toHaveLength(2);

      visualizer.clearAll();

      expect(
        mockScene.children.filter((c) => c.name.startsWith('raw-gps-'))
      ).toHaveLength(0);
      expect(
        mockArWorldGroup.children.filter((c) => c.name.startsWith('fused-'))
      ).toHaveLength(0);
      expect(visualizer.getCounts()).toEqual({
        raw: 0,
        fused: 0,
        snapshots: 0,
      });
    });

    it('resets zero reference', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.clearAll();

      expect(visualizer.getZeroRef()).toBeNull();
    });

    it('disposes of geometry and material', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      const rawMarker = mockScene.children.find((c) =>
        c.name.startsWith('raw-gps-')
      ) as THREE.Mesh;
      const geometryDisposeSpy = vi.spyOn(rawMarker.geometry, 'dispose');
      const materialDisposeSpy = vi.spyOn(
        rawMarker.material as THREE.Material,
        'dispose'
      );

      visualizer.clearAll();

      expect(geometryDisposeSpy).toHaveBeenCalled();
      expect(materialDisposeSpy).toHaveBeenCalled();
    });
  });

  describe('getCounts', () => {
    it('returns zero counts initially', () => {
      expect(visualizer.getCounts()).toEqual({
        raw: 0,
        fused: 0,
        snapshots: 0,
      });
    });

    it('returns correct counts after adding events', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);
      visualizer.addGpsEvent([15, 6, 25], [4, 5, 6]);

      expect(visualizer.getCounts()).toEqual({
        raw: 2,
        fused: 2,
        snapshots: 0,
      });
    });
  });

  describe('getRawMarkerWorldSizes (§3c bbox diagnostic)', () => {
    /**
     * Why these tests matter: a test of accuracy-ellipsoid scaling
     * relies on this accessor to read back the world-space size of each
     * raw-GPS marker via `THREE.Box3.setFromObject`. Bounding-box math is
     * the real invariant we want to test (pixel diffs are brittle).
     */

    it('returns an empty array when no markers exist', () => {
      expect(visualizer.getRawMarkerWorldSizes()).toEqual([]);
    });

    it('returns markedly larger bbox for a low-accuracy event (large reported uncertainty) than for a high-accuracy event', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      // Same position so positions don't dominate the bbox — only scale differs.
      visualizer.addGpsEvent([0, 0, 0], [0, 0, 0], {
        horizontal: 5,
        vertical: 5,
      });
      visualizer.addGpsEvent([0, 0, 0], [0, 0, 0], {
        horizontal: 40,
        vertical: 40,
      });

      const sizes = visualizer.getRawMarkerWorldSizes();
      expect(sizes).toHaveLength(2);
      // Sphere diameter = 2 × radius (= 1) × scale.
      // Event 1 (high accuracy, 5 m uncertainty): ~10m on each axis.
      // Event 2 (low accuracy, 40 m uncertainty): ~80m. Allow tolerance for
      // the sphere-tessellation approximation in Box3.setFromObject.
      expect(sizes[0].x).toBeGreaterThan(8);
      expect(sizes[0].x).toBeLessThan(12);
      expect(sizes[1].x).toBeGreaterThan(70);
      expect(sizes[1].x).toBeLessThan(90);
      // Ratio should be close to 8 (= 40/5).
      expect(sizes[1].x / sizes[0].x).toBeGreaterThan(6);
      expect(sizes[1].x / sizes[0].x).toBeLessThan(10);
    });

    it('legacy fixed sphere has ~8cm bbox (2 × 4cm radius)', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.addGpsEvent([0, 0, 0], [0, 0, 0]); // no accuracy → legacy

      const sizes = visualizer.getRawMarkerWorldSizes();
      expect(sizes).toHaveLength(1);
      // Radius halved 0.08 → 0.04 (D5), so the tessellated bbox is ~8 cm.
      expect(sizes[0].x).toBeGreaterThan(0.05);
      expect(sizes[0].x).toBeLessThan(0.1);
    });
  });

  describe('marker sizing', () => {
    it('creates spheres with 4cm radius (smaller than ref points)', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      const rawMarker = mockScene.children.find((c) =>
        c.name.startsWith('raw-gps-')
      ) as THREE.Mesh;

      // SphereGeometry stores radius in parameters
      const geometry = rawMarker.geometry as THREE.SphereGeometry;
      expect(geometry.parameters.radius).toBeCloseTo(0.04);
    });
  });

  describe('marker transparency', () => {
    /**
     * Why this test matters:
     * User feedback (2026-01-27): Solid GPS markers obstruct AR camera view.
     * Markers should be semi-transparent to allow seeing the scene behind them.
     */
    it('creates raw GPS markers with 30% opacity', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      const rawMarker = mockScene.children.find((c) =>
        c.name.startsWith('raw-gps-')
      ) as THREE.Mesh;
      const material = rawMarker.material as THREE.MeshBasicMaterial;

      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeCloseTo(0.3);
    });

    it('creates fused markers with 30% opacity', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      const fusedMarker = mockArWorldGroup.children.find((c) =>
        c.name.startsWith('fused-')
      ) as THREE.Mesh;
      const material = fusedMarker.material as THREE.MeshBasicMaterial;

      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeCloseTo(0.3);
    });

    /**
     * Why this test matters:
     * depthWrite: false prevents z-fighting when transparent spheres overlap.
     * Without this, overlapping markers have visual artifacts.
     */
    it('disables depth writing for raw GPS markers to prevent z-fighting', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      const rawMarker = mockScene.children.find((c) =>
        c.name.startsWith('raw-gps-')
      ) as THREE.Mesh;
      const material = rawMarker.material as THREE.MeshBasicMaterial;

      expect(material.depthWrite).toBe(false);
    });

    it('disables depth writing for fused markers to prevent z-fighting', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);

      const fusedMarker = mockArWorldGroup.children.find((c) =>
        c.name.startsWith('fused-')
      ) as THREE.Mesh;
      const material = fusedMarker.material as THREE.MeshBasicMaterial;

      expect(material.depthWrite).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Visibility toggle (Finding B / Slice 3 of
  // 2026-06-14-0012-frame-tile-legacy-aspect-and-live-toggle-followup.md)
  // ---------------------------------------------------------------------------
  // Why these tests matter: the recorder's new `visualization.gpsAlignmentMarkers`
  // toggle must be able to hide ALL GPS+VIO debug spheres live — raw (yellow),
  // fused (cyan), AND alignment-snapshot (red) — without touching capture or
  // replay. The markers are created at different times, so the contract is:
  // setVisible(false) hides every existing marker AND every marker added
  // afterwards (the live store-subscriber keeps adding events during recording);
  // setVisible(true) restores them. This is the load-bearing new framework
  // capability the recorder's Enter-AR gating depends on.
  describe('setVisible', () => {
    const findRaw = (): THREE.Mesh[] =>
      mockScene.children.filter((c) =>
        c.name.startsWith('raw-gps-')
      ) as THREE.Mesh[];
    const findFused = (): THREE.Mesh[] =>
      mockArWorldGroup.children.filter((c) =>
        c.name.startsWith('fused-')
      ) as THREE.Mesh[];
    const findSnapshots = (): THREE.Mesh[] =>
      mockScene.children.filter((c) =>
        c.name.startsWith('alignment-snapshot-')
      ) as THREE.Mesh[];

    it('markers are visible by default (purely additive — no behaviour change)', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);
      visualizer.addAlignmentSnapshot([10, 0, 5]);

      expect(findRaw()[0].visible).toBe(true);
      expect(findFused()[0].visible).toBe(true);
      expect(findSnapshots()[0].visible).toBe(true);
    });

    it('setVisible(false) hides existing raw, fused, and snapshot markers; setVisible(true) restores', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);
      visualizer.addGpsEvent([15, 6, 25], [4, 5, 6]);
      visualizer.addAlignmentSnapshot([10, 0, 5]);

      visualizer.setVisible(false);
      for (const m of [...findRaw(), ...findFused(), ...findSnapshots()]) {
        expect(m.visible).toBe(false);
      }

      visualizer.setVisible(true);
      for (const m of [...findRaw(), ...findFused(), ...findSnapshots()]) {
        expect(m.visible).toBe(true);
      }
    });

    it('markers added AFTER setVisible(false) inherit the hidden state', () => {
      // The live store-subscriber keeps adding events during recording — a
      // marker spawned after the operator opted out must NOT pop into view.
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.setVisible(false);

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);
      visualizer.addAlignmentSnapshot([10, 0, 5]);

      expect(findRaw()[0].visible).toBe(false);
      expect(findFused()[0].visible).toBe(false);
      expect(findSnapshots()[0].visible).toBe(false);
    });

    it('markers added AFTER setVisible(true) are visible again', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.setVisible(false);
      visualizer.setVisible(true);

      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);
      expect(findRaw()[0].visible).toBe(true);
      expect(findFused()[0].visible).toBe(true);
    });

    it('clearAll resets visibility to visible (replay safety after a live opt-out)', () => {
      // The visualizer is a singleton shared by live + replay. If a live
      // session opted out (setVisible(false)) and then replay started, replay
      // markers must still show — clearAll restores the pristine visible state.
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.setVisible(false);
      visualizer.clearAll();

      // A fresh marker (e.g. the first replay event) is visible again.
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.addGpsEvent([10, 5, 20], [1, 2, 3]);
      expect(findRaw()[0].visible).toBe(true);
      expect(findFused()[0].visible).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Alignment Snapshot Markers (Issue #1 — feedback session 2026-03-21)
  // ---------------------------------------------------------------------------
  describe('addAlignmentSnapshot / getAlignmentSnapshotPositions', () => {
    it('creates a red sphere at the given NUE position in scene root', () => {
      // Why: alignment snapshots represent the system's best GPS estimate at each
      // alignment update — they belong in scene root (GPS world space), not arWorldGroup.
      visualizer.addAlignmentSnapshot([10, 0, 5]);

      const snapshotMarker = mockScene.children.find((c) =>
        c.name.startsWith('alignment-snapshot-')
      ) as THREE.Mesh;
      expect(snapshotMarker).toBeDefined();

      const material = snapshotMarker.material as THREE.MeshBasicMaterial;
      expect(material.color.getHex()).toBe(0xff0000); // Red

      expect(snapshotMarker.position.x).toBeCloseTo(10);
      expect(snapshotMarker.position.y).toBeCloseTo(0);
      expect(snapshotMarker.position.z).toBeCloseTo(5);
    });

    it('uses 5cm radius for snapshot spheres (slightly larger than GPS markers)', () => {
      // Why: snapshots should stand out from the 4cm GPS marker spheres
      visualizer.addAlignmentSnapshot([0, 0, 0]);

      const snapshotMarker = mockScene.children.find((c) =>
        c.name.startsWith('alignment-snapshot-')
      ) as THREE.Mesh;
      const geometry = snapshotMarker.geometry as THREE.SphereGeometry;
      expect(geometry.parameters.radius).toBeCloseTo(0.05);
    });

    it('creates snapshot markers with 50% opacity', () => {
      // Why: higher opacity than GPS markers (30%) so snapshots are more visible
      visualizer.addAlignmentSnapshot([0, 0, 0]);

      const snapshotMarker = mockScene.children.find((c) =>
        c.name.startsWith('alignment-snapshot-')
      ) as THREE.Mesh;
      const material = snapshotMarker.material as THREE.MeshBasicMaterial;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeCloseTo(0.5);
    });

    it('does not require scene to be available (graceful skip)', () => {
      // Why: during tests or headless modes the scene might be null
      vi.mocked(getScene).mockReturnValue(null);

      expect(() => visualizer.addAlignmentSnapshot([1, 2, 3])).not.toThrow();
      expect(visualizer.getAlignmentSnapshotPositions()).toEqual([]);
    });

    it('returns empty array when no snapshots have been added', () => {
      expect(visualizer.getAlignmentSnapshotPositions()).toEqual([]);
    });

    it('returns positions for all added snapshots', () => {
      // Why: positions are read back at session end for GPS coordinate conversion
      visualizer.addAlignmentSnapshot([10, 0, 5]);
      visualizer.addAlignmentSnapshot([20, 1, 10]);
      visualizer.addAlignmentSnapshot([30, 2, 15]);

      const positions = visualizer.getAlignmentSnapshotPositions();
      expect(positions).toHaveLength(3);
      expect(positions[0]).toEqual([10, 0, 5]);
      expect(positions[1]).toEqual([20, 1, 10]);
      expect(positions[2]).toEqual([30, 2, 15]);
    });

    it('increments snapshot count correctly', () => {
      visualizer.addAlignmentSnapshot([10, 0, 5]);
      visualizer.addAlignmentSnapshot([20, 1, 10]);

      expect(visualizer.getCounts().snapshots).toBe(2);
    });

    it('clearAll removes snapshot markers and resets count', () => {
      // Why: cleanup must dispose ALL marker types including snapshots
      visualizer.addAlignmentSnapshot([10, 0, 5]);
      visualizer.addAlignmentSnapshot([20, 1, 10]);

      visualizer.clearAll();

      expect(visualizer.getCounts().snapshots).toBe(0);
      expect(visualizer.getAlignmentSnapshotPositions()).toEqual([]);
      expect(
        mockScene.children.filter((c) =>
          c.name.startsWith('alignment-snapshot-')
        )
      ).toHaveLength(0);
    });

    it('disposes geometry and material on clearAll', () => {
      visualizer.addAlignmentSnapshot([10, 0, 5]);

      const snapshotMarker = mockScene.children.find((c) =>
        c.name.startsWith('alignment-snapshot-')
      ) as THREE.Mesh;
      const geometryDisposeSpy = vi.spyOn(snapshotMarker.geometry, 'dispose');
      const materialDisposeSpy = vi.spyOn(
        snapshotMarker.material as THREE.Material,
        'dispose'
      );

      visualizer.clearAll();

      expect(geometryDisposeSpy).toHaveBeenCalled();
      expect(materialDisposeSpy).toHaveBeenCalled();
    });

    it('snapshots are NOT affected by arWorldGroup alignment changes', () => {
      // Why: snapshots are in scene root (like raw GPS), not in arWorldGroup —
      // they represent the system's best position estimate at the time of the
      // alignment update, already in GPS world space.
      visualizer.addAlignmentSnapshot([10, 0, 5]);

      mockArWorldGroup.matrixAutoUpdate = false;
      mockArWorldGroup.matrix.makeTranslation(100, 100, 100);
      mockArWorldGroup.updateMatrixWorld(true);

      const snapshotMarker = mockScene.children.find((c) =>
        c.name.startsWith('alignment-snapshot-')
      ) as THREE.Mesh;
      const worldPos = new THREE.Vector3();
      snapshotMarker.getWorldPosition(worldPos);

      expect(worldPos.x).toBeCloseTo(10);
      expect(worldPos.y).toBeCloseTo(0);
      expect(worldPos.z).toBeCloseTo(5);
    });
  });
});
