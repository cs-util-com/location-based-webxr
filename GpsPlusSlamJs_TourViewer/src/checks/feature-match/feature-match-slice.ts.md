# feature-match-slice.ts

## Purpose

The state of the feature matching check page (`feature-match-check.html`) as one Redux Toolkit slice, shared by every view of the page: the camera pair flow (`feature-match-check.ts`) and the flat target capture (`flat-capture.ts`). The reducers hold the page's rules; the views only dispatch and draw. Frames, results, Blob URLs, the camera, canvases and timers live outside it (`feature-match-store.ts`).

## Public API

- `initialFeatureMatchState({ session, progress?, flat?, plan? })`: the first state. `progress` is the stored running number, pair and spot (`advancedFor` starts at the stored number, so a reload never advances again); a stored pair of `flat` exits to the first pair. `plan` is the stored run plan; the running number starts at the higher of the stored one and the plan's highest take.
- `featureMatchReducer`, `featureMatchActions`, `FeatureMatchAction`.
- Selectors: `flowState` (for `stepStates`), `canSave`, `logText` (the log as one text), `currentSurface`, `flatPhase` (`overview`, `ref-live`, `corners`, `check`, `poses`).
- Constant: `NOTHING_MEASURED`. The options start at the controls' starting values in the HTML (module-private defaults); the view mirrors the controls into the state on every change and once more at each run start.
- Types: `FeatureMatchState`, `FlatState`, `Offered`, `PairNote`, `BenchOptions`, `SpeedOptions`, `StatusSlot`.

### Camera pair actions

