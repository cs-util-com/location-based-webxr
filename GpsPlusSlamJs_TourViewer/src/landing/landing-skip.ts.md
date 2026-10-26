# landing/landing-skip.ts

## Purpose

The rule that makes a returning device open at the setup instead of the
landing. The page applies it in a classic inline script, `#landing-skip`,
placed right after the stage's markup in `index.html`; this module is the
rule's tested statement, and `landing-skip.test.ts` runs the inline copy
against it.

## Public API

- `RETURNING_KEYS` - the two `localStorage` keys whose non-empty value makes
  a device a returning one: `tour-viewer.wizard.host` (the storage choice,
  `tour-host.ts`; a deselected tile stores "" and makes it a first visit
  again) and `tour-viewer.wizard.last-url` (the last link opened,
  `wizard.ts`).
- `skipsLanding({ mode, stored, hash, navigationType }): boolean` - true
  only for `mode === "creator"`, a non-empty stored value, an empty hash
  and the navigation type `"navigate"`.
- `reassertLandingSkip(document)` - scrolls `#setup-stage` to the top,
  instantly, while `<html data-landing-skip="applied">`.
- `holdLandingSkip(document, Observer = ResizeObserver)` - for a skipped
  page: puts the stage back now and on every resize of `#landing`,
  `#setup-stage`, `#setup-map` and `#setup-card`, until the mark reads
  `"moved"` (then it disconnects). `main.ts` calls it once at the end of
  its boot.

## Invariants & assumptions

- A reload, back/forward or a browser without a navigation entry never
  skips: the browser's own scroll restoration wins, and no entry reads as a
  first visit (the safe direction).
- A hash never skips: the browser goes to that place in the page.
- A visitor (`?qr`) never skips: the landing is not shown to a visitor.
- The skip is visual only: focus and screen readers start at the top.
- The inline copy scrolls `#setup-stage` with `{ block: "start", behavior:
"instant" }`. It runs before the rest of the page is parsed, so the stage
  carries `min-height: 100vh` (index.html) to make its top reachable; the
  stage's own parts are revealed later by `main.ts` and do not move its top.
  Content that changes later above or in the stage is handled by the hold
  below; the reserved heights keep it small.
- Site data blocked (the store throws): the inline copy catches it and opens
  at the top.
- **Why the hold, not scroll anchoring alone:** measured at 390x844 on the
  dev server, the browser's scroll anchoring followed the step card inside
  the stage when `main.ts` revealed the map above it, and left the stage
  218 px above the view; a caption that grew by a line when "Show again"
  appeared moved it 20 px more. The inline script therefore marks the page
  (`data-landing-skip="applied"`, and `"moved"` on the reader's first
  wheel, touch, key or pointer input), and `holdLandingSkip` keeps the stage
  at the top while the layout settles. Once the reader has moved the page,
  it is theirs: nothing scrolls it again. A drag of a desktop scrollbar may
  send no pointer event to the page (not checked); a resize during such a
  drag would put the stage back once.

## Examples

```ts
skipsLanding({
  mode: "creator",
  stored: [localStorage.getItem(RETURNING_KEYS[0]), null],
  hash: location.hash,
  navigationType: performance.getEntriesByType("navigation")[0]?.type,
});
```

## Tests

- `landing-skip.test.ts` - the rule's cases (first visit, deselected tile,
  reload, back/forward, hash, visitor), the inline script's place right
  after the stage, its instant scroll and its marks, blocked storage, a
  property that the inline copy agrees with `skipsLanding` on any input,
  and the re-assertion and the hold (a resize puts the stage back until
  the reader moved the page).
- `playwright-tests/landing.spec.js` - in a browser: the stage at the top
  after a load, after a reload (the browser's restoration), and with a hash;
  a first visit at the top.
