# mirror-marks.ts

## Purpose

The writer's mirror as runs: the body cut into stretches, each with the
looks the mirror under the text area gives it (a dimmed mark, a
heading's words, bold, italic, a link's words, a picture line, a part
shown as typed, a kept one, the one the callout is about). A light line
reader decides the looks only; which parts are shown as typed comes from
`typed-parts.ts`.

## Public API

- `MirrorLook` - `mk | hd | b | i | ln | pic | iss | kept | cur`; each is
  the class `m-<look>` (`long-text-editor.css`).
- `MirrorRun { from, to, looks, part }` - `part` is the index of the
  part shown as typed the run lies in, or -1.
- `mirrorRuns(body, parts, current = -1)`.

## Invariants & assumptions

- The runs cover the body in order, without gaps or overlaps, so the
  mirror's letters lie under the text area's own (property test).
- A code box's lines get no marks (they are shown as typed).
- The looks change colour only (the stylesheet), never the width of a
  letter, so the caret stays on its letter.

## Tests

- `mirror-marks.test.ts`.
