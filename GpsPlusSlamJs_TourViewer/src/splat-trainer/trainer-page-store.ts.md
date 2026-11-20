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
    dialog falls back to a download, any error ends in `saveFailed`.
  - `dispose()` - aborts the job and removes the listeners.

## Invariants

- Exactly one job runs, keyed by stretch id and attempt; any change of
  that key aborts the old job first. A stopped or queued stretch loses
  its preview.
- A trainer that throws, or a judge that throws, ends the stretch as not
  good enough ("the trainer stopped"), so the run never hangs at
  "Training".
- A read error or a throwing planner refuses the recording with the
  reason, never a stuck "Reading".

## Tests

`trainer-page-store.test.ts`: the real reader on synthetic recordings
(census, planned windows, refusals), the practice trainer on a manual
clock (a whole run, stop aborting the job with no timer left, continue,
a throwing trainer), and saving (picked, cancelled, download, failed then
retried), with the saved zip read back.
