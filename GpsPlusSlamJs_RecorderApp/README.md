# GpsPlusSlamJs Recorder App (WebXR/Three.js)

> **Live:** deployed at **<https://gps.csutil.com/recorder/>**. It records
> reusable AR + GPS datasets — for 3D reconstruction (COLMAP / Gaussian
> splatting), alignment-quality evaluation, desktop replay, and geo-anchored
> site documentation. (Linked from the landing page as the example app to
> evaluate tracking accuracy — one of those use cases.)

> **New to the framework?** This recorder is the **full** rung of the example
> ladder (trivial → starter → full). Start smaller with the
> [`GpsPlusSlamJs_MinimalExample`](../GpsPlusSlamJs_MinimalExample/)
> (resolve-and-run) and the
> [`GpsPlusSlamJs_AnchorStarter`](../GpsPlusSlamJs_AnchorStarter/) (a readable
> persistent-GPS-anchor demo) before reading this app.

## Background on the used GpsPlusSlamJs library

**GpsPlusSlamJs** is a TypeScript library designed to fuse AR (Augmented Reality) odometry data with GPS coordinates.

- **The Problem:** AR systems (like ARCore/ARKit) provide precise local tracking but drift over time and have no concept of global coordinates (latitude/longitude). GPS provides global coordinates but is noisy and lacks precise orientation.
- **The Solution:** The library aligns the local AR coordinate system with the global GPS frame in real-time. It uses a point-set registration algorithm to continuously compute the transformation matrix between the two worlds.
- **Why this Recorder?** It captures synchronized real-world AR + GPS data — AR poses, GPS readings, device orientation, camera frames and depth, plus user-marked reference points — into a format that can be replayed deterministically. That single dataset serves several developer use cases: the resulting ZIPs are **COLMAP-conform** (the recorder emits a COLMAP `sparse/0/` model, see [`src/colmap/`](src/colmap/)), so they feed 3D reconstructions (Gaussian splatting / photogrammetry), **evaluate GPS↔AR alignment quality**, re-run sessions in desktop replay for debugging and parameter tuning without going outside for every test, and **document a site** with accurate geo-anchored photos, point clouds and reference markers. (Developing/tuning the alignment library itself is one of these use cases, not the only one.)

## ⚠️ CRITICAL: This App Uses the GpsPlusSlamJs Library

**DO NOT create a custom Redux store.** This app **MUST** use the `gps-plus-slam-js` library for all GPS/AR alignment logic.

### Why This Matters

1. **Replay Compatibility:** The library provides `replayActionsFromJson()` to replay recorded sessions. Custom action formats won't work.
2. **Live Alignment:** The app must visualize reference points using the library's computed alignment matrix during recording.
3. **Correct Data Structures:** The library requires specific types (`GpsPoint`, `RecordGpsEventPayload`) with computed fields like `coordinates` and `weight`.

### Required Integration Steps

1. **Add Dependency:**

   ```bash
   npm install ../GpsPlusSlamJs  # or published package name
   ```

2. **Use Library Store:**

   ```typescript
   import { createGpsSlamStore } from 'gps-plus-slam-js';

   const libraryStore = createGpsSlamStore();
   // Add persistence middleware to save actions to disk
   // Optionally combine with app-specific state (UI, session metadata)
   ```

3. **Use Library Actions:**

   ```typescript
   import {
     setZeroPos, // Set GPS zero reference (first GPS reading)
     recordGpsEvent, // Record paired AR+GPS data
     odometryTrackingRestarted, // Handle AR tracking loss
     type RecordGpsEventPayload,
     type GpsPoint,
     calcRelativeCoordsInMeters,
   } from 'gps-plus-slam-js';
   ```

4. **Subscribe to Alignment Matrix:**
   ```typescript
   store.subscribe(() => {
     const state = store.getState();
     if (state.gpsData?.gpsEvents?.alignmentMatrix) {
       applyAlignmentMatrix(state.gpsData.gpsEvents.alignmentMatrix);
     }
   });
   ```

See "Library Integration Requirements" section below for complete details.

## Overview

This application serves as a dedicated testbed and data recorder for the `GpsPlusSlamJs` library. It utilizes WebXR and Three.js to capture real-world AR sessions combined with GPS data.

**Key Goals:**

- **Data Collection:** Record high-fidelity session data for offline replay.
- **Deterministic Testing:** Enable Redux-based replay of sessions to verify library logic.
- **Parameter Tuning:** Allow developers to fine-tune alignment parameters against real recorded scenarios.

## Non-Goals

- **No on-device parameter optimization:** All heavy analysis runs on desktop.
- **No account/login, no network sync:** Purely local files.

---

## Application State Machine

The app follows a strict state machine. There are two branches from the initial SETUP state: the **Recording workflow** (AR-capable device) and the **Replay workflow** (desktop / no WebXR).

### States

```
                              ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
                         ┌───▶│   AR_READY   │────▶│  RECORDING   │────▶│   SUMMARY    │
                         │    └──────────────┘     └──────────────┘     └──────────────┘
                         │    (WebXR supported)                                │
┌──────────────┐         │                                                     ▼
│    SETUP     │─────────┤                                              (Reload page)
└──────────────┘         │
                         │    (WebXR NOT supported — auto-switch)
                         │    ┌──────────────┐     ┌──────────────┐
                         └───▶│ REPLAY_SETUP │────▶│  REPLAYING   │
                              └──────────────┘     └──────────────┘
                                                     │ ▲ (pause/resume)
                                                     └─┘
```

#### Recording States (AR-capable device)

| State         | Description                                                                     | Entry Condition                                           | Available Actions                                           |
| ------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| **SETUP**     | Initial state. User configures folder, scenario, and grants permissions.        | App launch                                                | Select folder, choose scenario, grant permissions, Enter AR |
| **AR_READY**  | AR session active, camera feed visible. Ready to begin recording.               | User clicks "Enter AR" and XR session starts successfully | Start Recording, Toggle Map                                 |
| **RECORDING** | Actively recording GPS+AR data to disk.                                         | User clicks "Start Recording"                             | Stop Recording, Mark Ref Point, Toggle Map                  |
| **SUMMARY**   | Recording ended. Shows session summary and validation data. **Terminal state.** | User clicks "Stop Recording"                              | View logs, Export data, Reload page (for new recording)     |

#### Replay States (desktop / no WebXR)

| State            | Description                                                                               | Entry Condition                                      | Available Actions                                          |
| ---------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| **REPLAY_SETUP** | Auto-entered when WebXR is not supported. User selects a folder, scenario, and session.   | `isWebXRSupported()` returns `false` during SETUP    | Open folder, select scenario, select session, Start Replay |
| **REPLAYING**    | Timed dispatch of recorded actions into the store. Three.js visualizes the session in 3D. | User clicks "Start Replay" after selecting a session | Play, Pause, Resume, change speed, toggle camera mode      |

### State Transitions

#### Recording Transitions

1. **SETUP → AR_READY**: Triggered by "Enter AR" button
   - Preconditions: Folder selected, scenario configured, mandatory permissions granted
   - Actions: Hide setup modal, initialize WebXR session, show AR controls
   - UI Change: Show "Start Recording" button (NOT Stop button)

2. **AR_READY → RECORDING**: Triggered by "Start Recording" button
   - Preconditions: AR session active
   - Actions: Create new store, start GPS/orientation watches, start image/depth capture, dispatch `startSession`
   - UI Change: Hide "Start Recording", show "Stop" button + pulsing indicator + ref point button

