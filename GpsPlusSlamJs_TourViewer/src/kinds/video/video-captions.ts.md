# `kinds/video/video-captions.ts` - a video's captions

## Purpose

Reads a free video's `captions` (WebVTT text in the tour file) into timed
cues for the visitor's caption strip (`video-card.ts`), and says in the
editor how many cues were read (`video-panel.ts`). Pure: no page, no
three.js.

## Public API

- `CaptionCue` - `{ startS, endS, text }`, shown from `startS` to before
  `endS`.
- `Captions` - `{ cues, skipped, problem }`.
- `CAPTION_MAX_CUES` (5000), `CAPTION_MAX_CUE_CHARS` (400).
- `captionTime(text)` -> seconds or null: `hh:mm:ss.ttt` or `mm:ss.ttt`.
- `readCaptions(text: unknown)` -> `Captions`.
- `captionAt(cues, timeS)` -> the words on at that time, one cue per
  line; "" for none.
- `captionsStatus(text: unknown)` -> "3 cues · 135 characters", with
  "· N left out (a bad time or no words)" when blocks were skipped,
  "Not read: ..." without a header, null for no captions.

## Invariants & assumptions

- The text is untrusted (a tour file): anything that is not a string, or
  is blank, reads to no cues; it never throws.
- The first line must be `WEBVTT` (alone or followed by a space or tab;
  a byte-order mark is allowed); otherwise nothing is read and `problem`
  says why. The header's block runs to the first blank line.
- A cue block is an optional id line, a timing line
  (`start --> end [settings]`) and its words. Settings are ignored.
  `NOTE`, `STYLE` and `REGION` blocks are passed over without counting.
- Left out and counted in `skipped`: a block with no timing in its first
  two lines, a time that is not one, an end not after its start, a cue
  with no words, and every cue beyond `CAPTION_MAX_CUES`.
- Markup (`<v Anna>`, `<i>`, timestamps in a cue) and any leftover angle
  bracket are taken out of a cue's words, so a cue never reaches the page
  as HTML (the card also writes it as `textContent`). A cue's words are
  capped at `CAPTION_MAX_CUE_CHARS`.
- Times are counted in whole milliseconds, so a written time reads back
  exactly. Cues are returned in start order; overlapping cues show
  together.

## Examples

```ts
const { cues } = readCaptions(block.captions);
strip.textContent = captionAt(cues, player.currentTime);
```

## Tests

- `video-captions.test.ts` - a real file's cues (ids, hours, settings,
  markup, CRLF), a missing header, non-text input, each skipped case,
  markup taken out and the cue cap, the strip's timing, the status line.
- `video-captions.property.test.ts` - any text: no throw, finite forward
  markup-free cues in order; a well-formed file reads back exactly.
