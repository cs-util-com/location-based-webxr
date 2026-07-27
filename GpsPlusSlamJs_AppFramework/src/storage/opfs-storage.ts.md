# OPFS Storage Module

## Purpose

Provides persistent storage using the Origin Private File System (OPFS) API. This replaces `showDirectoryPicker` to achieve cross-platform compatibility (Desktop Chrome, Android Chrome, iOS Safari).

## Why OPFS?

The File System Access API (`showDirectoryPicker`) has a critical limitation on Android Chrome: even with `mode: 'readwrite'`, `createWritable()` fails with `NoModificationAllowedError`. OPFS works consistently across all platforms.

## Public API

### Initialization

```typescript
import { initOpfsStorage } from './opfs-storage';

// Must be called before any other operations
await initOpfsStorage();
```

**Note:** `odomCoordVersion` in session metadata was expanded to support values `2 | 3 | 4 | 5` reflecting the evolution from NUE-baked actions (era 2), to raw-WebXR positions (era 3), to raw-WebXR + RawGpsPoint (era 4), to state-side quaternion conversion (era 5). Optional `build` and sanitized `pageUrl` (origin + pathname only) fields were added for debugging — older ZIPs without them remain valid.

**Coverage index:** Optional `h3Cells` (deduped H3 cells the GPS path crossed) and `h3Resolution` (the H3 resolution used, currently 11) were added to power the map-centric recording browser — it reads them straight from `session.json` to place a tour and answer "which tours cross this tile?" without unzipping GPS data. The recorder computes `h3Cells` at recording stop via `gpsPathToCoverageCells` (see `geo/h3-proximity.ts` and `GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md`, D1/D2). Both fields are optional — legacy recordings without them remain valid and are backfilled in memory from their GPS path on demand.

### Session Management

```typescript
import {
  createSession,
  writeAction,
  writeFrame,
  writeSessionMetadata,
} from './opfs-storage';

// Create a new recording session
const { scenarioName, sessionName } = await createSession(
  'my-scenario',
  new Date()
);

// Write actions during recording
await writeAction({ type: 'test/action', payload: {} }, 1);

// Write frames during recording
await writeFrame(imageBlob, 1);

// Write metadata when session ends
await writeSessionMetadata({
  version: 1,
  startedAt: '2026-01-26T10:00:00Z',
  endedAt: '2026-01-26T10:30:00Z',
  scenarioName: 'my-scenario',
  actionCount: 42,
  frameCount: 21,
  userAgent: navigator.userAgent,
});
```

### Listing

```typescript
import { listScenarios, listSessions } from './opfs-storage';

// List all scenarios
const scenarios = await listScenarios(); // ['scenario-a', 'scenario-b']

// List sessions in a scenario
const sessions = await listSessions('scenario-a'); // ['recording-2026-01-26_10-00-00utc']
```

### Storage Quota

```typescript
import { checkStorageQuota } from './opfs-storage';

// Prefer calling initOpfsStorage() first for reliable results.
// If Storage Manager API is unavailable, returns { available: 0, used: 0 }.
const { available, used } = await checkStorageQuota();
```

## Directory Structure

```
/gps-plus-slam/
  └── scenarios/
      ├── {scenario-name}/
      │   ├── recording-YYYY-MM-DD_HH-MM-SSutc/
      │   │   ├── session.json
      │   │   ├── actions/
      │   │   │   ├── 000001.json
      │   │   │   └── ...
      │   │   └── frames/
      │   │       ├── frame-000001.jpg
      │   │       └── ...
      │   └── ...
      └── ...
```

## Invariants

1. `initOpfsStorage()` must be called before any other operations
2. `createSession()` must be called before `writeAction()`/`writeFrame()`
3. Action indices are 1-based and zero-padded to 6 digits (000001.json)
4. Frame filenames follow the pattern `frame-{index}.jpg`
5. Session folders are named `recording-YYYY-MM-DD_HH-MM-SSutc` (an underscore/dash-separated UTC stamp, NOT ISO 8601 — colons are illegal in directory names). The timestamp is whole-second resolution, so `createSession()` probes for an existing directory and appends a numeric suffix (`-2`, `-3`, …) on collision — two recordings started within the same UTC second get distinct directories instead of silently reusing and mixing one. The first session in a given second keeps the bare timestamp name.
   - The probe distinguishes error names (PR #158 review): `NotFoundError` → name free; `TypeMismatchError` (a **file** occupies the name — `{ create: true }` could not replace it either) → name taken, probe advances to the next suffix; any other error (`InvalidStateError`, …) is a storage failure and is **rethrown** so `createSession` fails loudly — treating it as "taken" would loop the suffix probe forever, treating it as "free" would crash later with a misleading create-time error.
6. All write operations go through the framework helper `writeFileOrAbort()` (`./write-file-or-abort.ts`), which guarantees `FileSystemWritableFileStream` cleanup: on write/close errors it aborts the stream (never closes it, which would commit a partial write), swallows an abort failure so it cannot mask the cause, and rethrows the original error. It lived here as a private `safeWriteToFile` until 2026-07-27, when three hand-rolled copies in the recorder — one already missing its abort guard — made it worth sharing.

## Error Modes

| Error                     | Cause                             | Recovery                        |
| ------------------------- | --------------------------------- | ------------------------------- |
| "OPFS not supported"      | Browser lacks OPFS API            | Use newer browser               |
| "Storage not initialized" | Called write before init          | Call `initOpfsStorage()` first  |
| "No active session"       | Called write before createSession | Call `createSession()` first    |
| QuotaExceededError        | Storage full                      | Delete old recordings or export |

### Soft Reset (Issue 4)

- `resetSessionHandles(): void` — Clears session-level handles (`currentSessionHandle`, `actionsHandle`, `framesHandle`) while preserving directory-level handles (`opfsRoot`, `gpsPlusSlamDir`, `sessionsDir`). Called by a wrapping backend's soft-reset flow (e.g. the recorder's `scenario-storage.resetForNewSession()`) so a new recording can start without re-initializing OPFS.

Write failures (e.g., disk full, quota exceeded) will propagate the error to the caller after safely aborting the writable stream to release file locks.

## Tests

- Unit tests: `opfs-storage.test.ts`
- All tests use `MockOPFSDirectoryHandle` from `browser-mocks.ts`
- Resource cleanup tests verify `writable.abort()` is called on write errors (the helper itself is covered directly by `write-file-or-abort.test.ts`)
