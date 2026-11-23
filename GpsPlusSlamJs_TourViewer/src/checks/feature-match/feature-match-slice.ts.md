# feature-match-slice.ts

## Purpose

The state of the feature matching check page (`feature-match-check.html`) as one Redux Toolkit slice, shared by every view of the page: the guided view (`guided-view.ts`), the cockpit view (`cockpit-view.ts`), the measuring block (`bench-engine.ts`) and the flat target capture (`flat-capture.ts`). The reducers hold the page's rules; the views only dispatch and draw. PNGs, previews, matches, Blob URLs, the camera, canvases and timers live outside it (`feature-match-store.ts`).

## Public API

- `initialFeatureMatchState({ session, flat?, plan? })`: the first state; `plan` is the stored run plan.
- `featureMatchReducer`, `featureMatchActions`, `FeatureMatchAction`.
- Selectors: `logText` (the log as one text), `currentSurface`, `flatPhase` (`overview`, `ref-live`, `corners`, `check`, `poses`), `currentShot(plan)` (the shot at `current`), `anyPairReady(plan)` (a derived pair has both photos), `handsOffDue(s)` (below).
- `HANDS_OFF_TEXT`: the status lines of a shot that takes itself (`still`, `move`, `waiting`, `taking`, `taken`, `refused`, `failed`, `lost`).
- The options start at the controls' starting values in the HTML (module-private defaults); the view mirrors the controls into the state on every change and once more at each run start.
- `planResultKeys(plan)`: the result keys of the plan's ready pairs (`readyResultKeys`).
- `RELOAD_LINE` (`page reloaded`): the log line between the stored log and a new load's.
- Types: `FeatureMatchState`, `FlatState`, `BenchOptions`, `SpeedOptions`, `FlatPhase`, `ResultEntry { status: "done" | "failed", text, persisted, measureMs?, context?, hidden? }`, `RunContext` (`beside-camera` or `idle`).

### Runs, log and options

