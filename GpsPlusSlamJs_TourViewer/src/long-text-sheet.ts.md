# `long-text-sheet.ts` - the reading sheet of a long text

## Purpose

Shows a long text's whole body, rendered from its Markdown, in the
narrated-text prototype's reading sheet
(`public/prototypes/station-blocks-1-narrated-text/`, its "sound off"
view): a bottom sheet over 63 % of a phone held upright, a side panel
held sideways (42 px from the top, at most 56 % wide) and a 520 px panel
on a desktop (48 px from the top). Its look is `long-text-sheet.css`
(imported here), whose numbers are the prototype's. It has the
prototype's three modes:

- `silent` (a text with no voice): a calm reading mark the visitor moves
  by tapping a sentence, by the previous and next buttons or along the
  bar; a readout ("Sentence 3 of 14", "¶ 2/5", the percentage); the
  paragraphs as ticks on the bar.
- `plain` (a voice, but no read-along that fits, or one still being
  checked): play, back 10 s, the voice's clock, and no mark. A stale
  read-along is plain, with nothing said to the visitor.
- `live` (a voice and a fitting read-along): the spoken sentence marked
  (`::highlight(long-text-voice)`), its word too on a word track read
  from a file (`::highlight(long-text-word)`); the sheet follows the
  voice until the visitor scrolls ("Back to the voice"); a tap on a
  sentence plays from it; previous sentence; the paragraphs as ticks at
  their times; the bar's arrow keys move 5 s.

## Public API

- `createLongTextSheet(deps)` -> `LongTextSheet`, built closed into
  `deps.host`. Deps:
  - `host` - where it is mounted (in AR, the DOM overlay's root).
  - `loadAsset(asset)` - a picture's file from the open tour.
  - `arActive()` - whether a link must ask before it opens.
  - `openLink(href)` - opens a link the visitor confirmed in AR.
  - `onClose?()` - called once each time the sheet closes.
  - `fit?`, `createUrl?`, `revokeUrl?`, `caretAt?` - default to
    `pictureFit`, `URL.createObjectURL` / `revokeObjectURL` and the
    browser's caret lookup; tests replace them.
- The sheet: `show({ over, title, body, lang?, narration? })` (opens it,
  or shows other content in it; `narration` is `SheetNarration`:
  `{ player, timing, synthetic, voiceCredit? }`, the shared clock and a
  promise of the read-along, null when it does not fit; the sheet is
  plain until it settles, and a rejection counts as null), `close()`
  (pauses the voice), `isOpen()`, `goTo(i)` (silent only; clamped;
  scrolls the sentence to about 28 % of the text's height), `tick()`
  (follows the voice; called every frame, cheap when nothing moved),
  `state()` (`open`, `title`, `mode`, `sentence`, `sentences`,
  `paragraph`, `paragraphs`, `marked`, `word`, `following`),
  `dispose()` (closes and removes it), `element`.
- `narrationMeta(words, durationMs, lang?)` - "1,928 words · 12 min
  narration"; `sheetIcon(doc, name)` and `fillCredit(into, narration)` -
  the prototype's icons and its credit line ("Synthetic voice" set apart),
  shared with the captions strip; `LONG_TEXT_VOICE`, `LONG_TEXT_WORD` -
  the voice's highlight names.
- `readMinutes(words)` - minutes to read at 200 words a minute, at least
  1 (the prototype's rule); `wordCount(body)` - the words of the body's
  plain text (`plainTextOf`); `sheetMeta(words)` - "1,928 words · about
  10 min to read · sound off"; `SHEET_CREDIT` - the line under the
  controls; `LONG_TEXT_MARK` - the highlight's name
  (`::highlight(long-text-place)`).

## Invariants & assumptions

- The body is built by `renderLongText` only (no HTML string); pictures
  are fetched and decoded by `createLongTextPictures` while near the view
  and within the decode budget, updated on every scroll of the text.
- Closing gives back everything the open text held: the pictures' object
  URLs (`dispose`), the reading mark, a pending link question (answered
  "no") and the rendered nodes. Escape and the close button close it.
- A link during an AR session asks `leaveArQuestion(host)` in a bar inside
  the sheet (Open / Stay) and opens only on Open; outside AR it opens by
  itself (its own `target` and `rel`). A second link tap answers a pending
  question "no" first. A tap on a link never moves the mark. The bar's
  look has no prototype yet.
- The mark is drawn with the CSS Custom Highlight API where the browser
  has it (`state().marked`); without it the readout still moves. The API
  draws a flat tint: the prototype's rounded 3 px halo around the
  sentence cannot be drawn this way.
- A text with no sentences hides the controls; the mark is -1.
- Sentences are cut from the plain text `P` (`indexSentences`), so a
  timing's offsets find them; the voice's marks are redrawn only when the
  cursor moves (`read-along.ts`), and a timing settling for an earlier
  text is ignored.
- Known differences from the prototype: the meta line carries the
  language only when the tour names one; the word mark is a highlight
  (no underline offset or rounded halo, which the Custom Highlight API
  cannot draw).
- The layout is chosen by media queries on the viewport (upright when
  width / height is under 0.85, sideways when under 520 px high), as the
  prototype chose its layout from its stage's size. Headings, lists,
  quotes, links and pictures, which the prototype's plain body has no
  example of, take its type and spacing.

## Example

```ts
const sheet = createLongTextSheet({
  host: arRoot,
  loadAsset: (id) => tour.asset(id),
  arActive: () => document.body.dataset["arActive"] === "true",
  openLink: (href) => window.open(href, "_blank", "noopener,noreferrer"),
});
sheet.show({
  over: "Old square · Station 1",
  title: block.title,
  body: block.body,
});
```

## Tests

- `long-text-sheet.test.ts` (jsdom) - the words around the text, opening
  and the readout, an untitled text, the buttons and the bar's keys at
  the ends, a tapped sentence and a tapped link, the link question in and
  out of AR, closing (button, Escape, once each), an empty text, dispose,
  the reading mark registered and let go, a near picture shown and its URL
  given back.
- `long-text-sheet.narration.test.ts` (jsdom) - plain until the timing
  settles, plain for a stale one, live marks following the clock, the
  word only on a word track, play and back 10 s, a tap playing from a
  sentence, previous sentence, following and "Back to the voice", a
  timing for an earlier text ignored.
- `playwright-tests/narration-check.spec.js` - reading along in a
  browser, a stale track plain with no notice, the timing read only on
  open.
- `long-text-sheet.property.test.ts` - any sequence of presses on any
  text keeps the mark on a sentence and the readout in step.
- `playwright-tests/long-text-check.spec.js` - the layout against the
  prototype's numbers at three viewports (positions and gaps), and a real
  tap on a sentence, through `long-text-check.html`.
