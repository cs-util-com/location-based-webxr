# mount-qrperf

## Purpose

DOM glue for the `?qrperf` instrument: builds it from the URL params, re-renders the on-screen report every 500 ms, wires "Copy perf JSON", feeds XR frame intervals, and warms zxing up in `zxing` mode.

## Public API

- **`mountQrPerf(params, { log, copy }): MountedQrPerf | null`** - `null` (touching nothing) when `params.mode === 'off'`; otherwise `{ instrument, dispose() }`. `dispose` clears the refresh timer, unregisters the XR frame hook and removes the click handler.

## Invariants & assumptions

- The `#qrperf-log` and `#qrperf-copy` elements stay hidden unless the flag is set.
- XR frame intervals come from the framework's `registerXrFrameUpdate` (`dt`), which only fires in a live XR session - desktop and e2e runs simply show no `xr-frame` line.
- A zxing load failure is shown as the report's first line (`zxing load FAILED: …`) - the phone run has no console to read; the native instrument keeps working.
- Thin by design: every decision it makes is in the unit-tested sibling modules.

## Tests

`playwright-tests/qrperf.spec.js` (hidden without the flag, report renders, baseline label, self-hosted WASM, copy feedback).
