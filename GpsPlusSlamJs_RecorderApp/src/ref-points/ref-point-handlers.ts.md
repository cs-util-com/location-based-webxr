# ref-point-handlers.ts

## Purpose

Encapsulates all reference-point state and event handlers extracted from `main.ts` (Finding #7 decomposition, Step 2). Provides a factory function that creates a self-contained handler object with private state for imported ref-points, mark-in-progress guard, and per-session usage tracking.

## Public API

### `createRefPointHandlers(deps: RefPointHandlersDeps): RefPointHandlers`

Factory that creates ref-point handlers with injected dependencies.

**`RefPointHandlersDeps`:**

- `getStore()` — returns the current `RecorderStore` (may change between recordings).
- `getCurrentSessionName()` — returns the current recording session name.
- `isStopInProgress?()` — optional; true from Stop until the session has ended. While true a mark is treated as after the recording (scenario only, warning toast).

**`RefPointHandlers`** returned object:

| Method                | Signature                           | Description                                                                                                          |
| --------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `handleMarkRefPoint`  | `() => Promise<void>`               | Full mark-ref-point flow: validate → picker → build → persist → visualize.                                           |
| `checkNearbyRefPoint` | `(lat, lng) => string \| undefined` | Check if (lat,lng) is near a known imported ref point. Returns display name or undefined.                            |
| `reset`               | `() => void`                        | Clears the concurrent-call guard and re-observation cooldown map, and dispatches `resetRefPoints` into the V2 slice. |

## Invariants & Assumptions

- **Concurrent-call guard**: `handleMarkRefPoint` sets `markRefPointInProgress = true` and returns early on re-entry, preventing overlapping picker flows.
- **Re-observation identity (D5, `2026-07-05-0559-recorder-folder-import-indexing-progress-user-feedback.md` Finding 5)**: a re-observation persists/dispatches/visualizes under the **matched anchor's id** (`nearbyMatch.h3Index`), NOT the user's current H3 cell. The proximity matcher tolerates gridDisk neighbor cells, so the two can differ — using the current cell would create a sibling `refPoints/{id}.json` and split the point's observation history into two anchors/spheres. The display-name fallback follows the matched id. New points (no match) still use `currentH3`.
- **Re-observation cooldown**: After a re-observation mark, a per-H3-cell 10-second cooldown prevents duplicate markings of the same location. Stored in `lastReObservationTimestamp` (closure `Map<string, number>`), keyed by the **matched** anchor's id (consistent with the persist identity above). New ref points via the picker are unaffected. Reset on `reset()`.
- **Mark confirmation toast feedback** (Finding 3, `2026-04-29-ref-points-user-feedback.md`; extended by D4/F4-B, `2026-06-16-2053-team1-user-feedback.md`): **both** mark paths confirm to the user after the OPFS persist resolves, reflecting the durable end state.
  - **Re-observe path** (`nearbyMatch` set, single tap, no picker): `showToast("Re-observed \"<name>\"", { severity: 'info' })` on success. Silent on cooldown rejections (by design) and on write failure (the `showError` HUD channel handles it — re-observe shows no failure toast).
  - **New-point path** (picker-driven): previously silent (the field tester reported "no indicator that a marker was set"). Now shows a transient **in-progress** `showToast("Saving \"<name>\"…")` before the durable write (only when a scenario handle exists), then either a final `showToast("Marked \"<name>\"", { severity: 'info' })` on success or `showToast("Could not save \"<name>\"", { severity: 'error', duration: TOAST_DURATION_ERROR })` on failure — the error toast reverts the in-progress state and is the AR-visible counterpart to `showError`'s HUD status (which is not composited over the camera). All under the `AGENTS.md` "UI feedback for async actions" rule.
- **`persistRefPointObservation` returns `boolean`**: `true` on successful save, `false` on caught error (after `showError` is invoked). The return value gates the confirmation toast so the toast reflects the durable end state.
- **Stop-window guard** (2026-07-12, root cause of the indoor-loop zip-1 lost "A3" action — `GpsPlusSlamJs_Docs/docs/2026-07-12-1313-indoor-loop-enablement-implementation-summary-and-followups.md` §3.5): the recording can end while the mark flow awaits (the new-point picker can stay open across Stop / a system session end). The framework persistence middleware gates `actions/` writes on `recording.isRecording`, so a post-stop `addRefPointEntry` dispatch would silently never reach the recording. `isRecordingActive()` (a mirror of the middleware's `readIsRecording`; missing slice ⇒ `false`) is read right before the dispatch: when the recording has ended, the dead dispatch is **skipped** (with a `log.warn`), the durable scenario-level OPFS observation is **kept** (session-independent data — the lost A3 became a useful cross-session anchor), and the confirmation toast switches to the honest variant `… — recording already ended, saved to scenario only` with `severity: 'warning'` on both mark paths. Pinned by the `recording ends mid-flow` describe block in [ref-point-handlers.test.ts](ref-point-handlers.test.ts).
  - **The stop window counts as ended** (DEC-AFK24-6, 2026-09-24; follow-up `GpsPlusSlamJs_Docs/docs/2026-09-24-1130-ref-point-stop-window-gap-followup.md`). Stop flushes, exports the zip for seconds, and only then ends the session, so `recording.isRecording` is still true while the zip is written; a dispatch in that window could land after the export listed `actions/`. `isRecordingActive()` therefore also returns `false` while the optional `isStopInProgress` dep (the recording session handlers' own, wired in `main.ts`) is true, and the point takes the same scenario-only path with the warning toast. Pinned by the `stop in progress` test and, for the wiring, by `main.ar-follower-wiring.test.ts`.
- **Picker-visible guard**: Returns early if the ref-point picker is already visible.
- **Raw-storage pattern**: `dispatchRefPointAction` destructures a full `GpsPoint` to extract only `RawGpsPoint` fields, dispatching `{ rawGpsPoint }` on the V2 `addRefPointEntry` action. When alignment is in effect the fused-at-mark-time snapshot is included as `{ gpsPoint }`; otherwise the field is omitted and consumers fall back to `rawGpsPoint`.
- **Action log is canonical; the OPFS sidecar is a cache (plan §A.2)**: every live mark writes the `refPoints/addRefPointEntry` action as the authoritative record; the per-scenario H3 sidecar JSON is a secondary cache write derived from the post-replay in-memory state. At startup the sidecar is hydrated _first_ via `setImportedRefPointEntries` (which replaces the array, so it must run before any action-log replay), then the session's own action log is replayed on top via `addRefPointEntry`. If the sidecar and action log disagree for a cell, the action-log observation wins — it survives into post-startup state and the sidecar is rewritten from that state on the next mark. The conflict rule is pinned by the `conflict rule: sidecar vs action log` block in [ref-points-selectors.test.ts](../state/ref-points-selectors.test.ts).
- **Single source of truth (Step 5.7 of the [2026-05-27 slice-collapse plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md))**: only `refPoints/addRefPointEntry` is dispatched at mark time. The previously-parallel `gpsData/markReferencePoint` dispatch (and its `MarkReferencePointPayload.alignmentMatrix` handoff) was dropped — fusion is now resolved directly inside `dispatchRefPointAction` via `fusedGpsFromOdom` so the V2 payload already carries the resolved `gpsPoint`. Legacy zips remain replayable via the Step 5.6 action-loader translator.
- The factory's `deps.getStore()` / `deps.getCurrentSessionName()` are called lazily (at handler invocation time), so they always reflect the latest app state.
- All other dependencies (AR, file-system, picker, HUD, store actions) are direct imports — same modules they were in `main.ts`. Visualization is **not** called from this module at all: the red current-session sphere is driven exclusively by `wireRefPointSubscribers` subscribing to `selectRefPointEntries` over the flat `refPoints` slice. (The former `visualizeRefPoint` no-op seam — whose sidecar description had gone stale, claiming an `addCurrentRefPointMark` dispatch that no longer existed — was removed 2026-07-10, quality-review D-2.)
- `reset()` does **not** interact with the store — the caller manages store lifecycle.
- Observation persistence uses `saveRefPointObservation` with the current scenario handle and session name.
- When the alignment matrix is available at mark time, `buildRefPointObservation` computes `fusedGpsPoint` via `fusedGpsFromOdom(alignmentMatrix, odomPosition, zeroRef)` (helper in `utils/fused-path.ts`). The `altitude` from the aligned VIO pipeline is included when the GPS origin carries altitude; otherwise it is `undefined`. The field is omitted entirely when no alignment matrix exists (early recording, legacy data).
- The fused-preferred/per-field-fallback positioning of the red sphere (Option B, `2026-04-29-ref-points-user-feedback.md` Finding 1; `2026-04-24-refpoint-positioning-investigation.md` §7) lives with the store-driven visualizer path (`wireRefPointSubscribers` → the shared renderer), not here.

## Examples

```typescript
import { createRefPointHandlers } from './ref-points/ref-point-handlers';

const refPointHandlers = createRefPointHandlers({
  getStore: () => store,
  getCurrentSessionName: () => currentSessionName,
});

// Wire into UI
initUI({ onMarkRefPoint: () => refPointHandlers.handleMarkRefPoint() });

// On new recording
// (per-session usage tracking was removed in 5.7a-3 Option C.)

// On folder open with ref-points
// (sidecar imports now dispatch `setImportedRefPointEntries` directly
//  into the `refPoints` slice; folder-manager owns this wiring.)

// On app reset
refPointHandlers.reset();
```

- **Single source of truth (5.7a-3 Option C of the [2026-05-27 slice-collapse plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md))**: known anchors live exclusively in the flat `refPoints` slice. `handleMarkRefPoint` and `checkNearbyRefPoint` read via `selectKnownAnchorsByCell(state.refPoints)`. The legacy `refPoints` slice is no longer written by production code; per-session usage tracking and `incrementRefPointUsage` were dropped because the picker is now always called with an empty `existingIds` list (H3 IDs are meaningless to users) so no usage column is rendered.

## Tests

- **`ref-point-handlers.test.ts`** — 67 unit tests covering factory creation, state management, validation guards, picker integration, observation building (including fusedGpsPoint computation with altitude propagation), persistence, visualization (including current-session fused-preference), concurrent-call prevention, H3-based IDs, proximity detection, re-observation cooldown (10s per H3 cell), and full end-to-end flow. Step 5.4 adds a `handleMarkRefPoint — Step 5.4 matcher source` block that proves the matcher resolves via `refPoints` even when legacy `importedRefPoints` is empty. Step 5.7 dropped the parallel `gpsData/markReferencePoint` dispatch — the dispatch-assertion helpers (`getMarkCalls`, `getLastV2Payload`, `expectMarkDispatchedTimes`) now read the V2 dispatch stream off the mock store directly.
- Key mock pattern: all external deps are mocked via `vi.hoisted()` + `vi.mock()`. Mock return values must be explicitly reset in every `beforeEach` because `vi.clearAllMocks()` does not reset `mockReturnValue` / `mockResolvedValue`.
