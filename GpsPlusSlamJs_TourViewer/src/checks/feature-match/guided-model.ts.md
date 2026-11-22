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
- `endView(state)`: `{ all, done, total, kicker, title, lede, canDownload }`; the zip needs a complete pair and an idle page.
- `planPairOf(state, frames)`: the current slot's `{ slot, seq, a, b }` (frames from the side table), or null for a half pair or a frame the side table does not hold; a plan run and the single-file exports read it.

## Invariants

- Reads only; no state of its own. The countdown and retake target come from `state.guided`, the countdown seconds from the plan's settings.

## Example

```ts
const v = runView(store.getState());
primary.textContent = v.primary.label;
```

## Tests

`guided-model.test.ts`: the first pair, the lit steps after photo A, countdown labels and Cancel, the review and the next pair, a failed light check, a retake, the missing pair and Finish, busy, the place line; the pairs rows and the end screen.
