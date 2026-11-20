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

## Tests

The device seam: not unit-tested (it needs a real Worker and a graphics
card); the work it runs is (`worker-train.test.ts`). The local GPU
acceptance spec runs it for real.
