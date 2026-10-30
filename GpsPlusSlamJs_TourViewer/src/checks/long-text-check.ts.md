# `long-text-check.ts` - the reading sheet's check page

## Purpose

The code of `long-text-check.html` (`long-text-check.html.md`): one long
text open in the production reading sheet (`long-text-sheet.ts`), with no
AR session, so the sheet can be compared side by side with the
narrated-text prototype's "sound off" sheet and the layout e2e can pin
where its parts land. Its text is the lectern check's
(`lectern-check-text.ts`: the prototype's title and first two
paragraphs), under the prototype's line "Old market square · Station 1".

## Public API

- `startLongTextCheck(host)` - builds the sheet under `host`, opens it on
  the demo text and installs `window.__longTextCheck`.
- The hook: `show(content?)` (any of `over`, `title`, `body`, `lang`; the
  demo text's by default), `goTo(i)`, `state()` (the sheet's state, the
  screen boxes of its parts by name, the first paragraph's box, the gap
  between the first two paragraphs, the text's font size and line height,
  whether the reading mark is registered) and `markRect()` (the marked
  sentence's first line box).

## Invariants & assumptions

- Linked from nothing; a Vite input (`vite.config.ts`) and a knip entry.
- No pictures (its `loadAsset` refuses) and no AR (`arActive` is false).
- A part's box is null when it is not rendered.

## Tests

`playwright-tests/long-text-check.spec.js`.
