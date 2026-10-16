# Persistence Component Implementation Plan (Chrome-Only, Frozen)

## Overview

The persistence component is the durability layer for KmlEditor in Google Chrome only (desktop and Android Chrome where supported). It persists the latest container bytes to the same user-selected file using the File System Access API and reports save status through the existing persistence contract.

This component is orchestration only. It never parses KML, never mutates feature data, and never rewrites bytes. It only commits the bytes produced by IKmzContainer.save().

### Boundaries

What it owns
- Native file binding lifecycle (open, permission, writable stream use).
- Debounced autosave scheduling and explicit flush.
- Save status transitions: idle, saving, saved, error.
- Session identity and stale-write prevention.
- Download export as recovery path when native write is not available.

What it never owns
- KML parsing, lossless mutation, or schema correctness.
- Command logic, selection, rendering, or AR behavior.
- Store state semantics beyond reacting to notifyChange calls.
- Any contract redesign or new cross-component interface.

Contracts it consumes
- IKmzContainer from src/contracts/kmz-container.ts.
- IPersistenceService and SaveStatus from src/contracts/persistence.ts.

Contracts it implements
- IPersistenceService exactly as-is.

Chrome-only support policy
- Supported runtime: Google Chrome (Chromium) only.
- Non-Chrome browsers are out of scope for this component and must fail with a clear unsupported-environment error at service creation/open.
- OPFS fallback for non-Chrome compatibility is removed from this plan. Recovery path is export/download only.

Architectural dependencies from other components
- kmz-io owns archive bytes and IKmzContainer.save().
- kml-model owns byte-faithful mutation.
- commands/store/editor/ar-scene own when edits happen; persistence only reacts to notifyChange.
- The store (component 7 in root plan) is the expected orchestration point that invokes open, notifyChange, save/flush, and dispose.

## Internal Architecture

Keep implementation minimal to avoid over-engineering.

### 1. PersistenceServiceImpl
Responsibility
- Single concrete class implementing IPersistenceService.
- Owns session state, timer, status, and all public methods.

Inputs
- open(file?)
- save(container)
- flush(container)
- notifyChange()
- downloadAs(container, filename)

Outputs
- IKmzContainer from open().
- Status notifications.
- Native file writes or explicit download export.

Dependencies
- Browser File System Access API.
- IKmzContainer.save().

Invariants
- Exactly one active session at a time.
- At most one in-flight write at a time.
- No write runs for a stale session token.
- No bytes are transformed between container.save() and disk/export.

### 2. SessionState (plain internal data object)
Responsibility
- Hold active container reference and native file handle binding.
- Track session token, dirty version, in-flight write promise, and last error.

Fields
- sessionToken: number
- activeContainer: IKmzContainer | null
- activeFileHandle: FileSystemFileHandle | null
- dirtyVersion: number
- persistedVersion: number
- isSaving: boolean
- pendingFlush: boolean
- timerId: number | null
- status: SaveStatus
- lastError: Error | null

Invariants
- save/flush/downloadAs must reject if container !== activeContainer.
- sessionToken increments on every successful open() and dispose().
- stale completion handlers (token mismatch) never mutate current state.

### 3. NativeWritePath (internal methods, not a separate public module)
Responsibility
- Materialize bytes via container.save().
- Write bytes through createWritable(), write(), close().

Invariants
- A successful close() is the only commit point.
- If write/close fails, status becomes error and dirty state remains true.
- No partial success clears dirtyVersion.

### Why this decomposition minimizes coupling
- One concrete service class plus a plain state object is enough for contract scope.
- Avoids unnecessary extra classes while still isolating critical invariants.
- Keeps all race-sensitive logic in one place for maintainability.

## Runtime Data Flow

### Flow A: open(file?)
1. Validate environment: Chrome required. If not Chrome, fail fast with unsupported-environment error.
2. If file is omitted:
   - Use showOpenFilePicker to get a file handle.
   - Request readwrite permission before binding session.
   - Read File from handle.getFile().
3. If file is provided:
   - Open container from File.
   - Session is detached (no native writable handle) until user explicitly rebinds via picker.
4. Create/reset session:
   - Increment sessionToken.
   - Clear timer, in-flight state, dirtyVersion, lastError.
   - Bind activeContainer and optional handle.
