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
- **XFeat (LiteRT.js)**: the Apache-2.0 LiteRT export of XFeat (1.4 MB, `xfeat_fp16.tflite` or `xfeat.tflite`, labelled by file name since the two are the same size), run by `@litertjs/core` 2.6.0 (Apache-2.0) on WebGPU or WASM.
- **ALIKED + LightGlue (onnxruntime-web)**: the split ONNX exports (extractor 13 MB, matcher 51 MB), run by onnxruntime-web 1.31.1 (MIT) on WebGPU or WASM. On by default like everything else; untick it under Options to skip the download.

Trust: the page imports its runtime code (sift.js, LiteRT.js, onnxruntime-web) from jsDelivr at run time, on the site's own origin, with no integrity check. The URLs pin a commit or version, but jsDelivr's `+esm` bundles are generated and not byte-stable, so a hash would not hold for them; the page therefore trusts jsDelivr and the pinned upstream releases. It holds the two photos and the device facts in memory only to offer them as local downloads; it uploads nothing and is linked from nothing. The CDN trust covers that data too: code served from jsDelivr runs on the same origin and could read the captured frames.

All models load from pinned Hugging Face revisions at run time; no model file is in the repository. They are fetched without a Referer (see `src/checks/feature-match/bench-net.ts.md`), because the model host refuses requests whose Referer is a `*.workers.dev` preview origin. Licences and attributions are in `src/checks/feature-match/method-*.ts.md`.

## Layout and behaviour

- **Two views.** The guided view (`src/checks/feature-match/guided-view.ts`) is the default: intro, one pair at a time with a countdown, the pairs sheet, the end screen with Download all, and a measure sheet. `?ui=cockpit` shows the four-step view described below instead (`cockpit-view.ts`).
- **What stays on the phone.** The guided run plan (which pair, its takes and settings) is kept in `localStorage`; its photos are kept in IndexedDB (`PHOTO_DB`, see `src/checks/feature-match/feature-match-store.ts.md`), so a discarded tab continues where it was. A photo is deleted from IndexedDB as soon as the plan no longer names it (a retake, Start over), and any photo the plan does not name is deleted at the next load. Nothing is uploaded. When a photo cannot be stored, the run screen shows "not stored on this phone: download soon" and the end screen says so too.
- One column on a phone in portrait, steps beside results when wide or in landscape; no horizontal page scroll (the table scrolls inside its box, pictures shrink to the column).
- **Guided steps**: 1 take photo A, 2 take photo B (hint: hold the phone the same way, step about 1 m to the side, keep most of A in view), 3 run, which starts by itself after photo B, 4 save. The current step is outlined with a filled number and "now"; done steps show a green number and "done"; later steps are dimmed.
- **Fully automatic**: every method, backend, XFeat model file and size is ticked by default; the Options panel (closed) only leaves things out. The synthetic pair is run from there too.
- **One action at a time**: while a run or a save lasts, every capture, run and save button is disabled; the camera is off during a run.
- **Visual results**: as each method and size finishes, a picture is added under Results: both frames side by side, keypoints as dots, up to 200 match lines spread over all matches, with the counts and median times as caption. Raw counts only: the page does no geometric check of the matches.
- **Portrait frames and XFeat**: XFeat runs at a fixed 640 x 480 input, so a portrait frame is turned a quarter turn clockwise first and its keypoints are turned back; the turn is named in the method notes in the log, and every saved coordinate stays in the frame as captured.
- "Copy log" copies the report (or the log before any run); if the clipboard is blocked, the report text is selected for a manual copy.
- "Save files" (step 4, after the run) offers one zip, "Download all (zip)", holding every file below plus the page log and the report as text (so nothing is copied out by hand), and each file on its own, to save on the device: both captured frames as PNG, exactly the pixels the run measured (at most 1280 px on the long side, before the per-size resize), `feature-match-frames.json` with their sizes, the camera's own size, their grey values and the device facts (browser, OS version, model, cores, memory, screen, cross-origin isolation, JSPI support, GPU), and `feature-match-matches.json` with every method's keypoints and matches per size, in the saved frames' pixels together with the size each was computed at. Nothing is uploaded. The PNGs come from the canvas encoder, which writes pixels only; each PNG is checked to hold only chunks that describe the pixels (no EXIF, text or time chunk) before it is offered, and both JSON files have a fixed list of fields with no time or place. The button shows "preparing..." while it encodes, then "ready: tap Download all (zip), or each file", or "failed (see log)" with every offered file withdrawn; a new photo withdraws the offered files.
- **Flat target capture** (selector entry "flat: flat target capture (own steps)"): a full-screen mode with a top bar (where you are, Overview, Exit), the camera or photo in the middle with a dashed guide frame and a countdown, and the controls at the bottom (hint, 6 pose buttons, 4 light bin chips with a live reading, the action buttons, a status line), all on screen without scrolling at 412x915, 880x790 and 790x880. The overview lists progress per class (5 surfaces each) and per surface, and starts a new surface with its class, whether a digital original exists and an optional original file. Details in `src/checks/feature-match/flat-capture.ts.md`.
- An inline script logs a page error even if the page module fails to load.

## Tests

- `playwright-tests/feature-match-check.spec.js`: with `sift.js` routed to a stub and every other host refused: a SIFT run on the synthetic pair at phone width (table, report, picture, no page overflow); a 404 for `sift.js` as an error line, row and card; the guided flow with a faked camera (photo A, photo B, the automatic run with every button disabled while it is held, grey values near 127.5, the step marks, the zip read back entry by entry, the four saved files: PNGs checked chunk by chunk and for the captured size, both JSON field lists, keypoints in frame pixels); a failed save; a refused camera; a camera start overtaken by a run; a run that measured nothing; a camera start that fails at once and is retried; a synthetic run that withdraws the camera run's files; and a flat target surface captured end to end (reference, corners, two light bins, the zip, a reload, the three viewports, Exit).
- The guided view's tests in the same spec: intro to end with a faked camera, the countdown driven by the page clock (3, 2, 1, then the photo), the "starting camera..." chip while the camera is held, Download all through the save picker and through the link fallback, a reload that keeps the photos and gives a new photo its own id (the restored pair's bytes in the zip are unchanged), a closed save dialog, the plan run on a pair, and the layout at 412x915, 915x412 and 880x790 (the step card's sequence inside the card and above the action bar).
- The pure parts are unit-tested under `src/checks/feature-match/`.
