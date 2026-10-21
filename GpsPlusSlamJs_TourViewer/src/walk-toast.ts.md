# walk-toast.ts

## Purpose

The visitor's toast in AR (visitor walk W4 build plan
`GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md`,
M2, §1.4): a thin wrapper over the framework's one toast
(`gps-plus-slam-app-framework/utils/toast-core`, its 6 s linger and its
polite live region) that says a news item once per AR entry and one
render's words as one toast.

## Public API

- `createWalkToast(toast: Pick<Toast, "show" | "clear">, live?: { textContent }): WalkToast`
  - `say(events, news = [])` - one render's words, shown now as ONE
    toast, joined by a space: its `events` every time ("Skipped The
    well.", "Welcome back - your progress is kept.") and its `news`
    once this AR entry (re-derived every camera frame: "Tour placed by
    GPS (less exact)"); only news actually shown counts as said;
  - `announce(text)` - write a text no other region announces into
    `live` (absent: nothing); "" is never announced;
  - `reset()` - a new entry: forget what was said, take the toast down,
    empty `live`.
- "" is never said; nothing shows when nothing is left to say.

## Invariants & assumptions

- What was said lives in the closure, not the store: it is the dedup of a
  DOM resource (a re-shown toast restarts its timer and is announced
  again), not walk state any view reads.
- **One render, one toast** (W4 build plan M2 review): the framework's
  toast holds one message, and a second `show` replaces the first before
  it is read. So a render's words are joined, never shown one by one.
  Two renders from different sources in one frame (`ar-entry.ts`'s status
  and `visitor-stations.ts`'s sheet) can still replace each other; each
  source joins only its own words.
- **`#walk-toast-root` is `aria-hidden="true"`**: the framework's toast
  is a polite live region, and every text it shows is announced already
  - the status's news by `#ar-status-live` (the whole sentence), a skip's
    note by `#station-line` (its lead), the welcome by the sheet's line.
    Without it a screen reader hears each item twice. The one text no
    other region says, the welcome back, goes to `#walk-live` (a visually
    hidden polite region beside the toast's root) by `announce(text)`;
    `reset()` empties it, so a later entry's welcome is announced again.
- `main.ts` creates the toast in `#walk-toast-root` with the class
  `walk-toast` (design.css's `.toast` class is not used, plan §1.2);
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
  the live region written by `announce` and emptied by `reset`.
