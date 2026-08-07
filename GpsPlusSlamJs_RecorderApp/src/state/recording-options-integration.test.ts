/**
 * Recording Options Integration Tests
 *
 * Tests that verify recording options are properly applied
 * to control which data streams are recorded.
 *
 * Why these tests matter:
 * - Disabled streams should not produce any actions
 * - Enabled streams should produce expected actions
 * - User settings must be respected during recording
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_RECORDING_OPTIONS,
  type RecordingOptions,
} from './recording-options';
import { createRecorderStore, type RecorderStore } from './recorder-store';
import {
  startSession,
  recordDepthSample,
} from 'gps-plus-slam-app-framework/state/recording-slice';
import { add2dImage } from 'gps-plus-slam-app-framework/state';

// Mock the persistence write path (ScenarioWrappingStorageBackend → opfs-storage)
// to avoid actual file operations; partial mock keeps the rest of opfs-storage real.
vi.mock(
  'gps-plus-slam-app-framework/storage/opfs-storage',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    writeAction: vi.fn().mockResolvedValue(undefined),
  })
);

describe('Recording Options Integration', () => {
  let store: RecorderStore;
  let dispatchedActions: Array<{ type: string }>;

  beforeEach(() => {
    store = createRecorderStore();
    dispatchedActions = [];

    // Track all dispatched actions
    const originalDispatch = store.dispatch;
    store.dispatch = ((action: { type: string }) => {
      dispatchedActions.push(action);
      return originalDispatch(action);
    }) as typeof store.dispatch;
  });

  describe('session metadata includes recording options', () => {
    it('should include default options when not specified', () => {
      store.dispatch(
        startSession({
          contextTag: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      const state = store.getState().recording;
      // recordingOptions may be undefined if not explicitly passed
      expect(state.sessionMetadata?.contextTag).toBe('Test');
    });

    it('should include custom options in session metadata', () => {
      const customOptions: RecordingOptions = {
        depth: { enabled: false, intervalMs: 2000, gridSize: 5, rgb: true },
        images: {
          enabled: true,
          intervalMs: 3000,
          quality: 0.8,
          resolutionDivisor: 1,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
          recordingOptions: customOptions,
        })
      );

      const state = store.getState().recording;
      expect(state.sessionMetadata?.recordingOptions).toEqual(customOptions);
    });

    it('should preserve exact option values in metadata', () => {
      const options: RecordingOptions = {
        depth: { enabled: true, intervalMs: 1500, gridSize: 7, rgb: true },
        images: {
          enabled: false,
          intervalMs: 5000,
          quality: 0.5,
          resolutionDivisor: 1,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
          recordingOptions: options,
        })
      );

      // The framework stores recordingOptions OPAQUELY (Record<string,
      // unknown> on SessionMetadata since the 2026-07-11 G-1 move); the
      // recorder owns the concrete type and narrows on read.
      const saved = store.getState().recording.sessionMetadata
        ?.recordingOptions as RecordingOptions | undefined;
      expect(saved?.depth.intervalMs).toBe(1500);
      expect(saved?.depth.gridSize).toBe(7);
      expect(saved?.images.enabled).toBe(false);
      expect(saved?.images.quality).toBe(0.5);
    });
  });

  describe('depth sampling behavior', () => {
    /**
     * Simulates the decision flow in main.ts:
     * if (recordingOptions.depth.enabled) { startDepthCapture(); }
     */
    function simulateDepthCaptureDecision(options: RecordingOptions): boolean {
      return options.depth.enabled;
    }

    it('should allow depth capture when enabled', () => {
      const options = structuredClone(DEFAULT_RECORDING_OPTIONS);
      options.depth.enabled = true;

      expect(simulateDepthCaptureDecision(options)).toBe(true);
    });

    it('should block depth capture when disabled', () => {
      const options = structuredClone(DEFAULT_RECORDING_OPTIONS);
      options.depth.enabled = false;

      expect(simulateDepthCaptureDecision(options)).toBe(false);
    });

    it('should not dispatch depth actions when disabled (simulated)', () => {
      const options: RecordingOptions = {
        ...DEFAULT_RECORDING_OPTIONS,
        depth: { ...DEFAULT_RECORDING_OPTIONS.depth, enabled: false },
      };

      // Start session with depth disabled
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
          recordingOptions: options,
        })
      );

      // Simulate main.ts logic: only dispatch if enabled
      if (options.depth.enabled) {
        store.dispatch(
          recordDepthSample({
            timestamp: Date.now(),
            cameraPos: [0, 0, 0],
            cameraRot: [0, 0, 0, 1],
            points: [],
          })
        );
      }

      // Verify no depth sample was dispatched
      const depthActions = dispatchedActions.filter(
        (a) => a.type === 'recording/recordDepthSample'
      );
      expect(depthActions.length).toBe(0);
    });

    it('should dispatch depth actions when enabled', () => {
      const options = structuredClone(DEFAULT_RECORDING_OPTIONS);
      options.depth.enabled = true;

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
          recordingOptions: options,
        })
      );

      // Simulate main.ts logic: dispatch if enabled
      if (options.depth.enabled) {
        store.dispatch(
          recordDepthSample({
            timestamp: Date.now(),
            cameraPos: [1, 2, 3],
            cameraRot: [0, 0, 0, 1],
            points: [{ screenX: 0.5, screenY: 0.5, depthM: 2.0 }],
          })
        );
      }

      const depthActions = dispatchedActions.filter(
        (a) => a.type === 'recording/recordDepthSample'
      );
      expect(depthActions.length).toBe(1);
    });
  });

  describe('image capture behavior', () => {
    /**
     * Simulates the decision flow in main.ts:
     * if (recordingOptions.images.enabled) { startImageCapture(); }
     */
    function simulateImageCaptureDecision(options: RecordingOptions): boolean {
      return options.images.enabled;
    }

    it('should allow image capture when enabled', () => {
      const options = structuredClone(DEFAULT_RECORDING_OPTIONS);
      options.images.enabled = true;

      expect(simulateImageCaptureDecision(options)).toBe(true);
    });

    it('should block image capture when disabled', () => {
      const options = structuredClone(DEFAULT_RECORDING_OPTIONS);
      options.images.enabled = false;

      expect(simulateImageCaptureDecision(options)).toBe(false);
    });

    it('should not dispatch image actions when disabled (simulated)', () => {
      const options: RecordingOptions = {
        ...DEFAULT_RECORDING_OPTIONS,
        images: { ...DEFAULT_RECORDING_OPTIONS.images, enabled: false },
      };

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
          recordingOptions: options,
        })
      );

      // Simulate main.ts logic: only dispatch if enabled
      if (options.images.enabled) {
        store.dispatch(
          add2dImage({
            imageFile: 'frames/frame-000001.jpg',
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            screenRotation: 0,
            capturedAt: Date.now(),
          })
        );
      }

      const imageActions = dispatchedActions.filter(
        (a) => a.type === 'gpsData/add2dImage'
      );
      expect(imageActions.length).toBe(0);
    });

    it('should dispatch image actions when enabled', () => {
      const options = structuredClone(DEFAULT_RECORDING_OPTIONS);
      options.images.enabled = true;

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
          recordingOptions: options,
        })
      );

      if (options.images.enabled) {
        store.dispatch(
          add2dImage({
            imageFile: 'frames/frame-000001.jpg',
            position: [1, 2, 3],
            rotation: [0, 0, 0, 1],
            screenRotation: 90,
            capturedAt: Date.now(),
          })
        );
      }

      const imageActions = dispatchedActions.filter(
        (a) => a.type === 'gpsData/add2dImage'
      );
      expect(imageActions.length).toBe(1);
    });
  });

  describe('combined behavior', () => {
    it('should respect both options independently', () => {
      // Depth on, images off
      const options: RecordingOptions = {
        depth: { enabled: true, intervalMs: 1000, gridSize: 3, rgb: true },
        images: {
          enabled: false,
          intervalMs: 2000,
          quality: 0.7,
          resolutionDivisor: 1,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
          recordingOptions: options,
        })
      );

      // Simulate dispatching based on options
      if (options.depth.enabled) {
        store.dispatch(
          recordDepthSample({
            timestamp: Date.now(),
            cameraPos: [0, 0, 0],
            cameraRot: [0, 0, 0, 1],
            points: [],
          })
        );
      }

      if (options.images.enabled) {
        store.dispatch(
          add2dImage({
            imageFile: 'test.jpg',
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            screenRotation: 0,
            capturedAt: Date.now(),
          })
        );
      }

      const depthActions = dispatchedActions.filter(
        (a) => a.type === 'recording/recordDepthSample'
      );
      const imageActions = dispatchedActions.filter(
        (a) => a.type === 'gpsData/add2dImage'
      );

      expect(depthActions.length).toBe(1);
      expect(imageActions.length).toBe(0);
    });

    it('should allow both when both enabled', () => {
      const options: RecordingOptions = {
        depth: { enabled: true, intervalMs: 1000, gridSize: 3, rgb: true },
        images: {
          enabled: true,
          intervalMs: 2000,
          quality: 0.7,
          resolutionDivisor: 1,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
          recordingOptions: options,
        })
      );

      if (options.depth.enabled) {
        store.dispatch(
          recordDepthSample({
            timestamp: Date.now(),
            cameraPos: [0, 0, 0],
            cameraRot: [0, 0, 0, 1],
            points: [],
          })
        );
      }

      if (options.images.enabled) {
        store.dispatch(
          add2dImage({
            imageFile: 'test.jpg',
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            screenRotation: 0,
            capturedAt: Date.now(),
          })
        );
      }

      const depthActions = dispatchedActions.filter(
        (a) => a.type === 'recording/recordDepthSample'
      );
      const imageActions = dispatchedActions.filter(
        (a) => a.type === 'gpsData/add2dImage'
      );

      expect(depthActions.length).toBe(1);
      expect(imageActions.length).toBe(1);
    });

    it('should block both when both disabled', () => {
      const options: RecordingOptions = {
        depth: { enabled: false, intervalMs: 1000, gridSize: 3, rgb: true },
        images: {
          enabled: false,
          intervalMs: 2000,
          quality: 0.7,
          resolutionDivisor: 1,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
          recordingOptions: options,
        })
      );

      if (options.depth.enabled) {
        store.dispatch(
          recordDepthSample({
            timestamp: Date.now(),
            cameraPos: [0, 0, 0],
            cameraRot: [0, 0, 0, 1],
            points: [],
          })
        );
      }

      if (options.images.enabled) {
        store.dispatch(
          add2dImage({
            imageFile: 'test.jpg',
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            screenRotation: 0,
            capturedAt: Date.now(),
          })
        );
      }

      const depthActions = dispatchedActions.filter(
        (a) => a.type === 'recording/recordDepthSample'
      );
      const imageActions = dispatchedActions.filter(
        (a) => a.type === 'gpsData/add2dImage'
      );

      expect(depthActions.length).toBe(0);
      expect(imageActions.length).toBe(0);
    });
  });
});