3. **RECORDING → SUMMARY**: Triggered by "Stop Recording" button
   - Actions: Stop all sensors/captures, dispatch `endSession`, cleanup subscriptions, compute summary stats
   - UI Change: Show Session Summary overlay with stats, logs, and validation info

4. **SUMMARY → (new session)**: User reloads page
   - No in-app "restart" button - this is intentional
   - Rationale: After stopping, the user's focus shifts to analyzing the recorded data. Starting a new recording is a distinct workflow that benefits from a clean slate (fresh permissions check, re-select scenario, etc.)

#### Replay Transitions

5. **SETUP → REPLAY_SETUP**: Automatic when `isWebXRSupported()` returns `false`
   - No error shown — the setup modal content is replaced with a replay-focused UX
   - Actions: Hide "Grant Permissions" section, hide "Enter AR" button, show scenario/session browser
   - UI Change: "Open Previous Recordings Folder" becomes the primary entry point

6. **REPLAY_SETUP → REPLAYING**: Triggered by "Start Replay" button
   - Preconditions: Folder selected, scenario selected, session selected
   - Actions: Load zip into memory, create store with `NullStorageBackend`, initialize replay Three.js scene (`initReplayScene()`), start cancellable async replay controller
   - UI Change: Show replay canvas with Three.js visualization, playback controls (play/pause, speed), camera mode toggle

### UI Elements per State

#### Recording Mode

| UI Element          | SETUP              | AR_READY                          | RECORDING              | SUMMARY                 |
| ------------------- | ------------------ | --------------------------------- | ---------------------- | ----------------------- |
| Setup Modal         | ✅ Visible         | ❌ Hidden                         | ❌ Hidden              | ❌ Hidden               |
| AR Canvas           | ❌ Hidden          | ✅ Visible                        | ✅ Visible             | ✅ Visible (background) |
| Start Recording btn | ❌ Hidden          | ✅ Visible                        | ❌ Hidden              | ❌ Hidden               |
| Stop Recording btn  | ❌ Hidden          | ❌ Hidden                         | ✅ Visible             | ❌ Hidden               |
| Recording Indicator | ❌ Hidden          | ❌ Hidden                         | ✅ Pulsing             | ❌ Hidden               |
| Ref Point btn       | ❌ Hidden          | ❌ Hidden                         | ✅ Visible             | ❌ Hidden               |
| Map btn             | ❌ Hidden          | ✅ Visible                        | ✅ Visible             | ❌ Hidden               |
| Summary Panel       | ❌ Hidden          | ❌ Hidden                         | ❌ Hidden              | ✅ Visible              |
| Status Text         | "Select folder..." | "AR active - Tap Start to record" | "Recording: {session}" | (in summary panel)      |

#### Replay Mode

| UI Element         | REPLAY_SETUP                            | REPLAYING                                |
| ------------------ | --------------------------------------- | ---------------------------------------- |
| Setup Modal        | ✅ Visible (replay variant)             | ❌ Hidden                                |
| Replay Canvas      | ❌ Hidden                               | ✅ Visible (standard Three.js, no WebXR) |
| Scenario Dropdown  | ✅ Visible                              | ❌ Hidden                                |
| Session List       | ✅ Visible (after scenario selected)    | ❌ Hidden                                |
| Speed Presets      | ❌ Hidden                               | ✅ Visible (0.1×–10× presets)            |
| Start Replay btn   | ✅ Visible (enabled after session pick) | ❌ Hidden                                |
| Play/Pause btn     | ❌ Hidden                               | ✅ Visible                               |
| Camera Mode Toggle | ❌ Hidden                               | ✅ Visible ("🔄 Orbit" / "🎮 Free Fly")  |
| Replay Progress    | ❌ Hidden                               | ✅ Visible ("Action 45/111")             |
| Map btn            | ❌ Hidden                               | ✅ Visible                               |
| Status Text        | "Select a recording to replay"          | "Replaying: {session} at {speed}x"       |

### Session Summary Panel (SUMMARY State)

When recording stops, display a summary overlay with:

1. **Session Stats:**
   - Duration (start time → end time)
   - GPS events recorded (count)
   - Reference points marked (count)
   - Images captured (count)
   - Depth samples taken (count)

2. **Error Log:**
   - GPS errors encountered
   - Image write failures
   - Tracking loss events
   - Any other warnings/errors from the session

3. **Quick Validation:**
   - First/last GPS coordinates
   - Total distance traveled (computed from odometry positions)
   - Alignment matrix status (valid/invalid)

4. **Actions:**
   - "View Full Logs" - Expands to scrollable detailed log view
   - "New Recording" - Reloads the page to start fresh

### Permission Flow

Permissions are requested in the **SETUP** state before entering AR:

1. **Check Phase** (on app load):
   - Check file storage permission state (shown first - most common failure point)
   - Check WebXR support (via `navigator.xr.isSessionSupported`)
   - Check geolocation permission state (via Permissions API)
   - Check camera permission state (via Permissions API)
   - Check device orientation permission state
   - Display status for each in the setup modal
   - Note: WebXR depth-sensing permission cannot be checked without starting a session

2. **Folder Selection Phase** (on "Select Folder" button):
   - Request folder access via `showDirectoryPicker({ mode: 'readwrite' })`
   - **Verify Write Access via Probe Test:**
     - Create a temporary test file in the selected folder
     - Write test content and close the file
     - Delete the test file
     - If any step fails, show error: "Folder is read-only. Please select a different folder."
   - Mark file storage as "granted" only if write probe succeeds
   - **Important:** Some Android devices grant read-only access despite requesting readwrite mode

3. **Request Phase** (on "Grant Permissions" button):
   - Request geolocation (triggers browser prompt)
   - Request camera (triggers browser prompt)
   - Request orientation (iOS only, triggers prompt)
   - **Request WebXR + Depth via Probe Session:**
     - Start a probe XR session with the same options as the real session:
       - `requiredFeatures: ['local-floor']`
       - `optionalFeatures: ['dom-overlay', 'depth-sensing']`
       - `depthSensing: { usagePreference: ['cpu-optimized'], ... }`
     - This triggers the ARCore/ARKit "create 3D map" permission prompt
     - End the probe session immediately after it starts
     - Mark WebXR as "granted" if session started successfully
     - **Important:** The permission persists in the browser - subsequent `requestSession()` calls won't re-prompt

