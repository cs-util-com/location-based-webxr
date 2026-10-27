# film-bar-view.ts

## Purpose

Draws the bar model (`film-bar.ts`) as real buttons: the play/pause button
and one button per part in an ordered list, the film's only keyboard
control.

## Public API

- `createFilmBarView(doc, { titles, weights, onJump, onToggle }): { element, update(model) }`
  - `weights`: each part's length on the timeline (the segment widths).
  - Throws `RangeError` when the weights do not match the titles.

## Markup

- `div.lf-controls` (`role="group"`, `aria-label="The film's parts"`)
  - `button.lf-play` (`data-kind`, `aria-label`, an icon, `span.lf-play-text`
    shown when finished)
  - `ol.lf-segs > li > button.lf-seg.lf-seg-{seen|current|upcoming}`
    (`aria-label`, `aria-current="step"` on the current one)
    `> span.lf-seg-track > span.lf-seg-fill` (fill through `--lf-fill`).

## Invariants

- Writes only what changed (classes, fill, labels, `aria-current`).
- The fill is a custom property, so the paused rule in the stylesheet wins
  over it.
- A segment's hit area is 24 px tall whatever the visible bar height.

## Tests

`film-bar-view.test.ts` (jsdom).
