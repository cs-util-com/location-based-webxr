# maker.css

**Purpose:** the look of `characters.html`: the prototype's shared stylesheet and page styles, ported unchanged minus the prototype-only boxes, plus one rule that hides every step panel in the library view.

## Invariants

- The page does not load the app's design system, so nothing here competes with it; the class names follow the prototype so the side-by-side check stays like for like.

## Tests

Pinned by the layout test in `playwright-tests/character-maker.spec.js` and checked by eye against the prototype.
