# trainer-page-slice.ts

## Purpose

The one Redux slice of the splat trainer page: the phase of the page, the
recording's census, every stretch's status and verdict, the person's
decisions, the stop dialog's target and the save status. Reducers enforce
the rules; the view (`trainer-page.ts`) only reads it, and the store's
listeners (`trainer-page-store.ts`) carry out its side effects. Files,
pictures, splats and the running job live outside it, keyed by its ids.

## State

- `phase`: `start | reading | census | training | stopped | done | refused`.
- `refusal`: `{ kind: phone | no-webgpu | recording, reason, code? }` or
  null; `code` is the reader's refusal code (`no-depth`), so the page
  never guesses the kind from the sentence.
- `gpu`: `{ status: probing | ready | integrated | no-webgpu, accepted,
recheck }`; `recheck` is `idle | checking | unchanged`: "Check again" runs
  (`checking`) while the status stays what it was, and a probe that finds
  the same again says so (`unchanged`).
- `trainer`: `practice | unavailable | gpu` (from the adapter).
- `recording`: `{ id, name, census }` or null.
- `windows`: one `WindowState` per stretch - the `StretchSummary` fields
  plus `status` (`waiting | training | stopped | queued | done`),
  `attempt`, `progress`, `secondsLeft`, `nextPreviewInS`, `previews`,
  `outcome`, `metrics`, `judgement`, `trainingS`, `decision`
  (`keep | discard | null`).
- `current` (the training stretch), `queue` (the order of the rest).
- `stopDialog`: the id the stop dialog was opened for, or null; `held`:
  true while a stretch finished under the open dialog and the next start
  waits for the person's answer.
- `banner`, and `save`: `{ status: idle | saving | saved | failed, error,
savedCount, left }`; `left` is the sentence about a picked file a failed
  save did not write (it may now be empty), or null.

## Actions

- Probe and page: `probeFinished(kind)` (no WebGPU refuses the page;
  ends a running recheck), `recheckRequested` (only marks the recheck
  running), `integratedAccepted`, `phoneRefused`.
- Recording: `readingStarted({ id, name })` (from start or census),
  `readFinished({ id, census, windows })` (ignored for a stale id; an
  empty plan refuses the recording), `readRefused({ id, reason, code? })`,
  `anotherRecordingChosen` (keeps the probe result).
- Run: `trainingStarted` (needs a census, a trainer that is not the
  unavailable one, and a ready
  graphics card, or built-in graphics accepted), `progressed` (clamped to
  0..1, never backwards, non-finite values ignored), `previewed`,
  `windowFinished` (ignored unless that stretch and attempt is the one
  training; a finished stretch makes a saved run unsaved, since the file
  no longer holds everything).
- Stop: `stopAsked`, `stopDismissed` (starts a held stretch),
  `stopConfirmed({ id })` (acts only when `id` is the dialog's stretch; a
  stretch still training becomes `stopped`, loses its progress and goes to
  the front of the queue).
- `continued`, `trainAgainAsked({ id })` (poor any time, weak on its first
  attempt; attempt n gets `attemptTimeScale(n)` = 2 to the power n - 1 of
  the first try's time), `decided({ id, decision
})` (only on a finished poor stretch; null undoes).
- Save: `saveStarted`, `saveSucceeded({ count })`, `saveFailed({ message, left? })`,
  `saveCancelled`. Any change to what goes into the file makes a saved run
  unsaved again.

## Selectors

`currentWindow`, `finishedWindows`, `windowsInFile` (good, weak, and poor
kept marked), `undecidedWindows` (poor with no decision), `verdictCounts`,
`secondsLeftInRun` (the current stretch's estimate plus the queue times
the average time per attempt so far, each scaled by
`attemptTimeScale`; null until measured, once the stretch is complete,
and for a total that is not finite - a stand-in until the trainer's own
time estimates arrive), `attemptTimeScale(attempt)` (the one time rule
the store and the estimate share), `canTrainAgain`, `stretchNo`.

## Invariants (held by the property test)

- At most one stretch trains, and it is `current`; `current` is never in
  the queue; the queue holds no duplicates and no finished stretch.
- `done` means no current stretch and an empty queue.
- Progress stays within 0..1; decisions exist only on poor stretches.
- A finished stretch becomes unfinished only by "train again" for it.

## Tests

`trainer-page-slice.test.ts` (each action's rules and refusals) and
`trainer-page-slice.property.test.ts` (random sequences of finish, late
finish, progress with non-finite values, stop ask/keep/confirm, continue,
train again and decide, checked against the invariants above). Shared
fixtures: `src/test-support/splat-trainer-fixtures.ts`.
