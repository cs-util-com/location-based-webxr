# method-xfeat.ts

## Purpose

The XFeat method of the benchmark: the LiteRT export of XFeat run by LiteRT.js on WebGPU or WASM, with one of two model files (`xfeat_fp16.tflite` or `xfeat.tflite`), decoded on the host and matched by mutual nearest neighbour.

## Sources and licences

- Model: `litert-community/xfeat-litert` on Hugging Face, revision `f5001dcae042fa6f79e1407b6d6d1ade01a76c27`, Apache-2.0. Files `xfeat_fp16.tflite` (about 1.4 MB) and `xfeat.tflite` (about 1.4 MB). The two are the same size, so the page does not claim they differ in weight precision: a variant is labelled by its file name (the setting's values stay `fp16` and `fp32`).
- Runtime: `@litertjs/core` 2.6.0, Apache-2.0, from jsDelivr (`/+esm` for the module, `/wasm/` for its Wasm files).
- Nothing is vendored: both load at run time from the pinned URLs.

## Public API

- `LITERT_URL`, `xfeatModelUrl(precision)`. Internal settings: top 1024 keypoints, heat threshold 0.05, match cosine floor 0.82.
- `liteRtApi(mod)`: checks the module has `loadLiteRt`, `loadAndCompile` and `Tensor`.
- `toFloat32(data, dtype)`: a float32 copy of an output, float16 (16-bit words) converted; always a copy, because the tensor is deleted after reading and its array may be a view on the runtime's memory.
- `xfeatMaps(outputs)`: the three output maps found by channel count (64, 65, 1), since exporters do not keep their order; each role takes a different output (a `[1, 64, 64, 1]` map fits two roles).
- `xfeatMethod(backend, precision, deps)`: the `BenchMethod`, labelled `XFeat (LiteRT.js) <backend> <model file>`.

## Invariants

- The runtime loads once per page (a second `loadLiteRt` fails); the promise is a resource cache keyed by the loader, and a failed load is forgotten so the next run retries. Threads are used only under cross-origin isolation.
- The model input is fixed (640 x 480 for this export): a smaller frame is padded, a larger or portrait one is shrunk to fit, so the model's own time hardly changes with the size chosen. Keypoints are mapped back to frame pixels.
- Every tensor made per frame is deleted, also on failure; on WebGPU the input moves to the GPU and each output back to the host.
- The backend shown is the requested accelerator; LiteRT.js does not report a partial fallback through its public API.
- Init is the model compile; the runtime's own load time is in the notes.

## Tests

`method-xfeat.test.ts` (a fake runtime with out-of-order outputs).