5. Set status to saved.
6. Return activeContainer.

### Flow B: notifyChange()
1. Require activeContainer; otherwise no-op with warning-level internal diagnostic.
2. Increment dirtyVersion.
3. Schedule debounce timer (reset if existing).
4. On timer fire, call internal attemptSave("autosave", tokenSnapshot).

### Flow C: save(container)
1. Validate container identity equals activeContainer; otherwise reject (container-session mismatch).
2. Cancel debounce timer for current session.
3. Execute attemptSave("manual", tokenSnapshot) immediately.

### Flow D: flush(container)
1. Validate container identity equals activeContainer.
2. Cancel debounce timer.
3. If a write is in-flight:
   - Set pendingFlush = true.
   - Await in-flight completion.
4. If dirtyVersion > persistedVersion, run attemptSave("flush", tokenSnapshot).
5. If pendingFlush was set and dirtyVersion changed during save, run exactly one additional save.

### Flow E: attemptSave(mode, token)
1. Abort if token != sessionToken.
2. If no activeFileHandle:
   - Transition to error.
   - Return explicit native-handle-missing result.
3. Set status to saving.
4. bytes = await activeContainer.save().
5. writable = await activeFileHandle.createWritable().
6. await writable.write(bytes).
7. await writable.close().
8. If token changed during await chain, ignore completion effects.
9. Set persistedVersion = dirtyVersion snapshot.
10. Set status to saved if no newer dirty changes exist, else leave/save again via scheduler.

### Flow F: permission revoked during save
1. createWritable or write/close throws NotAllowedError/SecurityError.
2. Keep dirtyVersion > persistedVersion.
3. Set status = error and lastError.
4. Next save/flush retries native path.
5. If retries keep failing, caller can use downloadAs() explicitly.

### Flow G: downloadAs(container, filename)
1. Validate container identity equals activeContainer.
2. bytes = await container.save().
3. Create Blob and object URL.
4. Trigger download with sanitized filename.
5. Revoke URL in finally block.
6. Do not change persistedVersion (export is not native in-place commit).

### Flow H: dispose()
1. Increment sessionToken.
2. Clear debounce timer.
3. Drop activeContainer and activeFileHandle.
4. Clear pending flags and listeners.
5. Set status = idle.

### Integration trigger requirements (store/editor/ar-scene)
- Store must call notifyChange() after every successful command execute, undo, and redo that changed the document.
- Store must call flush() before destructive lifecycle transitions:
  - opening another file,
  - unloading page,
  - disposing current session.
- Persistence must never infer changes by inspecting model internals.

## Public Surface

No contract changes.

createPersistenceService(): IPersistenceService
- Factory returns PersistenceServiceImpl.

IPersistenceService method behavior in this plan
- open(file?): creates active session; may be native-bound or detached.
- save(container): immediate native write, identity-checked.
- flush(container): drains in-flight save and guarantees latest dirty version attempt.
- notifyChange(): marks dirty and debounces.
- status: live SaveStatus.
- onStatusChange(listener): subscribe/unsubscribe.
- hasNativeFileAccess: true only when Chrome capability checks pass.
- downloadAs(container, filename): explicit export only; does not claim native persistence.
- dispose(): cancel timers, invalidate session token, clear references.

Container identity rule (critical)
- save/flush/downloadAs must fail if the passed container is not the currently active session container.
- This prevents cross-session corruption and stale writes.

## Algorithms

### 1. Debounce with version counters
Purpose
- Coalesce bursts while preserving the latest state.

State
- dirtyVersion increments on notifyChange.
- persistedVersion tracks last committed dirtyVersion.

Steps
1. notifyChange -> dirtyVersion++
2. reset timer
3. timer fires -> attemptSave
4. on success -> persistedVersion = snapshotDirtyVersion
5. if dirtyVersion > persistedVersion, schedule one more save

Complexity
- O(1) per notifyChange plus O(file_size) per save attempt.

Failure cases
- save throws, permission revoked, stale token.

Memory implications
- One full ArrayBuffer from container.save() per attempt.

### 2. Session token stale-write guard
Purpose
- Ensure old async completions cannot mutate new session.

