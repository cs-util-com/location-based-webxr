# feature-match-slice.ts

## Purpose

The state of the feature matching check page (`feature-match-check.html`) as one Redux Toolkit slice, shared by every view of the page: the guided view (`guided-view.ts`), the cockpit view (`cockpit-view.ts`), the measuring block (`bench-engine.ts`) and the flat target capture (`flat-capture.ts`). The reducers hold the page's rules; the views only dispatch and draw. Frames, results, Blob URLs, the camera, canvases and timers live outside it (`feature-match-store.ts`).

## Public API

- `initialFeatureMatchState({ session, progress?, flat?, plan? })`: the first state. `progress` is the stored running number (`{ sequence }`). `plan` is the stored run plan; the running number starts at the higher of the stored one and the plan's highest take.
- `featureMatchReducer`, `featureMatchActions`, `FeatureMatchAction`.
- Selectors: `logText` (the log as one text), `currentSurface`, `flatPhase` (`overview`, `ref-live`, `corners`, `check`, `poses`).
- The options start at the controls' starting values in the HTML (module-private defaults); the view mirrors the controls into the state on every change and once more at each run start.
- Types: `FeatureMatchState`, `FlatState`, `BenchOptions`, `SpeedOptions`, `FlatPhase`.

### Runs, log and options

