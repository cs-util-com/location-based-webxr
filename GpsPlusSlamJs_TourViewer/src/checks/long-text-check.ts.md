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

Three more for a narrated text: `?voice=timed` gives it a voice and a
word read-along that fits it, `?voice=stale` one whose text hash is of
other words; both run through the visitor's own narration
(`narration-visitor.ts`), with a stand-in clock that stands still until
moved (no sound plays) and a timing made in the page the way the
prototype makes its own (`checkSegments`), opened at the prototype's
demo position (`checkDemoMs`). `?view=captions` shows the captions strip
(`captions-strip.ts` through `captions-follow.ts`) in place of the sheet;
"Full text" opens the sheet. `?open=0` opens nothing until `show()` or
`follow()`.

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
  With a voice also: `follow()` (starts the strip), `at(ms)` (moves the
  clock and lets the views follow), `demoMs`, `segments`, `voice()`
  (the verdict, how often the timing entry was read, the narration's
  warnings, the sheet's marked word, the strip's state and its parts'
  boxes, the clock), `voiceRect()` and `wordRect()` (the voice's marks'
  first line boxes); `voice()` is null without `?voice=`.
- `CHECK_RICH_BODY` - the rich text.
- `longTextCheckOptions(search)` - `{ rich, ar, voice, view, open }`
  from the query (`text=rich`, `ar=1`, `voice=timed|stale`,
  `view=captions`, `open=0`; anything else is the default).
- `checkSegments(plain)` - a word track over `P` timed as the
  prototype's stand-in narration; `checkDemoMs(sentences, segments)` -
  60 ms into the third sentence's seventh word;
  `createCheckClock(durationMs)` - the clock; `CHECK_VOICE_CREDIT`.

## Invariants & assumptions

- Linked from nothing; a Vite input (`vite.config.ts`) and a knip entry.
- Pictures only in the rich text: its `loadAsset` serves the two check
  pictures and refuses any other id. AR only with `?ar=1`; a link then opens through `window.open` on yes.
- A part's box is null when it is not rendered.

## Tests

`playwright-tests/long-text-check.spec.js` (the layout at three viewports,
the mark, and the rich text: pictures after a scroll, the link's question
in AR, allowlisted tags only); `playwright-tests/narration-check.spec.js`
(reading along, a stale track, the read on open, the strip's layout at
three viewports); `src/checks/long-text-check.test.ts` (the query, the
rich body's forms, the check timing parsed and fitting its text, the
demo position, the clock).