Steps
1. tokenSnapshot captured at operation start.
2. Every async completion checks tokenSnapshot === sessionToken.
3. Mismatch -> ignore completion side effects.

Complexity
- O(1) per checkpoint.

### 3. Container-session identity validation
Purpose
- Prevent writing bytes from one container into another session target.

Steps
1. Reference equality check: passedContainer === activeContainer.
2. If false, throw deterministic mismatch error.

Complexity
- O(1).

### 4. Native write commit sequence
Purpose
- Prevent data loss by only marking saved after close() succeeds.

Steps
1. bytes = container.save()
2. writable = handle.createWritable()
3. writable.write(bytes)
4. writable.close()
5. only then persistedVersion update

Complexity
- O(file_size).

### 5. Filename sanitization for export
Purpose
- Avoid unsafe/invalid suggested names in download flow.

Rules
- Strip path separators.
- Normalize whitespace.
- Enforce .kml or .kmz extension consistent with container content when known.
- Fallback to exported.kmz.

Complexity
- O(filename_length).

## State Management

Mutable state ownership
- All mutable state is owned by PersistenceServiceImpl instance.
- No global singleton state.

Lifetime
- Created at factory call.
- Active until dispose().

Synchronization rules
- Single writer rule: one in-flight save only.
- save and flush serialize through same internal write path.
- notifyChange never performs writes directly.

Caching
- No persistent byte cache.
- Only transient in-flight ArrayBuffer.

Invalidation
- open() and dispose() invalidate prior token.
- timer and pending flush flags reset on token change.

Disposal
- Revoke any active export URLs.
- clearTimeout on timer.
- clear listeners and references.

## Error Strategy

Error classes (internal)
- UnsupportedEnvironmentError
- ContainerSessionMismatchError
- NativeHandleMissingError
- NativePermissionDeniedError
- NativeWriteFailedError
- ExportFailedError

Expected failures and exact behavior

1. Unsupported browser
- When: service initialization/open in non-Chrome.
- Behavior: throw UnsupportedEnvironmentError; status -> error.
- Recovery: none in this component; Chrome required.

2. Container-session mismatch
- When: save/flush/downloadAs called with non-active container.
- Behavior: throw ContainerSessionMismatchError, no state mutation.
- Recovery: caller must use active container/session.

3. Missing native handle
- When: detached open(file) session tries native save.
- Behavior: save/flush fail with NativeHandleMissingError; status -> error.
- Recovery: caller reopens/rebinds using picker or uses downloadAs.

4. Permission denied/revoked
- When: createWritable/write/close throws permission-related error.
- Behavior: status -> error, keep dirty versions unchanged.
- Recovery: retry save/flush after permission re-grant, else export.

5. Serialization failure from container
- When: container.save() throws.
- Behavior: status -> error, do not alter persistedVersion.
- Recovery: caller resolves upstream model/container issue and retries.

6. Download blocked/cancelled
- When: browser blocks or user cancels save dialog.
- Behavior: ExportFailedError, no persistedVersion change.
- Recovery: user retries export.

Diagnostics policy
- Keep lastError internally for debugging and tests.
- Emit status transitions deterministically regardless of error type.

## Performance Strategy

CPU
- Debounce window defaults to 600 ms for It.1 (configurable constant).
- No save on every pointer move; rely on store command completion and notifyChange.

Memory
- One save buffer at a time.
- Avoid copying ArrayBuffer before write.

Large files
- Add pre-save guardrails:
  - warn at >100 MB,
  - hard fail at >300 MB with explicit error (protect browser memory stability).
- These thresholds are implementation constants and must be test-covered.

Backpressure
- If edits continue during long save, only one follow-up save is queued (latest-state wins).
- Do not enqueue unbounded save backlog.

Not optimized by design
- No partial archive patching in persistence.
- No multi-threading in It.1.

## Testing Strategy

### Unit tests
- Status transitions across success/failure/retry.
- Container identity mismatch rejection.
- Session token stale completion ignored.
- Debounce behavior and latest-state follow-up save.
- pendingFlush behavior with in-flight save.
- filename sanitization.

