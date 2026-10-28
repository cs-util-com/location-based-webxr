# film-bar.ts

## Purpose

The film's segmented progress bar as data: one segment per part (seen,
current or upcoming, with its fill), the play/pause button's kind and
name, the caption to show, and whether the captions show as a list.

## Public API

- `barModel(snap: PlayerSnapshot, titles, captions): BarModel`
  - Throws `RangeError` without one title and one caption per part.
- `BarModel`: `segments` (`{ index, look, fill, label, current }`),
  `finished`, `paused`, `button` (`{ kind: "pause" | "play" | "again", label }`),
  `caption`, `captionsAsList`.

## Invariants

- The current part stays "current" while paused (drawn red with a pause
  mark), so a tap never makes it look like an upcoming one.
- Finished: every segment seen, none `current`, the button "Play again".
  Reduced motion's opening still is finished but says "Play the film".
- Labels read "Part 3 of 8: A story you know".
- `fill` is the current part's progress through its whole segment, in [0, 1].

## Tests

`film-bar.test.ts`.
