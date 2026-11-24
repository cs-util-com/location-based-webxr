# worker-spike-slice.ts

## Purpose

The worker spike page's run status as one Redux slice: the phase (starting, ready, running, done, failed), the current step, the pair times, the live camera verdict, the result card, the plain error and the log. `worker-spike.ts` dispatches; its view reads the state and `spikeProgress` (`worker-spike-model.ts`) turns it into the bar and the status line.

## Public API

- `createWorkerSpikeStore(plan)`: a store for one run of `plan`.
- `workerSpikeActions`: `cameraOn`, `cameraFailed(error)`, `runStarted(now)`, `stepBegan({ step, now })`, `photoTaken`, `pairMeasured({ ms, now })`, `liveVerdict(verdict)`, `finished(result)`, `runFailed(error)`, `logged(line)`.
- `SpikePhase`, `WorkerSpikeState`.

## Invariants and defensive measures

- Start only once, and only with the camera on: `runStarted` moves `ready` to `running` and nothing else.
- Steps, photos and pairs change the state only while running; `photoTaken` only in the photos step, `pairMeasured` only in the pairs step, its count capped at the plan. A failed pair sends `ms: null`: it moves the count on but adds no time, so a fast failure never makes the estimate optimistic.
- `finished` only ends a running run; `cameraFailed` only before the run, `runFailed` only during it. A late answer after the end changes nothing.
- Outside the store on purpose (in `worker-spike.ts`): the raw frame gaps (thousands of numbers per second), the camera stream, the workers and the photos.

## Example

```ts
const store = createWorkerSpikeStore(DEFAULT_PLAN);
store.dispatch(workerSpikeActions.cameraOn());
store.dispatch(workerSpikeActions.runStarted(performance.now()));
```

## Tests

- `worker-spike-slice.test.ts`: Start waits for the camera, the run begins at the baseline step, a second Start is ignored, photos and pairs count only in their own step, never more pairs than planned, the result card, a plain error from the camera or the run, the log in order, the live verdict.
- `worker-spike-slice.property.test.ts`: any sequence of actions keeps the phase legal and the pair count within the plan.
