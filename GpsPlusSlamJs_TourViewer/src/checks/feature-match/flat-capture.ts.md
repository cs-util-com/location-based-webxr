# flat-capture.ts

## Purpose

The DOM side of the flat target capture mode of `feature-match-check.html`: a full-screen overlay (`#flat`) for capturing flat surfaces (pictures, text, low-texture) as matcher test data. Per surface a head-on reference with four corner taps and a straightened check, then query photos per pose at falling light, and one zip per surface. The rules are in `flat-target.ts` and `flat-progress.ts`.

## Public API

- `startFlatCapture(root, deps): { open(), close() }`. `deps`: `session` (the page load's token), `log`, `fail`, `pageLog()` (packed into each zip) and `onExit()` (called after Exit, with the mode closed). Throws `flat-capture: missing <selector>` if the HTML lacks an element.
- Constants (not exported): `FLAT_CAPTURE_MAX` (1024 px long edge) and `COUNTDOWN_S` (3).

## Invariants and assumptions

- **Phases** follow from the state: overview (no surface selected), ref-live (no reference photo yet), corners, check (four good taps, straightened preview shown), poses (reference accepted).
- **Countdown.** Every photo is taken `COUNTDOWN_S` after the tap so the phone is still again; a second tap cancels. During a countdown or a save the pose buttons, Overview, Retake last and Download are disabled.
- **Corners.** Taps on the photo map to image pixels through the letterbox (`toImagePoint`); the hint names the next corner; a bad set of four names the problem; Redo starts over; Use this reference stores taps, sizes and both photos.
- **Light.** The reading of a pose is the grey mean (`greyStats`) of its guide frame region. Every 500 ms a 256 px frame is read live: before the full-light shot it shows the grey value (and "too dark"), afterwards the ratio and bin, marking that bin chip `data-live`. A too-dark full-light shot is refused with a message.
- **Memory only.** Photos live in a `Map` in this closure until downloaded; nothing is uploaded. Only the progress goes to `localStorage` (try/catch; with storage blocked it lasts as long as the page). After a reload only downloaded captures remain in the progress (`afterReload`).
- **Download** is one tap, one zip (`allFilesZip`): the reference, its straightened copy, every query photo still in memory, the attached original, the surface JSON and the page log. It shows "Preparing zip..." and then the file and photo count; on failure it logs, says "nothing was marked downloaded" and marks nothing.
- **Camera.** Rear camera via `getUserMedia`; the page's own camera is stopped while the mode is open. A generation counter stops a stream that arrives after a stop. The camera stops on Overview, Exit and `pagehide`.
- State is kept in this closure plus the pure reducer, as the page's other code does; the page has no store.

## Example

```ts
const flat = startFlatCapture(document, {
  session,
  log,
  fail,
  pageLog: () => logText,
  onExit,
});
flat.open();
```

## Tests

`playwright-tests/feature-match-check.spec.js`, "captures a flat target surface end to end": faked camera, countdown and cancel, corners with a redo, the check, a full-light and a dimmed shot with their bins (live and stored), the zip's entries and JSON, the progress after a reload, every visible button on screen at 412x915, 880x790 and 790x880 in every phase, and Exit back to the photo pairs. The rules are unit-tested in `flat-target.test.ts` and `flat-progress.test.ts`.
