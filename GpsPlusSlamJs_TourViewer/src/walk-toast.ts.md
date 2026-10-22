# walk-toast.ts

## Purpose

The visitor's toast in AR: a thin wrapper over the framework's one toast
(`gps-plus-slam-app-framework/utils/toast-core`, its 6 s linger and its
polite live region) that says a news item once per AR entry and one
frame's words as one toast.

## Public API

- `createWalkToast(toast: Pick<Toast, "show" | "clear">, live?: { textContent }): WalkToast`
  - `say(events, news = [])` - one render's words, shown now as ONE
    toast, joined by a space: its `events` every time ("Skipped The
    well.", "Welcome back - your progress is kept.") and its `news`
    once this AR entry (re-derived every camera frame: "Tour placed by
    GPS (less exact)"); only news actually shown counts as said. Words
    said earlier in the same synchronous run stay in front (a word is
    shown once); a toast from an earlier run is replaced;
  - `announce(text)` - write a text no other region announces into
    `live` (absent: nothing); "" is never announced;
  - `reset()` - a new entry: forget what was said, take the toast down,
    empty `live`, end the current run's toast.
- "" is never said; nothing shows when nothing is left to say.

## Invariants & assumptions

- What was said lives in the closure, not the store: it is the dedup of a
  DOM resource (a re-shown toast restarts its timer and is announced
  again), not walk state any view reads.
- **One frame, one toast**: the framework's toast holds one message, and
  a second `show` replaces the first before it is read. So everything said
  in one synchronous run is joined, never shown one by one, across calls:
  two sources say in the same frame (`ar-entry.ts`'s status, its news,
  and `visitor-stations.ts`'s sheet, its events; the sheet's first render
  of an entry re-renders the status). Without the join the sheet's welcome
  back replaced the status's "placed by GPS" news, which already counted
  as said and so never came back that entry.
  - The run is closed by a microtask (`queueMicrotask`), so a say in a
    later task (the next frame) replaces the toast as before; `reset()`
    closes it at once.
  - The joined text is re-shown whole: the framework's `show` replaces
    the standing message and its deferred write, so only the full join is
    ever written.
- **`#walk-toast-root` is `aria-hidden="true"`**: the framework's toast
  is a polite live region, and every text it shows is announced already
  - the status's news by `#ar-status-live` (the whole sentence), a skip's
    note by `#station-line` (its lead), the welcome by the sheet's line.
    Without it a screen reader hears each item twice. The one text no
    other region says, the welcome back, goes to `#walk-live` (a visually
    hidden polite region beside the toast's root) by `announce(text)`;
    `reset()` empties it, so a later entry's welcome is announced again.
- `main.ts` creates the toast in `#walk-toast-root` with the class
  `walk-toast` (design.css's `.toast` class is not used);
  `ar-entry.ts` resets it at the session's end.

## Examples

```ts
const toast = createWalkToast(
  createToast(root, { className: "walk-toast", id: "walk-toast" }),
);
toast.say([], ["Tour placed by GPS (less exact)"]); // once this entry
toast.say(["Skipped The well."]); // every time
```

## Tests

- `walk-toast.test.ts` - once per entry and again after a reset; an
  event every time; never an empty text; one render's words as one toast;
  two says in one run joined (a word once), a new toast in the next task,
  a reset ending the run; the live region written by `announce` and
  emptied by `reset`.
- `playwright-tests/visitor-walk.spec.js` - coming back to a tour of
  stories placed by GPS: the toast carries both the placement and the
  welcome back.
