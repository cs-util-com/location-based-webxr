# `long-text-sheet.ts` - the reading sheet of a long text

## Purpose

Shows a long text's whole body, rendered from its Markdown, in the
narrated-text prototype's reading sheet
(`public/prototypes/station-blocks-1-narrated-text/`, its "sound off"
view): a bottom sheet over 63 % of a phone held upright, a side panel
held sideways (42 px from the top, at most 56 % wide) and a 520 px panel
on a desktop (48 px from the top). The format has no narration for a long
text yet, so this is the prototype's sheet without playback: a calm
reading mark the visitor moves by tapping a sentence, by the previous and
next buttons or along the bar; a readout ("Sentence 3 of 14", "¶ 2/5",
the percentage); the paragraphs as ticks on the bar. Its look is
`long-text-sheet.css` (imported here), whose numbers are the prototype's.

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
- The sheet: `show({ over, title, body, lang? })` (opens it, or shows
  other content in it), `close()`, `isOpen()`, `goTo(i)` (clamped; scrolls
  the sentence to about 28 % of the text's height), `state()` (`open`,
  `title`, `sentence`, `sentences`, `paragraph`, `paragraphs`, `marked`),
  `dispose()` (closes and removes it), `element`.
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
- `long-text-sheet.property.test.ts` - any sequence of presses on any
  text keeps the mark on a sentence and the readout in step.
- `playwright-tests/long-text-check.spec.js` - the layout against the
  prototype's numbers at three viewports (positions and gaps), and a real
  tap on a sentence, through `long-text-check.html`.
