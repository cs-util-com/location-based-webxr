# block-fields.ts

## Purpose

A block's text fields as the desktop editor's inspector edits them
(B2c of the station-blocks plan, GpsPlusSlamJs_Docs
`2026-10-25-2052-station-blocks-build-plan.md`). Pure: no DOM, no store.

## Public API

- `BlockField` - `{ name, label, value, max, unit, required, prose }`:
  the block's own field name (the inspector's `data-field`), its label,
  its text now ("" when absent), the format's cap, the unit the cap counts
  in (`codePoints`, or `utf16` for a long text's body), whether the block
  needs it, and whether it is prose (a text area keeping its lines) or one
  line.
- `blockFields(block)` - the fields of any block (`TourObject` or
  `TourBlock`) besides a short text's caption, which the inspector's head
  types:
  - short text: Description (160);
  - long text: Title (80, needed), Body (32 000 UTF-16 units, needed,
    prose);
  - picture: Title (40), Caption (1200, prose), Alt text (300, prose);
  - video and audio: Title (40), Transcript (32 000, needed, prose);
  - model: Title (80);
  - character: Name (80, needed), Caption (2000, needed, prose). Its
    image and voice are assets, not text: not fields here.
- `BLOCK_KIND_LABEL` - each kind in the block model's words ("Short
  text", "Long text", "Picture", "Video", "Audio", "3D model",
  "Character").
- `blockTitle(block)` - how a block is named where it is listed (the
  tree, the inspector, the 3D view's bar): a short text's caption, a
  character's name, else its title (a picture's caption when it has no
  title), trimmed; its kind's words when it has none.
- `blockFieldEdit(block, name, value)` - what typing `value` writes:
  - `edited` with the block, the text trimmed at its ends (inner lines
    kept); a blank text removes an optional field;
  - `unchanged` for the same text, or for a field the kind does not have
    here (a short text's caption, which `pinTextEdit` writes, included);
  - `refused` with a sentence ("A title takes at most 40 characters.")
    for a text over its cap, counted in the field's unit, or ("A body
    cannot be empty.") for a field the block needs emptied.
- The fields' counters are `pin-text.ts`'s `textCounterLine` and
  `wireTextCounter` (one copy for every text counter of the creator
  pages); this module keeps only the fields and their edit rule.

## Invariants & assumptions

- **Every cap, unit and need, and every count, is the format's:**
  `TOUR_BLOCK_TEXT_RULES` and `tourTextCount` (code points after
  trimming and collapsing each whitespace run, or UTF-16 units as
  written for a long text's body). The counter, the refusal and the reader cannot
  disagree; no `maxlength` (it counts UTF-16 units).
- The envelope (`id`, `kind`, `view`, the pose or `geo`) is never
  changed; only the named text field is.
- NFC normalisation of typed text is not done here (B2b's step 0 does it
  at the editor's and the phone's text inputs).

## Examples

```ts
const out = blockFieldEdit(picture, "alt", "A stone gate");
if (out.kind === "edited")
  store.dispatch(tourDocumentActions.edited({ object: out.after, what }));
```

## Tests

- `block-fields.test.ts` - each kind's fields and caps in order, the
  story kinds' with their unit and need; `blockTitle` per kind and its
  fallback; a body counted in UTF-16 units; a needed field not emptied; a field
  written trimmed with its lines; emptied removes it; the same text
  unchanged; a text over its cap refused in words, an emoji counted as
  one; a field the kind lacks writes nothing; `pin-text.ts`'s counter
  against a block's cap and its over mark.
- `block-fields.property.test.ts` - any sequence of edits over every
  field of every kind, story kinds included, keeps each text within its
  rule (`checkTourBlockText`), every needed field set, and the envelope
  untouched.