4. **Enter AR Phase** (on "Enter AR" button):
   - All mandatory permissions should already be granted (including depth via probe)
   - Start the real XR session - no additional prompts expected
   - If probe was successful, depth-sensing will be available
   - If user denied during probe, proceed without depth (it's optional)

**Write Failure Handling:**

- If writes fail during recording, show toast notification: "⚠️ Save failed - check folder permissions"
- Failed writes are tracked and displayed in the Session Summary panel
- Files may be created with 0 bytes if file creation succeeds but writing fails

**Edge Cases:**

- If user denies the probe session, mark WebXR as denied and disable "Enter AR"
- If device doesn't support depth-sensing, the probe still succeeds (depth is optional)
- If probe session fails for other reasons (e.g., hardware busy), allow retry
- If folder write verification fails, allow user to re-select a different folder

---

## Replay Mode

When `isWebXRSupported()` returns `false` (desktop browsers **and iOS**, where browsers do not provide `immersive-ar` at all), the app automatically switches to a **Replay Mode** — no dead-end. The setup modal is replaced with a replay-focused UX for loading and replaying previously recorded sessions in an interactive 3D visualization. This enables desktop-based debugging, UX verification, and parameter tuning without an AR device.

To avoid leaving mobile users confused about why recording is unavailable, a prominent **unsupported-platform notice** (`#unsupported-platform-notice`, revealed by `showUnsupportedPlatformNotice()`) explains the cause (the browser lacks the AR camera tracking the recorder needs — notably iOS) and the fix (open the app in **Chrome on Android** with ARCore), while making clear that replay still works on the current device (D1, [docs/2026-06-16-2053-team1-user-feedback.md](../GpsPlusSlamJs_Docs/docs/2026-06-16-2053-team1-user-feedback.md)). **Recording is supported only on Chromium-based browsers on Android with WebXR `immersive-ar` (ARCore).**

For the full design investigation, code analysis, and alternatives considered, see [docs/2026-02-19-replay-mode.md](../GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md).

### Design Decisions

| Area                | Decision                                                    | Key Detail                                                                                                      |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Entry**           | Auto-switch when WebXR not supported                        | Setup modal replaced with replay UX; a prominent unsupported-platform notice explains why recording is off (D1) |
| **Replay engine**   | Cancellable async replay controller                         | Async loop with `AbortController`; play/pause/resume; speed as closure variable                                 |
| **Playback speed**  | Adjustable during playback (0.1x–10x)                       | Preset buttons (0.1x, 0.2x, 0.5x, 1x, 2x, 5x, 10x)                                                              |
| **Scene init**      | Separate `initReplayScene()` in `src/ar/replay-scene.ts`    | Reuses `createSceneHierarchy()`; standard `WebGLRenderer` + `requestAnimationFrame` loop                        |
| **Camera**          | `OrbitControls` + FPS toggle (`PointerLockControls` + WASD) | Camera in `scene` root (not `arWorldGroup`); orbit auto-follows latest GPS event                                |
| **Session browser** | Scenario dropdown + session list                            | Reuses `listScenarios()`, `loadSessionMetadata()`, enumerates `*.zip` files                                     |

### Live vs. Replay Comparison

| Aspect      | Live AR Mode                                 | Replay Mode                                   |
| ----------- | -------------------------------------------- | --------------------------------------------- |
| Render loop | `renderer.xr.setAnimationLoop()`             | `requestAnimationFrame()`                     |
| Camera      | WebXR `XRViewerPose` (inside `arWorldGroup`) | OrbitControls / FPS (in `scene` root)         |
| Store       | `OpfsStorageBackend`                         | `NullStorageBackend`                          |
| Actions     | GPS sensor + AR pose callbacks               | Zip → `loadActionsFromZip()` → timed dispatch |

All existing store subscribers (alignment matrix, `GpsEventVisualizer`, `RefPointVisualizer`) work unchanged — they react to dispatched actions identically in both modes.

### Future Enhancement

Redux DevTools export — convert zip action logs to DevTools-importable format for state inspection. DevTools time-travel doesn't trigger `store.subscribe()` (no 3D updates), but is useful for debugging state at specific action points.

---

## Library Integration Requirements

### Understanding the Two Coordinate Frames

**Critical Concept:** AR and GPS operate in different coordinate systems. Understanding this separation is essential.

#### 1. AR Local Frame (Odometry Space)

- **Origin:** Arbitrary point where the AR session started
- **Source:** WebXR's `XRViewerPose` from `frame.getViewerPose(referenceSpace)`
- **Characteristics:** Millimeter-precise relative tracking, but drifts over time and has no concept of GPS coordinates

#### 2. GPS World Frame (Global Space)

- **Origin:** The first GPS position received (the "zero" reference)
- **Source:** Computed by the GpsPlusSlamJs library
- **Characteristics:** Globally anchored (latitude/longitude), meter-level precision, aligned with compass directions

The library computes an **AlignmentMatrix** that transforms the AR local frame into the GPS world frame.

### Three.js Scene Hierarchy (MANDATORY)

**DO NOT apply the alignment matrix directly to the camera.** This breaks the ability to read raw AR poses.

**Required scene structure:**

```typescript
// Create scene (represents GPS world space)
const scene = new THREE.Scene();

// Create AR world group (represents AR local space)
// This group will be transformed by the library's alignment matrix
const arWorldGroup = new THREE.Group();
arWorldGroup.name = 'ar-world';
scene.add(arWorldGroup);

// Camera lives INSIDE arWorldGroup
// Its local transform = raw AR pose from WebXR
const camera = new THREE.PerspectiveCamera(...);
arWorldGroup.add(camera);

// AR-tracked content (planes, etc.) also goes in arWorldGroup
const arContent = new THREE.Group();
arWorldGroup.add(arContent);

// GPS-anchored content (reference point spheres) goes directly in scene
const gpsContent = new THREE.Group();
scene.add(gpsContent);
```

**Applying the alignment matrix:**

```typescript
function applyAlignmentMatrix(matrix: mat4): void {
  const threeMatrix = new THREE.Matrix4();
  threeMatrix.fromArray(matrix);
  arWorldGroup.matrix.copy(threeMatrix);
  arWorldGroup.matrixAutoUpdate = false;
  arWorldGroup.updateMatrixWorld(true);
}
```

### GPS Event Triggers Recording (MANDATORY Data Flow)

**DO NOT record AR poses on every frame.** This creates massive logs and unpaired data.

**Correct pattern:**

```
GPS Event Arrives → Read Current AR Pose → Dispatch Single Combined Action
```

**Implementation:**

```typescript
// WebXR module: Store latest AR pose every frame
let latestArPose: {
  position: Vector3;
  rotation: Quaternion;
  timestamp: number;
} | null = null;

function onXRFrame(frame: XRFrame): void {
  const pose = frame.getViewerPose(referenceSpace);
  if (pose) {
    latestArPose = {
      // WebXR uses right-handed Y-up coordinates (same as Three.js and Unity)
      // Vector3 format: [x, y, z]
      position: [
        pose.transform.position.x,
        pose.transform.position.y,
        pose.transform.position.z,
      ],
      // Quaternion format: [x, y, z, w] (same as library expects)
      rotation: [
        pose.transform.orientation.x,
        pose.transform.orientation.y,
        pose.transform.orientation.z,
        pose.transform.orientation.w,
      ],
      timestamp: performance.now(),
    };
  }
  // DO NOT dispatch action here - only store the pose
}

// Export function to read latest pose
export function getCurrentArPose() {
  return latestArPose;
}

// GPS module: When GPS arrives, get AR pose and dispatch combined action
function onGpsPosition(position: GeolocationPosition): void {
  const arPose = getCurrentArPose();
  if (!arPose) return;

  const state = store.getState();

  // Set zero reference on first GPS
  if (!state.gpsData?.zero) {
    store.dispatch(
      setZeroPos({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      })
    );
  }

  const zeroRef = store.getState().gpsData!.zero;

  // Construct library-compatible GpsPoint
  const coords = calcRelativeCoordsInMeters(
    { lat: position.coords.latitude, lon: position.coords.longitude },
    zeroRef
  );

  const gpsPoint: GpsPoint = {
    id: `gps-${Date.now()}`,
    zeroRef,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    altitude: position.coords.altitude ?? undefined,
    latLongAccuracy: position.coords.accuracy,
    coordinates: [coords.x, coords.y, coords.z],
    weight: 1 / Math.max(position.coords.accuracy, 1),
    timestamp: position.timestamp,
    deviceRotation: deviceOrientation
      ? eulerToQuaternion(
          deviceOrientation.alpha,
          deviceOrientation.beta,
          deviceOrientation.gamma
        )
      : undefined,
  };

  // Dispatch single combined action
  store.dispatch(
    recordGpsEvent({
      odomPosition: arPose.position,
      odomRotation: arPose.rotation,
      gpsPoint,
    })
  );
}
```

### Device Orientation to Quaternion Conversion

**DO NOT use identity quaternion `[0,0,0,1]` placeholder.**

```typescript
import { quat } from 'gl-matrix';

function eulerToQuaternion(
  alpha: number, // Z-axis rotation (compass heading)
  beta: number, // X-axis rotation (tilt forward/back)
  gamma: number // Y-axis rotation (tilt left/right)
): [number, number, number, number] {
  // DeviceOrientation uses ZXY Tait-Bryan angles in degrees
  const alphaRad = (alpha * Math.PI) / 180;
  const betaRad = (beta * Math.PI) / 180;
  const gammaRad = (gamma * Math.PI) / 180;

  // Create rotation quaternions for each axis
  const qZ = quat.setAxisAngle(quat.create(), [0, 0, 1], alphaRad);
  const qX = quat.setAxisAngle(quat.create(), [1, 0, 0], betaRad);
  const qY = quat.setAxisAngle(quat.create(), [0, 1, 0], gammaRad);

  // Combine in ZXY order: apply Z first, then X, then Y
  // For quaternions, this is right-to-left: qY * qX * qZ
  const q = quat.create();
  quat.multiply(q, qY, qX);
  quat.multiply(q, q, qZ);

  return [q[0], q[1], q[2], q[3]];
}
```

### AR Tracking Loss Handling

When AR tracking is lost and resumes, the system automatically handles alignment correction:

```typescript
// Tracking store + callbacks ride into initAR as ONE callbacks group
// (the framework's pre-init setters were folded into initAR):
await initAR(container, isolationOptions, sessionFeatures, {
  tracking: {
    store,
    onLost: () => {
      updateArInfo('⚠️ LOST');
      showError('AR tracking lost. Try moving to a well-lit area...');
    },
    onRestarted: (payload) => {
      store.dispatch(odometryTrackingRestarted(payload));
      log.info('AR tracking restarted — alignment correction dispatched');
    },
    onRecovered: () => {
      updateArInfo('');
      log.info('AR tracking recovered (same coordinate frame)');
    },
  },
});
```

The `tracking` Redux slice (driven by `webxr-session.ts` during `initAR()`) detects tracking loss via null poses and listens for `XRReferenceSpace` `reset` events to distinguish:

- **Case 1 (seamless recovery):** No origin change → keep all data, clear UI warning
- **Case 2 (relocalization):** Origin reset → dispatch `odometryTrackingRestarted` to accumulate offsets and clear stale trajectory data

---

## Requirements & Ideas

### Data Capture

- **Images:** Capture downsized, compressed JPG screenshots from the AR feed on a regular interval (e.g., ~2s).
  - _Constraint:_ Must be efficient. If live feed capture is too performance-heavy, this feature may be dropped.
  - _Mechanism:_ Dispatch a Redux action upon capture to record the timestamp and link it to the store state (especially the user's pose) for replay.
- **Depth/Points:** Sample confident 3D points from the AR depth system every second.
  - _Storage:_ Include point data directly in dispatched Redux actions.
  - _Rationale:_ At 1 Hz with a configurable N×N grid (default 3×3 = 9 points, max 10×10 = 100 points), each sample is ~1-2 KB. Embedding data in actions enables full replay: integration tests can process depth data as if running a live session, without needing to resolve external file references.
- **Sensors:** Include device orientation and compass data with every GPS event dispatched to the store.
- **General:** All dispatched Redux actions are persisted to disk to ensure no data loss.

### Recording Format & Folder Layout

- **Action Logs:** One file per action (e.g., timestamped NDJSON).
  - _TODO:_ Research Redux Toolkit best practices for persisting action streams.
- **Manifest / Metadata:** No separate manifest file. Session metadata (device info, date, user-entered notes) is dispatched as an action at the start of each recording, persisted like all other actions.
- **Folder Structure:**
  - User picks a root folder via `showDirectoryPicker()`.
  - Structure: `<RootFolder>/<ScenarioName>/`
    - Example: `Paris Eiffeltower/`
  - Each scenario folder contains:
    - `refPoints/` — Reference point definitions (one JSON file per reference point)
      - `pointA.json`, `pointB.json`, etc.
      - Each file matches the `RefPointDefinition` schema: `{ id, name, createdAt, observations: [...] }`
    - `<SessionTimestamp>/` — Individual recording sessions
      - Example: `recording-2025-02-28_14-30-11utc/`
      - `actions/` — Redux action log files (session-specific actions only)
      - `frames/` — Captured JPG images for this session

### Scenarios & Sessions

- **Scenario:** A named group of recordings covering the same physical area and reference points (e.g., "Paris Eiffeltower recordings").
  - When starting a new recording, the user chooses to create a new scenario or add to an existing one.
- **Session:** A single recording within a scenario, named by UTC timestamp (e.g., `recording-2025-02-28_14-30-11utc`).

### Ground Truth & Validation

- **Reference Points:** The app must allow the user to define and mark specific physical locations as "Reference Point X" (e.g., Ref A, Ref B) during a recording session.
  - _Stored Data:_
    - **Scenario-level storage:** Each reference point gets its own JSON file in `/<ScenarioName>/refPoints/`
    - File naming: `<pointId>.json` (e.g., `pointA.json`, `benchCorner.json`)
    - Each file tracks ALL observations of that reference point across sessions
    - Redux actions during recording: Still dispatch actions for replay, but also persist to scenario refPoints folder
  - _Workflow:_
    1. The user identifies a physical landmark that can be revisited precisely (e.g., a specific corner of a park bench, a statue base).
    2. The user places the device in a specific, reproducible position and orientation against this landmark.
    3. The user triggers a "Mark Reference Point" action in the UI and selects an ID from a suggested list or creates a new one.
    4. **On marking:** App writes/updates `/<ScenarioName>/refPoints/<pointId>.json` with observation data from current session
  - _Reference Point Suggestions:_
    - The app loads reference point names from existing `*.json` files in `/<ScenarioName>/refPoints/` directory
    - Displays list of previously used reference point names to avoid typos and ensure consistency.
  - _**CRITICAL: Reference Point Visualization**_ (This was missing in initial implementations):
    - **When recording starts:** The app MUST load all reference points from the scenario's `refPoints/` directory.
    - **How to load:**
      1. Access the `/<ScenarioName>/refPoints/` directory handle
      2. Enumerate all `*.json` files in the directory
      3. Read and parse each JSON file to get reference point definitions
      4. Each file contains GPS coordinates and observation history across all sessions
    - **How to visualize:**
      1. Create Three.js sphere meshes for each prior reference point
      2. Position spheres at GPS coordinates (convert lat/lon to meters from zero reference using `calcRelativeCoordsInMeters`)
      3. **IMPORTANT:** Add spheres to `scene` (GPS world space), NOT to `arWorldGroup` (AR local space)
      4. Use color coding: Green for prior sessions, Red for current session
      5. Optional: Add text labels showing reference point IDs
    - **When to update visualization:**
      - Subscribe to store updates: `store.subscribe(() => { ... })`
      - When alignment matrix changes, spheres automatically align (they're in GPS world space)
      - When user marks new ref point in current session, add red sphere immediately
    - **Purpose of visualization:**
      1. **Live Tracking Feedback:** Shows the user how well the current alignment matches prior sessions. If green spheres (prior ref points) appear in the expected physical locations, the alignment is good.
      2. **Memory Aid:** Reminds the user where reference points were created in earlier runs so they can navigate back and mark them again.
  - _Implementation Details for Reference Points:_
    - **Dual Storage Strategy:**
      1. **Redux actions:** Still dispatch actions during recording for replay compatibility (use `add2dImage` with `"ref-point:{id}"` pattern)
      2. **Scenario JSON files:** Simultaneously write to `/<ScenarioName>/refPoints/<pointId>.json` for easy cross-session loading
    - **Reference Point JSON Schema:**

      ```typescript
      interface RefPointDefinition {
        id: string; // e.g., "pointA", "benchCorner"
        name: string; // Human-readable name
        createdAt: number; // First observation timestamp
        observations: RefPointObservation[]; // All observations across sessions
      }

      interface RefPointObservation {
        sessionId: string; // e.g., "recording-2025-02-28_14-30-11utc"
        timestamp: number; // When marked in this session
        arPose: { position: Vector3; rotation: Quaternion };
        gpsPoint: GpsPoint; // Full GPS point from library
      }
      ```

    - **Loading reference points:** Create a `ref-point-loader.ts` module with functions:

      ```typescript
      // Load all reference point definitions from scenario
      async function loadAllRefPoints(
        scenarioHandle: FileSystemDirectoryHandle
      ): Promise<RefPointDefinition[]>;

      // Load a specific reference point by ID
      async function loadRefPoint(
        scenarioHandle: FileSystemDirectoryHandle,
        pointId: string
      ): Promise<RefPointDefinition | null>;

      // Save/update a reference point (adds new observation)
      async function saveRefPointObservation(
        scenarioHandle: FileSystemDirectoryHandle,
        pointId: string,
        pointName: string,
        observation: RefPointObservation
      ): Promise<void>;

      // Get list of reference point IDs for autocomplete
      async function listRefPointIds(
        scenarioHandle: FileSystemDirectoryHandle
      ): Promise<string[]>;
      ```

    - **Visualization module:** Create `reference-points.ts` with a `RefPointVisualizer` class:

      ```typescript
      class RefPointVisualizer {
        private scene: THREE.Scene;
        private priorRefMeshes: THREE.Mesh[] = [];
        private currentRefMeshes: THREE.Mesh[] = [];
        private zeroRef: LatLong | null = null;

        setZeroRef(zero: LatLong): void;
        addPriorRefPoint(refPoint: RefPointMark): void; // Green sphere
        addCurrentRefPoint(refPoint: RefPointMark): void; // Red sphere
        clearAll(): void;
      }
      ```

  - _Multi-Session Strategy:_
    - The user must perform multiple recordings (e.g., 3 separate sessions).
    - Each session should start at a different physical location to initialize the AR/GPS alignment differently.
    - In each session, the user visits the _same_ physical reference points and marks them.
  - _Validation Value:_
    - This creates a ground truth dataset where the "correct" alignment is known: The reference points, after the library's alignment processing, must converge to consistent global coordinates across all sessions.
    - Note: Raw GPS readings for the same physical location will naturally vary by several meters due to GPS noise. The validation metric tests whether the library's fused AR+GPS alignment _compensates_ for this noise and produces stable, repeatable global positions.
    - Developers can use these recordings to run integration tests: "Do the 3 recordings converge to the same global coordinate for all reference points?"
    - This metric is crucial for fine-tuning library parameters (e.g., GPS weight vs. AR drift) and ensuring that code changes improve (or at least do not degrade) the alignment consistency.
  - _Automated Parameter Optimization:_
    - Once a library of such integration tests (each with multiple recordings) exists, it enables automated exploration of the library's configuration space.
    - Scripts can run the recordings through the library using randomized or evolutionary parameter sets (e.g., varying GPS weights, decay rates, outlier rejection thresholds).
    - By scoring each parameter set based on how well the reference points align across sessions, the system can automatically converge towards local or global maxima in the solution space, finding the optimal configuration for diverse real-world conditions.

### User Interface

- **View:** Full-screen AR camera feed.
- **Map:** Interactive map icon (bottom right).
  - _Behavior:_ Clicking that button toggles a map in the 3D Three.js space, floating below the user and following their movement.
  - _TODO:_ Research options for rendering map tiles in Three.js 3D space (e.g., `three-geo`, custom tile mesh, or if no viable option exists).
  - _Offline:_ Let the map library handle caching; the core recording logic does not require network.
- **HUD:** Debug text overlay displaying current GPS accuracy and other relevant metrics.
- **New Recording Screen:** Before recording starts, the user:
  - Selects an existing scenario or creates a new one (with a custom name).
  - **IMPORTANT:** Wire the scenario dropdown's `change` event to update the current scenario and trigger loading of prior reference points.
  - Optionally enters notes/metadata (dispatched as an action).
- **Reference Point UI:**
  - Button to mark current location as a reference point
  - When clicked, show a picker with:
    - List of previously used reference point IDs in this scenario (for consistency)
    - Option to create new reference point with custom name
  - Display count of visible reference points: "Prior ref points: 5 | Current: 2"
- **GPS Debug Visualization:**
  - Display 3D markers for each GPS event recorded during the session
  - Two types of markers shown simultaneously:
    1. **Raw GPS markers (Yellow spheres):** Show where the device received each GPS reading, positioned at the raw GPS coordinates (converted to meters from zero reference). These represent the noisy GPS input.
    2. **Fused/Aligned markers (Cyan spheres):** Show the AR odometry position at each GPS event, transformed by the current alignment matrix. These represent where the library thinks the device was based on fused AR+GPS data.
  - **Purpose:** Visual comparison of raw GPS scatter vs. aligned odometry path helps developers:
    - See how well the alignment is working in real-time
    - Identify GPS outliers or alignment issues
    - Understand the relationship between noisy GPS and stable AR tracking
  - **Implementation details:**
    - Markers are 8cm radius spheres (smaller than reference point markers)
    - Raw GPS markers: Yellow (`0xffff00`), added to `scene` root (GPS world space)
    - Fused markers: Cyan (`0x00ffff`), added to `scene` root but positioned using transformed odometry
    - Subscribe to store updates: when a new GPS event is recorded, add both marker types
    - The fused markers update position when alignment matrix changes (recalculate from stored odometry positions)
  - **Visualization module:** Create `src/visualization/gps-event-markers.ts`:

    ```typescript
    class GpsEventVisualizer {
      private rawGpsMarkers: THREE.Mesh[] = [];
      private fusedMarkers: THREE.Mesh[] = [];
      private zeroRef: LatLong | null = null;
      private odometryPositions: [number, number, number][] = [];

      setZeroRef(zero: LatLong): void;
      addGpsEvent(
        gpsPoint: GpsPoint,
        odomPosition: [number, number, number]
      ): void;
      updateAlignment(alignmentMatrix: mat4): void; // Recalculate fused marker positions
      clearAll(): void;
      getCounts(): { raw: number; fused: number };
    }
    ```

### Output & Storage

- **Platform:** Android (Chrome 142+) targeting the File System Access API.
- **Workflow:** User selects a local folder via `showDirectoryPicker()` at startup.
- **Structure:** See "Recording Format & Folder Layout" above.

### Developer Workflow

- **Using Recordings:** Copy scenario folders into `TestData/` and write integration tests in a dedicated test suite that replays the actions.
- **Replay Mode:** The app includes a built-in replay mode for desktop debugging — see the "Replay Mode" section above. When opened in a browser without WebXR, it automatically switches to a 3D replay/debug UX.

### Tech Stack

- **Core:** WebXR, Three.js.
- **UI Overlay:** Vanilla HTML with Tailwind CSS.

## Project Structure

```
GpsPlusSlamJs_RecorderApp/
├── index.html              # Main HTML with setup modal and HUD overlay
├── package.json            # Dependencies (MUST include gps-plus-slam-js)
├── tsconfig.json           # TypeScript configuration
├── config/
│   ├── vite.config.ts      # Vite dev server config
│   ├── vitest.config.ts    # Vitest test runner config
│   └── eslint.config.mjs   # ESLint configuration
└── src/
    ├── main.ts             # App entry point, store subscription, ref point loading
    ├── ar/
    │   ├── webxr-session.ts    # WebXR AR session, Three.js scene hierarchy
    │   │                        # MUST implement: arWorldGroup pattern, getCurrentArPose()
    │   └── replay-scene.ts     # Replay Three.js scene (no WebXR), initReplayScene()
    ├── sensors/
    │   └── gps.ts              # Geolocation, triggers recordGpsEvent on GPS arrival
    ├── state/
    │   ├── store.ts            # Wraps createGpsSlamStore(), persistence middleware
    │   ├── store.test.ts       # Store unit tests
    │   ├── recording-coordinator.ts  # GPS event handler, eulerToQuaternion()
    │   ├── recording-replayer.ts     # Instant replay (all-at-once dispatch, no UI)
    │   └── replay-engine.ts    # createListenerMiddleware-based timed replay with play/pause/speed
    ├── storage/
    │   ├── file-system.ts      # File System Access API persistence
    │   └── ref-point-loader.ts # Load/save reference points from scenario refPoints/ folder
    ├── visualization/
    │   ├── reference-points.ts # RefPointVisualizer class, Three.js spheres
    │   └── gps-event-markers.ts # GpsEventVisualizer class, raw GPS + fused markers
    ├── types/
    │   └── webxr.d.ts          # WebXR & File System Access type declarations
    └── ui/
        ├── hud.ts              # HUD overlay and UI event handlers
        └── map-browser.ts     # Map-centric recording browser (replay selection)
```

**Key Implementation Files (must exist):**

1. **`src/state/store.ts`** - Wraps library store, does NOT create custom actions
2. **`src/state/recording-coordinator.ts`** - GPS arrival handler, constructs `GpsPoint` objects
3. **`src/ar/webxr-session.ts`** - Scene hierarchy (`scene → arWorldGroup → camera`), `applyAlignmentMatrix()`
4. **`src/ar/replay-scene.ts`** - Replay Three.js scene without WebXR, `initReplayScene()`, camera controls
5. **`src/state/replay-engine.ts`** - `createListenerMiddleware`-based timed replay with play/pause/speed
6. **`src/storage/ref-point-loader.ts`** - Load/save reference points from scenario's refPoints/ directory
7. **`src/visualization/reference-points.ts`** - Visualize ref points as Three.js spheres
8. **`src/visualization/gps-event-markers.ts`** - Visualize raw GPS and fused alignment markers
9. **`src/storage/recording-discovery.ts`** - Enumerate scenarios + session zips from a picked folder (no DOM)
10. **`src/main.ts`** - Subscribe to alignment updates, load prior ref points on session start, WebXR detection → replay branch

---

## Common Mistakes to Avoid

### ❌ MISTAKE 1: Creating a Custom Redux Store

**Wrong:**

```typescript
// DO NOT DO THIS
const store = configureStore({
  reducer: {
    recording: recordingReducer, // Custom reducer
    gps: gpsReducer, // Custom reducer
  },
});
```

**Correct:**

```typescript
import { createGpsSlamStore } from 'gps-plus-slam-js';

const libraryStore = createGpsSlamStore();
// Add persistence middleware, optionally combine with app-specific state
```

**Why:** The library's store contains the alignment algorithm. Custom stores can't replay sessions or compute alignment matrices.

---

### ❌ MISTAKE 2: Recording AR and GPS Separately

**Wrong:**

```typescript
// DO NOT DO THIS - creates unpaired data
function onXRFrame(frame: XRFrame) {
  const pose = frame.getViewerPose(referenceSpace);
  store.dispatch(recordArPose(pose)); // ❌ Wrong
}

function onGPS(position: GeolocationPosition) {
  store.dispatch(recordGpsReading(position)); // ❌ Wrong
}
```

**Correct:**

```typescript
// Store AR pose every frame, but don't dispatch
function onXRFrame(frame: XRFrame) {
  latestArPose = extractPose(frame); // ✅ Just store
}

// On GPS arrival, read current AR pose and dispatch combined action
function onGPS(position: GeolocationPosition) {
  const arPose = getCurrentArPose();
  store.dispatch(
    recordGpsEvent({
      odomPosition: arPose.position,
      odomRotation: arPose.rotation,
      gpsPoint: constructGpsPoint(position, zeroRef),
    })
  ); // ✅ Single combined action
}
```

**Why:** The library needs paired AR+GPS data at the same timestamp. Separate actions create timing issues and make replay non-deterministic.

---

### ❌ MISTAKE 3: Wrong Scene Hierarchy

**Wrong:**

```typescript
// DO NOT DO THIS
scene.add(camera); // ❌ Camera directly in scene
applyAlignmentMatrix(camera.matrix); // ❌ Can't read raw AR pose anymore
```

**Correct:**

```typescript
// ✅ Correct hierarchy
const arWorldGroup = new THREE.Group();
scene.add(arWorldGroup);
arWorldGroup.add(camera); // Camera inside AR group

// Apply alignment to group, not camera
applyAlignmentMatrix(arWorldGroup.matrix);

// Can still read raw AR pose from camera.matrix (local to arWorldGroup)
```

**Why:** The alignment matrix transforms the entire AR coordinate frame. If applied to the camera directly, you lose access to the raw AR pose needed for recording.

---

### ❌ MISTAKE 4: Missing GpsPoint Required Fields

**Wrong:**

```typescript
// DO NOT DO THIS - missing required computed fields
const gpsPoint = {
  latitude: pos.coords.latitude,
  longitude: pos.coords.longitude,
  accuracy: pos.coords.accuracy,
  timestamp: pos.timestamp,
}; // ❌ Missing: id, zeroRef, coordinates, weight
```

**Correct:**

```typescript
import { calcRelativeCoordsInMeters } from 'gps-plus-slam-js';

const coords = calcRelativeCoordsInMeters(
  { lat: pos.coords.latitude, lon: pos.coords.longitude },
  zeroRef
);

const gpsPoint: GpsPoint = {
  id: `gps-${Date.now()}`, // ✅ Unique identifier
  zeroRef, // ✅ GPS origin reference
  latitude: pos.coords.latitude,
  longitude: pos.coords.longitude,
  altitude: pos.coords.altitude ?? undefined,
  latLongAccuracy: pos.coords.accuracy,
  coordinates: [coords.x, coords.y, coords.z], // ✅ Meters from zero
  weight: 1 / Math.max(pos.coords.accuracy, 1), // ✅ Higher accuracy = higher weight
  timestamp: pos.timestamp,
  deviceRotation: eulerToQuaternion(alpha, beta, gamma), // ✅ Device orientation for tracking restart detection
};
```

**Why:** The library's alignment algorithm requires `coordinates` (position in meters) and `weight` (for the weighted alignment). Missing these fields breaks the algorithm.

---

### ❌ MISTAKE 5: Not Applying the Alignment Matrix

**Wrong:**

```typescript
// DO NOT DO THIS - alignment matrix computed but never used
const store = createGpsSlamStore();
// No subscription to state.gpsData.gpsEvents.alignmentMatrix
// Reference points won't align with real world
```

**Correct:**

```typescript
store.subscribe(() => {
  const state = store.getState();
  if (state.gpsData?.gpsEvents?.alignmentMatrix) {
    applyAlignmentMatrix(state.gpsData.gpsEvents.alignmentMatrix);
  }
});
```

**Why:** Without applying the alignment matrix, the AR world and GPS world remain misaligned. Reference points from prior sessions won't appear in the correct physical locations.

---

### ❌ MISTAKE 6: Reference Points in Wrong Coordinate Space

**Wrong:**

```typescript
// DO NOT DO THIS - ref points in AR space won't stay in place
arWorldGroup.add(refPointSphere); // ❌ Wrong parent
```

**Correct:**

```typescript
// ✅ Ref points in GPS world space
scene.add(refPointSphere); // GPS-anchored, not AR-anchored
```

**Why:** Reference points are GPS locations that should remain fixed in the world. If added to `arWorldGroup`, they'll move when the alignment matrix changes.

---

### ❌ MISTAKE 7: Not Loading Prior Reference Points

**Wrong:**

```typescript
// DO NOT DO THIS - only shows current session ref points
function onMarkRefPoint(id: string) {
  store.dispatch(markRefPoint({ id, ... }));
  visualizeRefPoint({ id, ... });  // Only current session
}
// Never loads prior sessions - user can't see alignment quality
```

**Correct:**

```typescript
async function startRecording(scenarioName: string) {
  // ✅ Load ALL ref points from scenario's refPoints/ directory
  const refPointDefs = await loadAllRefPoints(scenarioHandle);
  refPointDefs.forEach(def => {
    // Show all observations from all sessions as green spheres
    def.observations.forEach(obs => {
      visualizer.addPriorRefPoint({
        id: def.id,
        ...obs
      });
    });
  });  // Green spheres
}

function onMarkRefPoint(id: string) {
  store.dispatch(markRefPoint({ id, ... }));
  visualizer.addCurrentRefPoint({ id, ... });  // Red sphere
}
```

**Why:** The core value of the app is showing alignment quality by displaying where prior sessions marked the same reference points. Without this, users can't verify alignment.

---

### ❌ MISTAKE 8: Using Identity Quaternion for Device Orientation

**Wrong:**

```typescript
// DO NOT DO THIS - placeholder breaks tracking restart detection
const deviceRotation = [0, 0, 0, 1]; // ❌ Identity quaternion
```

**Correct:**

```typescript
const deviceRotation = eulerToQuaternion(
  deviceOrientation.alpha,
  deviceOrientation.beta,
  deviceOrientation.gamma
); // ✅ Proper conversion
```

**Why:** The library uses device orientation to detect when AR tracking has restarted (different orientation = different session). Identity quaternion breaks this.

---

## Implementation Checklist

Use this checklist to ensure correct implementation from the start.

### Phase 1: Library Integration

- [ ] **Add library dependency** to `package.json`:

  ```json
  "dependencies": {
    "gps-plus-slam-js": "file:../GpsPlusSlamJs",
    "@reduxjs/toolkit": "^2.9.2",
    "gl-matrix": "3.4.4",
    "three": "^0.170.0"
  }
  ```

- [ ] **Import library exports** in `src/state/store.ts`:

  ```typescript
  import {
    createGpsSlamStore,
    setZeroPos,
    recordGpsEvent,
    odometryTrackingRestarted,
    type RecordGpsEventPayload,
    type GpsPoint,
    type LatLong,
    calcRelativeCoordsInMeters,
  } from 'gps-plus-slam-js';
  ```

- [ ] **Wrap library store** (don't create custom reducers for GPS/AR data):

  ```typescript
  export const store = createGpsSlamStore();
  // Add persistence middleware here
  ```

- [ ] **Use library types** - No custom `ArPose` or `GpsReading` interfaces

### Phase 2: Scene Hierarchy

- [ ] **Create proper Three.js hierarchy** in `src/ar/webxr-session.ts`:

  ```typescript
  const scene = new THREE.Scene();
  const arWorldGroup = new THREE.Group();
  arWorldGroup.name = 'ar-world';
  scene.add(arWorldGroup);
  const camera = new THREE.PerspectiveCamera(...);
  arWorldGroup.add(camera);
  ```

- [ ] **Implement `applyAlignmentMatrix()`** function:

  ```typescript
  export function applyAlignmentMatrix(matrix: mat4): void {
    const threeMatrix = new THREE.Matrix4().fromArray(matrix);
    arWorldGroup.matrix.copy(threeMatrix);
    arWorldGroup.matrixAutoUpdate = false;
    arWorldGroup.updateMatrixWorld(true);
  }
  ```

- [ ] **Export `getCurrentArPose()`** to read raw AR pose:
  ```typescript
  export function getCurrentArPose() {
    return latestArPose;
  }
  ```

### Phase 3: GPS-Triggered Recording

- [ ] **Store AR pose every frame** (don't dispatch action):

  ```typescript
  function onXRFrame(frame: XRFrame) {
    const pose = frame.getViewerPose(referenceSpace);
    if (pose) latestArPose = extractPose(pose);
  }
  ```

- [ ] **GPS handler dispatches single combined action** in `src/sensors/gps.ts`:

  ```typescript
  function onGPS(position: GeolocationPosition) {
    const arPose = getCurrentArPose();
    if (!arPose) return;

    // Set zero ref on first GPS
    if (!store.getState().gpsData?.zero) {
      store.dispatch(
        setZeroPos({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        })
      );
    }

    const zeroRef = store.getState().gpsData!.zero;
    const gpsPoint = constructGpsPoint(position, zeroRef);

    store.dispatch(
      recordGpsEvent({
        odomPosition: arPose.position,
        odomRotation: arPose.rotation,
        gpsPoint,
      })
    );
  }
  ```

- [ ] **Implement `constructGpsPoint()`** with all required fields:

  ```typescript
  function constructGpsPoint(pos: GeolocationPosition, zeroRef: LatLong): GpsPoint {
    const coords = calcRelativeCoordsInMeters(
      { lat: pos.coords.latitude, lon: pos.coords.longitude },
      zeroRef
    );
    return {
      id: `gps-${Date.now()}`,
      zeroRef,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      altitude: pos.coords.altitude ?? undefined,
      latLongAccuracy: pos.coords.accuracy,
      coordinates: [coords.x, coords.y, coords.z],
      weight: 1 / Math.max(pos.coords.accuracy, 1),
      timestamp: pos.timestamp,
      deviceRotation: deviceOrientation ? eulerToQuaternion(...) : undefined
    };
  }
  ```

- [ ] **Implement `eulerToQuaternion()`** in `src/state/recording-coordinator.ts` using gl-matrix

### Phase 4: Alignment Matrix Subscription

- [ ] **Subscribe to store updates** in `src/main.ts`:

  ```typescript
  let unsubscribe: (() => void) | null = null;

  function handleStartRecording() {
    // ... existing code ...

    unsubscribe = store.subscribe(() => {
      const state = store.getState();
      if (state.gpsData?.gpsEvents?.alignmentMatrix) {
        applyAlignmentMatrix(state.gpsData.gpsEvents.alignmentMatrix);
      }
    });
  }

  function handleStopRecording() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }
  ```

### Phase 5: Reference Point Visualization

- [ ] **Create reference point loader module** `src/storage/ref-point-loader.ts`:
  - `loadAllRefPoints(scenarioHandle)` - Load all `*.json` from `refPoints/` directory
  - `loadRefPoint(scenarioHandle, pointId)` - Load specific reference point
  - `saveRefPointObservation(scenarioHandle, pointId, pointName, observation)` - Save new observation to point's JSON file
  - `listRefPointIds(scenarioHandle)` - Get list of existing reference point IDs for autocomplete

- [ ] **Create visualizer module** `src/visualization/reference-points.ts`:
  - `RefPointVisualizer` class
  - `setZeroRef(zero)`, `addPriorRefPoint(ref)`, `addCurrentRefPoint(ref)`
  - Create Three.js spheres, add to `scene` (not `arWorldGroup`)

- [ ] **Load prior ref points on session start** in `src/main.ts`:

  ```typescript
  async function handleStartRecording() {
    // ... after zero ref is set (wait ~2 seconds) ...
    const refPointDefs = await loadAllRefPoints(scenarioHandle);
    refPointDefs.forEach((def) => {
      def.observations.forEach((obs) => {
        refPointVisualizer.addPriorRefPoint({ id: def.id, ...obs });
      });
    });
  }
  ```

- [ ] **Save reference point when marked** in `src/main.ts`:

  ```typescript
  async function handleMarkRefPoint(pointId: string) {
    const arPose = getCurrentArPose();
    const gpsPoint = getCurrentGpsPoint();

    // Dispatch action for replay
    store.dispatch(add2dImage({ imageFile: `ref-point:${pointId}`, ... }));

    // Save to scenario's refPoints folder for cross-session persistence
    await saveRefPointObservation(scenarioHandle, pointId, pointId, {
      sessionId: currentSessionId,
      timestamp: Date.now(),
      arPose,
      gpsPoint
    });

    // Visualize immediately
    refPointVisualizer.addCurrentRefPoint({ id: pointId, arPose, gpsPoint });
  }
  ```

- [ ] **Wire scenario selector** in `src/ui/hud.ts`:
  ```typescript
  scenarioSelect.addEventListener('change', () => {
    const selectedScenario = scenarioSelect.value;
    if (selectedScenario !== '**new**') {
      callbacks.onScenarioChange(selectedScenario);
    }
  });
  ```

### Phase 6: Testing

- [ ] **Unit tests** for all new modules (ref-point-loader, reference-points, store)
- [ ] **Verify alignment matrix applied** - Log camera world position, verify it changes after GPS events
- [ ] **Verify ref point loading** - Check prior ref points appear as green spheres from `refPoints/` JSON files
- [ ] **Verify ref point saving** - Mark a ref point, check `/<ScenarioName>/refPoints/<pointId>.json` was created/updated
- [ ] **Verify GPS event structure** - Inspect saved `actions.jsonl`, confirm `recordGpsEvent` has all fields

### Phase 7: Replay Mode

See the detailed implementation checklist in [docs/2026-02-19-replay-mode.md](../GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md#implementation-checklist). Covers: WebXR detection → REPLAY_SETUP, session browser UI, replay scene, replay engine, store wiring, and unit tests.

---

## Getting Started

### Prerequisites

- Node.js 22.14+ (24 LTS recommended); pnpm 11 via `corepack enable`
- Android device with Chrome 142+ (for File System Access API)
- WebXR-capable browser

### Development

```bash
cd GpsPlusSlamJs_RecorderApp

# Install dependencies
npm install

# Start dev server (accessible on local network for phone testing)
npm run dev

# Run tests
npm test

# Run all tests including E2E
npm run test:all
```

## Testing Strategy

The app has a layered testing approach that maximizes coverage for code that can be tested automatically, while acknowledging that WebXR and device APIs require manual testing on real hardware.

### What IS Tested Automatically

| Layer                 | Test Type        | What's Covered                                               |
| --------------------- | ---------------- | ------------------------------------------------------------ |
| **Redux Store**       | Unit (Vitest)    | Action creators, reducers, state transitions                 |
| **Action Schema**     | Unit (Vitest)    | Recorded action structure matches expected format for replay |
| **Utility Functions** | Unit (Vitest)    | Timestamp formatting, filename generation                    |
| **UI Rendering**      | E2E (Playwright) | Page loads without errors, modal appears, buttons exist      |
| **Form Logic**        | E2E (Playwright) | UI elements are present and have correct initial states      |

### What Requires Manual Testing on Android

- WebXR AR session initialization and tracking
- File System Access API (`showDirectoryPicker`)
- Geolocation and compass APIs
- Three.js rendering in AR context
- Actual recording workflow end-to-end

### Running Tests

```bash
# Full test suite (format, lint, code analysis, typecheck, unit tests, E2E)
npm test

# Individual checks
npm run format           # Prettier formatting check
npm run lint             # ESLint
npm run check:all        # Code analysis (duplicates, cycles, boundaries)
npm run typecheck        # TypeScript compilation
npm run typecheck:tests  # TypeScript compilation for test files
npm run test:unit        # Unit tests only (fast, no browser)
npm run test:e2e         # E2E smoke tests (Playwright, launches browser)
npm run test:e2e:ui      # Interactive E2E debugging

# Verbose unit tests (show all console.log/error output from tests)
npm run test:unit -- --silent=false
```

### Code Analysis

The project includes several static analysis tools matching the library's quality gates:

| Tool                   | Command                    | Purpose                                       |
| ---------------------- | -------------------------- | --------------------------------------------- |
| **jscpd**              | `npm run check:dup`        | Detect copy-paste code (>20 tokens, >2 lines) |
| **dpdm**               | `npm run check:cycles`     | Detect circular dependencies                  |
| **dependency-cruiser** | `npm run check:boundaries` | Enforce module boundaries (e.g., storage↛ui)  |

### Testing on Android

1. Connect your Android phone via USB with USB debugging enabled.
2. Open `chrome://inspect` in Chrome on your computer.
3. Forward port 5173 to your phone.
4. Navigate to `http://localhost:5173` on your phone's Chrome.
5. Alternatively, use `ngrok` or similar to expose the dev server with HTTPS (required for WebXR in production).

## License

This app is licensed under **Apache 2.0** — see [LICENSE](LICENSE).

> **Note:** This app depends on `gps-plus-slam-js`, which is a **closed-source, proprietary** library distributed via [npm](https://www.npmjs.com/package/gps-plus-slam-js) under a separate license. A free community license key is included so you can start building right away — no signup or API key required. See the core library's EULA for the full terms.

## Related Projects

- **gps-plus-slam-js** ([npm](https://www.npmjs.com/package/gps-plus-slam-js)) — The core TypeScript library (closed-source) this recorder feeds data into.
- **GpsPlusSlamJs_AppFramework** (`../GpsPlusSlamJs_AppFramework/`) — Reusable AR+GPS framework layer (open-source, Apache 2.0).
- **Replay Mode** — Built into this app. When opened on a desktop browser (no WebXR), the app automatically switches to a 3D replay/debug UX. See the "Replay Mode" section above.
