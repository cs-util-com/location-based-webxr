# measure-worker-core.ts

## Purpose

What the measuring worker does with one request: decode both photos, cut and turn the squares of a rotation pair, run the ticked methods once with the photo test's settings, and answer with the results. The browser parts come in through `MeasureEnv`, so it runs in a unit test; `feature-match-measure.worker.ts` wires the real ones.

## Public API

- `MeasureEnv { decode, webgpu, build, now }`: the PNG decoder (`pngFrame`), the WebGPU probe of the worker (`webGpuProbe`; a dedicated worker has its own `navigator.gpu`), the method builder (`buildMethods(selection, deps, "worker")`) and the clock.
- `measureMsOf(results)`: the time a pair took, in ms: for every size without an error, two extracts and one match (their medians). Downloads, session creation and failed sizes are left out, so it is the cost of one more pair; the end screen's estimate multiplies it.
- `handleMeasure(data, env, post)`: answers one message with progress lines and then `done` or `failed`. Never rejects.

## Invariants and defensive measures

- A message that fails `requestOf` but names a job id is answered `failed` ("malformed request"), so the page does not wait for it forever; one without a job is dropped.
- A photo that cannot be decoded answers `failed` ("a photo could not be decoded: ...").
- The settings are the photo test's protocol settings: `runSettings({ pair, backends: [], precisions: [], runs: 1 }, webgpu)`, so one run, no warm-up and the backend the probe allows; the settings line is the first progress line and goes into `done`.
- XFeat is always off in the worker (`xfeat: false`), whatever the request says.
- A rotation pair cuts A's centre square unturned and B's turned by `turn` (`rotationSquare`), as the PC side does.
- Any throw after the decode answers `failed` with its text.

## Example

```ts
await handleMeasure(event.data, env, (answer) => self.postMessage(answer));
```

## Tests

`measure-worker-core.test.ts` (a fake decoder, probe and method): a pair measured with the photo test settings and posted, a rotation pair cut to centre squares with B turned, the load time left out of the measuring time, a decode failure, a malformed request with a job answered and one without dropped, and `measureMsOf` summing both extracts and the match of every size that ran.
