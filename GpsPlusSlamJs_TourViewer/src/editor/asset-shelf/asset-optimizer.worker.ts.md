# asset-optimizer.worker.ts

**Purpose:** the asset optimizer's module Worker, which runs the heavy part of an optimization off the page.

## Behaviour

- `run`: looks up `WORKER_STEPS[kind]` (`image`: `picture-step.ts`, `audio`: `sound-step.ts`); when there is none it answers `failed` with words. A step runs with its own `AbortController` and a `progress` callback that posts `progress`; its result is posted with the job id unless the job was cancelled; a throw posts `failed` with the error's message.
- `cancel`: aborts that job's controller; a cancelled job posts nothing more.

## Invariants

- `createOptimizerHost` spawns the Worker only on a run, so a tour with no picture or sound job never starts it.
- Every message is checked with `inboundOf` (`optimizer-protocol.ts`) before it is read: a non-object, an unknown type or a malformed run is ignored, never thrown on (a throw would reach the page as the Worker's error event, which it reads as a crash).

## Tests

The device seam: not unit-tested (it needs a real Worker). The page side is covered by `optimizer-client.test.ts`.
