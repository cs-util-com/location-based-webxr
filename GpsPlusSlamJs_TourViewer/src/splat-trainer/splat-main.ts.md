# splat-main.ts

## Purpose

Entry of the splat trainer page (`splat/index.html`): chooses the trainer
from the address (`trainer-choice.ts`), creates the page store with the
real recording reader and window planner, mounts the page, and probes the
graphics card.

## Behaviour

- `?trainer=gpu` - the GPU trainer (`gpu-trainer.ts`): the real probe,
  photos read with `readRecordingPhotos`, one worker per stretch started
  by `spawnTrainerWorker` (no Referer reaches the CDN).
- `?trainer=practice` - the practice trainer on the window's timers, with
  `pace`, `gpu` and `lost` from the address and painted practice pictures.
- Otherwise - the unavailable trainer with the browser's real WebGPU
  probe: no WebGPU refuses the page; with WebGPU the page reads
  recordings and says the splat maker is not ready yet.
- A screen at most 700 px wide is a phone: the page refuses and nothing
  is probed.
- Saving writes through the framework's `writeFileOrAbort`, or downloads
  with `downloadBlob` where there is no save dialog.
- On `pagehide` the page and the store are disposed (the job is aborted),
  unless the page goes into the back/forward cache (`event.persisted`): it
  comes back alive from there and must keep running.
- The paper colour for practice pictures is read from the page root, where
  the page's tokens live (`.splat-page`).

## Tests

No unit test of its own: it only wires tested modules. The e2e
`playwright-tests/splat-trainer.spec.js` loads the page through it in
every mode.
