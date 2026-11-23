# feature-match-check.ts

## Purpose

The entry of `feature-match-check.html`: it creates the page store (`feature-match-store.ts`, state in `feature-match-slice.ts`), the stamped log and `fail`, the page error listeners, the camera (`camera-control.ts`), the measuring block (`bench-engine.ts`) and the view, and subscribes their renders; a change that only moved the hands-off detector (`sameDrawing`) draws nothing. Taps and option changes dispatch actions; each part draws the state on every change. All measuring lives in `bench-run.ts`.

The page as a whole is described below, whichever module implements a rule:

- `camera-control.ts`: the camera start, stop and generation guard.
- `bench-engine.ts`: Options, Speed test, the synthetic run, results table, pictures, report, Copy log and log.
- `plan-io.ts`: what both views do with the run plan in the browser: the camera start, the countdown, the photo, Download all (one zip, a folder per ready pair) and the summary.
- `guided-view.ts`: the default view, one shot of the run at a time (intro, step card, viewfinder with countdown, shots sheet, end screen with Download all and the summary, and the measure sheet holding the measuring block). Its rules are in `guided-view.ts.md`.
- `cockpit-view.ts` (`?ui=cockpit`): the viewfinder and one fixed dock over the same run plan, the next shot coming up by itself, and a drawer with the shots, the guide, the results (the measuring block, the flat target) and the settings. Its rules are in `cockpit-view.ts.md`.

## Picking the view

An inline script in the page head reads `?ui`: `cockpit` sets `<html data-ui="cockpit">`, anything else `data-ui="guided"`. Each view's styles are scoped to its own `data-ui` (`guided-view.css`, `cockpit-view.css`); the flat target rules are a style of their own (`flat-style`), on in both views. The entry reads `data-ui` and starts the camera on that view's video and that view; the other view's markup stays hidden. Both views walk the one run plan in the store, so switching views keeps the shots taken.

## Public API

- `startFeatureMatchCheck(root = document)`: wires the page. Throws `feature-match-check: missing <selector>` if the HTML lacks an element it needs.

## Invariants and assumptions

