# fake-trainer.ts

## Purpose

The practice trainer: a scripted stand-in behind the `TrainerAdapter`
interface, so the splat trainer page can be built, tested and tried
without a graphics card. It is selected only by `?trainer=practice` or in
tests; the page shows a "Practice run" chip, and on every print that it
shows a drawing, not a splat. Its progress is always the `training`
stage.

## Public API

- `PracticeOptions` - `{ timer, pace?, gpu?, script?, picture?,
lostStretch? }`. `timer` is `{ now, set, clear }` (the internal
  `PracticeTimer` shape): the page passes the window's timers, tests a
  manual clock (`src/test-support/manual-timer.ts`). `lostStretch` (1-based,
  from the page's `lost=<n>`) makes that stretch's first try lose the
  graphics card halfway and end `gpu-lost`.
- `PRACTICE_STRETCH_MS` (20 s per first try at pace 1).
- Internal, not exported: `PRACTICE_PREVIEW_MS` (a new picture every
  4 s) and `PRACTICE_MEASURE_MS` (no time estimate in the first 3 s).
- `DEFAULT_PRACTICE_SCRIPT(index, attempt)` - how each attempt ends, by
  the stretch's position modulo 8: mostly good, one weak, one not good
  enough that is weak on its second try, one that runs out of time. Its
  numbers are invented for the practice run.
- `parsePace(raw) -> number` - a positive finite number clamped to
  0.05..1000, anything else 1 (never NaN).
- `practicePictures(doc, paper) -> picture` - draws into a 960x640 canvas
  with `practice-prints.ts`.
- `createPracticeTrainer(options) -> TrainerAdapter` - `probe` reports
  `options.gpu`; `trainWindow` ticks every 250 ms, reports progress, a
  picture at each preview time and the scripted ending; an abort resolves
  `cancelled` and clears its timers; `judge` maps the scripted ending to a
  verdict, and a lost graphics card or failure to not good enough.

## Tests

`fake-trainer.test.ts`: timing at pace 1 and faster, previews, the
measuring phase, the scripted verdicts and retries, cancel clearing every
timer, `parsePace` on bad input, and the lost graphics card of
`lostStretch` (first try only, judged not good enough).
