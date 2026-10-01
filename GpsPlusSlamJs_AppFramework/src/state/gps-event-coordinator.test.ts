/**
 * Recording Coordinator Tests
 *
 * Tests for the GPS+AR event coordination logic.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 * and docs/issue-library-integration.md
 *
 * These tests verify the CRITICAL data flow:
 * - GPS triggers recording
 * - AR pose is captured at GPS moment
 * - Proper GpsPoint is constructed with coordinates relative to zero
 * - Library's recordGpsEvent action is dispatched
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vec3 as glVec3, quat as glQuat } from 'gl-matrix';
import {
  quaternionMagnitude,
  type RecordGpsEventPayload,
} from 'gps-plus-slam-js';
import {
  extractOdomPosition,
  extractOdomRotation,
  buildRawGpsPoint,
  buildRecordGpsEventPayload,
  toRawAbsoluteOrientation,
  createGpsPositionHandler,
  updateDeviceOrientation,
  getLastDeviceOrientation,
  resetCoordinatorState,
  eulerToQuaternion,
} from './gps-event-coordinator';
import type { AbsoluteOrientationReading } from '../sensors/absolute-orientation';
import type { ReducersMapObject } from '@reduxjs/toolkit';
import { createSlamAppStore, type SlamAppStore } from './create-slam-app-store';
import { startSession } from './recording-slice';
import { NullStorageBackend } from '../storage/null-storage-backend';
import type { StorageBackend } from '../storage/storage-backend';
type RecorderStore = SlamAppStore<ReducersMapObject>;
const createRecorderStore = (opts?: { storageBackend?: StorageBackend }) =>
  createSlamAppStore({
    storageBackend: opts?.storageBackend ?? new NullStorageBackend(),
  });
import type { ARPose } from '../ar/webxr-session';
import type { GpsPosition, RawDeviceOrientation } from '../sensors/gps';

describe('Recording Coordinator', () => {
  beforeEach(() => {
    resetCoordinatorState();
  });

  afterEach(() => {
    resetCoordinatorState();
  });

  describe('extractOdomPosition', () => {
    /**
     * Why this test matters:
     * Verifies the correct conversion from WebXR ARPose position (right-handed:
     * X=East, Y=Up, Z=South) to the internal right-handed convention
     * (X=North, Y=Up, Z=East). Incorrect mapping produces a mirrored path
     * The reducer applies webxrToNUE separately, so extractOdomPosition
     * returns raw WebXR [x, y, z] as-is.     */
    it('returns raw WebXR position as-is', () => {
      const arPose: ARPose = {
        position: { x: 1.5, y: 2.0, z: -3.0 },
        orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
      };

      const result = extractOdomPosition(arPose);

      // Raw WebXR pass-through: [x, y, z]
      expect(result).toEqual([1.5, 2.0, -3.0]);
    });

    it('maps zero vector to zero vector', () => {
      const arPose: ARPose = {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
      // Use toBeCloseTo to avoid -0 vs +0 comparison issues with Object.is
      const result = extractOdomPosition(arPose);
      expect(result[0]).toBeCloseTo(0, 10);
      expect(result[1]).toBeCloseTo(0, 10);
      expect(result[2]).toBeCloseTo(0, 10);
    });

    it('correctly handles walking north (WebXR z decreases)', () => {
      // Walking north in WebXR: z = -5 (z goes negative going forward)
      const arPose: ARPose = {
        position: { x: 0, y: 0, z: -5 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
      const result = extractOdomPosition(arPose);
      // Raw WebXR pass-through: [0, 0, -5]
      expect(result[0]).toBeCloseTo(0, 6);
      expect(result[1]).toBeCloseTo(0, 6);
      expect(result[2]).toBeCloseTo(-5, 6);
    });
  });

  describe('extractOdomRotation', () => {
    /**
     * Why this test matters:
     * Verifies quaternion order [x, y, z, w] matches library expectations.
     */
    it('extracts rotation as tuple with correct component order', () => {
      const arPose: ARPose = {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
      };

      const result = extractOdomRotation(arPose);

      expect(result[0]).toBe(0.1); // x
      expect(result[1]).toBe(0.2); // y
      expect(result[2]).toBe(0.3); // z
      expect(result[3]).toBe(0.9); // w
    });
  });

  describe('buildRawGpsPoint', () => {
    /**
     * Why this test matters:
     * Verifies the RawGpsPoint construction with all raw sensor fields.
     * Derived fields (coordinates, weight, zeroRef, deviceRotation) must NOT be present —
     * they are computed by the reducer (raw-storage pattern).
     */
    it('builds RawGpsPoint with all raw sensor fields', () => {
      const gpsPosition: GpsPosition = {
        lat: 48.8567,
        lon: 2.3523,
        altitude: 35.5,
        accuracy: 5.0,
        altitudeAccuracy: 3.0,
        heading: 180,
        speed: 1.2,
        timestamp: 1704110400000,
      };

      const result = buildRawGpsPoint(gpsPosition, null);

      expect(result.id).toMatch(/^gps-\d+$/);
      expect(result.latitude).toBe(48.8567);
      expect(result.longitude).toBe(2.3523);
      expect(result.altitude).toBe(35.5);
      expect(result.latLongAccuracy).toBe(5.0);
      expect(result.timestamp).toBe(1704110400000);
      // Derived fields must not be present
      expect(result).not.toHaveProperty('zeroRef');
      expect(result).not.toHaveProperty('coordinates');
      expect(result).not.toHaveProperty('weight');
      expect(result).not.toHaveProperty('deviceRotation');
    });

    /**
     * Why this test matters:
     * Coordinates are now computed by the reducer, not by buildRawGpsPoint.
     * Verify derived fields are absent.
     */
    it('does not include coordinates or weight (computed by reducer)', () => {
      const gpsPosition: GpsPosition = {
        lat: 48.8576, // ~111m north
        lon: 2.3522, // same longitude
        altitude: 0,
        accuracy: 5.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      };

      const result = buildRawGpsPoint(gpsPosition, null);

      expect(result).not.toHaveProperty('coordinates');
      expect(result).not.toHaveProperty('weight');
    });

    /**
     * Why this test matters:
     * Weight computation belongs in the core library (IP protection §3.2).
     * The framework no longer passes weight at all — it's computed by the reducer.
     */
    it('does not set weight (core library computes it in reducer)', () => {
      const highAccuracy: GpsPosition = {
        lat: 48.8567,
        lon: 2.3523,
        altitude: null,
        accuracy: 2.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      };

      const lowAccuracy: GpsPosition = {
        lat: 48.8567,
        lon: 2.3523,
        altitude: null,
        accuracy: 10.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      };

      const highResult = buildRawGpsPoint(highAccuracy, null);
      const lowResult = buildRawGpsPoint(lowAccuracy, null);

      // RawGpsPoint does not include weight — reducer computes it
      expect(highResult).not.toHaveProperty('weight');
      expect(lowResult).not.toHaveProperty('weight');
      // Accuracy is still passed through for the core to use
      expect(highResult.latLongAccuracy).toBe(2.0);
      expect(lowResult.latLongAccuracy).toBe(10.0);
    });

    /**
     * Why this test matters:
     * GPS heading, speed, and altitudeAccuracy are raw sensor fields that should
     * be preserved in the recording for diagnostic analysis and future algorithmic
     * use (e.g. filtering stationary noise via speed, altitude weighting).
     * Identified as dropped raw fields by the raw data fidelity audit.
     */
    it('preserves GPS heading, speed, and altitudeAccuracy when available', () => {
      const gpsPosition: GpsPosition = {
        lat: 48.8567,
        lon: 2.3523,
        altitude: 35.5,
        accuracy: 5.0,
        altitudeAccuracy: 3.0,
        heading: 180,
        speed: 1.2,
        timestamp: 1704110400000,
      };

      const result = buildRawGpsPoint(gpsPosition, null);

      expect(result.altitudeAccuracy).toBe(3.0);
      expect(result.heading).toBe(180);
      expect(result.speed).toBe(1.2);
    });

    /**
     * Why this test matters:
     * GPS heading/speed/altitudeAccuracy are null when unavailable (e.g. device
     * is stationary). They should map to undefined (not null) in GpsPoint to
     * match the optional field convention.
     */
    it('maps null GPS heading, speed, altitudeAccuracy to undefined', () => {
      const gpsPosition: GpsPosition = {
        lat: 48.8567,
        lon: 2.3523,
        altitude: null,
        accuracy: 5.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      };

      const result = buildRawGpsPoint(gpsPosition, null);

      expect(result.altitudeAccuracy).toBeUndefined();
      expect(result.heading).toBeUndefined();
      expect(result.speed).toBeUndefined();
    });
  });

  describe('buildRecordGpsEventPayload', () => {
    /**
     * Why this test matters:
     * Verifies the library-compatible payload structure with raw-storage pattern.
     * Payload stores rawGpsPoint (raw sensor data); the legacy
     * rawDeviceOrientation field is no longer populated.
     * Derived fields are computed by the reducer.
     */
    it('builds payload with odomPosition, odomRotation, and rawGpsPoint', () => {
      const gpsPosition: GpsPosition = {
        lat: 48.8567,
        lon: 2.3523,
        altitude: 35.5,
        accuracy: 5.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      };

      const arPose: ARPose = {
        position: { x: 1.0, y: 0.5, z: -2.0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };

      const result = buildRecordGpsEventPayload(gpsPosition, arPose, null);

      // Raw WebXR pass-through: [x, y, z] = [1.0, 0.5, -2.0]
      expect(result.odomPosition).toEqual([1.0, 0.5, -2.0]);
      expect(result.odomRotation).toEqual([0, 0, 0, 1]);
      expect(result.rawGpsPoint.latitude).toBe(48.8567);
      expect(result.rawGpsPoint).not.toHaveProperty('zeroRef');
      // No AbsoluteOrientationSensor reading provided → field absent (back-compat).
      expect(result.rawAbsoluteOrientation).toBeUndefined();
    });

    /**
     * Why this test matters: Phase 1 of the AbsoluteOrientationSensor plan
     * snapshots the sensor reading into the GPS-event payload so it pairs 1:1
     * with the AR pose. The capture-module `timestamp` must map to the payload's
     * `sampleTimestamp`, and the quaternion/frame/screen-angle pass through.
     */
    it('injects the absolute-orientation reading and maps timestamp → sampleTimestamp', () => {
      const gpsPosition: GpsPosition = {
        lat: 0,
        lon: 0,
        altitude: null,
        accuracy: 5,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: 1000,
      };
      const arPose: ARPose = {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
      const reading: AbsoluteOrientationReading = {
        quaternion: [0.1, 0.2, 0.3, 0.9],
        referenceFrame: 'device',
        screenAngleDeg: 90,
        timestamp: 555,
      };

      const result = buildRecordGpsEventPayload(
        gpsPosition,
        arPose,
        null,
        reading
      );

      expect(result.rawAbsoluteOrientation).toEqual({
        quaternion: [0.1, 0.2, 0.3, 0.9],
        referenceFrame: 'device',
        screenAngleDeg: 90,
        sampleTimestamp: 555,
      });
    });

    it('toRawAbsoluteOrientation returns undefined for a null reading', () => {
      expect(toRawAbsoluteOrientation(null)).toBeUndefined();
    });
  });

  describe('createGpsPositionHandler', () => {
    let store: RecorderStore;
    let mockArPose: ARPose;

    beforeEach(() => {
      store = createRecorderStore();
      mockArPose = {
        position: { x: 1, y: 2, z: 3 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
    });

    /**
     * Why this test matters:
     * CRITICAL - verifies that GPS triggers dispatch with paired AR pose.
     */
    it('dispatches recordGpsEvent when GPS arrives during recording', () => {
      // Start a recording session
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      const handler = createGpsPositionHandler({
        store,
        getArPose: () => mockArPose,
      });

      const gpsPosition: GpsPosition = {
        lat: 48.8566,
        lon: 2.3522,
        altitude: 35.5,
        accuracy: 5.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      };

      handler(gpsPosition);

      const state = store.getState();
      // Should have set zero pos and recorded one event
      expect(state.gpsData).not.toBeNull();
      expect(state.gpsData?.gpsEvents?.odometryPositions.length).toBe(1);
      // extractOdomPosition returns raw WebXR [1,2,3].
      // Reducer applies webxrToNUE → state stores [-3, 2, 1] (NUE).
      expect(state.gpsData?.gpsEvents?.odometryPositions[0]).toEqual([
        -3, 2, 1,
      ]);
    });

    /**
     * Why this test matters:
     * Should not record data when not in recording mode.
     */
    it('does not dispatch when not recording', () => {
      const handler = createGpsPositionHandler({
        store,
        getArPose: () => mockArPose,
      });

      const gpsPosition: GpsPosition = {
        lat: 48.8566,
        lon: 2.3522,
        altitude: null,
        accuracy: 5.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      };

      handler(gpsPosition);

      const state = store.getState();
      expect(state.gpsData).toBeNull();
    });

    /**
     * Why this test matters:
     * Cannot create paired data without AR pose - should skip gracefully.
     */
    it('does not dispatch when AR pose is unavailable', () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      const handler = createGpsPositionHandler({
        store,
        getArPose: () => null, // No AR pose available
      });

      const gpsPosition: GpsPosition = {
        lat: 48.8566,
        lon: 2.3522,
        altitude: null,
        accuracy: 5.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      };

      handler(gpsPosition);

      const state = store.getState();
      // gpsData should still be null since no event was recorded
      expect(state.gpsData).toBeNull();
    });

    /**
     * Why this test matters:
     * Verifies multiple GPS events create multiple paired records.
     */
    it('records multiple GPS events in sequence', () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      let poseCounter = 0;
      const handler = createGpsPositionHandler({
        store,
        getArPose: () => {
          poseCounter++;
          return {
            position: { x: poseCounter, y: 0, z: 0 },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          };
        },
      });

      // Simulate 3 GPS events
      for (let i = 0; i < 3; i++) {
        handler({
          lat: 48.8566 + i * 0.0001,
          lon: 2.3522,
          altitude: null,
          accuracy: 5.0,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          timestamp: Date.now() + i * 1000,
        });
      }

      const state = store.getState();
      expect(state.gpsData?.gpsEvents?.odometryPositions.length).toBe(3);
      // AR pose {x: poseCounter, y: 0, z: 0} → raw WebXR [poseCounter, 0, 0]
      // Reducer webxrToNUE → NUE [0, 0, poseCounter]. East at index [2].
      // Last pose (poseCounter=3): east component [2] = 3
      expect(state.gpsData?.gpsEvents?.odometryPositions[2][2]).toBe(3);
    });

    /**
     * Why this test matters:
     * First GPS event should set zero position for coordinate calculations.
     */
    it('sets zero position on first GPS event', () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      const handler = createGpsPositionHandler({
        store,
        getArPose: () => mockArPose,
      });

      handler({
        lat: 48.8566,
        lon: 2.3522,
        altitude: null,
        accuracy: 5.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      });

      const state = store.getState();
      expect(state.gpsData?.zero).toEqual({ lat: 48.8566, lon: 2.3522 });
    });

    /**
     * Why this test matters (Tour Viewer authoring plan 2026-09-28-0953,
     * D18): an app that sends other observations WITH a device fix in one
     * solve - the viewer's keep-alive ring, as one `recordGpsEventBatch` -
     * must receive the built fix instead of it being dispatched alone. The
     * zero is still set first, so the app's router dispatches into a store
     * that can take it; nothing else is dispatched for the fix.
     */
    it('hands the built fix to `recordFix` instead of dispatching it, after setting the zero', () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );
      const routed: { payload: RecordGpsEventPayload; zeroSet: boolean }[] = [];
      const handler = createGpsPositionHandler({
        store,
        getArPose: () => mockArPose,
        recordFix: (payload) => {
          routed.push({ payload, zeroSet: store.getState().gpsData !== null });
        },
      });

      handler({
        lat: 48.8566,
        lon: 2.3522,
        altitude: null,
        accuracy: 5.0,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: 1_700_000_000_000,
      });

      expect(routed).toHaveLength(1);
      expect(routed[0]!.zeroSet).toBe(true);
      expect(routed[0]!.payload.odomPosition).toEqual([1, 2, 3]);
      expect(routed[0]!.payload.rawGpsPoint.timestamp).toBe(1_700_000_000_000);
      // Not dispatched by the coordinator itself: the router owns it.
      expect(store.getState().gpsData?.gpsEvents?.gpsPositions ?? []).toEqual(
        []
      );
    });
  });

  describe('device orientation caching', () => {
    /**
     * Why this test matters:
     * Verifies orientation is cached correctly for later use.
     */
    it('updates and retrieves device orientation', () => {
      const orientation: RawDeviceOrientation = {
        alpha: 90,
        beta: 30,
        gamma: 15,
        absolute: true,
      };

      updateDeviceOrientation(orientation);
      const result = getLastDeviceOrientation();

      expect(result).toEqual(orientation);
    });

    /**
     * Why this test matters:
     * Reset must clear cached state for clean test isolation.
     */
    it('resets clears cached orientation', () => {
      updateDeviceOrientation({
        alpha: 90,
        beta: 30,
        gamma: 15,
        absolute: true,
      });

      resetCoordinatorState();

      expect(getLastDeviceOrientation()).toBeNull();
    });
  });

  describe('eulerToQuaternion', () => {
    /**
     * Why this test matters:
     * Identity rotation (0,0,0) should produce identity quaternion [0,0,0,1].
     * This is the most basic sanity check for quaternion math.
     */
    it('returns identity quaternion for zero angles', () => {
      const result = eulerToQuaternion(0, 0, 0);

      // Identity quaternion is [0, 0, 0, 1]
      expect(result[0]).toBeCloseTo(0, 5); // x
      expect(result[1]).toBeCloseTo(0, 5); // y
      expect(result[2]).toBeCloseTo(0, 5); // z
      expect(result[3]).toBeCloseTo(1, 5); // w
    });

    /**
     * Why this test matters:
     * 90Â° rotation around Z axis (alpha/compass) is common.
     * Verifies the Z-axis rotation component.
     */
    it('handles 90 degree alpha rotation (compass heading)', () => {
      const result = eulerToQuaternion(90, 0, 0);

      // 90Â° around Z: quaternion = [0, 0, sin(45Â°), cos(45Â°)] = [0, 0, 0.707, 0.707]
      expect(result[0]).toBeCloseTo(0, 5); // x
      expect(result[1]).toBeCloseTo(0, 5); // y
      expect(result[2]).toBeCloseTo(Math.sin(Math.PI / 4), 3); // z ≈ 0.707
      expect(result[3]).toBeCloseTo(Math.cos(Math.PI / 4), 3); // w ≈ 0.707
    });

    /**
     * Why this test matters:
     * 90Â° rotation around X axis (beta/pitch) tests the X component.
     */
    it('handles 90 degree beta rotation (pitch)', () => {
      const result = eulerToQuaternion(0, 90, 0);

      // 90Â° around X: quaternion = [sin(45Â°), 0, 0, cos(45Â°)] = [0.707, 0, 0, 0.707]
      expect(result[0]).toBeCloseTo(Math.sin(Math.PI / 4), 3); // x ≈ 0.707
      expect(result[1]).toBeCloseTo(0, 5); // y
      expect(result[2]).toBeCloseTo(0, 5); // z
      expect(result[3]).toBeCloseTo(Math.cos(Math.PI / 4), 3); // w ≈ 0.707
    });

    /**
     * Why this test matters:
     * 90Â° rotation around Y axis (gamma/roll) tests the Y component.
     */
    it('handles 90 degree gamma rotation (roll)', () => {
      const result = eulerToQuaternion(0, 0, 90);

      // 90Â° around Y: quaternion = [0, sin(45Â°), 0, cos(45Â°)] = [0, 0.707, 0, 0.707]
      expect(result[0]).toBeCloseTo(0, 5); // x
      expect(result[1]).toBeCloseTo(Math.sin(Math.PI / 4), 3); // y ≈ 0.707
      expect(result[2]).toBeCloseTo(0, 5); // z
      expect(result[3]).toBeCloseTo(Math.cos(Math.PI / 4), 3); // w ≈ 0.707
    });

    /**
     * Why this test matters:
     * 360Â° rotation should be equivalent to identity (full rotation).
     */
    it('handles 360 degree rotation returning to identity', () => {
      const result = eulerToQuaternion(360, 0, 0);

      // 360Â° rotation = identity (but quaternion might be [0,0,0,-1] which is equivalent)
      // Both [0,0,0,1] and [0,0,0,-1] represent the same rotation
      expect(result[0]).toBeCloseTo(0, 5); // x
      expect(result[1]).toBeCloseTo(0, 5); // y
      expect(result[2]).toBeCloseTo(0, 5); // z
      expect(Math.abs(result[3])).toBeCloseTo(1, 5); // w = Â±1
    });

    /**
     * Why this test matters:
     * Negative angles are valid and should produce correct rotations.
     */
    it('handles negative angles correctly', () => {
      const result = eulerToQuaternion(-90, 0, 0);

      // -90Â° around Z: quaternion = [0, 0, -sin(45Â°), cos(45Â°)]
      expect(result[0]).toBeCloseTo(0, 5); // x
      expect(result[1]).toBeCloseTo(0, 5); // y
      expect(result[2]).toBeCloseTo(-Math.sin(Math.PI / 4), 3); // z ≈ -0.707
      expect(result[3]).toBeCloseTo(Math.cos(Math.PI / 4), 3); // w ≈ 0.707
    });

    /**
     * Why this test matters:
     * The quaternion must be normalized (unit quaternion) for valid rotation.
     */
    it('returns a normalized quaternion', () => {
      // Test with arbitrary combined rotation
      const result = eulerToQuaternion(45, 30, 15);

      expect(quaternionMagnitude(result)).toBeCloseTo(1, 5);
    });

    /**
     * Why this test matters:
     * Combined rotations must work correctly for real device orientations.
     * A device pointing north, tilted 45Â° forward, rolled 10Â° right.
     */
    it('handles combined rotations', () => {
      const result = eulerToQuaternion(0, 45, 10);

      // Should be normalized
      expect(quaternionMagnitude(result)).toBeCloseTo(1, 5);

      // w should be positive and largest for small rotations
      expect(result[3]).toBeGreaterThan(0.5);
    });

    /**
     * Why this test matters:
     * Edge case - 180Â° rotation should be handled correctly.
     */
    it('handles 180 degree rotation', () => {
      const result = eulerToQuaternion(180, 0, 0);

      // 180Â° around Z: quaternion = [0, 0, 1, 0] or [0, 0, -1, 0]
      expect(result[0]).toBeCloseTo(0, 5); // x
      expect(result[1]).toBeCloseTo(0, 5); // y
      expect(Math.abs(result[2])).toBeCloseTo(1, 3); // z = Â±1
      expect(result[3]).toBeCloseTo(0, 3); // w ≈ 0
    });

    /**
     * Why this test matters:
     * Validates W3C DeviceOrientation spec compliance. The spec §A.2 defines
     * the combined quaternion formula for intrinsic Z-X'-Y'' Tait-Bryan angles.
     * For alpha=90Â°, beta=45Â°, gamma=30Â° the reference quaternion must match
     * q = qZ Â· qX Â· qY (not the reverse). This catches wrong multiplication order.
     */
    it('matches W3C reference quaternion for alpha=90, beta=45, gamma=30', () => {
      const alpha = 90,
        beta = 45,
        gamma = 30;
      const q = eulerToQuaternion(alpha, beta, gamma);

      // W3C spec §A.2 closed-form formula:
      const toRad = Math.PI / 180;
      const cX = Math.cos((beta * toRad) / 2);
      const sX = Math.sin((beta * toRad) / 2);
      const cY = Math.cos((gamma * toRad) / 2);
      const sY = Math.sin((gamma * toRad) / 2);
      const cZ = Math.cos((alpha * toRad) / 2);
      const sZ = Math.sin((alpha * toRad) / 2);

      const expectedX = sX * cY * cZ - cX * sY * sZ;
      const expectedY = cX * sY * cZ + sX * cY * sZ;
      const expectedZ = cX * cY * sZ + sX * sY * cZ;
      const expectedW = cX * cY * cZ - sX * sY * sZ;

      expect(q[0]).toBeCloseTo(expectedX, 4); // x ≈ 0.0924
      expect(q[1]).toBeCloseTo(expectedY, 4); // y ≈ 0.4305
      expect(q[2]).toBeCloseTo(expectedZ, 4); // z ≈ 0.7011
      expect(q[3]).toBeCloseTo(expectedW, 4); // w ≈ 0.5610
    });

    /**
     * Why this test matters:
     * Validates the ZXY rotation order by applying a combined rotation to a vector.
     * For intrinsic Z-X'-Y'' order per W3C spec:
     * R = Rz(Î±) Â· Rx(Î²) Â· Ry(Î³), so q = qZ Â· qX Â· qY.
     * With alpha=90Â° (Z), beta=90Â° (X), gamma=0Â° (Y):
     * Starting with unit vector [1, 0, 0] (pointing east):
     * - Rz(90Â°): [1,0,0] → [0,1,0]
     * - Rx(90Â°): has no effect on [0,1,0] becoming [0,0,1] in this intrinsic frame;
     *   the combined world-frame result is [0,1,0].
     * Verified numerically: qZÂ·qX applied to [1,0,0] yields [0,1,0].
     */
    it('applies rotations in correct ZXY order', () => {
      const q = eulerToQuaternion(90, 90, 0);

      // Apply quaternion to vector [1, 0, 0]
      const v = glVec3.fromValues(1, 0, 0);
      const qGl = glQuat.fromValues(q[0], q[1], q[2], q[3]);
      const result = glVec3.create();
      glVec3.transformQuat(result, v, qGl);

      // Expected: [0, 1, 0]
      expect(result[0]).toBeCloseTo(0, 3);
      expect(result[1]).toBeCloseTo(1, 3);
      expect(result[2]).toBeCloseTo(0, 3);
    });
  });
});
