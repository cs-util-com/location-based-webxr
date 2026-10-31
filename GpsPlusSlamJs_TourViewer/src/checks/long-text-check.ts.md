# `long-text-check.ts` - the reading sheet's check page

## Purpose

The code of `long-text-check.html` (`long-text-check.html.md`): one long
text open in the production reading sheet (`long-text-sheet.ts`), with no
AR session, so the sheet can be compared side by side with the
narrated-text prototype's "sound off" sheet and the layout e2e can pin
where its parts land. Its text is the lectern check's
(`lectern-check-text.ts`: the prototype's title and first two
paragraphs), under the prototype's line "Old market square · Station 1".

Two query switches: `?text=rich` opens `CHECK_RICH_BODY` instead (two
headings, a nested list with strong text, a link to
`https://town.example/map`, and two pictures, `asset:mill` and
`asset:bell`, several screens below the start, whose files are PNGs drawn
in the page); `?ar=1` makes the sheet behave as during an AR session, so
a link asks before it opens.

## Public API

- `startLongTextCheck(host)` - builds the sheet under `host`, opens it on
  the demo text and installs `window.__longTextCheck`.
- The hook: `show(content?)` (any of `over`, `title`, `body`, `lang`; the
  demo text's by default), `goTo(i)`, `state()` (the sheet's state, the
  screen boxes of its parts by name, the first paragraph's box, the gap
  between the first two paragraphs, the text's font size and line height,
  whether the reading mark is registered) and `markRect()` (the marked
  sentence's first line box) and `opened()` (the links
  the sheet opened through its `openLink`, which only a yes in AR calls).
- `CHECK_RICH_BODY` - the rich text.
- `longTextCheckOptions(search)` - `{ rich, ar }` from the query
  (`text=rich`, `ar=1`; anything else is off).

## Invariants & assumptions

- Linked from nothing; a Vite input (`vite.config.ts`) and a knip entry.
- Pictures only in the rich text: its `loadAsset` serves the two check
  pictures and refuses any other id. AR only with `?ar=1`; a link then opens through `window.open` on yes.
- A part's box is null when it is not rendered.

## Tests

`playwright-tests/long-text-check.spec.js` (the layout at three viewports,
the mark, and the rich text: pictures after a scroll, the link's question
in AR, allowlisted tags only); `src/checks/long-text-check.test.ts` (the
query and the rich body's forms).
