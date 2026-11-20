# trainer-page-store.ts

## Purpose

Creates the splat trainer page's store and runs its side effects as
listeners: reading the chosen recording, probing the graphics card,
running the trainer on whichever stretch the state says is training (and
aborting it the moment the state says otherwise), and saving.

## Public API

- `TrainerPageDeps` - `{ adapter, read, plan, write, download }`: the
  trainer, the recording reader (`readSplatInputs`), the window planner
  (`windowPlanner()`), a write into a picked file handle, and a download
  that resolves false when cancelled.
- `TrainerSideTables` - `files`, `inputs` and `plans` keyed by recording
  id; `previews` and `splats` keyed by stretch id.
- `createTrainerPageStore(deps) -> { store, sides, probe, chooseRecording,
save, dispose }`.
  - `probe()` - runs the adapter's probe; a throw counts as no WebGPU.
  - `chooseRecording(file)` - from the start or census only; gives the
    recording a fresh id so a late read of an earlier file is ignored.
  - `save(pick)` - `pick` is the save dialog's promise, asked for in the
    click before anything awaits. Cancelled ends quietly, an unavailable
    dialog falls back to a download, any error ends in `saveFailed`. A
    picked file the save did not write is released with the framework's
    `releaseUnusedPick` (never deleted, since the browser may already have
    emptied it), and its sentence goes into `saveFailed`'s `left`.
  - `dispose()` - aborts the job and removes the listeners.

## Invariants

- Exactly one job runs, keyed by stretch id and attempt; any change of
  that key aborts the old job first. A stopped or queued stretch loses
  its preview. Every preview picture that is replaced or dropped is
  closed (`ImageBitmap.close()` where it has one), and a picture that
  arrives after its job was aborted is closed at once.
- A trainer that reports `cancelled` without the page asking for it is
  judged as `failed`: only the page's own stop is never judged.
- Each attempt's `timeScale` is the slice's `attemptTimeScale`.
- A trainer that throws, or a judge that throws, ends the stretch as not
  good enough ("the trainer stopped"), so the run never hangs at
  "Training".
- A read error refuses the recording with the reader's reason and
  refusal code; a throwing planner refuses it with the planner's message.
  Neither leaves a stuck "Reading" or keeps inputs or plans.

## Tests

`trainer-page-store.test.ts`: the real reader on synthetic recordings
(census, planned windows, refusals), the practice trainer on a manual
clock (a whole run, stop aborting the job with no timer left, continue,
a throwing trainer, an unasked cancel, preview pictures closed), and
saving (picked, cancelled, download, failed then retried, the picked file
released), with the saved zip read back.
