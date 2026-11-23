# cockpit-model.ts

## Purpose

The cockpit view's dock as plain data, read from the page state (`feature-match-slice.ts`): what the big button does and says, the Retake button, the two tiles, the instruction line, the progress and its segments, the Download all label, the readouts and the status line. Pure, so `cockpit-view.ts` only copies fields into its fixed boxes and every rule is unit-tested. The current shot and its context come from `shotContext` (`guided-model.ts`), shared with the guided view.

## Public API

- `shutterView(s)` -> `ShutterView { mode, text, tone, disabled, index }`. `mode`:
  - `busy`: Measuring while a run goes, Saving while the zip is prepared, Taking L2 while a shot takes itself;
  - `cancel`: a countdown runs (Tap to stop);
  - `start`: the shot wants a photo and the camera is off (Start, Starting, Retry camera);
  - `capture`: Take L1, or "L1 in 3 s" with the countdown; while a shot waits to take itself, Waiting or Hold still (a tap still takes it after the countdown: the way out of the wait);
  - `retake`: a failed light check (Retake L3);
  - `next`: Next shot, `index` from `nextOpen`;
  - `save`: All done.
  - `tone` is the prototype's `data-mode`.
- `retakeView(s)` -> `RetakeView { label, disabled, action }`: "Retake L1" (`{ kind: "shoot" }`) once the current shot has its photo, else "Back to L1" (`{ kind: "back", index }`) when the scene's previous shot has one; off while busy or counting.
- `tileView(s)` -> `{ a, b }` of `TileView { state, text, disabled }`: `a` is the scene's previous shot (its key; a tap goes back to it), `b` the current one (`armed` while due with the camera on: "now", or the seconds left; `taken`).
- `instrView(s)` -> `{ label, text, bold? }`: the measuring line while a run goes, "tap Start" with the camera off (`bold: "Start"`), the scene's setup and capture words on a first shot or the change and capture words on a later one, the failed light check's note, then "Shot done" or "All shots done".
- `progressText(s)` ("2 / 13": shots with a photo whose light check did not fail), `segClasses(s)` (one class per shot: `cur`, `kept`, `warn` or none), `downloadLabel(s)` ("Download all (N)" with N ready pairs, else "Download all").
- `nightOn(s)`: before a dimmed shot (L3, L4) is taken: the dock must not light the room.
- `readoutView(s, motion)` -> `{ still, light, mode }` of `Readout { text, tone }`: "still: -" before a motion reading, then moving or steady; the shot's light check, or its grey mean; the capture mode: "auto" while a shot waits to take itself, else tap with the countdown.
- `meterFill(s)`: the meter ring from 0 to 1: the countdown while one runs, the dwell's progress (`stillProgress`) while a shot waits, else empty.
- `statusView(s)` -> `Line { text, tone }`: the newest workflow line, in this order: photos not stored, the running kind's status (`runStatusText`), the countdown, the run zip's text, the camera starting or failed, the hands-off line (ok when taken, bad when refused or failed).
- `runStatusText(s)`: the status of the run going, else empty.
- `handsOffResult(shoot, onError?)`: `taken`, `refused` (no picture) or `failed` (it threw; `onError` gets the error).
- `sameDrawing(prev, next)`: true when only the hands-off detector moved, in the same phase, text, shot and 1/50 of the meter; the page then draws nothing.

## Invariants and assumptions

- Pure functions of the state and their arguments; no DOM, no timers. The current shot is clamped into the plan's list, so a stored index outside it never throws.
- Busy wins over everything: while a run or a save goes, no button offers an action.
- Nothing is measured or packed after a shot: the photos go to the PC in Download all's zip.

## Example

```ts
const v = shutterView(store.getState());
button.textContent = v.text;
button.disabled = v.disabled;
```

## Tests

`cockpit-model.test.ts`: each state of the big button (camera first, the shot due and the countdown, busy, a failed light check, next and all done), Retake and Back (off while busy or counting), the tiles, the instruction line (setup and capture on L1, change and capture after), the progress, segments and Download all label, night on L3 and L4, the readouts, the status order and tones, the hands-off shot on L2 (button, status, meter, mode readout), `handsOffResult`, `sameDrawing`, and a property test that random plans and actions always give a shutter text, finite counts and a meter fill in 0..1.
