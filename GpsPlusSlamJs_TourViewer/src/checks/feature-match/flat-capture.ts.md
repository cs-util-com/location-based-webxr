# flat-capture.ts

## Purpose

The DOM side of the flat target capture mode of `feature-match-check.html`: a full-screen overlay (`#flat`) for capturing flat surfaces (pictures, text, low-texture) as matcher test data. Per surface a head-on reference with four corner taps and a straightened check, then query photos per pose at falling light, and one zip per surface. It is a view on the page store: its state is the slice's `flat` part (`feature-match-slice.ts`), its photos the store's side tables (`feature-match-store.ts`). The rules are in the slice, `flat-target.ts` and `flat-progress.ts`.

## Public API

- `startFlatCapture(root, deps): { open(), close() }`. `deps`: `store` (the page store; its session token goes into every surface JSON and its log into each zip), `log`, `fail` and `onExit()` (called after Exit, with the mode closed). Throws `flat-capture: missing <selector>` if the HTML lacks an element.
- Constants (not exported): `FLAT_CAPTURE_MAX` (1024 px long edge) and `COUNTDOWN_S` (3).

## Invariants and assumptions

- **Phases** follow from the state: overview (no surface selected), ref-live (no reference photo yet), corners, check (four good taps, straightened preview shown), poses (reference accepted).
- **Countdown.** Every photo is taken `COUNTDOWN_S` after the tap so the phone is still again; a second tap cancels. During a countdown or a save the pose buttons, Overview, Retake last and Download are disabled.
- **Corners.** Taps on the photo map to image pixels through the letterbox (`toImagePoint`); the hint names the next corner; a bad set of four names the problem; Redo starts over; Use this reference stores taps, sizes and both photos.
- **Light.** The reading of a pose is the grey mean (`greyStats`) of its guide frame region. Every 500 ms a 256 px frame is read live: before the full-light shot it shows the grey value (and "too dark"), afterwards the ratio and bin, marking that bin chip `data-live`. A too-dark full-light shot is refused with a message.
- **Memory only.** Photos live in the store's side tables (`flatFrames` for the reference being marked, `flatPhotos` per surface) until downloaded; nothing is uploaded. Starting or opening a surface frees (a store listener) the photos of every other surface with nothing left to download (a later zip of it lists the earlier photos with a null file and the camera size as null, as after a reload). An attached original counts as not downloaded until a zip of its surface was saved (`unsavedCount`), so it is neither freed nor left without a warning. While any surface has captures not yet downloaded, or a reference is being marked, `beforeunload` asks before the page is left. Only the progress goes to `localStorage` (try/catch; with storage blocked it lasts as long as the page). After a reload only downloaded captures remain in the progress (`afterReload`).
- **Download** prepares one zip (`allFilesZip`): the reference, its straightened copy, every query photo still in memory, the attached original, the surface JSON and the page log. It shows "Preparing zip...", then a Save link (`#flat-save-link`), as the photo pairs do: a download started from script after an await can be blocked, and only the tap on the link marks the captures downloaded. A shot added or removed after the zip was made, or leaving the poses, drops the link (and its object URL). On failure it logs, shows the error and "nothing was marked downloaded", and marks nothing.
- **Camera.** Rear camera via `getUserMedia`; the page's own camera is stopped while the mode is open. A generation counter stops a stream that arrives after a stop. The camera stops on Overview, Exit and `pagehide`. A photo is refused while the video track is not `live` or is muted (an ended track still shows its last frame). When the page becomes visible again with an ended track, the camera is restarted. A failure to start shows its error text.
- **Screen on.** A screen wake lock is requested on open and again whenever the page becomes visible (the browser drops it when hidden), and released on close; a refusal is logged, never fatal.
- **Back-forward cache.** `pagehide` closes the mode; a `pageshow` restore from the cache reopens it, since the pair selector still reads flat.
- **Labels.** The shoot button names the pose (`Darker shot, 40 % 0 deg (3 s)`). The class suggested for the next surface (the one furthest from its plan) never overwrites a class the user picked, until that surface is started.
- **State in the store, resources here.** Open, the phase's inputs (the reference being marked, taps, preview), the pose, the countdown, saving, the picked class, the prepared zip and the status line are store state; the camera stream, its generation counter, the countdown and live-reading timers and the wake lock stay in this closure. The view re-renders only when the `flat` part of the state changed, so the page's log lines never replace a button under a finger. Every side table entry goes in through the store's `put` (set and the action naming it in one step); the shot photos are the one exception, set right after `flatShotTaken` because their key exists only once the reducer placed the shot. The zip starts only when `accepted(flatSavingStarted())` says the reducer took it.

## Example

```ts
const flat = startFlatCapture(document, {
  store: fm, // createFeatureMatchStore(...)
  log,
  fail,
  onExit,
});
flat.open();
```

## Tests

`playwright-tests/feature-match-check.spec.js`, "captures a flat target surface end to end": faked camera, countdown and cancel, corners with a redo, the check, a full-light and a dimmed shot with their bins (live and stored), the zip's entries and JSON, the progress after a reload, the prepare-then-Save link with the session in the zip and JSON names, the capture source and camera size in the JSON, every visible button and link on screen at 412x915, 880x790, 790x880, 830x600 and 750x700 in every phase, and Exit back to the photo pairs. "keeps the photos when the zip fails, and attaches the original": a PNG encoder returning null gives the error, marks nothing and leaves the button ready, and a picked original file reaches the zip. The rules are unit-tested in `flat-target.test.ts`, `flat-progress.test.ts` and, for the flat steps in the store, `feature-match-slice.test.ts`.
