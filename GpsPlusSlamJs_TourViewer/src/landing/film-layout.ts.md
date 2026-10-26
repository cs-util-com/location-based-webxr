# film-layout.ts

## Purpose

Where the drawn phone sits in the film's picture, the free space left of it
that a close view is fitted into, where the old photo lies, and each view's
camera angles. Laid out against the film's own stage, not the window.

## Public API

- `filmLayout(w, h, viewportW): FilmLayout` (`{ W, H, portrait, phone, screen, free, polaroid }`).
- `closeRect(ly)`, `ndcRect(view, ly)`, `viewParams(view, ly)`.
- `PHONE_SHARE` (0.47 of the width on an upright phone).

## Invariants

- Pure; sizes below 1 px or non-finite read as 1.
- Upright (width / height under 1.05 and a window under 700 px): the phone
  is 0.47 of the width; elsewhere 0.4 of it, at most 290 px. Either way it
  keeps 52 px clear of the picture's soft top and bottom edge, so a short
  stage makes the phone narrower (and a screen under 158 px drops the small
  print, `film-phone.ts`).
- A close view fits at most 400 x 470 px, so a wide box shows more park,
  not a bigger one.

## Tests

`film-layout.test.ts`.
