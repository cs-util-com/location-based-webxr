# optimizer-protocol.ts

**Purpose:** the message shapes between the page and the asset optimizer's module Worker, and the Worker's message loop, shared by `optimizer-client.ts`, `asset-optimizer.worker.ts` and the model converter's `model-import.worker.ts` (no DOM, no `new Worker`).

## Public API

- `OptimizerInbound` (page to Worker): `run { job, kind, payload, settings }`, `cancel { job }`.
- `OptimizerOutbound` (Worker to page): `progress { job, fraction }`, `done { job, blob, extension, width?, height?, model?, conversion? }` (`model` the model step's `ModelReport`, a type-only import; `conversion` a `ConversionReport { notes, used }` from the model converter), `kept { job, reason }`, `failed { job, reason }`.
- `WorkerStepAnswer`: what a Worker step returns, a `done` or `kept` without its job id; `WorkerStepControl`: `{ signal, progress }` as a step sees them.
- `stoppedError()`: the `AbortError` a step throws once stopped.
- `WorkerStep`: `(payload, settings, control) => Promise<WorkerStepAnswer>`; `WorkerScope`: the part of a Worker's global scope the loop uses.
- `serveSteps(scope, steps)`: the Worker side: each run goes through its kind's step and its answer is posted with the job id; progress is forwarded; `cancel` aborts that run's signal and nothing more is posted for it; a throw posts `failed` with its message; a kind without a step answers `failed` with words; what `inboundOf` refuses is ignored.
- `inboundOf(data)`: `data` as an `OptimizerInbound`, or null for a non-object, an unknown type, a job that is no whole number, a run of no known kind, or a run without settings. The Worker ignores what it returns null for.

## Invariants

- `job` is the page's correlation id; every answer echoes it.
- `payload` is whatever the page-side optimizer hands over: the file's Blob, or data it prepared on the page (a sound's decoded samples, since decoding audio is not available in a Worker).
- Neither side trusts these types at runtime: the Worker checks what it receives (`inboundOf`), the page every answer field by field (`optimizer-client.ts`).

## Tests

`optimizer-protocol.test.ts`: `inboundOf` takes a run and a cancel and ignores every other shape; `serveSteps` with a fake scope answers, forwards progress, fails a throw and a kind without a step in words, ignores nonsense, and posts nothing for a stopped run. The answers are exercised by `optimizer-client.test.ts` with a fake Worker.
