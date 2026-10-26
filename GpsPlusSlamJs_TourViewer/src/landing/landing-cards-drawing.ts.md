# landing/landing-cards-drawing.ts

## Purpose

The step cards' drawing, as markup strings: one drawn place (the mill, the
path, the trees, the noticeboard with its code) shown in every phone and
behind it, and the drawn phone each card's dock gets a copy of. Ported from
the maker's-story prototype (`public/prototypes/` on the gallery branches),
with every id, class and keyframe prefixed `lc-`.

## Public API

- `LC_DEFS` - the shared `<defs>` content (gradients, the scene `#lc-scene`,
  the poster `#lc-poster`, the old photo `#lc-millPhoto`, the code symbol
  `#lc-qrSym`, and empty groups the textures go into).
- `LC_PHONE` - one phone: the camera view (`.lc-world`, two layers: the
  place and the AR content), the AR content pinned to the place
  (`.lc-anc[data-wx][data-wy]`), the screen chrome and the sheets. The
  dock's `data-kind` (`place`, `add`, `hang`, `scan`) decides what it shows
  (`landing-cards.css`). The card title is split into letters
  (`.lc-ch`, `--lc-i` its place) so the CSS can type it.
- `seededRandom(seed)` - a xorshift generator in [0, 1).
- `fakeCodePath(seed?)` - a code-like pattern as one SVG path (21 by 21
  modules with three finder squares). It is not a readable code.
- `paintTextures(root, seed = 20261025)` - fills the texture groups (the
  canopies' leaves, the far trees, the facade's stones, the grass, the
  path's edge stones, the tufts) and the code's path, in the prototype's
  order from one seed, so the drawing is the same on every load.

## Invariants & assumptions

- Every `href="#..."` and `url(#...)` in `LC_PHONE` and `LC_DEFS` names an
  id drawn in `LC_DEFS`, each id once (tested).
- `paintTextures` fills each group once: a group that already has children
  is left alone, and a missing group is skipped.
- The strings are this package's own markup; `landing-cards.ts` writes
  them with `innerHTML`.

## Examples

```ts
defs.innerHTML = `<defs>${LC_DEFS}</defs>`;
paintTextures(defs);
template.innerHTML = LC_PHONE;
```

## Tests

- `landing-cards.test.ts` - id uniqueness and prefix, every reference
  resolved, every phone class prefixed; the mount draws a phone per dock.
