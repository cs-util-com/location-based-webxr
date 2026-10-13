# print-link.ts

## Purpose

Which spelling of the tour link a printed code carries (polish round,
r820 feedback R4/R5). A code's identity is a hash of its full text
(`qrCodeId`) and the measured pose is filed under it, so two spellings of
one Google Drive file make two different codes. New codes print the
trimmed address; a tour's own measured codes keep the spelling they were
printed in.

## Public API

- The Drive file id comes from the framework's
  `utils/drive-file-id.ts` `driveFileId`, the one parser (follow-up F3,
  DEC-H3); this module has none of its own.
- `printableLink(url)` - a Drive file link as
  `https://drive.google.com/file/d/<id>`; anything else unchanged.
- `linkSpellings(url)` - the spellings a tour's measured codes may carry:
  the link as given first (a re-print from the same link is the common
  case and costs one round - M0c review), then the trimmed address,
  `/view`, and `/view?usp=` with `sharing` (the desktop's "copy link"),
  `drivesdk` (the phone app's share), `drive_link` and `share_link`
  (Drive's newer copy-link tails); each once. One spelling for a
  non-Drive link. A spelling outside the list is a different code -
  follow-up F2 stores the printed spelling in the tour instead.
- `nextCodeIndex(ids, idOfCode, limit)` - the first free code number
  (moved here from `print-panel.ts`): one past the highest number whose code
  the tour holds, 1 for none; stops once every id is found (PR #586
  review).
- `printedCodes(levels, hash?) → Promise<PrintedCode[]>` (follow-up F2) -
  the measured codes whose level carries its printed text
  (`level-printed.ts`), read back into `{ id, link, index }` through the
  boot's own parse (`code-tour.ts` `launchPayload`, the framework's
  `resolveQrPayload`; no `n` is number 1). A text counts only when its
  hash is its level's id; one that is not a launch URL is skipped.
- `spellingOfRecord(url, measuredIds, idOf, limit, printed?)` - the
  stored texts decide first: among those naming this tour (the same Drive
  file in any spelling, else the same link), the spelling with the most
  codes (ties: the higher number), next = its highest + 1; codes without a
  text are still searched in that spelling and the higher next wins.
  Without one: the first of `linkSpellings` with a code the tour holds,
  and the next free number in it; else the trimmed address from 1.

## Invariants & assumptions

- **Why the warning fired on the owner's link (r820, a hypothesis - the
  zip was not read):** measured from one Drive spelling, re-printed from
  another. `spellingOfRecord` makes that case print in the measured
  spelling, so a re-print matches the posters already hanging and nothing
  warns; the orphan warning remains for a genuinely different link.
- **A spelling outside the list** (Drive for desktop's
  `open?id=...&usp=drive_fs`, a share tail Drive adds later) is found
  only through a stored text (F2); a code stored before F2 keeps the search
  until a re-measure re-mints it (a replace or a move at the visit's
  settle; see `level-printed.ts.md`). The orphan warning needs no
  change of its own: it checks the spelling of record, which the stored
  text now names.
- **The `D/<id>` short form would break the mixed search.** If
  `allowDriveShortForm` is ever turned on for printing, `idOf(link, k)`
  builds `D/<id>` texts, which never match older full-link codes without a
  stored text; the search would miss them and could reuse a number. Turn
  it on only together with a search over both forms (r834 milestone
  review #7).
- **Measured (R5):** a phone-shared link prints at QR version 8, trimmed at
  7 (`print-link.test.ts`; the framework's `qr-launch-url.ts.md` has the
  full table and the `D/<id>` short form, whose writer is off until `main`
  reads it).
- Old printed codes are untouched: their text, and with it their id, is
  what it was; visitors' scans resolve them as before.
- Cost: a spelling with no match is walked to the limit (50 numbers of a
  launch-URL build and a hash); a tour with codes from another link walks
  all seven, once per open. While it runs the print panel holds its PDF
  button and its warning (`print-panel.ts`).

## Examples

```ts
printableLink("https://drive.google.com/file/d/ID/view?usp=drivesdk");
// "https://drive.google.com/file/d/ID"
await spellingOfRecord(desktopLink, measured, idOf, 50);
// { link: phoneLink, next: 3 } when the tour holds the phone link's codes 1, 2
```

## Tests

`print-link.test.ts` (every Drive spelling, non-Drive links, the measured
version gain, the spelling order and a property, the owner's r820 case,
the fallbacks, the early stop; F2: a text read back, a foreign or
unusable text ignored, an unlisted spelling continued, stored and unstored
codes mixed, another tour's text ignored, and a property);
`print-panel.test.ts` (`nextCodeIndex`);
`print-panel.wiring.test.ts` (the panel printing trimmed, and in the
spelling of record after `presentCodes`).
