# replay-launch.ts

## Purpose

Load a recording file and start a desktop replay session via the framework's
`startReplaySession` (Part A). Factored out of `main.ts` as a pure orchestration
around a status sink so the async-feedback contract is unit-testable without a
DOM or WebGL.

## Public API

- **`loadRecordingActions(file): Promise<RecordedAction[]>`** — read a current-era
  recording zip (`file.arrayBuffer()` → `loadActionsFromZip`) and map its entries
  to a bare action list (the shape `startReplaySession` expects). Current-era
  recordings only — no old-era migration (dependency direction, per the design).
- **`loadAndStartReplay(file, container, sink, deps?): Promise<ReplaySessionController | null>`**
  — drive `sink` through **loading → ready/error**, returning the controller (or
  `null` on an empty/failed load). `deps` (`loadActions`, `startSession`) are
  injectable seams so the flow runs without WebGL in tests.
- **`ReplayLaunchSink`** — `onLoading()`, `onReady(controller, actionCount)`,
  `onError(message)`. The in-progress signal always precedes the durable one.

## Invariants & assumptions

- **Async feedback (repo rule):** `onLoading` fires before any durable state, and
  exactly one of `onReady`/`onError` follows on both success and failure.
- An empty recording is reported via `onError`, not a crash.
- Errors are stringified defensively (`Error.message` or a fallback).

## Tests

- `replay-launch.test.ts` — `loadRecordingActions` maps entries→actions (zip-reader
  mocked); `loadAndStartReplay` drives loading→ready (returns controller, passes
  actions+container to `startSession`), loading→error on a throwing load (no
  session started), and loading→error for an empty recording. Ordering of the
  in-progress vs. durable signal is asserted for both paths.