### Integration tests (Chrome environment)
- Native picker open -> edit notify -> autosave writes same file.
- save() and flush() with real createWritable mocks.
- Permission revoked mid-session -> status error -> retry path.
- Reopen file while save in-flight -> stale completion ignored.
- Detached file open -> save fails with missing-handle -> downloadAs works.

### Regression tests
- Rapid execute/undo/redo bursts produce bounded save count.
- open(new file) after dirty old session never writes old bytes to new file.
- flush before dispose attempts latest dirty version exactly once (plus one follow-up only if dirtied again).

### Golden tests
- Byte-exact pass-through: bytes written/exported exactly equal container.save() output.
- Persistence layer never edits XML text or zip entries.

### Security-focused tests
- Oversized buffer guardrail behavior.
- Unsafe filename normalization.
- Object URL always revoked in success and failure paths.

### Demo acceptance tests
- Open real fixture, perform command-driven edit, observe status saving->saved.
- Reopen same file in app and in Google Earth: only intended edits changed.

## Demo

Standalone demo scope
- Chrome-only page in demos/persistence-demo.
- Controls:
  - Open file via picker
  - Simulate edit (calls notifyChange)
  - Save now (save)
  - Flush now (flush)
  - Export (downloadAs)
- Visuals:
  - status badge
  - active mode: native-bound or detached
  - last error text
  - save counter

What must be proven
- Native in-place autosave works in Chrome.
- Container mismatch is rejected deterministically.
- Permission failure is visible and recoverable.
- Export is explicit and does not mark native persistence as saved.

## Dependencies

External libraries
- None required for persistence logic.

Platform APIs (Chrome)
- showOpenFilePicker / FileSystemFileHandle / createWritable.
- Blob + URL.createObjectURL + URL.revokeObjectURL.

Why alternatives are rejected
- OPFS fallback for cross-browser parity is out of scope under Chrome-only policy.
- Additional wrapper libraries add indirection without improving correctness for fixed contract scope.

Assumptions
- Chrome implementation of File System Access is available on target devices.
- User grants and retains permission for native save path.

## Risks

1. Native permission volatility
- Risk: writes can fail after initial open.
- Severity: High.
- Detection: integration tests with forced NotAllowedError.
- Mitigation: deterministic error state, retry path, explicit export fallback.

2. Session/container mismatch from orchestration bugs
- Risk: wrong bytes written to wrong target.
- Severity: High.
- Detection: strict identity checks in all write/export paths.
- Mitigation: fail-fast mismatch error and store integration tests.

3. Large file memory pressure
- Risk: browser tab instability from huge ArrayBuffers.
- Severity: High.
- Detection: stress tests with large fixtures.
- Mitigation: size thresholds and bounded follow-up scheduling.

4. Stale async completion races
- Risk: old save completion overwrites state after reopen.
- Severity: Medium.
- Detection: race tests reopening during save.
- Mitigation: session token guard at each await boundary.

5. User misunderstanding of detached mode
- Risk: user thinks file was saved in place when only export exists.
- Severity: Medium.
- Detection: demo and UX tests.
- Mitigation: explicit mode indicator and status messaging rules.

## Milestones

Milestone 1: Core service + state invariants
- Implement PersistenceServiceImpl skeleton.
- Implement status transitions, token invalidation, identity checks.
- Unit tests for mismatch, stale token, and basic lifecycle.

Milestone 2: Native Chrome open/save path
- Implement picker-bound open and immediate save.
- Implement write commit sequence with status changes.
- Integration tests for successful in-place persistence.

Milestone 3: Debounced autosave + flush semantics
- Implement notifyChange debounce and follow-up save rule.
- Implement flush draining behavior.
- Tests for rapid edits, in-flight save, and bounded queueing.

Milestone 4: Error and recovery flows
- Implement permission-revoked handling.
- Implement detached-mode missing-handle behavior.
- Implement deterministic error classification.
- Integration tests for recovery and retries.

Milestone 5: Export path + security guards
- Implement downloadAs with filename sanitization.
- Implement object URL finally-revoke.
- Implement large-file thresholds.
- Security-focused tests.

Milestone 6: Standalone demo + end-to-end validation
- Build persistence demo page.
- Validate with real fixture round-trip and Google Earth reopen.
- Verify store integration points: notifyChange after execute/undo/redo and flush before session switch/dispose.
