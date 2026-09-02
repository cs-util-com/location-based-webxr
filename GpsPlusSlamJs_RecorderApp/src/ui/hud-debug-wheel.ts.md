# hud-debug-wheel.ts

## Purpose

The in-recording settings wheel: a gear in the AR HUD, shown only with `?debug=1` (see [`debug-flag.md`](../debug-flag.md)), that opens a panel usable DURING a running recording to switch alignment presets and compass options. Every control is a store action, so a switch takes effect on the next GPS fix and lands in the recording's action stream, where the framework replayer re-applies it. 2026-09-02, rotation-first search plan D8 / M3 (private repo, `GpsPlusSlamJs_Investigation/docs/2026-09-02-0905-rotation-first-full-search-and-field-wheel-plan.md`).

## Public API

- `createDebugWheel({ storeRef, controlsRoot, overlayRoot })` → `DebugWheel` with `attach()`, `dispose()`, `values()`, `touched()`, `set(patch)` (programmatic change, behaves like a tap; used by the e2e hook).
- `dispatchWheelSettings(store, settings)` — the eleven dispatches a settings object implies: the preset (`setAlignmentOverrides`, `null` for shipped), the seven compass settings from the shared mapping (`gps-plus-slam-app-framework/utils/compass-influence-mapping`) with the recorder's experiment policy, the pair-selection mode and trust prerequisite, the heading penalty.
- `formatWheelReadout(state)` — one line: solved yaw (the alignment's Euler Y, wrapped to 0..360), applied compass weight + trust state, fix count; dashes rather than `NaN`, and "waiting for the first GPS fix" before the store is decided.
- `WheelSettings`, `WHEEL_DEFAULTS` (preset `shipped`, influence 0.1, gate `binary`, pair selection `off`, pairs need trust, penalty 0), `WHEEL_HEADING_PENALTY_DEFAULT` (0.25 m/°). Module-private: the 15° trust tolerance the mapping is given and the 0.05 slider step (the settings slider's step).

## The controls, and what each reaches

- **preset** → `setAlignmentOverrides` with the entry from [`alignment-presets.md`](../alignment-presets.md); `shipped` clears.
- **compass** (0..1 slider; the label follows the drag, the dispatch happens on RELEASE, because every dispatch is persisted into the recording and a drag would otherwise write eleven actions per notch) → the seven compass dispatches; 0 is "GPS only" (prior off, cold-start off, weight 0: three settings, see the mapping's sidecar), any other value turns the Stage-C prior on with that steady-state weight.
- **trust gate** → `setCompassTrustGateMode`, every mode the library declares (`off | binary | ramp | latch`; the list is derived from the exported const). `latch` (trusted once, trusted for the session) ships for the field test with its corpus label attached: at the shipped thresholds 52 of the 88 compass-era recordings that ever reach trusted drop out of it again (59 %), so the corpus does NOT say the latch is safe - it says the field test is needed (private repo, `test-results/compass-trust-drop-census.txt`).
- **pair selection** → `off` (`setCompassPairSelectionEnabled(false)`), `soft cut` / `hard cut` (enabled + `setCompassPairSelectionMode`).
- **pairs need trust** → `setCompassPairSelectionRequireTrust`.
- **heading penalty** → `setRobustSolverHeadingPenalty(0.25)` or `0`; inert unless a preset switched the robust solver on.

## Invariants & assumptions

- **Untouched means silent.** Nothing is dispatched until the tester changes a control, so an ordinary session with the flag set but the wheel untouched is byte-identical to one without the flag. The settings modal's compass block remains the pre-session persisted default; the wheel persists nothing.
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

- `hud-debug-wheel.test.ts` (jsdom) — the exact eleven actions and their payloads for a full settings object, the three-setting silence at influence 0, the shipped preset clearing with `null`; mount/toggle/dispose; nothing dispatched while untouched; a change made before the first fix flushed once decided and not inside the deciding dispatch; re-apply on a store swap, once per store; immediate apply on a decided store; the readout live while open; the readout's dash-not-NaN rule and yaw wrap.
- `playwright-tests/debug-wheel.spec.js` — no gear without the flag; gear and panel with it; a preset picked in the panel reflected through the `getDebugWheelValues` test hook. The spec reaches the recording HUD through two hooks, `hideSetupModal` (added with the wheel: the setup modal intercepts every click on `#controls`, and no earlier spec clicked a HUD button) and `showRecordingControls`, the state machine's public steps without a real AR session.

## Related

- `main.ts` — mounts the wheel after the HUD is initialised when the flag is set, and hands the instance to the e2e hooks.
- `../state/store-ref.md`, `confirm-dialog.ts` (overlay mount pattern), the OSM demo's `ar-experiment-panel.ts` (the gear pattern this follows).
