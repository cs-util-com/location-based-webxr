# uses-height.ts

## Purpose

Keeps the use cases' mounted height, as this tab measured it, for the next
load of the page, so a reload that the browser scrolls back to the setup is
not pushed down when the use cases mount above it.

## Why

The wizard reloads the page mid-setup on purpose (after an AR session,
after the print dialog), and the browser restores the scroll position
before the use cases' chunk has arrived. The page's CSS reserves the
section's height (`index.html`, `.landing-uses` `min-height`), but that
reservation is a lower bound measured in one face. In a wider face the
section mounts taller, and the setup below it moved down by the
difference: 141 px at 390x844 in the CI's Linux face, against the 24 px
the e2e allows. A height this browser measured itself, at the same window
width, is exact in whatever face the page is set in.

## Public API

- `USES_HEIGHT_KEY`: `"tour-viewer.landing.uses-height"`, in session
  storage (this tab, across reloads; a new tab starts from the CSS bound).
- `encodeUsesHeight(width, height): string`: the stored form,
  `{"width":390,"height":2391.5}`.
- `keptUsesHeight(stored, width): number | null`: the height to reserve at
  window width `width`, or null for nothing stored, another width,
  unreadable JSON, a width or height that is not a number, or a height
  that is not above 0 and below 20 000 px.
- `keepUsesHeight(host, { storage, width }): () => void`: called by
  `landing-mount.ts` once the use cases mounted. Removes the inline
  `min-height` the page's script set (the mounted section now holds its
  own place), stores the host's border-box height at `width()`, and stores
  it again whenever the host resizes (a `ResizeObserver`, where there is
  one). Returns the unwatch. A height of 0 is not stored; storage that is
  null or throws stores nothing.

## Invariants

- The page's classic inline script `#landing-uses-height`, right after the
  use cases' host and before the setup stage (so before the first paint,
  which `#landing-skip` holds), applies the same rule as `keptUsesHeight`
  as the host's inline `min-height`. A classic script cannot import, so the
  rule exists twice; `uses-height.test.ts` runs the inline copy against
  generated stored values and holds it to `keptUsesHeight`.
- Keyed by `window.innerWidth`: a rotated phone or a resized window reads
  no kept height and falls back to the CSS bound.
- The inline reservation is dropped before the first measurement, so a
  kept height that is too large is never measured back as the section's
  own.

## Examples

```ts
const unkeep = keepUsesHeight(dom.uses, {
  storage: window.sessionStorage,
  width: () => window.innerWidth,
});
keptUsesHeight(sessionStorage.getItem(USES_HEIGHT_KEY), innerWidth); // 2391.5
```

## Tests

- `uses-height.test.ts`: the rule (same width, other width, malformed
  values, a round-trip property), the keeper (drops the inline reservation,
  stores the height, survives a throwing or missing storage), and the
  inline script held to the rule (a property over generated stored values,
  its place in the page).
- `playwright-tests/landing.spec.js`, "a returning device": the reload
  comes back to the stage within 24 px when the use cases arrive late, in
  the system face, the wide face and a wider one, also under reduced
  motion.
