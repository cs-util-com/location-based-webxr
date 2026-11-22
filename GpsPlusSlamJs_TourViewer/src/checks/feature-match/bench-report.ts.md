# bench-report.ts

## Purpose

The benchmark's output: rows of the results table and the plain-text report a tester copies into a chat.

## Public API

- `hasJspi(wasm)`: true when the given `WebAssembly` global has `Suspending`; false when it is absent.
- `UNKNOWN_DEVICE`: the device facts used when collecting them fails; every field reads `-`.
- `DeviceInfo`: user agent, model, platform version, cores, memory, cross-origin isolation, JSPI, screen, WebGPU adapter text (null where the browser hides a value).
- `ReportInput { startedAt, device, input, sizes, runs, warmup, results, errors }`; the settings line reads `runs: N after 1 warm-up`, or `runs: N, no warm-up` when `warmup` is false (a time without a warm-up includes the first-call cost).
- `TableRow` and `tableRows(results)`: one row per method and size, one row for a method that failed to load.
- `deviceLines(device)`: the device facts as report lines; the speed test report (`bench-timing.ts`) starts with the same lines.
- `formatReport(input)`: a header, the device lines, the settings, then per method `## <label>`, the backend and init time, one line per download, the notes, and one line per size (`@320 (320x240): extract a / b ms | match ... | kp ... | desc .../frame | matches ... | correct ...`).

## Invariants

- A missing number reads `-` and an error reads `ERROR ...`; never a blank or a zero.

## Tests

`bench-report.test.ts`.
