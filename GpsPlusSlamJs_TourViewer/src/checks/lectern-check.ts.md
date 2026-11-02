# `lectern-check.ts` - the reading stand's check page

## Purpose

The code of `lectern-check.html` (`lectern-check.html.md`): one long text
on the production reading stand (`lectern-view.ts` `mountLectern`) in the
narrated-text prototype's square, seen from its 1.6 m eye 2.6 m in front,
so the stand can be compared side by side with the prototype and the
layout e2e can pin where the page lands. Its demo text is
`lectern-check-text.ts` (the prototype's record: its title and first two
paragraphs).

## Public API

- `startLecternCheck(host)` - builds the renderer, the scene and the
  stand under `host`, installs `window.__lecternCheck` and draws every
  frame until `stop()`.
- `lecternCheckFovDeg(width, height)` - the prototype's field of view: 50
  degrees of height in landscape (and for a size that is not positive),
  42 degrees across the width in portrait. It differs from the model
  views' check page (45 degrees) on purpose: each page copies its own
  prototype.
- The hook `window.__lecternCheck`: `show({ title?, body? })` (re-made
  from scratch; the default is the demo text), `turn()`, `standAt(x, z)`
  (throws on a non-finite number), `state()` (the sentence and the screen
  boxes of the page and the stand, null before a stand is shown),
  `stop()`.

## Invariants & assumptions

- The scene's numbers are the prototype's: background and fog `#dde4e8`
  (70-190 m), hemisphere light 2.3, sun 0.9 from (-20, 40, 25), the
  ground, a 40 m paved square and the guild house's front.
- A click on the page (a ray cast against the page plane) turns it; a
  click elsewhere does nothing.

## Tests

`lectern-check.test.ts` (the field of view);
`playwright-tests/lectern-check.spec.js` (the layout and the turn).