- `selectorChanged({ pair, spot })`: ignored unless `pair` is a selector key and `spot` a valid spot; a non-flat pair is also remembered as the pair the flat mode exits to. `flatExited()` returns to it.
- `cameraChanged(on)`.
- `photoTaken({ which, photo })`: photo A starts a new pair (running number + 1, the pair and spot fixed from the selector, photo B cleared); photo B of a pair any of whose files was downloaded gets a new running number (the retake rule) and the light check. Either withdraws the run and the offered files. Refused while busy, in the flat mode, for photo B without A, and for a size that is not a positive finite number or a grey mean outside 0-255.
- `runStarted(kind)` (`camera`, `synthetic`, `speed`, `plan`): refused unless idle; a camera run also needs both photos; a `plan` run needs both photos of the current plan slot, records that take in `planRun` `{ slot, seq, resultsId }` and ends a countdown. `runProgressed(line)` sets the running kind's status line. `runFinished({ text, resultsId })`: a `plan` run keeps its results id in `planRun`; a camera run with results is `done`, without `failed` (Save then offers the photos alone, `NOTHING_MEASURED`). `cameraRunWithdrawn()`: a synthetic run or speed test hides the camera run and its files.
- `saveStarted()` (only when `canSave`), `saveFinished(offered)`, `saveFailed()`.
- `filesDownloaded()`: the first download per pair moves the selector to `nextPair`, unless the light check failed (the pair stays, `pairNote` kind `kept`); a second one changes nothing.
- `statusSet`, `tableSet`, `reportSet`, `logged(line)` (stamped by the view), `failed({ line, stamped })` (kept in `errors` for the run's report and logged), `errorsCleared`, `optionsChanged`, `speedOptionsChanged`.

### Run plan actions

`planSized`, `planMoved`, `planPhotoTaken`, `planPhotoLost`, `planFileKept`, `planFilesDownloaded(ids)`, `planRunDownloaded`, `planKeptDropped`, `planSettingsChanged`, `planReset`: each wraps `planReducer` (`run-plan.ts`, which holds the rules) on `state.plan` with the page's one running number, so plan takes and pair-selector takes never share a number. A photo or a reset is refused while busy. An accepted photo, move, resize or reset clears the guided retake target and countdown; a photo in `planRun`'s slot, a resize or a reset drops `planRun` (its results belong to the take before).

### Guided view actions

`state.guided` `{ retake, count }` is what the guided view's camera button does next (`guided-model.ts` reads it with `shotDue`).

- `guidedRetakeToggled(which)`: points the next photo at A or B of the current slot, a second tap takes it back; refused while counting or busy and for a photo the slot does not hold.
- `guidedCountSet({ shot, left } | null)`: one countdown second (the view owns the timer) or its end; refused while busy, for a shot other than the due one and for a count that is not a whole number of at least 1.

### Guided run zip actions

`state.runZip` `{ phase, text }` is the guided view's Download all (workflow status, so it lives here).

- `runZipStarted()`: refused unless idle with at least one complete pair; sets busy `saving` and phase `preparing`.
- `runZipEnded({ phase, text })`: `saved`, `failed` or `idle` (the save dialog was closed); only ends a zip in preparation, so a camera save's end does not end it.
- An accepted plan photo, lost photo, resize or reset makes a saved or failed zip stale and resets it to `idle`; a move does not.

### Guided single files, camera start and photo store

- `planFileSaveStarted()`: refused unless idle; sets busy `saving` and `fileSave` `{ preparing: true, text: "preparing..." }`. `planFileSaveEnded(text)`: only ends a save it started, back to idle with the note.
- `cameraStartSet("idle" | "starting" | "failed")`: the guided view's camera start (workflow status: the chip and the auto start read it); other values are refused.
- `photoStoreChanged(failing)`: whether a named photo could not be written to the phone's database (set by the store, read by the run and end screens).

### Flat target actions

`flatOpened`, `flatClosed`, `flatCameraChanged`, `flatSurfaceAdded`, `flatSurfaceSelected`, `flatOverview`, `flatClassPicked`, `flatPoseChosen`, `flatCountdown`, `flatStatus`, `flatReferenceTaken`, `flatReferenceDropped`, `flatTapped`, `flatPreviewMade`, `flatCornersRedone`, `flatReferenceAccepted`, `flatShotTaken`, `flatShotRemoved`, `flatSavingStarted`, `flatSavingEnded`, `flatSaved`. Progress changes go through `flatReducer` (`flat-progress.ts`); each refuses input that does not fit the phase (a tap outside the corner step or after four taps, a non-finite tap, a preview without four taps, an unknown pose, a reference outside `ref-live`).

## Invariants and assumptions

- The state holds plain, serializable data only; every frame, result and URL is named by an id into a side table.
- `busy === "running"` exactly when `running` is set; `advancedFor <= sequence`; the running number never decreases; photo B never exists without A; a `resultsId` only with `cameraRun === "done"`; offered files only when saved and idle.
- A refused action returns the very same state object; the store's `accepted` relies on it.
- The advance after a download also moves `lastPair` (the pair Exit of the flat mode returns to) to the new pair. The page before the store returned to the pair picked before the advance; the new pair is the one the protocol asks for next, so this is kept on purpose.
- An accepted photo B always belongs to a pair whose number is above `advancedFor`, so saved file names are never reused.
- Every flat action ends in `settleFlat`: a prepared zip survives only for the current surface, on the poses step, with the shot count it was made for.

## Example

```ts
import { configureStore } from "@reduxjs/toolkit";
const store = configureStore({ reducer: featureMatchReducer });
store.dispatch(featureMatchActions.photoTaken({ which: "a", photo }));
store.getState().pairInProgress; // { pair: "1a", spot: 1, sequence: 1, ... }
```

## Tests

- `feature-match-slice.test.ts`: the pair flow, the retake rule, the advance and the kept pair, one run or save at a time, the run's end states, the withdrawal, the selector, the stored start, errors and log, and the flat steps (phases, taps, the stale prepared zip, Save, the overview, poses), and the rules one deleted line would lose (no pair photo in the flat mode, `lastPair` on the advance, a synthetic run leaving `cameraRun` alone, the same state for refused actions, the flat zip refused while saving or with no reference), and the run plan inside the page state (the shared running number, the stored plan's start number, refusals while busy, the same state for refused plan actions), and the guided view's capture state (the retake toggle only onto a held photo, retake and countdown dropped at a photo, move and reset, the countdown only for the due photo and never while busy, the `plan` run on the current pair and its results dropped at a new photo there), and the run zip (started only idle with a pair, ended only while preparing, forgotten at a new photo), and the single-file save, camera start and photo store flags.
- `feature-match-slice.property.test.ts`: random action sequences keep the invariants above, a second download is a no-op, a failed light check keeps the pair, and the flat prepared zip is always valid.
