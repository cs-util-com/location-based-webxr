# feature-match-check.html

## Purpose

A standalone measurement page: it times keypoint extraction and matching of three methods on the device that opens it, and gives the numbers as a table and as one plain-text block to copy. It is a build entry linked from nothing (served at `/tour/feature-match-check.html` on the site), not product UX.

## What it measures

- Per method, backend and input size (long edge 320, 480, 640): extraction time per frame and matching time per pair, median and p90 over N runs (default 5) after one warm-up.
- Keypoints per frame, descriptor bytes per frame, matches per pair; on the synthetic pair also how many matches land within 3 px of the known warp ("correct").
- Download size and time of each model and runtime file (from resource timing; "-" where the browser hides the size), init time, and the backend in use.
- Per input frame: its size and the mean and standard deviation of its grey values (0-255), in the capture log line and in the report's `input:` line, so a dark or flat frame is visible next to the keypoint counts.
- Device facts: user agent, model and platform version (where the browser gives them), cores, memory, cross-origin isolation, JSPI support, screen, and the WebGPU adapter with its features.

## Methods

- **SIFT (plain JS)**: Splat.js `sift.js` (MIT), imported at run time from a pinned commit on jsDelivr; never vendored.
- **XFeat (LiteRT.js)**: the Apache-2.0 LiteRT export of XFeat (1.4 MB, fp16 or fp32 weights), run by `@litertjs/core` 2.6.0 (Apache-2.0) on WebGPU or WASM.
- **ALIKED + LightGlue (onnxruntime-web)**: the split ONNX exports (extractor 13 MB, matcher 51 MB), run by onnxruntime-web 1.31.1 (MIT) on WebGPU or WASM. Off by default because of the download.

All models load from pinned Hugging Face revisions at run time; no model file is in the repository. They are fetched without a Referer (see `src/checks/feature-match/bench-net.ts.md`), because the model host refuses requests whose Referer is a `*.workers.dev` preview origin. Licences and attributions are in `src/checks/feature-match/method-*.ts.md`.

## Layout and behaviour

- One column on a phone in portrait, settings beside results when wide or in landscape; no horizontal page scroll (the table scrolls inside its box).
- The Run button shows "Running..." and is disabled while a run lasts, then shows the outcome next to it; a failure is a log line and a table row, and the button comes back.
- "Copy log" copies the report (or the log before any run); if the clipboard is blocked, the report text is selected for a manual copy.
- "Save frames" (camera input, once A and B are captured) offers three files to save on the device: both captured frames as PNG, exactly the pixels the run measured (at most 1280 px on the long side, before the per-size resize), and `feature-match-frames.json` with their sizes, the camera's own size, their grey values and the device facts. Nothing is uploaded. The PNGs come from the canvas encoder, which writes pixels only; every file is checked to hold image chunks only (no EXIF, text or time chunk) before it is offered, and the JSON has a fixed list of fields with no time or place. The button shows "preparing..." while it encodes, then "3 files ready: tap each to save", or "failed (see log)"; a new capture withdraws the offered files.
- An inline script logs a page error even if the page module fails to load.

## Tests

- `playwright-tests/feature-match-check.spec.js`: with `sift.js` routed to a stub and every other host refused, a SIFT run on the synthetic pair fills the table and the report at phone width, a faked camera stream is captured, logged with its grey values, run, and saved (both PNGs checked chunk by chunk for pixels only and for the captured size, the JSON for its field list), and a 404 for `sift.js` becomes an error line with the button restored.
- The pure parts are unit-tested under `src/checks/feature-match/`.
