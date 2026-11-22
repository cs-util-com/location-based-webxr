# cockpit-model.ts

## Purpose

The cockpit view's dock as plain data, read from the page state (`feature-match-slice.ts`): what the big button does and says, the Retake button, the A and B tiles, the instruction line, the progress and its segments, the readouts and the status line. Pure, so `cockpit-view.ts` only copies fields into its fixed boxes and every rule is unit-tested.

## Public API

- `shutterView(s)` -> `ShutterView { mode, text, tone, disabled, shot, index }`. `mode`: `busy` (Measuring while a run goes, Saving while a zip or file is prepared), `cancel` (a countdown runs: Tap to stop), `start` (a photo is due and the camera is off: Start, Starting, Retry camera), `capture` (Take A or B, Retake A or B, or "A in 5 s" with the countdown), `retake` (a failed light check: Retake the photo `warnShot` names), `next` (Next pair, `index` the slot `nextStep` gives) or `save` (All done). While photo B waits to take itself the button stays `capture` B, armed, with Waiting or Hold still (a tap takes B after the countdown, as Take B does: the way out of the wait); while it takes itself, `busy` Taking B. `tone` is the prototype's `data-mode`.
- `retakeView(s, last)` -> `RetakeView { label, disabled, action }`: Cancel retake, Retake A while B is due, "Retake B of NN" once the pair finished last (`LastPair { index, seq }`) is behind the current one, Retake A or B of a reviewed pair; off while busy or counting. `action` is a toggle of one photo or a move back to `last.index`.
- `tileView(s)` -> `{ a, b }` of `TileView { state, text, disabled }`: `armed` (due and the camera on: "now", or the seconds left), `taken`, `retake` or none; a tile is tappable only when its photo exists and the page is idle and not counting.
- `instrView(s)` -> `{ label, text, bold? }`: the run's note while measuring, "tap Start" with the camera off (`bold: "Start"`, the word the view sets in bold), the guide card's A text, then its change and B text, the failed light check's note, or the pair done and all done lines ("All pairs done and downloaded." once Download all has nothing left to add).
- `warnShot(light)`: the photo a failed light check asks for again: A only for an almost black A, B for every other case, so a retake never loops on the same photo.
- `nextAfterPair(s)`: the slot to move to once a complete pair is packed, or null for a half pair, a failed light check or the end.
- `progressText(s)` ("done / total", failed light checks not counted), `segClasses(s)` (one class per slot: `cur`, `saved`, `warn`, `kept`), `downloadCount(s)` (complete takes not downloaded: what Download all adds).
- `nightOn(s)`: between photo A and B of the dimmed pairs `1b` and `1c`.
- `readoutView(s, motion)` -> `{ still, light, mode }` of `Readout { text, tone }`: "still: -" before a motion reading, then moving or steady; the take's light check, or photo A's grey mean; the capture mode: "auto" while photo B waits to take itself, else tap with the countdown.
- `meterFill(s)`: the meter ring from 0 to 1: the countdown while one runs, the dwell's progress (`stillProgress`) while photo B waits, else empty.
- `statusView(s)` -> `Line { text, tone }`: the newest workflow line, in this order: photos not stored, the running kind's own status (`runStatusText`), the countdown, the run zip's text, the camera starting or failed (before the single-file line, which may be older), the single-file line (bad when it says `NOT_MEASURED`), the hands-off photo B's line (ok when taken, bad when refused or failed).
- `runStatusText(s)`: the status of the run going, in its own slot (a synthetic or speed run), else the photo pair run's.
- `NOT_MEASURED` and `pairMeasured(s, results, slot, seq)`: whether the last photo pair run measured that take, with at least one method measuring at least one size (a missing `sift.js` leaves every method in error); else the pair's save line ends in "Not measured: see Results.".
- `handsOffResult(shoot, onError?)`: `taken`, `refused` (no picture) or `failed` (it threw; `onError` gets the error).
- `sameDrawing(prev, next)`: true when only the hands-off detector moved, in the same phase, text, take and 1/50 of the meter; the page then draws nothing.

## Invariants and assumptions

- Pure functions of the state and their arguments; no DOM, no timers. The current slot is clamped into the plan's slot list, so a stored index outside it never throws.
- Busy wins over everything: while a run or a save goes, no button offers an action.

## Example

```ts
const v = shutterView(store.getState());
button.textContent = v.text;
button.disabled = v.disabled;
```

## Tests

`cockpit-model.test.ts`: each state of the big button (camera first, the photo due and the countdown, busy, the retake a light check asks for, all done), `warnShot`, Retake (A while B is due, cancel, back to the last pair's B, a reviewed pair, off while busy or counting), the tiles, the instruction line, `nextAfterPair`, the progress, segments and download count, night, the readouts and the status line, the hands-off states on the button, the status line, the meter and the mode readout, the status order and tones (a camera failure outranks an older save line), the running kind's own line, `pairMeasured`, the all-downloaded end, `handsOffResult`, `sameDrawing` (still readings over 1.2 s redraw only per meter step, at most 52 times), and a property test that random plans and actions (the hands-off ones included) always give a shutter text, finite counts, a download count of at least 0 and a meter fill in 0..1.
