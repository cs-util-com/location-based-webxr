# shell-pictures.ts

## Purpose

The 3D view's card pictures: a station card's picture (and the
inspector's thumbnail) is read from the tour only once it scrolls into
view, checked as the card's photo is, and kept as one object URL per
picture until the shell lets them all go.

## Public API

- `createShellPictures({ load })` -> `ShellPictures`:
  - `show(el, path)` - `el`'s background becomes the picture at `path`
    once `el` is within 120 px of the window (an `IntersectionObserver`;
    a card scrolled out of its dock is clipped by the dock, so it is out
    of view too); a picture that cannot be read or is too large to decode
    (`pictureProblem`) leaves `el` as it is;
  - `clear()` - stops watching and revokes every URL; a read that ends
    afterwards revokes its own URL at once.

## Invariants & assumptions

- One read per path while the shell shows, however often the tree is
  drawn again.
- Nothing outlives `clear`: the shell calls it on hide.

## Examples

```ts
const pictures = createShellPictures({ load: readContent });
pictures.show(hero, "content/knight.jpg");
// on hide
pictures.clear();
```

## Tests

No unit test (it needs a DOM and an `IntersectionObserver`); the cards'
drawing is exercised by `playwright-tests/editor3d-shell.spec.js`. Not
pinned: that a picture appears (the sample tour's stations carry none).
