# truncated.ts

## Purpose

Keeps a quoted piece of the creator's text short in the editor's notes: cut at `n` characters, ending in "...". One copy for the package (root `CLAUDE.md`, a one-liner once per package); the long-text writer's link note and the Narration section's lists both use it.

## Public API

- `truncated(s, n)` - `s` unchanged when `s.length <= n`; otherwise `s.slice(0, n - 3)` with trailing space removed, then `...`. Counts UTF-16 code units, like the rest of the editor's offsets. A negative or tiny `n` gives just `...`.

## Invariants

- Pure; never throws. The result is at most `n` characters long for `n >= 3`.

## Examples

- `truncated("the old bridge", 40)` gives `the old bridge`.
- `truncated("Welcome to the old bridge", 12)` gives `Welcome t...`.

## Tests

- `truncated.test.ts`.
