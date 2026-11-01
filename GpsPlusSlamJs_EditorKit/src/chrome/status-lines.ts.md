# editor/status-lines.ts

## Purpose

Plain-text lines in a live region (`role="status"`, `aria-live="polite"`),
put back only when their words change (QR-first M1b-2 milestone review
#5). The desktop editor redraws its needs-no-GPS warnings on every
`refresh()` (each save, move, delete, restore); identical lines put in as
new nodes are announced again by a screen reader.

## Public API

- `createStatusLines(box, make): StatusLines`
  - `box` - anything with `replaceChildren(...nodes)` (`LinesBox<N>`; an
    element on the page, a plain object in the tests).
  - `make(text)` - one line's node (the page makes a `<p>` with
    `textContent`, never markup).
  - `show(lines): boolean` - shows `lines`; true when the region's nodes
    were replaced, false when the same lines (in the same order) were
    already shown, which leaves the nodes as they are.
- `LinesBox`, `StatusLines`.

## Invariants & assumptions

- The region starts empty: `show([])` before any lines is no change.
- Lines are compared one by one, never joined, so `["a\nb"]` and
  `["a", "b"]` differ.
- **The region is never hidden.** An empty region is zero-height (the
  page's CSS gives `.setting-warnings` no padding or border), and a region
  that goes from `hidden` to filled in one task is commonly not announced
  at all. The page therefore never sets `hidden` on it.
- Only this module writes the region's children; a change made around it
  would not be seen.

## Examples

```ts
const warnings = createStatusLines(box, (text) => {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
});
warnings.show(noGpsWarnings(check)); // replaced only when the words change
```

## Tests

`status-lines.test.ts` (a plain-object box): the same lines again leave the
nodes alone; changed words and an emptied region replace them; a line
split in two is a change; no lines at the start is no change. The page's
region is pinned by `playwright-tests/editor.spec.js` ("the needs-no-GPS
setting ...": never `hidden`, and the same warning node kept across a
save's refresh).
