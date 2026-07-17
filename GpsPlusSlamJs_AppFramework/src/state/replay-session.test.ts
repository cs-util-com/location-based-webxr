/**
 * @vitest-environment jsdom
 *
 * Tests for `startReplaySession` — the framework composer for desktop replay.
 *
 * Why this test matters:
 * This is the "replay in a handful of lines" entry point a fresh consumer (the
 * PhysicsDemo) builds on. The composition must actually connect the replayed
 * `recordDepthSample` stream to the occupancy grid and its cube visualizer (the
 * "replay reconstructs the live mesh" promise), expose the pieces a physics
 * consumer needs (store, scene, grid, occlusion mesh), and tear everything down
 * on dispose — including restoring the GPS-marker singleton's scene source so a
 * later AR session is unaffected. The WebGL scene and the NUE↔WebXR converters
 * are mocked (jsdom has no GL); everything else is the real composition.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// The desktop scene creates a real WebGLRenderer — mock it for jsdom. Return
// value is configured per-test (below) where THREE is in scope.
vi.mock('../ar/replay-scene', () => ({
  initReplayScene: vi.fn(),
  disposeReplayScene: vi.fn(),
  updateOrbitTarget: vi.fn(),
  getAlignmentLerper: vi.fn(() => ({ setTarget: vi.fn() })),
}));
// Stub the heavy webxr-session module: the replay path needs the two pose
// converters (identity here — NUE≈WebXR for the test), and gps-event-markers
// (pulled in transitively) needs getScene/getArWorldGroup.
vi.mock('../ar/webxr-session', () => ({
  nuePositionToWebXR: (p: readonly number[]) => [...p],
  nueQuaternionToWebXR: (q: readonly number[]) => [...q],
  getScene: vi.fn(),
  getArWorldGroup: vi.fn(),
}));

import { startReplaySession } from './replay-session';
import { initReplayScene, disposeReplayScene } from '../ar/replay-scene';
import { OccupancyGrid } from '../ar/occupancy-grid';
import { OccupancyCubesVisualizer } from '../visualization/occupancy-cubes-visualizer';
import { gpsEventVisualizer } from '../visualization/gps-event-markers';
import { recordDepthSample } from './recording-slice';
import type { DepthSample } from '../types/ar-types';

function makeSceneRefs() {
  return {
    scene: new THREE.Scene(),
    arWorldGroup: new THREE.Group(),
    arpose: new THREE.Object3D(),
    camera: new THREE.PerspectiveCamera(),
    renderer: {} as unknown as THREE.WebGLRenderer,
  };
}

function makeSample(x: number): DepthSample {
  return {
    timestamp: x,
    cameraPos: [x, 1.5, 0],
    cameraRot: [0, 0, 0, 1],
    points: [],
  };
}

describe('startReplaySession', () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Reset module-mock call counts (initReplayScene/disposeReplayScene persist
    // across tests) before re-establishing this test's scene.
    vi.clearAllMocks();
    container = document.createElement('div');
    vi.mocked(initReplayScene).mockReturnValue(makeSceneRefs());
  });

  afterEach(() => {
    gpsEventVisualizer.setSceneSource(null);
    vi.restoreAllMocks();
  });

  it('exposes a controller with the full replay + physics-consumer surface', () => {
    const session = startReplaySession({ actions: [], container });
    for (const method of [
      'play',
      'pause',
      'resume',
      'setSpeed',
      'getState',
      'getStore',
      'getScene',
      'getOccupancyGrid',
      'getCubesVisualizer',
      'getOcclusionMesh',
      'getActionCount',
      'dispose',
    ]) {
      expect(
        typeof (session as unknown as Record<string, unknown>)[method]
      ).toBe('function');
    }
    // Occupancy on by default → grid + cubes + occlusion mesh built and exposed.
    expect(session.getOccupancyGrid()).toBeInstanceOf(OccupancyGrid);
    expect(session.getCubesVisualizer()).not.toBeNull();
    expect(session.getOcclusionMesh()).not.toBeNull();
    expect(session.getActionCount()).toBe(0);
    session.dispose();
  });

  it('folds a replayed depth sample into the grid and refreshes the cubes', () => {
    const addSampleSpy = vi.spyOn(OccupancyGrid.prototype, 'addSample');
    const refreshSpy = vi.spyOn(OccupancyCubesVisualizer.prototype, 'refresh');

    const session = startReplaySession({ actions: [], container });

    // Dispatching the recorded action into the session's OWN store must drive
    // the occupancy subscriber synchronously (leading-edge refresh).
    session.getStore().dispatch(recordDepthSample(makeSample(1)));

    expect(addSampleSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    // The cube refresh received the sample's head pose for over-cap ranking.
    expect(refreshSpy.mock.calls[0]?.[1]).toEqual({
      cameraPos: [1, 1.5, 0],
      cameraRot: [0, 0, 0, 1],
    });
    session.dispose();
  });

  it('builds no occupancy grid when occupancy is disabled', () => {
    const session = startReplaySession({
      actions: [],
      container,
      occupancy: { enabled: false },
    });
    expect(session.getOccupancyGrid()).toBeNull();
    expect(session.getCubesVisualizer()).toBeNull();
    expect(session.getOcclusionMesh()).toBeNull();
    session.dispose();
  });

  it('tears down the scene and detaches the occupancy subscriber on dispose', () => {
    const setSceneSourceSpy = vi.spyOn(gpsEventVisualizer, 'setSceneSource');
    const addSampleSpy = vi.spyOn(OccupancyGrid.prototype, 'addSample');

    const session = startReplaySession({ actions: [], container });
    const store = session.getStore();
    store.dispatch(recordDepthSample(makeSample(1)));
    expect(addSampleSpy).toHaveBeenCalledTimes(1);

    session.dispose();

    // Scene torn down and the marker singleton's scene source restored to null.
    expect(disposeReplayScene).toHaveBeenCalledTimes(1);
    expect(setSceneSourceSpy).toHaveBeenLastCalledWith(null);

    // A post-dispose action no longer reaches the grid (subscriber detached).
    store.dispatch(recordDepthSample(makeSample(2)));
    expect(addSampleSpy).toHaveBeenCalledTimes(1);
  });
});
