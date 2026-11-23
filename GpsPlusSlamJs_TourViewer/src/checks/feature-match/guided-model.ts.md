# guided-model.ts

## Purpose

The guided view's screens as plain data, read from the page state (`FeatureMatchState`): the run screen, the shots sheet's rows and the end screen, plus the current shot's context both views read. Pure, so the view only copies fields into the DOM and the rules are unit-tested without one.

## Public API

- `shotContext(state)` -> `ShotContext { list, index, shot, card, photo, prev, prevPhoto, light, redoes }`: the current shot clamped into the list, its words (`shotCard`), its photo, the scene's previous shot and its photo, its light check and how many pairs a retake of it measures again (`pairsUsing`). `warned(light)`: a light check that failed.
- `shotCounts(state)` -> `{ done, total }` (shots with a photo, every shot) and `readyCount(state)` (pairs with both photos: what Download all saves).
- `runView(state): RunView` for the current shot:
  - `pos` ("Shot 3 of 13"), `done`, `total`, `shot` id, `key`, `title`, `place` ("place N" on the light shots only), `purpose`, `avoid`, `diagram`, `steps { a, change, b }` (the scene setup, the change from the previous shot, the shot itself; a scene's first shot says "This is the scene's first shot.").
  - `chip`: "Shot L2" (`a` on a scene's first shot, `b` on a later one) or `done` ("Check").
  - `seq`: per step `now`, `past` or `todo`. On a later shot the change and the shot are both lit.
  - `reviewing` (the shot has its photo and no count runs) and `note`: the light check's `LIGHT_NOTE` (`warn` when it failed), or "Photo taken. Check it is sharp.", each followed by what a retake costs ("Retaking F1 redoes 7 measurements.").
  - `ghost`: the scene's previous photo can be laid over the finder while this shot is due.
  - `slots { a, b }`: thumb `a` is the scene's previous shot, `b` this one; disabled when empty, while counting and while busy. `photos { a, b }`: their photo ids.
  - `primary`: the big button. `capture` ("Capture L2", "Retake L3" after a failed light check, with the countdown in its line), `cancel` while a countdown runs, `next` / `missing` (with the shot `index`, from `nextOpen`) or `finish`. Disabled while busy.
- `shotRows(state)`: one row per shot, `{ index, label, sub, status, current }`, `status` `done`, `retake` (a failed light check) or `missing`.
- `endView(state)`: `{ all, done, total, kicker, title, lede, canDownload, download }`; the zip needs a ready pair and an idle page. `download` is `{ label, text, tone }` from `state.runZip`: "Preparing the zip..." while packing, "Download again" (tone `ok`) after a save, "Download all" (tone `err`) after a failure, and otherwise the estimate line "One zip with N pairs, saved to this phone only." (no size: PNG sizes are unknown before encoding).
- `deviceSummary(device)`: the summary's phone line, "model, OS version, N cores", dashes for the unknown.
- `STEADY_THRESHOLD` (6 degrees per second), `motionStep(level, rotationRate)` (an 0.8/0.2 moving average of the summed absolute rotation rates; a rate that is null or not a finite number counts as missing, and a reading without any, or whose sum overflows, keeps the level, so one NaN cannot latch the level) and `isMoving(level)`: the steady chip. `rateSum(rotationRate)` is the summed absolute finite rates, or null for a reading without one or whose sum overflows; `motionStep` and `still-detector.ts` share it. `hasRate(rotationRate)` says whether a reading carries any finite rate; the views mark motion as seen only then, so an all-NaN reading never makes the readout claim "steady".
- `introCountdownText(settings)`: the intro's hands-off line for `{ countdown, sound }`: the countdown in seconds, ", with a beep per second" when the sound is on, or, with the countdown off, that each photo is taken at the tap.

## Invariants

- Reads only; no state of its own. The countdown comes from `state.guided`, the countdown seconds from the plan's settings.

## Example

```ts
const v = runView(store.getState());
primary.textContent = v.primary.label;
```

## Tests

`guided-model.test.ts`: L1 first, the move to L2 with the ghost, countdown labels and Cancel, the review naming what a retake redoes (F1: 7), a failed light check staying on its shot, the missing shot and Finish, busy, the place line; the shots rows, the shot and pair counts and the end screen with the download label per zip phase, `deviceSummary`, `introCountdownText` (3 and 5 s, sound on and off, the countdown off), and the steady hint: a threshold sweep 3 to 12 over assumed profiles (table, hand, tap, pan; synthetic, not recordings) in which every value keeps the table and the hand steady and the pan moving, and the tap settles in about 0.3 s at 6 (28 readings at 3, 11 at 12).
