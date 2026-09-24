# recorder-sun-check.ts

## Purpose

The recorder's glue for the AR sun check (sun-overlay plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-0100-ar-sun-overlay-heading-check-plan.md`
M3). It builds the `SunCheckUi` (`sun-check-ui.ts`) over the framework
controller, with the recorder's store handle and note recorder, and ties it to
the AR session's life. `main.ts` only creates it (with `?debug=1`) and
attaches it after Enter-AR.

## Public API

- `createRecorderSunCheck(deps): SunCheckUi`. The deps:
  - `storeRef`;
  - `appContainer`;
  - `getScene` / `getArWorldGroup`: the live session's GPS-world root and
    alignment group;
  - `isStopInProgress`;
  - `isReplaying`;
  - `showToast`;
  - `confirm`: the recorder's confirm dialog;
  - `start` (optional): the framework's `startSunCheck`, injected for tests.
- `sunCheckStoreReaders(storeRef)`: the controller's `getZeroReference` and
  `getTargetYawDeg`, read from the CURRENT store.
- `attachSunCheckToSession(ui, scope, registerSessionDisposer)`.

## Invariants & assumptions

- **The zero reference is mapped `lon` → `lng`.** The library's `LatLong`
  spells longitude `lon`; the check's place type spells it `lng`.
- **The target yaw uses `alignmentYawDeg`.**
  - That is the same convention as the drawn yaw the controller reads from
    `arWorldGroup`.
  - It is not `alignmentRotationInDegree[1]`, which is a three.js Euler Y
    with the opposite sign.
  - A degenerate matrix throws there, and the controller's callback guard
    reads that as "no target".
- **No live scene, no start.** `startCheck` throws "no AR scene", which the UI
  turns into an error toast. The box ends up unchecked on both paths: through
  `setEnabled`'s result, or through `onEnabledChange(false)` when the failure
  happens on attach (`main.ts` forwards it to the wheel's `showSunCheck`).
- **Session life.**
  - The recorder's `arSessionScope` unwinds only at the next Enter-AR (or a
    failed one).
  - So `attachSunCheckToSession` also registers a framework session disposer.
  - Whichever of the two comes first detaches the UI, and the scope's
    disposer unregisters the other.
- Before Start, `gpsData` is null, so the HUD reads "waiting for the GPS
  origin" until a recording has a fix and an alignment.

## Example

```ts
sunCheckUi = createRecorderSunCheck({
  storeRef,
  appContainer,
  getScene,
  getArWorldGroup,
  isStopInProgress: recordingSessionHandlers.isStopInProgress,
  isReplaying: replayHandlers.getIsReplayMode,
  showToast,
  confirm: showConfirmDialog,
});
// after wireArScene:
attachSunCheckToSession(sunCheckUi, arSessionScope, registerSessionDisposer);
```

## Tests

`recorder-sun-check.test.ts` covers:

- the `lon` → `lng` mapping, and null before a fix;
- the readers following a store swap;
- the target yaw's convention (a 30° yaw reads 30), and null without an
  alignment;
- the safety note's text, and the start on the live scene;
- the refusal without a scene;
- detaching on session end or on scope unwind, whichever comes first.
