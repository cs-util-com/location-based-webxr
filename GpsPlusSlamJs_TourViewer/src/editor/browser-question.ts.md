# browser-question.ts

- Purpose: the browser's own yes-or-no question (`window.confirm`) for
  the edit page's unsaved-work guards (File's Open and the 3D view's
  Reload, `edit-main.ts`), asked so the 3D views' frame clocks
  (`../editor3d/frame-clock.ts`) leave the wait for its answer untimed.
- Public API:
  - `FRAMES_STOPPED_EVENT` (`"framesstopped"`): the page's event that its
    frames stopped while it was shown; `pauseWhenHidden` pauses its clock
    on it.
  - `confirmPausingFrames(message, page = document, ask = window.confirm)`:
    asks, then dispatches the event on `page`; returns the answer.
- Invariants & assumptions:
  - The question blocks the page, so no frame is drawn between the ask
    and the event; the next frame after the answer starts the clock
    again, and a frame drawn later is timed as usual.
  - It lives in `src/editor/`, not beside the clock: the edit page loads
    none of `src/editor3d/` before its `import()` (`editor3d-lazy.test.ts`),
    and it asks before the 3D view may ever be loaded. With no clock
    listening the event goes nowhere.
- Example:
  ```ts
  if (unsavedWork() && !confirmPausingFrames("Open another tour anyway?")) {
    return;
  }
  ```
- Tests: `../editor3d/frame-clock.test.ts` ("does not time the wait for
  the browser's question": the answer passed through, the wait untimed,
  the next frame timed, no pause once the view stopped listening).
