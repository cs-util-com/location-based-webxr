# splat-trainer.worker.ts

## Purpose

The splat trainer's module Worker: wires `worker-train.ts` to the real
`loadSplatJs`, a photo decoder and the worker's clock, and to
`postMessage`. `gpu-trainer.ts` is its page side;
`trainer-worker-spawn.ts` starts it.

## Behaviour

- `{ type: "train" }` starts the stretch (one per worker: a second train
  message is ignored); progress and the result are posted back as
  `FromWorker` messages.
- `{ type: "cancel" }` aborts the stretch; the result still follows.
- Splat.js is loaded only through the importer its `blob:` start module
  leaves (`trainer-worker-spawn.ts`); started any other way, the load
  fails ("the worker was not started from its shim") rather than send
  this site's origin to the CDN.
- Photos are decoded with `createImageBitmap` and an `OffscreenCanvas`
  (no DOM in a worker).
- Looks at the model (`PREVIEW_EVERY_MS`, 15 s): `takeLook` draws the
  model from the chosen training camera with the trainer's own
  `renderTrainCam` into this worker's `OffscreenCanvas`, configured for
  WebGPU with the trainer's device and canvas format (made again only
  when the camera size or the device changes), and hands it over as an
  `ImageBitmap` (`transferToImageBitmap`), posted as a transferable
  `{ type: "preview", picture }`. A trainer without a device, a canvas
  format, `renderTrainCam` or a camera size gives no look.

## Tests

The device seam: not unit-tested (it needs a real Worker and a graphics
card); the work it runs is (`worker-train.test.ts`, `window-run.test.ts`
for when looks are taken). The local GPU acceptance spec runs it for
real.
