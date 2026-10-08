# creator-codes.ts

## Purpose

The one owner of the codes while authoring (code book refactor plan
`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`,
M4a; the M2 milestone review's #1): the code in hand, its measurement, the
visit's sighting of it, the visit's latest sighting of every stored code,
and the levels a Finish of this page wrote. Every creator module reads and
writes these through it, and they are private to it (code book plan M5d-2:
no session field holds any of them); its inside is the code book
(`code-book.ts`) holding several codes.

## Public API

- `wireCreatorCodes({ ctx }): CreatorCodes`
- The code in hand (the one-code view today's callers need):
  - `inHand()`, `measurement()`, `sighting()`;
  - `setInHand(level, measurement)` (a measurement, or a kept stored
    reference with null), `restoreInHand(level)` (a restored draft: only into an empty
    hand, true when taken; a code changed live in this page is taken at its
    live text, `liveText`), `clearInHand()` (a new print size);
  - `setSighting(sighting)`; `forgetSightings(levelId)` -
    a size adoption: that code's stored-code sighting goes, and the visit's
    sighting if it is that code's.
- Per code:
  - `hasStoredPose(levelId)` - in hand, in the book with a saved pose, or
    in the open tour with a geo (the book since the M4 milestone review
    #1: a code this page measured and another code then took the hand
    from stays a reference, never re-measured in a later visit);
    `savedText(levelId)` - the book's saved level text, null when the
    book does not hold the code;
  - `references()` - every code's stored pose, each code once: the code
    in hand first, then the book's other codes at their saved pose (the
    pose the next Finish writes, which replaces a hosted one; M4e - the
    summary and the object list missed a code measured before the one in
    hand), then the tour's others (geo null for a level without one);
    `storedPoses()` - the ones that read, same order.
  - Every re-mint is `saveLevel(level)` (the settle's code in hand
    included; code book plan M5d removed `remint`, which did the same).
- The book of codes a Finish writes (M4c-1, `code-book.ts`):
  - `toWrite()` - every code this page took whose saved text differs from
    what the zip the Finish rebuilds from holds (the last Finish's text,
    else the hosted one from `ctx.currentLevelTexts`), in the order the
    codes were first taken; a stored code kept unchanged is not written;
  - `finished(written)` - a Finish wrote these: each is saved, and its
    text is what the next Finish builds on;
  - `ids()` - every code in the book, in the order first taken (M4d: the
    print panel's reprint warning counts them);
  - `numbering()` - the one order every label uses ("Code 2", M5b): the
    open tour's codes in the tour's order, then this page's, in the order
    taken - never moved by the hand (the summary sorts by it, the refused
    line names its code by it);
  - `notHosted()` - what the draft keeps: every code whose saved text the
    HOSTED zip does not hold yet, a Finish's among them;
  - `dropMeasurement(levelId)` - a code not in hand is measured again (a
    new print size, M4c-3): its measurement is dropped and its saved text
    falls back to the zip's;
  - `restoreLevels(levels)` - a restored draft's codes, in its order, saved
    and taken as references; a code changed live keeps its live text.
- The visit's stored-code sightings: `noteStoredSighting(levelId, visit,
sighting)` keeps the latest per code; `storedSightings()` lists them (the
  visit log reads them).
- `endVisit()` - the visit's sightings go (the stored codes' and the code
  in hand's); `reset()` - a tour closed: the book, the levels its
  Finishes wrote and the code in hand with its measurement go (the
  creator setup's `resetFinishStep` calls it first).

## Invariants & assumptions

- **Private storage** (M5d-2): the code in hand, its measurement and the
  visit's sighting are closure variables; the composed tests reach them
  through `CreatorSetup.codes`. The close reaches them through `reset()`.
- **The code in hand's text wins for its own code**: every write of the
  book goes through one `setBook`, which puts the hand's text back when a
  change replaced it (a dropped measurement). The book therefore always
  holds the code in hand, and reads never write.
- **A draft's newer text takes a hand that only KEPT its code** (PR #568
  review): `restoreLevels` moves the hand to the draft's text when the
  page changed that code in no live way (`liveText` null), before
  `setBook`; a hand with live work keeps it. (M5d-2 had kept the older
  rule, under which the hand's kept text always won.)
- **`measurement()` is the HAND's**, not the book entry's: a code taken as
  a stored reference has none, even when the book keeps an earlier
  visit's measurement of it (the M5d-2 review's #2; the settle's size and
  its re-mint read it without a visit filter).
- A new print size (`clearInHand`) drops the code's measurement and puts
  its saved text back to the zip's.
- `reset()` leaves the visit's sightings to `endVisit`: a tour cannot close
  inside a visit (scan-to-open never switches tours, and the open controls
  sit outside the AR overlay).
- A stored code's sighting is tagged with its visit; the visit log reads
  only its own visit's, and `endVisit` empties the map anyway.
- Pure state, no I/O: every method is synchronous and total.

## Examples

```ts
const codes = wireCreatorCodes({ ctx });
codes.setInHand(level, measurement);
codes.saveLevel(remintedLevel); // the settle's re-mint, measurement kept
```

## Tests

`creator-codes.test.ts` (the code in hand, its measurement and sighting;
the hand's own measurement against the book's; a failed identity's empty
hand; the draft restore into an empty hand, at a live text and over a code
only kept at its hosted pose; the hand's text over a draft's; the re-mint;
the close; stored poses, the references' order, the visit's sightings). Composed, through `wireCreatorSetup`: every creator suite, and
the sampled mutants (`scripts/fixtures/creator-setup.mutants.json`) whose
text moved here.
