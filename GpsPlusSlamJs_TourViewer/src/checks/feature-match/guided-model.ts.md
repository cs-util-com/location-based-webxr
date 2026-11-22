# guided-model.ts

## Purpose

The guided view's screens as plain data, read from the page state (`FeatureMatchState`): the run screen, the pairs sheet's rows and the end screen. Pure, so the view only copies fields into the DOM and the rules are unit-tested without one.

## Public API

- `runView(state): RunView` for the current plan slot:
  - `pos` ("Pair 3 of 14"), `done`, `total`, `slot` id, `key`, `title`, `place` ("place N" on the light pairs only), `purpose`, `avoid`, `diagram`, `steps { a, change, b }`.
  - `chip`: the due photo ("Shot A", "Retake B") or `done` ("Check").
  - `seq`: per step `now`, `past` or `todo`. After photo A the change and photo B are both lit, since the change happens right before B.
  - `reviewing` (both photos, nothing due, no countdown) and `note` (the light check's `LIGHT_NOTE`, or the pair-complete line).
  - `ghost`: photo A can be laid over the finder while photo B is due.
  - `slots { a, b }`: thumbnail state; disabled when empty, while counting and while busy.
  - `primary`: the big button. `capture` (with `shot` and the countdown in its line), `cancel` while a countdown runs, `next` / `missing` (with the slot `index`, from `nextStep`) or `finish`. Disabled while busy. After a failed light check `next` says "or tap A or B to retake first".
- `pairRows(state)`: one row per slot, `{ index, label, sub, status, current }`.
- `endView(state)`: `{ all, done, total, kicker, title, lede, canDownload, download }`; the zip needs a complete pair and an idle page. `download` is `{ label, text, tone }` from `state.runZip`: "Preparing the zip..." while packing, "Download again" (tone `ok`) after a save, "Download all" (tone `err`) after a failure, and otherwise the estimate line "One zip with N pairs, saved to this phone only." (no size: PNG sizes are unknown before encoding).
- `runPairs(state, frames)`: every complete pair (done or retake) in run order as `{ slot, tag, names, light, a, b }`, the names from `pairFileNames`; throws `photo A of <slot> is not loaded` when a frame is missing from the side table, so a zip is never silently short.
- `deviceSummary(device)`: the summary's phone line, "model, OS version, N cores", dashes for the unknown.
- `STEADY_THRESHOLD` (6 degrees per second), `motionStep(level, rotationRate)` (an 0.8/0.2 moving average of the summed absolute rotation rates; a rate that is null or not a finite number counts as missing, and a reading without any, or whose sum overflows, keeps the level, so one NaN cannot latch the level) and `isMoving(level)`: the steady chip.
- `measureText(state, pair)`: the measure sheet's state line: the run's status line only while `planRun` is the current slot, else "pair <slot>: photos A and B ready" or "the current pair has no two photos yet".
- `introCountdownText(settings)`: the intro's hands-off line for `{ countdown, sound }`: the countdown in seconds, ", with a beep per second" when the sound is on, or, with the countdown off, that each photo is taken at the tap.
- `planPairOf(state, frames)`: the current slot's `{ slot, seq, a, b }` (frames from the side table), or null for a half pair or a frame the side table does not hold; a plan run and the single-file exports read it.

## Invariants

- Reads only; no state of its own. The countdown and retake target come from `state.guided`, the countdown seconds from the plan's settings.

## Example

```ts
const v = runView(store.getState());
primary.textContent = v.primary.label;
```

## Tests

`guided-model.test.ts`: the first pair, the lit steps after photo A, countdown labels and Cancel, the review and the next pair, a failed light check, a retake, the missing pair and Finish, busy, the place line; the pairs rows and the end screen, the download label per zip phase, `runPairs` (run order, names, distinct names of the other pairs, the missing frame), `deviceSummary`, `measureText` (the run's line only for its own pair), `introCountdownText` (3 and 5 s, sound on and off, the countdown off), and the steady hint: a threshold sweep 3 to 12 over assumed profiles (table, hand, tap, pan; synthetic, not recordings) in which every value keeps the table and the hand steady and the pan moving, and the tap settles in about 0.3 s at 6 (28 readings at 3, 11 at 12).
