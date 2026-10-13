# level-printed.ts

## Purpose

The code's printed text on its level file (follow-up F2, plan
`GpsPlusSlamJs_Docs/docs/2026-10-13-0847-tour-printed-text-on-level-plan.md`):
the optional `qr.printed`, the full text the code carries (its launch URL),
written when the code is measured. A level is filed under a HASH of that
text (`qrCodeId`), so without it a re-print can only guess which spelling
of the tour link the code was printed from (`print-link.ts`).

## Public API

- `readPrintedText(json) → string | null` - the stored text; null for a
  level without one, a damaged field (not a string, empty, over 4 096
  characters) or anything that is not a level object. Never throws.
- `withPrintedText(json, text) → string` - the level with `qr.printed` set;
  every other field kept. Throws `SyntaxError` when `json` is not a level.
- `carryPrintedText(fromJson, toJson) → string` - the re-mint seam: the
  freshly minted `toJson` with the old level's text; `toJson` itself when
  the old one had none, `toJson` already has one, or it is not a level.

## Invariants & assumptions

- A Tour Viewer authoring field, like `qr.spots` (`level-spots.ts`):
  visitors' parser (`parseQrLevel`) rebuilds a level from its known fields
  and drops it; the level's format version does not change.
- Read leniently: external data in a hosted zip; a bad field is no text,
  never a reason to reject the level.
- Believed only when it is the level's own: `print-link.ts`
  `printedCodes` checks that the text's hash is the level's id.
- Written at the first measurement of a code (`creator-measuring.ts`)
  and carried at the one re-mint seam (`visit-settle.ts` `remintedLevel`,
  with `carryCodeSpots`). A code stored BEFORE F2 is kept as the stored
  reference when it is measured again, so the fresh level with the text
  is not what is kept; it gains the text only when the visit's settle
  re-mints it (a replace or a move: `remintedLevel` writes the
  measurement's own text when the level has none - r834 milestone review
  #1). A keep or a confirm leaves it without one (backfilling those would
  make an unchanged tour's Done save: an owner question).
- The text is what the poster prints; it names the tour's link.

## Examples

```ts
const json = withPrintedText(level.json, decodedText);
readPrintedText(json); // decodedText
carryPrintedText(json, freshlyMinted); // freshlyMinted with the text
```

## Tests

- `level-printed.test.ts` - write/read round trip (and a property), the
  visitors' parser unchanged, lenient reads, the carry.
- `authoring-settle.test.ts` - "writes the code's printed text on its
  level, and the visit's re-mint keeps it (F2)" (mutation-checked: without
  the carry it fails).