- This file only touches the DOM and browser APIs (`getUserMedia`, `performance`, `navigator.gpu`, `navigator.userAgentData`, the clipboard, canvas encoding, `navigator.locks`, page visibility); the drawing is `bench-draw.ts`, the files `bench-export.ts` and `run-zip.ts`.
- **One action at a time.** A single `busy` state (`idle`, `running`, `saving`) drives every button: during a run or a save the photo, run and save buttons are disabled, so a photo cannot change the pair under a run or under an encode.
- **Camera.** Rear camera (`facingMode: environment`), frames kept at most 1280 px on the long side. A capture tap with the camera off only starts it, so the photo is aimed rather than the first frame. The camera stops when any run starts and on `pagehide`. One start is in flight at a time; it is forgotten once it settles, also when it failed before awaiting anything (no camera API at all), so the next tap tries again and logs again. Every stop raises a generation counter; a start still waiting for its stream when a stop happens stops that stream, so a run never measures beside a live camera. A refused camera is an `ERROR camera:` line, and the view offers a retry.
- **Results.** As each method and size finishes, a figure is appended under Results: both frames side by side at one scale (canvas at most 640 device pixels wide), keypoints as dots, at most 200 match lines spread evenly over all matches, and a caption with the counts of the round drawn ("last round: keypoints A n, B n | matches n") and the median times; the table and report show the lower median over all rounds, which may differ for a method whose output varies. A failed size or method gets a red caption card instead. The table and report are written when the run ends.
- **Options check.** A ticked method left with no backend (or XFeat with no model file) is refused before the run with an `ERROR options:` line naming it (`selectionGaps`), rather than dropped without a word.
- **Scenes, shots and pairs.** The run is a list of scenes of shots (`scenes.ts`); the pairs are derived from the shots, never photographed as pairs. Download all puts each shot's photo in once and a frames JSON per ready pair naming its shot files, its legacy protocol key, the takes and the page load's `sessionToken`. The layout is in `run-zip.ts.md`.
- **Progress across reloads.** The run plan, its photos, the measured results and the log are kept (`feature-match-store.ts.md`), so a reload or a discarded tab continues where it was; the log is written a second after a line and at once on `pagehide` or when the page is hidden (`flushLog`). A stored plan of the earlier pair-slot version is dropped and logged (`stored plan of version 1 discarded`). Reads and writes are in try/catch: with storage blocked the run lasts as long as the page, and the random session token (4 bytes, no time, no place) tells such runs apart.
- **Synthetic run settings.** The synthetic run uses the Options (`runSettings` with no protocol pair). Nothing is measured on the run's photos on the phone; the protocol pair settings of `runSettings` (1 run, no warm-up, one backend, the fp16 XFeat file) wait for the on-phone measuring of a later version.
- **Light check.** At each light shot (L2-L4) its grey mean goes through `lightOf` against L1 (L4 also against L3), and the result is logged (`light check <shot>: ...`). A failed check keeps the shot current for the retake, is named in the view (the cockpit's instruction line, the guided review note) and goes into the pair's frames JSON as `lightCheck`.
- **Copy log** carries a note that the photo tests do not need it (the zip holds the log); it is for pasting a quick timing run into a chat.
- Device facts that cannot be read fall back to `UNKNOWN_DEVICE` with a log line; they never stop a run.
- Every failure (camera refused, nothing ticked, a method that fails, a page error, an unhandled rejection) becomes an `ERROR ...` log line and goes into the report; buttons come back through `runFinished` and `runZipEnded`, which every run and save path ends in.
- Resource timing's buffer is raised to 1000 entries so a long run keeps the download sizes.
- **State in the store.** The run plan (shots, takes, the settings), one action at a time, the run and save status, the status lines, table, report, log and errors, and the options all live in the slice; its reducers hold the rules. The options are mirrored from the controls on every `input`/`change` and read from the state at run time. Log lines are stamped with the page time here and stored finished.
- **Outside the store**, as browser resources: the camera stream, its start in flight and its generation counter, the result pictures (canvases drawn during a run), and, in the store's side tables keyed by the ids the state holds, the photos' PNGs until stored, their previews and the prepared flat zip's Blob URL. A side table entry goes in through the store's `put`, in the same step as the action that names it, since the store drops every entry the state does not name; a run or save starts only when `accepted(...)` says the reducer took its start action, so a second tap is never mistaken for the first.
- **Run plan photos.** The store gets the IndexedDB `PHOTO_DB` store (`indexedDbKeyValueStore`, null where IndexedDB is missing), `previewOf` (the stored PNG decoded by `blobFrame` and shrunk by `previewFrame`) and the tab lock (`holdTabLock(navigator.locks)`); `restore()` runs once at start, after the first render, and ends in `restoreFinished`, so the view is drawn again. A tab that does not get the lock logs `another tab holds this test: this one takes no photo`. A database failure is an `ERROR photo storage:` line.
- **Drawn only when moved:** the table, report and log are written only when their part of the state changed.
- **Speed test.** A `Speed test` section times the XFeat fp16 reference, DINOv2-S/14 (int8, q4f16) and SIFT + LightGlue, per ticked backend, on one pair at the chosen long edge (480/640/960) and SIFT cap (512/1024), N runs (`parseTimingRuns`, default 10). It uses the flat scene's F1 and F2 when both are taken (restored after a reload, so in either view), else the synthetic pair, and stops the camera. `runTimingByGroup` (`bench-timing.ts`) runs each backend group alone, one after another, and interleaves its arms in a balanced order per round. While it runs, `guardRun` (`run-guard.ts`) holds the screen wake lock (taken again when the page comes back) and records a hidden page: the report then carries `ERROR page was hidden during runs`; the report (`formatTimingReport`, download size and time, start-up, first run, steady median and p90, the backend, the ratio to the group's reference) goes into the Report box and so into Copy log. The button reads "Timing..." and every button is off while it runs (`busy` = `running`); the state reads "done: N arms" with the count of arms that failed, or "not run: nothing ticked". An arm that fails to load is an `ERROR load:` line in its section, never a stopped test. `#m-siftlg` adds SIFT + LightGlue to the normal benchmark (unticked by default: 46 MB).
- **Flat target mode.** Opened from either view ("Flat targets" in the guided measure sheet, "Flat target capture" in the cockpit's Results tab): it stops the page camera and opens `flat-capture.ts` full screen; Exit closes it and draws the view again. The canvas helpers live in `bench-dom.ts`.

## Example

```html
<script type="module">
  import { startFeatureMatchCheck } from "./src/checks/feature-match/feature-match-check.ts";
  startFeatureMatchCheck(document);
</script>
```

## Tests

`playwright-tests/feature-match-check.spec.js`: stubbed SIFT on the synthetic pair (table, report, picture, phone width), a 404 for `sift.js`, the cockpit flows listed in `cockpit-view.ts.md` and the guided flows listed in `guided-view.ts.md`, a refused camera, a camera start overtaken by a run, a camera start that fails at once and is retried, the light check (the fake camera dims with `window.__dim` for L2 and L3), the speed test reporting an arm that cannot load and refusing to run with nothing ticked, and a flat target surface captured end to end (`flat-capture.ts.md` has the list). The browser-only code has no unit test.
