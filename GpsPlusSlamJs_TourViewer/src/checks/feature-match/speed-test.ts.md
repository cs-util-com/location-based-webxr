# speed-test.ts

## Purpose

The speed test's arm list from the page's choices: per backend the XFeat fp16 reference, the DINOv2 variants and SIFT + LightGlue, all on one pair resized once to the chosen long edge.

## Public API

- `SpeedTestChoice`: which arms (`xfeat`, `siftLightGlue`, `dino` variants), `backends`, `longEdge`, `siftCap`.
- `SPEED_LONG_EDGES` (480, 640, 960) and `SPEED_SIFT_CAPS` (512, 1024): what the page offers.
- `speedFrames(ids, readFrame)`: the flat scene's F1 and F2 as frames, or `{ fallback }` naming why the synthetic pair is used instead: a shot not taken, or a read or decode that rejects (a photo storage lost, or one whose write was refused and memory no longer holds). Never rejects.
- `speedTestInput(input, longEdge)`: both frames resized once, the known warp of a synthetic pair kept.
- `speedTestArms(choice, input, deps)`: per backend, in load order XFeat (the group's reference), DINOv2, SIFT + LightGlue; the harness rotates the run order anyway.
- `speedTestSettings(choice, input, backendNote, wasmThreads)`: the settings line every number rests on (long edge and real size, DINOv2 224x224, SIFT cap, the reference, backends and the WebGPU fallback note, and `ort wasm threads N`).

## Invariants and assumptions

- At most one reference per group, and nothing that was not ticked.
- DINOv2 always sees 224x224 whatever the long edge; only the keypoint arms depend on it.

## Example

```ts
const arms = speedTestArms(choice, pair.input, browserDeps);
const line = speedTestSettings(
  choice,
  pair.input,
  note,
  ortWasmThreads(crossOriginIsolated, navigator.hardwareConcurrency),
);
```

## Tests

`speed-test.test.ts`: the arms per backend, a property on references and unticked arms, the resize keeping the warp, and the settings line. The page wiring is covered by "the feature matching speed test reports an arm that cannot load" in `playwright-tests/feature-match-check.spec.js`.