- `cameraChanged(on)`.
- `runStarted(kind)` (`synthetic`, `speed`, `plan`): refused unless idle; a `plan` run needs both photos of the current plan slot, records that take in `planRun` `{ slot, seq, resultsId }` and ends a countdown. `runProgressed(line)` sets the running kind's status line (a `plan` run writes the `run` slot). `runFinished({ text, resultsId })`: a `plan` run keeps its results id in `planRun`; the other kinds keep none.
- `statusSet`, `tableSet`, `reportSet`, `logged(line)` (stamped by the view), `failed({ line, stamped })` (kept in `errors` for the run's report and logged), `errorsCleared`, `optionsChanged`, `speedOptionsChanged`.

### Run plan actions

`planSized`, `planMoved`, `planPhotoTaken`, `planPhotoLost`, `planFileKept`, `planFilesDownloaded(ids)`, `planRunDownloaded`, `planKeptDropped`, `planSettingsChanged`, `planReset`: each wraps `planReducer` (`run-plan.ts`, which holds the rules) on `state.plan` with the page's one running number (`progress.sequence`), which is stored across reloads, so no two takes ever share a number. A photo or a reset is refused while busy. An accepted photo, move, resize or reset clears the guided retake target and countdown; a photo in `planRun`'s slot, a resize or a reset drops `planRun` (its results belong to the take before).

### Guided view actions

`state.guided` `{ retake, count }` is what the guided view's camera button does next (`guided-model.ts` reads it with `shotDue`).

- `guidedRetakeToggled(which)`: points the next photo at A or B of the current slot, a second tap takes it back; refused while counting or busy and for a photo the slot does not hold.
- `guidedCountSet({ shot, left } | null)`: one countdown second (the view owns the timer) or its end; refused while busy, for a shot other than the due one and for a count that is not a whole number of at least 1.

### Hands-off photo B actions

`state.handsOff` `{ phase, slot, a, still, text }` is the cockpit's photo B that takes itself once the phone rests (`still-detector.ts`). Phases: `off`, `armed` (no reading yet, or a move pair waiting for its move), `waiting` (for the phone to rest), `taking` (rested for the dwell: the view takes the photo), `taken`, `refused` (the photo was not taken), `failed` (the readings stopped, or the capture threw); `text` is the status line for it. `slot` and `a` name the take it was armed for, so one photo A is armed once.

- `handsOffDue(s)`: the setting is `capture: "auto"`, the camera on, nothing busy, no countdown or retake, the current pair one the sensor can judge (`handsOffKind`), its A taken and B missing, and this A not armed before.
- `handsOffArmed(t)`: refused unless `handsOffDue` and `t` is finite; starts the detector at `t` (needing a move first on a move pair).
- `handsOffSample({ t, rate })`: one reading, or a missing one (rate null) from the view's watchdog; only while armed or waiting and idle. Readings lost turn the wait `failed`; a state that did not change returns the same object.
- `handsOffShot("taken" | "refused" | "failed")`: only from `taking`.
- `handsOffPaused()`: an armed or waiting B goes back to `off` with no take named (the drawer opened), so it arms again afterwards.
- A photo, a countdown, a retake toggle or a run started ends an armed or waiting B, keeping its take named (no second wait for that A); a move, resize or reset, or the camera going off while it waits, clears it entirely. A new photo A re-arms.

### Guided run zip actions

`state.runZip` `{ phase, text }` is the guided view's Download all (workflow status, so it lives here).

- `runZipStarted()`: refused unless idle with at least one complete pair; sets busy `saving` and phase `preparing`.
- `runZipEnded({ phase, text })`: `saved`, `failed` or `idle` (the save dialog was closed); only ends a zip in preparation, so a single-file save's end does not end it.
- An accepted plan photo, lost photo, resize or reset makes a saved or failed zip stale and resets it to `idle`; a move does not.
- An accepted plan photo, lost photo, move, resize or reset clears the single-file line (`fileSave.text`) unless a single-file save is in preparation: the line named the pair or the photos it was about.

### Guided single files, camera start and photo store

- `planFileSaveStarted()`: refused unless idle; sets busy `saving` and `fileSave` `{ preparing: true, text: "preparing..." }`. `planFileSaveEnded(text)`: only ends a save it started, back to idle with the note.
- `cameraStartSet("idle" | "starting" | "failed")`: the guided view's camera start (workflow status: the chip and the auto start read it); other values are refused.
- `photoStoreChanged(failing)`: whether a named photo could not be written to the phone's database (set by the store, read by the run and end screens).

### Flat target actions

`flatOpened`, `flatClosed`, `flatCameraChanged`, `flatSurfaceAdded`, `flatSurfaceSelected`, `flatOverview`, `flatClassPicked`, `flatPoseChosen`, `flatCountdown`, `flatStatus`, `flatReferenceTaken`, `flatReferenceDropped`, `flatTapped`, `flatPreviewMade`, `flatCornersRedone`, `flatReferenceAccepted`, `flatShotTaken`, `flatShotRemoved`, `flatSavingStarted`, `flatSavingEnded`, `flatSaved`. Progress changes go through `flatReducer` (`flat-progress.ts`); each refuses input that does not fit the phase (a tap outside the corner step or after four taps, a non-finite tap, a preview without four taps, an unknown pose, a reference outside `ref-live`).

## Invariants and assumptions

- The state holds plain, serializable data only; every frame, result and URL is named by an id into a side table.
- `busy === "running"` exactly when `running` is set; `busy === "saving"` exactly when the run zip or a single file is in preparation; the running number never decreases.
- A refused action returns the very same state object; the store's `accepted` relies on it.
- Every flat action ends in `settleFlat`: a prepared zip survives only for the current surface, on the poses step, with the shot count it was made for.

## Example

```ts
import { configureStore } from "@reduxjs/toolkit";
const store = configureStore({ reducer: featureMatchReducer });
store.dispatch(
  featureMatchActions.planPhotoTaken({ slot: "1a-s1", which: "a", photo }),
);
store.getState().progress.sequence; // 1
```

## Tests

- `feature-match-slice.test.ts`: one run or save at a time, the run's end states, the stored running number, errors and log, and the flat steps (phases, taps, the stale prepared zip, Save, the overview, poses), and the rules one deleted line would lose (a synthetic run keeping no plan results, the same state for refused actions, the flat zip refused while saving or with no reference), and the run plan inside the page state (the shared running number, the stored plan's start number, refusals while busy, the same state for refused plan actions), and the guided view's capture state (the retake toggle only onto a held photo, retake and countdown dropped at a photo, move and reset, the countdown only for the due photo and never while busy, the `plan` run on the current pair and its results dropped at a new photo there), and the run zip (started only idle with a pair, ended only while preparing, forgotten at a new photo), and the single-file save, camera start and photo store flags, and the hands-off photo B (the due rules, armed once per photo A, waiting, taking and its three ends, a move pair, readings lost, the ends at a countdown, retake or run, the clears at a pause, move, reset or camera off, and readings ignored when not waiting).
- `feature-match-slice.property.test.ts`: random run, save and plan photo sequences keep the busy and numbering invariants above, and the flat prepared zip is always valid.
