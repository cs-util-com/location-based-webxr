# film-dom.ts

## Purpose

The hero film's markup, built once per mount: the stage (the flat drawing,
the labels layer, the dashed line, the old photo, the drawn phone with all
its screen parts, the paused mark, the debug readout), the caption and the
captions list. All classes carry the `lf-` prefix.

## Public API

- `buildFilmDom(doc): FilmDom`: a detached `div.lf-film` and references to
  every part the film writes (`stage`, `floor`, `tags`, `leadLine`,
  `leadDot`, `polaroid`, `phone`, `screen`, `caption`, `captions`, `debug`,
  and `parts` with the phone's pieces and their anchors).
  - Throws when a part is missing (a template edit that broke a selector).

## Invariants

- A constant template: nothing from the page or the user goes into it.
- Each mount gets its own code symbol id (`lf-qr-<n>`), so two films on a
  page never share an id.
- The stage carries the flat drawing's label (`role="img"`); the phone,
  the photo and the labels are `aria-hidden`: the caption is the text.
- The found-tour chip on the phone's screen has two lines, the tour's name
  and "Opened in the browser"; it stays inside the screen and above the
  code's frame at every size (`landing-film.spec.js`, "the scanning part").
- The 3D canvas is not in the template: the scene inserts it after the
  flat drawing.

## Tests

`film-phone.test.ts` (the markup's parts and the per-mount ids) and
`landing-film.test.ts`.
