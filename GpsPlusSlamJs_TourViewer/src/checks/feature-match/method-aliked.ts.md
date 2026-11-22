# method-aliked.ts

## Purpose

The ALIKED + LightGlue method of the benchmark: the split ONNX exports of the ALIKED keypoint extractor and the LightGlue matcher, run by onnxruntime-web on WebGPU or WASM.

## Sources and licences

- Extractor: `kornia/raco-aliked` on Hugging Face, revision `8f251612206a539335b62671c970bd80911495e3`, file `raco_aliked_extractor_k512.onnx` (about 13 MB). The RaCo weights and the export tooling are Apache-2.0; ALIKED itself is BSD-3-Clause.
  - Attribution (BSD-3-Clause): ALIKED, copyright its authors; a redistribution of the model must keep its copyright notice and licence text (this page only downloads it from the pinned revision).
- Matcher: `kornia/lightglue`, revision `68c04837a6fe52a082beb1fecded7438a99c8496`, file `lightglue_matcher_k512.onnx` (about 51 MB). A derived work: LightGlue (Apache-2.0), trained on RaCo-ALIKED features (Apache-2.0), with ALIKED (BSD-3-Clause) upstream; the model repository's `LICENSE-NOTICE.md` carries all three obligations and the ALIKED notice.
- Both model repositories carry that `LICENSE-NOTICE.md`; it is the reference for any redistribution.
- Runtime: onnxruntime-web 1.31.1 (MIT), the WebGPU build, from jsDelivr.
- Nothing is vendored: all load at run time from the pinned URLs.
- Each init downloads both models again; a repeat is normally served by the browser's HTTP cache and its download line then reads `(cache)`. The bytes are deliberately not kept between methods, so each method's download line stays a measurement of its own.

## Public API

- `ORT_PREFIX`, `ORT_URL`, `ORT_WASM_DIR`, `ALIKED_EXTRACTOR_URL`, `LIGHTGLUE_URL`.
- `ortApi(mod)`: checks `InferenceSession.create`, `Tensor` and `env.wasm`.
- `loadOrtRuntime(deps)`: imports and configures the runtime once per page (per `importModule`); shared with `method-sift-lightglue.ts` and `method-dino.ts`, so every ONNX method of the page uses the same runtime and settings.
- `OrtSession`: the session shape the ONNX methods use.
- `alikedMethod(backend, deps)`: the `BenchMethod`.

## Invariants

- The export fixes 512 keypoints per frame; the frame is resized to multiples of 32 and the keypoints are mapped back to frame pixels.
- The matcher takes A and B stacked (`[2, 1, K, 2]` normalized keypoints, `[2, 1, K, 128]` descriptors); its `matches0` (-1 for none) gives the pairs. Matches are LightGlue's own output, not a nearest-neighbour pass.
- Inputs and outputs are read by name with a fallback to their position.
- The runtime loads once per page; its Wasm path and thread count are set then (`ortWasmThreads(isolated, cores)`: up to four threads under cross-origin isolation, else one; the speed report prints the same number).
- Init is the creation of both sessions; if the second fails, the first is released.
- 64 MB of models: off by default on the page.

## Tests

`method-aliked.test.ts` (a fake runtime with renamed outputs).
