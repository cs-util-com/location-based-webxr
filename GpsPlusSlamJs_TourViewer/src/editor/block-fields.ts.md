# block-fields.ts

## Purpose

A free block's text fields as the desktop editor's inspector edits them
(B2c of the station-blocks plan, GpsPlusSlamJs_Docs
`2026-10-25-2052-station-blocks-build-plan.md`). Pure: no DOM, no store.

## Public API

- `BlockField` - `{ name, label, value, max, prose }`: the block's own
  field name (the inspector's `data-field`), its label, its text now (""
  when absent), the format's cap, and whether it is prose (a text area
  keeping its lines) or one line.
- `blockFields(block)` - the fields of a free block (`TourObject` or
  `WorldBlock`) besides a short text's caption, which the inspector's head
  types:
  - short text: Description (160);
  - picture: Title (40), Caption (1200, prose), Alt text (300, prose);
  - model: Title (80).
- `blockFieldEdit(block, name, value)` - what typing `value` writes:
  - `edited` with the block, the text trimmed at its ends (inner lines
    kept); a blank text removes the field (all of them are optional);
  - `unchanged` for the same text, or for a field the kind does not have
    here (a short text's caption, which `pinTextEdit` writes, included);
  - `refused` with a sentence ("A title takes at most 40 characters.")
    for a text over its cap.
- The fields' counters are `pin-text.ts`'s `textCounterLine` and
  `wireTextCounter` (one copy for every text counter of the creator
  pages); this module keeps only the fields and their edit rule.

## Invariants & assumptions

- **Every cap and every count is the format's:** `TOUR_BLOCK_TEXT_RULES`
  and `tourTextCount` (code points after trimming and collapsing each
  whitespace run). The counter, the refusal and the reader cannot
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

- `block-fields.test.ts` - each kind's fields and caps in order; a field
  written trimmed with its lines; emptied removes it; the same text
  unchanged; a text over its cap refused in words, an emoji counted as
  one; a field the kind lacks writes nothing; `pin-text.ts`'s counter
  against a block's cap and its over mark.
- `block-fields.property.test.ts` - any sequence of edits over every
  field of every kind keeps each text within its rule
  (`checkTourBlockText`) and the envelope untouched.
