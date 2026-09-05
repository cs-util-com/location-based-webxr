# Recording Coordinator Module

## Purpose

Coordinates GPS events with AR poses to dispatch combined recording actions. This module implements the critical data flow where GPS arrival triggers the capture of paired GPS+AR data.

## Architecture Note

See `docs/architecture-ar-gps-pose-separation.md` for the full architecture explanation.

**Key principle:** GPS events are the trigger for recording. At the moment GPS arrives, we read the current AR pose and dispatch a SINGLE combined action containing both.

## Public API

### Functions

#### `updateDeviceOrientation(orientation: DeviceOrientation): void`

Caches the latest device orientation for inclusion in GPS events.

- **Input:** DeviceOrientation from device sensors
- **Output:** None (caches internally)

#### `getLastDeviceOrientation(): DeviceOrientation | null`

Returns the cached device orientation.

#### `eulerToQuaternion(alpha, beta, gamma): Quaternion`

Re-exported from the core library (`gps-plus-slam-js`). Converts DeviceOrientationEvent Euler angles to a quaternion.

- **Input:**
  - `alpha` - Compass heading in degrees (rotation around Z axis, 0-360°)
  - `beta` - Pitch in degrees (front-back tilt, rotation around X axis, -180 to 180°)
  - `gamma` - Roll in degrees (left-right tilt, rotation around Y axis, -90 to 90°)
- **Output:** Unit quaternion as `Quaternion` (readonly `[x, y, z, w]`)

**Important:** Uses intrinsic Z-X'-Y'' Tait-Bryan rotation order per the W3C DeviceOrientation spec §3.1. The quaternion composition is `q = qZ · qX · qY`.

#### `resetCoordinatorState(): void`

Clears all cached state. Call when starting a new session.

#### `convertArPose(arPose: ARPose, timestamp: number): ArPose`

Converts WebXR ARPose (object format) to store ArPose (array format).

- **Input:**
  - `arPose` - ARPose from WebXR with `.position` and `.orientation` objects
  - `timestamp` - Timestamp to use for the pose
- **Output:** ArPose with `[x, y, z]` position and `[x, y, z, w]` rotation arrays

#### `buildGpsEventPayload(gpsPosition, arPose, deviceOrientation): GpsEventPayload`

Builds a complete payload for the `recordGpsEvent` action. Returns `{ odomPosition, odomRotation, rawGpsPoint, rawAbsoluteOrientation? }` — raw sensor values only, no derived fields. The reducer computes `coordinates`, `weight`, and `zeroRef` from the raw values + state. The legacy `rawDeviceOrientation` field is no longer populated (§5b dead-code removal, 2026-06-28) — it was dead data on recorded GPS events; the live odometry-restart orientation snapshot reads the cached orientation via `getLastDeviceOrientation` instead.

- **Input:**
  - `gpsPosition` - GpsPosition from Geolocation API
  - `arPose` - ARPose from WebXR
  - `deviceOrientation` - Optional DeviceOrientation (kept for the live orientation cache; no longer written into the payload)
- **Output:** Payload ready for dispatch with `rawGpsPoint: RawGpsPoint` (and optional `rawAbsoluteOrientation` when an AbsoluteOrientationSensor reading is present)

#### `createGpsPositionHandler(config): (position: GpsPosition) => void`

Creates a GPS callback function that dispatches combined events.

- **Input:**
  - `config.store` - Redux store to dispatch to
  - `config.getArPose` - Function to get current AR pose
- **Output:** Callback function for `startGpsWatch()`

## Invariants & Assumptions

1. **GPS triggers recording** - AR poses are not recorded independently
2. **Paired data only** - If AR pose is unavailable when GPS arrives, the event is skipped
3. **Recording state check** - Only dispatches when `isRecording` is true
4. **Device orientation is optional** - Recorded if available, undefined otherwise
5. **Coordinate convention — `extractOdomPosition`**: Returns raw WebXR `[x, y, z]` directly (identity pass-through). The reducer converts to NUE via `webxrToNUE()`. **Old recordings** (pre-2026-03-15 fix, no `odomCoordVersion` in session.json) also store raw WebXR positions; era-2 recordings (`odomCoordVersion: 2`) store NUE and require reverse-migration.
6. **GPS field fidelity** - `buildRawGpsPoint()` preserves all Geolocation API fields: `altitudeAccuracy`, `heading`, `speed` (mapped from `null` → `undefined`). The legacy `compassAbsolute` field is no longer populated (§5b dead-code removal, 2026-06-28). No derived fields (coordinates, weight, zeroRef) are computed — the reducer handles those.

## Examples

### Basic Usage

```typescript
import {
  createGpsPositionHandler,
  updateDeviceOrientation,
} from './gps-event-coordinator';
import { getCurrentArPose } from '../ar/webxr-session';
import { startGpsWatch, startOrientationWatch } from '../sensors/gps';

// Create handler
const handler = createGpsPositionHandler({
  store,
  getArPose: getCurrentArPose,
});

// Start watching
startGpsWatch(handler);
startOrientationWatch(updateDeviceOrientation);
```

### Testing

```typescript
// Mock AR pose for testing
const mockArPose = {
  position: { x: 1, y: 2, z: 3 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};

const handler = createGpsPositionHandler({
  store,
  getArPose: () => mockArPose,
});

// Simulate GPS event
handler({
  lat: 48.8566,
  lon: 2.3522,
  accuracy: 5.0,
  timestamp: Date.now(),
  // ... other fields
});

// Verify state
expect(store.getState().recorder.gpsEventCount).toBe(1);
```

## Tests

- `gps-event-coordinator.test.ts` - covering:
  - Pose conversion (object to array format)
  - Payload building (with and without orientation)
  - GPS handler dispatching (recording mode checks)
  - AR pose unavailability handling
  - Multiple sequential events
  - Device orientation caching
  - GPS field fidelity: heading, speed, altitudeAccuracy preserved (null→undefined)
  - legacy compassAbsolute / rawDeviceOrientation no longer populated
