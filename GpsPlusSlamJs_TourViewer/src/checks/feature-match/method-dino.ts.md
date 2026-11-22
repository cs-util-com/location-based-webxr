# method-dino.ts

## Purpose

DINOv2-S/14 as a timing arm of the speed test: one forward pass per frame through onnxruntime-web, the CLS token as the descriptor, and the cosine of the pair's two descriptors as a sanity value. It measures cost on a device only; there is no retrieval here.

## Public API

- `DinoVariant` (`int8` | `q4f16`) and `DINO_MODELS`: the files of `onnx-community/dinov2-small` at a pinned revision, int8 24,446,700 bytes, q4f16 13,908,222 bytes.
- `dinoTimingArm(variant, backend, deps, { a, b })`: a `TimingArm` in the backend's group, never the reference. `load()` loads the ORT runtime, downloads the file and creates the session (start-up). A run is three phases: preprocess (both frames), forward A, forward B; its note is the cosine A-B. A missing output is an error naming it.

## Invariants and assumptions

- Licences: the original facebook/dinov2-small weights are Apache-2.0; the onnx-community model card states no licence of its own (an export of those weights). Nothing is bundled; the file is fetched at run time from Hugging Face with `referrerPolicy: no-referrer`.
- In Node (WASM, one thread) the int8 variant took about 1.1 s per forward pass and q4f16 about 1.6-1.8 s, with a cosine of 0.995 and 1.000 on a test pattern; the phone numbers are what the arm is for.

## Example

```ts
const arm = dinoTimingArm("int8", "webgpu", browserDeps, sizedPair);
```

## Tests

`method-dino.test.ts` with a fake runtime: the pinned variant fetched, both forward passes timed and the CLS cosine reported, and a missing output named.
