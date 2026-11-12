# shell-pictures.ts

## Purpose

The 3D view's card pictures: an unfolded station card's picture (and the
inspector's thumbnail) is read from the tour only once it scrolls into
view, checked as the card's photo is, and kept as one object URL per
picture until the shell lets them all go.

## Public API

- `createShellPictures({ load, owns? })` -> `ShellPictures`:
  - `owns(el)` says whether a panel still holds `el` (default: `el` is
    in the page). The shell passes "inside the list or the details", so a
    card drawn into a docked panel behind another tab (out of the page)
    keeps waiting for its picture, which comes once the panel shows;
  - `show(el, path)` - `el`'s background becomes the picture at `path`
    once `el` is within 120 px of the window (an `IntersectionObserver`;
    a card scrolled out of its dock is clipped by the dock, so it is out
    of view too); a picture that cannot be read or is too large to decode
    (`pictureProblem`) leaves `el` as it is;
  - a read that FAILS (the load rejects) is not remembered: it is tried
    again after 1.5 s while a panel still holds `el` and it still wants
    that path, three tries in all per path; a card seen later reads it
    again while tries are left. After the third failure the path counts
    as unshowable until `clear`. A picture with a problem is final at
    once: its bytes would not decode the next time either;
  - a picture read before is set at once on a new element (a redrawn
    card), with no second read and no wait for the observer, so a redraw
    does not flicker;
  - `sweep()` - stops watching every element no panel holds (the
    shell calls it on each draw, so the cards a redraw replaced are not
    kept alive by the observer);
  - `clear()` - stops watching and revokes every URL; a read that ends
    afterwards revokes its own URL at once.

## Invariants & assumptions

- One read per path while the shell shows, however often the tree is
  drawn again; one object URL per path, kept until `clear`.
- The observer watches only elements still on the page after a
  `sweep`.
- Nothing outlives `clear`: the shell calls it on hide. A try waiting
  when `clear` runs does nothing, and the failure counts start again.
- At most three reads per path between two `clear`s, whatever the
  number of cards or redraws: a missing file is not read over and over.

## Examples

```ts
const pictures = createShellPictures({ load: readContent });
pictures.show(pic, "content/knight.jpg");
// on hide
pictures.clear();
```

## Tests

`shell-pictures.test.ts` (jsdom, a fake `IntersectionObserver`, a
1x1 PNG): read only once in view and shown; a redrawn card shown at once
from the earlier read, the replaced cards no longer watched after a
sweep; a picture that cannot be read left as its placeholder; a failed
read tried again and shown, given up after three tries, read again on a
redrawn card, not tried for a card that left or after `clear`, and a
picture with a problem read once (fake `setTimeout`); and
`clear` letting every URL go, a late read too. The cards' drawing by
`playwright-tests/editor3d-shell.spec.js` (the sample tour's stations
carry no picture).
