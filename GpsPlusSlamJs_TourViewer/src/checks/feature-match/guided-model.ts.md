# guided-model.ts

## Purpose

The photo test's shared readings of the page state, used by both views and by `guided-scene-model.ts`: the current shot's context, the cockpit's shot rows, the ready pair count, the measuring line, the phone line of the summary and the steady hint. Pure, so every rule is unit-tested without a DOM.

## Public API

- `shotContext(state)` -> `ShotContext { list, index, shot, card, photo, prev, prevPhoto, light, redoes, fixAt }`: the current shot clamped into the list, its words (`shotCard`), its photo, the scene's previous shot and its photo, its light check and how many pairs a retake of it measures again (`pairsUsing`), and `fixAt`: the shot whose retake fixes its light check, the scene's L1 when L1 is too dark to dim from (`too-dark-a`), else its own index. The plan keeps such a shot current (its check failed); the views lead to `fixAt` instead of offering a retake that cannot pass. `warned(light)`: a light check that failed.
- `readyCount(state)`: pairs with both photos (what the zip saves).
- `shotRows(state)`: one row per shot for the cockpit, `{ index, label, sub, status, current }`, `status` `done`, `retake` (a failed light check) or `missing`.
- `measureText(progress)`: the measuring line from `measureProgress` (`feature-match-slice.ts`): "Measuring on this phone: X of N pairs, about M min left. ..." while a pair measures, "Measured on this phone: X of N pairs, k failed (the PC measures it)." when none waits, "Measuring stopped: the worker crashed N times in a row. ..." after the crash limit (N from the progress's `crashes`, so the text follows `MAX_CRASHES`), "X of N pairs measured on this phone; the rest go to the PC." otherwise, and empty while no pair is ready. The guided end view says it when measuring stopped.
- `deviceSummary(device)`: the summary's phone line, "model, OS version, N cores", dashes for the unknown.
- `STEADY_THRESHOLD` (6 degrees per second), `motionStep(level, rotationRate)` (an 0.8/0.2 moving average of the summed absolute rotation rates; a rate that is null or not a finite number counts as missing, and a reading without any, or whose sum overflows, keeps the level, so one NaN cannot latch the level) and `isMoving(level)`: the steady chip. `rateSum(rotationRate)` is the summed absolute finite rates, or null for a reading without one or whose sum overflows; `motionStep` and `still-detector.ts` share it. `hasRate(rotationRate)` says whether a reading carries any finite rate; the views mark motion as seen only then, so an all-NaN reading never makes the readout claim "steady".

## Invariants

- Reads only; no state of its own. Imports the slice for types only: the slice imports `still-detector.ts`, which imports this module.

## Example

```ts
const c = shotContext(store.getState());
title.textContent = c.card.title;
```

## Tests

`guided-model.test.ts`: the shot rows (done, retake suggested, missing), `readyCount`, `measureText` per state, `deviceSummary`, and the steady hint: a threshold sweep 3 to 12 over assumed profiles (table, hand, tap, pan; synthetic, not recordings) in which every value keeps the table and the hand steady and the pan moving, and the tap settles in about 0.3 s at 6 (28 readings at 3, 11 at 12).
