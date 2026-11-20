# feature-match-check.ts

## Purpose

The page module of `feature-match-check.html`: the guided steps (photo A, photo B, run, save), the camera, the options, the results table, the result pictures and the copyable log. All measuring lives in `bench-run.ts`.

## Public API

- `startFeatureMatchCheck(root = document)`: wires the page. Throws `feature-match-check: missing <selector>` if the HTML lacks an element it needs.

## Invariants and assumptions

- This file only touches the DOM and browser APIs (`getUserMedia`, `performance`, `navigator.gpu`, `navigator.userAgentData`, the clipboard, canvas encoding); the step logic is `bench-steps.ts`, the drawing `bench-draw.ts`, the files `bench-export.ts`.
- **One action at a time.** A single `busy` state (`idle`, `running`, `saving`) drives every button: during a run or a save, Take photo A/B, Run again, Save and the synthetic run are disabled, so a capture cannot change the pair under a run or under an encode (which would offer old files as new ones). `refresh()` sets every disabled state, label and step mark from the state, so they cannot drift apart.
- **Steps.** Step marks come from `stepStates`: the first step whose work is missing is "current" (with `aria-current="step"`), earlier ones "done". Photo A starts a new pair (it clears B, the run and the offered files); photo B starts the run on the pair by itself. "Run again" re-runs the same pair. The synthetic run (under Options) never moves the steps.
- **Camera.** Rear camera (`facingMode: environment`), frames kept at most 1280 px on the long side. A capture tap with the camera off only starts it ("camera on: aim, then tap Take photo X"), so the photo is aimed rather than the first frame. The camera stops when any run starts and on `pagehide`. One start is in flight at a time. Every stop raises a generation counter; a start still waiting for its stream when a stop happens stops that stream and reports "camera stopped: tap again", so a run never measures beside a live camera. A refused camera shows "camera unavailable (see log)" and an `ERROR camera:` line.
- **Results.** As each method and size finishes, a figure is appended under Results: both frames side by side at one scale (canvas at most 640 device pixels wide), keypoints as dots, at most 200 match lines spread evenly over all matches, and a caption with the counts and median times. A failed size or method gets a red caption card instead. The table and report are written when the run ends.
- **Save.** Shows "preparing...", then encodes both frames as PNG through a canvas, checks them with `assertPlainPng`, and offers four links (both PNGs, `feature-match-frames.json`, `feature-match-matches.json`) with "4 files ready: tap each to save". On a failure every offered link is withdrawn (blob URLs revoked), the state reads "failed (see log)", an `ERROR save:` line is logged and Save is enabled again.
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

`playwright-tests/feature-match-check.spec.js`: stubbed SIFT on the synthetic pair (table, report, picture, phone width), a 404 for `sift.js`, the guided camera flow with a faked camera (auto run, buttons disabled while the run is held, grey values near 127.5, steps, four saved files checked), a failed save (in-progress state, buttons disabled while encoding, links withdrawn, error logged, button back), a refused camera, and a camera start overtaken by a run. The browser-only code has no unit test.
