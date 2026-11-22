# asset-optimizer.worker.ts

**Purpose:** the asset optimizer's module Worker, which runs the heavy part of an optimization off the page.

## Behaviour

- Hands its steps to `serveSteps` (`optimizer-protocol.ts`), the loop it shares with the model converter's Worker: `image` (`picture-step.ts`), `audio` (`sound-step.ts`), `model` (`model-step.ts` with the picture device for its textures); a kind without a step answers `failed` with words.
- A step runs with its own abort signal and a `progress` callback; its result is posted with the job id unless the job was cancelled; a throw posts `failed` with the error's message. `cancel` aborts that job; a cancelled job posts nothing more.

## Invariants

- `createOptimizerHost` spawns the Worker only on a run, so a tour with no picture, sound or model job never starts it.
- Every message is checked with `inboundOf` before it is read: a non-object, an unknown type or a malformed run is ignored, never thrown on (a throw would reach the page as the Worker's error event, which it reads as a crash).

## Tests

The device seam: not unit-tested (it needs a real Worker). The loop is covered by `optimizer-protocol.test.ts`, the page side by `optimizer-client.test.ts`.