- `cameraChanged(on)`.
- `runStarted(kind)` (`synthetic` or `speed`): refused unless idle or for another kind; ends a countdown and an armed or waiting hands-off shot. Also refused while the queue measures a pair (the two would time each other). `speed` times the methods on the flat scene's F1 and F2; the run's pairs are measured by the queue below, and the run plan has no run kind. `runProgressed(line)` sets the running kind's status line. `runFinished({ text })` ends the run.
- `statusSet`, `tableSet`, `reportSet`, `logged(line)` (stamped by the view), `failed({ line, stamped })` (kept in `errors` for the run's report and logged), `errorsCleared`, `optionsChanged`, `speedOptionsChanged`.

### Run plan actions

`planSized`, `planMoved`, `planShotTaken({ shot, photo })`, `planShotLost(shot)`, `planSettingsChanged`, `planReset`: each wraps `planReducer` (`run-plan.ts`, which holds the rules) on `state.plan`. A photo or a reset is refused while busy, and every plan action is refused in a tab that does not hold the run (`otherTab`). An accepted photo, move, resize or reset ends a countdown, and drops the stored ids and results the plan no longer names. An accepted reset also empties the log: the stored log is the run's, and a new run's zip must not carry the earlier runs' lines.

### Countdown

`state.guided` `{ count }` is the countdown before the current shot's photo; the view owns the timer.

- `guidedCountSet({ shot, left } | null)`: one countdown second or its end; refused while busy, for a shot other than the current one and for a count that is not a whole number of at least 1. A count ends an armed or waiting hands-off shot.
- A run or the zip starting ends the count too: a count that ran on would shoot into a refused photo.

### Hands-off shot actions

`state.handsOff` `{ phase, shot, prev, still, text }` is a shot that takes itself once the phone rests (`still-detector.ts`): L2, F2 and D2 (`still`) and F3 (`move`, the phone turns first), by `handsOff` in `scenes.ts`. Phases: `off`, `armed` (no reading yet, or a move shot waiting for its move), `waiting` (for the phone to rest), `taking` (rested for the dwell: the view takes the photo), `taken`, `refused` (the photo was not taken), `failed` (the readings stopped, or the capture threw); `text` is the status line (`HANDS_OFF_TEXT`; the waiting texts say "or tap"). `shot` and `prev` name the shot and the scene's previous photo it was armed against, so one previous photo arms a shot once.

- `handsOffDue(s)`: the setting is `capture: "auto"`, the camera on, nothing busy, no countdown, the current shot one the sensor can judge, without a photo, the scene's previous shot with one, and not armed against that photo before.
- `handsOffArmed(t)`: refused unless `handsOffDue` and `t` is finite; starts the detector at `t` (needing a move first on a move shot).
- `handsOffSample({ t, rate })`: one reading, or a missing one (rate null) from the view's watchdog; only while armed or waiting and idle. Readings lost turn the wait `failed`, as does a reading that jumps far ahead of the last; a state that did not change returns the same object.
- `handsOffShot("taken" | "refused" | "failed")`: only from `taking`.
- `handsOffPaused()`: an armed or waiting shot goes back to `off` with nothing named (the drawer opened), so it arms again afterwards.
- A photo, a countdown or a run started ends an armed or waiting shot, keeping it named (no second wait against that photo); a move, resize, reset, a lost photo or the camera going off clears it entirely.

### Guided run zip actions

`state.runZip` `{ phase, text }` is Download all, shared by both views (workflow status, so it lives here).

- `runZipStarted()`: refused unless idle with at least one ready pair, and in a tab that does not hold the run (`otherTab`: its plan may be stale); sets busy `saving`, phase `preparing` and ends a countdown.
- `runZipEnded({ phase, text })`: `saved`, `failed` or `idle` (the save dialog was closed); only ends a zip in preparation.
- An accepted photo, lost photo, resize or reset makes a saved or failed zip stale and resets it to `idle`; a move does not.

### Camera start and photo store

- `cameraStartSet("idle" | "starting" | "failed")`: the page's camera start (workflow status: the chip and the auto start read it); other values are refused.
- `photoStoreChanged(failing)`: whether a named photo or result could not be written to the phone's database (set by the store, read by the run and end screens).

### What storage holds

- `storedIds`: the plan photos whose write succeeded. `photoStored(id)`: refused for an id the plan does not name; never twice. No view reads it yet: today's views show a shot as taken at once; a "stored" mark per shot comes with the scene views built from the chosen prototypes.
- `results`: per current result key a `ResultEntry`. `resultStored({ key, text, persisted?, measureMs?, context?, hidden? })` (done; kept unless `persisted` is false, as when a method's model could not load; a time that is not finite and at least 0 and an unknown context are dropped) and `resultFailed({ key, text, persisted })`: a key that is not a ready pair's current one is not kept. The measuring queue (`measure-queue.ts`) produces them.
- `restored`: the stored photos, results and log were read back. `restoreFinished({ stored, results, log })`: once only; keeps the named ids and current keys, and puts the stored log first with `RELOAD_LINE` between it and this load's lines. `resetBeforeRestore`: set by a `planReset` accepted before the restore finished; the stored log is then the dropped run's and is not read back (the reset emptied the log, and the next log write stores only the new run's lines).
- `otherTab`: another tab holds the run. `otherTabFound()` sets it; from then on every plan action is refused.

### Measuring queue

`state.queue` `{ running, crashes }`: the result key the measuring worker holds, and the worker crashes in a row. The queue's status is store state; the worker, its Blobs and the wake lock are resources outside it (`measure-queue.ts`).

- `queueHasWork(options)` (module-private): a worker method is ticked (SIFT, ALIKED + LightGlue, SIFT + LightGlue; XFeat's runtime does not start in a module worker) and a size is above 0.
- `nextMeasureKey(s)`: the first ready pair in run order without a result, once the restore finished, in the tab that holds the run, while no pair and no run is going, before `MAX_CRASHES` (2) crashes in a row and with work ticked. Null when none.
- `queueStarted(key)`: refused unless `key` is `nextMeasureKey`.
- `resultStored` and `resultFailed` free the queue when they name the running pair and reset the crash count; a stale key still frees it.
- `workerCrashed({ key, text })`: only for the running pair; counts the crash and fails the pair for this load only (not persisted).
- `measureProgress(s)` -> `MeasureProgress { total, done, failed, waiting, running, stopped, estimateMs }`: over the ready pairs; `estimateMs` is the lower median of the measured times times the pairs left (the running one whole), null before a pair is done.

### Flat target actions

`flatOpened`, `flatClosed`, `flatCameraChanged`, `flatSurfaceAdded`, `flatSurfaceSelected`, `flatOverview`, `flatClassPicked`, `flatPoseChosen`, `flatCountdown`, `flatStatus`, `flatReferenceTaken`, `flatReferenceDropped`, `flatTapped`, `flatPreviewMade`, `flatCornersRedone`, `flatReferenceAccepted`, `flatShotTaken`, `flatShotRemoved`, `flatSavingStarted`, `flatSavingEnded`, `flatSaved`. Progress changes go through `flatReducer` (`flat-progress.ts`); each refuses input that does not fit the phase (a tap outside the corner step or after four taps, a non-finite tap, a preview without four taps, an unknown pose, a reference outside `ref-live`).

## Invariants and assumptions

- The state holds plain, serializable data only; every frame and URL is named by an id into a side table.
- `busy === "running"` exactly when `running` is set; `busy === "saving"` exactly when the run zip is in preparation; a countdown only ever counts for the current shot.
- A refused action returns the very same state object; the store's `accepted` relies on it.
- Every flat action ends in `settleFlat`: a prepared zip survives only for the current surface, on the poses step, with the shot count it was made for.

## Example

```ts
import { configureStore } from "@reduxjs/toolkit";
const store = configureStore({ reducer: featureMatchReducer });
store.dispatch(
  featureMatchActions.planShotTaken({ shot: "light-s1/L1", photo }),
);
currentShot(store.getState().plan)?.id; // "light-s1/L2"
```

## Tests

- `feature-match-slice.test.ts`: one run or save at a time, the log and errors, the flat target capture (phases, taps, the stale prepared zip, Save, the overview, poses), the rules one deleted line would lose (synthetic status keys, speed and copy), the run plan inside the page state (refusals while busy, the same state for refused plan actions), the countdown (only for the current shot, never while busy, dropped at a photo, move, reset, a run or the zip starting), Download all (started only idle with a ready pair and never in another tab, the log emptied at a reset, ended only while preparing, stale after a new photo), the camera start and photo store flags, what storage holds (stored ids, results refused for stale keys, the restore once with the log joined, the other tab refusing every plan action), the measuring queue (the next key and its refusals, one pair at a time, a stale result freeing the queue, the crash count and its stop, the progress and estimate, a run refused while a pair measures), and the hands-off shot (the due rules, armed once per previous photo, waiting, taking and its three ends, a move shot, readings lost, the ends at a countdown or run, the clears at a pause, move, reset or camera off).
- `feature-match-slice.property.test.ts`: random run, save, countdown and shot sequences keep the busy invariants above and a countdown only on the current shot, and the flat prepared zip is always valid.
