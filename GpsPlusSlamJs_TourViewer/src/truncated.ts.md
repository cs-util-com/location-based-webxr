# truncated.ts

## Purpose

Keeps a piece of the creator's text short where a line has room for only so much: cut at `n` characters, ending in "…". One copy for the package (root `CLAUDE.md`, a one-liner once per package). It lives at `src/` rather than `src/editor/` because the viewer's own modules use it too (the dependency rules keep them from importing the editor): the long-text writer's link note and the Narration section's lists, the creator's panel label for a tour file (`archive-open.ts`), the tour's short name (`tour-session.ts`), the map's "off the map view" chip (`editor/editor-card.ts`), the undo and re-seat notes (`editor/editor-session.ts`, `editor/reseat-note.ts`) and the 3D editor's station marks (`editor3d/editor3d-marks.ts`).

## Public API

- `truncated(s, n)` - `s` unchanged when it has at most `n` code points; otherwise its first `n - 1` code points with trailing space removed, then `…`. Counting code points, never UTF-16 code units, keeps an emoji (a surrogate pair) whole. An `n` below 1 gives just `…`.

## Invariants

- Pure; never throws. The result is at most `n` code points long for `n >= 1`.
- `n` counts the ellipsis: a caller that wants "at most 24 characters, then the ellipsis" passes 25.

## Examples

- `truncated("the old bridge", 40)` gives `the old bridge`.
- `truncated("Welcome to the old bridge", 12)` gives `Welcome to…`.
- `truncated("🌉🌉🌉 bridge", 3)` gives `🌉🌉…`.

## Tests

- `truncated.test.ts`: the cut, the split-safe cut, and a property over any text (never longer than asked, never a lone surrogate the input did not have).
