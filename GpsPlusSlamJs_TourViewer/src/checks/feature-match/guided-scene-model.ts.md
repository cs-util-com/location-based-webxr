# guided-scene-model.ts

## Purpose

The guided view's screens as plain data, read from the page state only: the run screen (scene header, strip, step card, finder chips, the two buttons), each scene's measuring progress and the end view with the zip choice. Pure, so `guided-view.ts` only copies fields into the DOM and every rule is unit-tested without one.

## Public API

- `runView(state): RunView`: `mode` (`RunMode`), `scene`, `kicker` ("Scene 1 of 3", "Extra" for an own scene), `sceneName`, `rule` (`still` for the light scene, else `hand`) and `ruleText`, `card` (`CardView`: banner, code, title, "photo n of m", diagram, steps, note), `finder` (`still` chip, `ghost` label and base photo while a later shot is due, the `camera` line while it is not running, the `saved` chip), `primary` and `secondary` (label, sub line, disabled, look; the secondary's `act`).
- `runMode(state, context?)`: `counting` while a countdown runs, `capture` for a shot without a photo, `warn` after a failed light check, `retake` for a taken shot chosen again (or any taken current shot while another is open), else `allDone`.
- `stripView(state, browse)`: a tab per scene (`sceneShort` name, selected, current, measuring badge) and the thumbs of the browsed scene (else the current one): state `taken`, `open` or `skipped`, the `step` or `retake` mark, a failed light check, the photo drawn, an aria label; plus the hint beside a short scene ("Your photos appear here", then "Tap a photo to retake it").
- `endView(state)`: kicker ("3 of 13 photos taken"), title and lede by the measuring (nothing yet, the last pairs, stopped, everything measured), `eta`, one `EndRow` per scene (pair count, badge, a progress bar once the scene is complete, else which keys are not taken), `choice` (shown while pairs wait and measuring did not stop), `retry` (shown while a failure kept for this load exists), `download` (label, sub, disabled, the waiting share, tone `err` after a failure; while pairs still measure "Make the zip now" in tone `warn` saying how many results go in, a zip saved early `warn` with what it lacks, and "Download the full zip" once everything is measured), the zip `state` line (a zip saved early adds how many results it lacks), the `trust` line and the `missing` shots as buttons.
- `sceneProgress(state, sceneId, progress?)`: badge kind and text, measured share, time left, whether every shot is taken or skipped, ready and failed pairs, keys not taken.
- `etaText` ("about 25 s" under 50 s, rounded up to 5 s; else "about N min"; empty for none).

The scene names, the scene rule and the thumb state behind these views are module-private helpers.

## Invariants

- Reads only; no state of its own. The screen, the retake choice and the zip choice come from `state.guided`.
- The download is off while busy, in another tab and before any pair has both photos ("Needs two photos of one scene first").
- "Wait for the rest" turns the download into a progress bar only while pairs wait and measuring has not stopped; a stopped queue gives the button back.

## Example

```ts
const v = runView(store.getState());
primaryLabel.textContent = v.primary.label;
```

## Tests

`guided-scene-model.test.ts`: the run screen (L1 with the new-scene banner, L2 with Skip photo and the ghost, the camera lines, Cancel while counting, a retake of F1 naming what it redoes and going back, a failed light check, all done, the previous light check, the previous scene measuring in the background), the strip (tabs, browsing, light places), the scene progress from waiting to done or failed and a skipped scene, the end view (the choice, the download label per zip phase and red after a failure, a zip made while pairs still measure and the full zip after, measuring stopped with Retry failed, everything measured) and `etaText`.
