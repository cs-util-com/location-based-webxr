# feature-match-check.ts

## Purpose

The page module of `feature-match-check.html`: the guided steps (photo A, photo B, run, save), the camera, the options, the results table, the result pictures and the copyable log. All measuring lives in `bench-run.ts`.

## Public API

- `startFeatureMatchCheck(root = document)`: wires the page. Throws `feature-match-check: missing <selector>` if the HTML lacks an element it needs.

## Invariants and assumptions

- This file only touches the DOM and browser APIs (`getUserMedia`, `performance`, `navigator.gpu`, `navigator.userAgentData`, the clipboard, canvas encoding); the step logic is `bench-steps.ts`, the drawing `bench-draw.ts`, the files `bench-export.ts`.
- **One action at a time.** A single `busy` state (`idle`, `running`, `saving`) drives every button: during a run or a save, Take photo A/B, Run again, Save and the synthetic run are disabled, so a capture cannot change the pair under a run or under an encode (which would offer old files as new ones). `refresh()` sets every disabled state, label and step mark from the state, so they cannot drift apart.
- **Steps.** Step marks come from `stepStates`: the first step whose work is missing is "current" (with `aria-current="step"`), earlier ones "done". Photo A starts a new pair (it clears B, the run and the offered files); photo B starts the run on the pair by itself. "Run again" re-runs the same pair. The synthetic run (under Options) replaces what Results shows, so it also withdraws the camera run: its results and offered files are dropped, the run step is current again and reads "replaced by the synthetic run: tap Run again", and Save stays off until the camera pair runs again. With no camera run it moves no step.
- **Camera.** Rear camera (`facingMode: environment`), frames kept at most 1280 px on the long side. A capture tap with the camera off only starts it ("camera on: aim, then tap Take photo X"), so the photo is aimed rather than the first frame. The camera stops when any run starts and on `pagehide`. One start is in flight at a time; it is forgotten once it settles, also when it failed before awaiting anything (no camera API at all), so the next tap tries again and logs again. Every stop raises a generation counter; a start still waiting for its stream when a stop happens stops that stream and reports "camera stopped: tap again", so a run never measures beside a live camera. A refused camera shows "camera unavailable (see log)" and an `ERROR camera:` line.
- **Results.** As each method and size finishes, a figure is appended under Results: both frames side by side at one scale (canvas at most 640 device pixels wide), keypoints as dots, at most 200 match lines spread evenly over all matches, and a caption with the counts of the round drawn ("last round: keypoints A n, B n | matches n") and the median times; the table and report show the lower median over all rounds, which may differ for a method whose output varies. A failed size or method gets a red caption card instead. The table and report are written when the run ends.
- **Options check.** A ticked method left with no backend (or XFeat with no model file) is refused before the run with an `ERROR options:` line naming it (`selectionGaps`), rather than dropped without a word.
- **Pair names.** Step 1 holds a Pair selector (the `PAIRS` list) and a Spot field (1-3). Photo A raises the page session's running number and fixes the pair from both (`pairTag`), shown as "now: pair N, <key> <label>, spot S" and logged; changing the selector afterwards does not relabel the pair in progress. Save offers every file under `pairFileNames` of that pair (the zip's entries keep the fixed `FRAME_FILES` names) and writes the pair into the frames JSON. The first tap of Download all for a pair moves the selector and spot on with `nextPair` (from the pair in progress, not from the selector's current value) and logs "next pair: ..."; a second tap saves again and moves nothing.
- **Save after a run.** Save is enabled once the camera run has ended, whatever it came to. After a run with results it reads "ready: tap to prepare the files"; after a run that measured nothing (refused options, nothing ticked, a run that threw) it reads "nothing measured: tap to save the photos anyway", and the matches JSON then lists no methods.
- **Save.** Shows "preparing...", then encodes both frames as PNG through a canvas, checks them with `assertPlainPng`, packs them with the log and the report (`allFilesZip`, the log as it reads when Save is tapped) and offers five links, "Download all (zip)" first, then both PNGs, `feature-match-frames.json` and `feature-match-matches.json`, with "ready: tap Download all (zip), or each file". On a failure every offered link is withdrawn (blob URLs revoked), the state reads "failed (see log)", an `ERROR save:` line is logged and Save is enabled again.
- Device facts that cannot be read fall back to `UNKNOWN_DEVICE` with a log line; they never stop a run.
- Every failure (camera refused, nothing ticked, a method that fails, a page error, an unhandled rejection) becomes an `ERROR ...` log line and goes into the report; buttons come back in a `finally`.
- Resource timing's buffer is raised to 1000 entries so a long run keeps the download sizes.
- No app state in a store: the page is a standalone measurement tool with one transient run at a time; its captures, offered blob URLs, stream and generation counter are imperative resources local to the page's closure.

## Example

```html
<script type="module">
  import { startFeatureMatchCheck } from "./src/checks/feature-match/feature-match-check.ts";
  startFeatureMatchCheck(document);
</script>
```

## Tests

`playwright-tests/feature-match-check.spec.js`: stubbed SIFT on the synthetic pair (table, report, picture, phone width), a 404 for `sift.js`, the guided camera flow with a faked camera (auto run, buttons disabled while the run is held, grey values near 127.5, steps, the zip and the four saved files checked, the pair picked before A fixed while the selector is changed between A and B, every name carrying it, the frames JSON's pair fields and the selector moved on after Download all), a failed save (in-progress state, buttons disabled while encoding, links withdrawn, error logged, button back), a refused camera, a camera start overtaken by a run, a run that measured nothing (options gap and a run that throws, with the save label for both), a camera start that fails at once and is retried, and a synthetic run that withdraws the camera run's files. The guided flow also runs size 480 on the 320x240 camera, so a saved keypoint is checked through a mapping that is not the identity. The browser-only code has no unit test.
