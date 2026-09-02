# hud-debug-wheel.ts

## Purpose

The in-recording settings wheel: a gear in the AR HUD, shown only with `?debug=1` (see [`debug-flag.ts.md`](../debug-flag.ts.md)), that opens a panel usable DURING a running recording to switch alignment presets and compass options. Every control is a store action, so a switch takes effect on the next GPS fix and lands in the recording's action stream, where the framework replayer re-applies it. 2026-09-02, rotation-first search plan D8 / M3 (private repo, `GpsPlusSlamJs_Investigation/docs/2026-09-02-0905-rotation-first-full-search-and-field-wheel-plan.md`).

## Public API

- `createDebugWheel({ storeRef, controlsRoot, overlayRoot })` → `DebugWheel` with `attach()`, `dispose()`, `values()`, `touched()`, `set(patch)` (programmatic change, behaves like a tap on each key; used by the e2e hook), `suspend()` / `resume()` (replay owns the store / a recording store is back).
- `dispatchWheelSettings(store, settings, controls?)` — the dispatches the given CONTROLS imply (default: all eleven): the preset is ONE action (`setAlignmentOverrides`, `null` for shipped); the compass slider is the seven compass settings from the shared mapping (`gps-plus-slam-app-framework/utils/compass-influence-mapping`) with the recorder's experiment policy; the gate, the pair selection (enabled + mode), the trust prerequisite and the heading penalty each their own setter(s).
- `seedWheelSettings(current, touched, state)` — the untouched controls' values read from a decided store (gate, pair selection + mode, prerequisite, penalty, a preset whose overrides match the store's, and the slider from the vote weight while the Stage-C prior is on); a read, never a write.
- `formatWheelReadout(state, churn?)` — one line: solved yaw (the alignment's Euler Y, wrapped to 0..360), yaw churn (median |Δyaw| per fix over the last 30 fixes, from [`yaw-churn.ts.md`](yaw-churn.ts.md) - the number the search ranked on, so a preset switch reads as a number within a minute; a dash until two samples), applied compass weight + trust state, fix count; dashes rather than `NaN`, and "waiting for the first GPS fix" before the store is decided.
- `WheelSettings`, `WHEEL_DEFAULTS` (preset `shipped`, influence 0.1, gate `binary`, pair selection `off`, pairs need trust, penalty 0), `WHEEL_HEADING_PENALTY_DEFAULT` (0.25 m/°). Module-private: the 15° trust tolerance the mapping is given, the 0.05 slider step (the settings slider's step), and `observeYawChurn(tracker, state)`, which feeds one store update to the churn tracker (one sample per new fix).

## The controls, and what each reaches

- **preset** → `setAlignmentOverrides` with the entry from [`alignment-presets.ts.md`](../alignment-presets.ts.md); `shipped` clears.
- **compass** (0..1 slider; the label follows the drag, the dispatch happens on RELEASE, because every dispatch is persisted into the recording and a drag would otherwise write eleven actions per notch) → the seven compass dispatches; 0 is "GPS only" (prior off, cold-start off, weight 0: three settings, see the mapping's sidecar), any other value turns the Stage-C prior on with that steady-state weight.
- **trust gate** → `setCompassTrustGateMode`, every mode the library declares (`off | binary | ramp | latch`; the list is derived from the exported const). `latch` (trusted once, trusted for the session) ships for the field test with its corpus label attached: at the shipped thresholds 52 of the 88 compass-era recordings that ever reach trusted drop out of it again (59 %), so the corpus does NOT say the latch is safe - it says the field test is needed (private repo, `test-results/compass-trust-drop-census.txt`).
- **pair selection** → `off` (`setCompassPairSelectionEnabled(false)`), `soft cut` / `hard cut` (enabled + `setCompassPairSelectionMode`).
- **pairs need trust** → `setCompassPairSelectionRequireTrust`.
- **heading penalty** → `setRobustSolverHeadingPenalty(0.25)` or `0`; inert unless a preset switched the robust solver on.

## Invariants & assumptions

- **Untouched means silent, and a touch is ONE control.** Nothing is dispatched until the tester changes a control, and a change dispatches only that control's setting(s) - a preset tap sends one action and leaves the operator's compass config exactly as the settings modal seeded it (PR #405/#406 review: dispatching every control from the wheel's defaults had turned a preset A/B into a compass-config change). The compass slider is the one control that is a whole configuration: moving it engages the Stage-C prior at that weight (0 silences the compass), which is what its label says. A store swap re-applies every control ever touched. The settings modal's compass block remains the pre-session persisted default; the wheel persists nothing.
- **Shows the session, not the defaults.** Once a store is decided the untouched controls are seeded from it (`seedWheelSettings`); a Stage-0 session has no slider position, so the slider keeps its default until moved.
- **Never drives a replay store.** `main.ts` calls `suspend()` before the replay handlers swap their store in and `resume()` when the recording handlers swap one in; while suspended, changes are held and no store receives anything (a recording made without the wheel must replay against the config in the recording, not the tester's live one).
- **The heading-penalty box is disabled** (with a hint) unless the selected preset enables the robust solver, because the penalty is provably inert otherwise and a tester must be able to tell that from "no effect on this walk".
- **One churn tracker per store.** The fix count restarts with every store swap, so `attachStore` creates a fresh tracker and feeds it on every store update, panel open or not; the readout shows the current store's summary.
- **Follows the store, never captures it** (cold-review finding 5). The recorder swaps its store at Start Recording and on replay; the wheel subscribes through `followStore(storeRef, …)` and re-applies the touched settings to every new store, once per store instance.
- **Waits for a decided store, and flushes from a microtask.** Every alignment setter is a no-op before `setZeroPos`; a change made earlier is held and flushed when `gpsData` becomes non-null, scheduled from the subscriber via `queueMicrotask` so the dispatch never nests inside the one that decided the store (the persistence middleware's re-entrancy tripwire would refuse a nested dispatch, and rightly).
- **Order of the eleven dispatches is irrelevant** to the outcome: every action writes an independent state field and the library derives the config from the final state.
- The gear is appended to `#controls` (pointer events re-enabled per child there) and the panel to the `#app` DOM-overlay root, so both composite over the camera feed in immersive AR, like `confirm-dialog`.

## Example

```ts
if (debugUiEnabledFromSearch(location.search)) {
  const wheel = createDebugWheel({
    storeRef,
    controlsRoot: controls,
    overlayRoot: app,
  });
  wheel.attach();
}
```

## Tests

- `hud-debug-wheel.test.ts` (jsdom) — per control: the preset is one action, the slider the seven (prior on at the weight; three-setting silence at 0), the gate / pair selection / prerequisite / penalty their own setters, all eleven together; seeding from a decided store (and never over a touched control, never before decided); mount/toggle/dispose; nothing dispatched while untouched; a preset-only tap leaves the compass config alone; a change before the first fix flushed once decided and not inside the deciding dispatch; re-apply of every touched control on a store swap, once per store; suspend/resume around a replay store; slider on release; the penalty box disabled until the robust preset is picked; the readout live while open; the churn sampled once per fix while closed and reset per store; dash-not-NaN, yaw wrap and the churn format.
- `playwright-tests/debug-wheel.spec.js` — no gear without the flag; gear and panel with it; a preset picked in the panel reflected through the `getDebugWheelValues` test hook. The spec reaches the recording HUD through two hooks, `hideSetupModal` (added with the wheel: the setup modal intercepts every click on `#controls`, and no earlier spec clicked a HUD button) and `showRecordingControls`, the state machine's public steps without a real AR session.

## Related

- `main.ts` — mounts the wheel after the HUD is initialised when the flag is set, hands the instance to the e2e hooks, and suspends/resumes it around the replay and recording store swaps.
- `yaw-churn.ts.md` — the churn tracker behind the readout's calm number.
- `../state/store-ref.md`, `confirm-dialog.ts` (overlay mount pattern), the OSM demo's `ar-experiment-panel.ts` (the gear pattern this follows).
