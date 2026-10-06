# creator-codes.ts

## Purpose

The one owner of the codes while authoring (code book refactor plan
`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`,
M4a; the M2 milestone review's #1): the code in hand, its measurement, the
visit's sighting of it, the visit's latest sighting of every stored code,
and the levels a Finish of this page wrote. Every creator module reads and
writes these through it, so that M4c can turn its inside into the code book
(`code-book.ts`) holding several codes without touching seven modules.

## Public API

- `wireCreatorCodes({ ctx }): CreatorCodes`
- The code in hand (the one-code view today's callers need):
  - `inHand()`, `measurement()`, `sighting()`;
  - `setInHand(level, measurement)` (a measurement, or a kept stored
    reference with null), `remint(level)` (the settle; the measurement
    stays), `restoreInHand(level)` (a restored draft: only into an empty
    hand, true when taken), `clearInHand()` (a new print size);
  - `setSighting(sighting)`, `clearSighting()`.
- Per code:
  - `hasStoredPose(levelId)` - in hand, or in the open tour with a geo;
  - `references()` - every code's stored pose, the code in hand first and
    once, then the tour's others (geo null for a level without one);
    `storedPoses()` - the ones that read, same order;
  - `isSaved(levelId)` - hosted by the open tour, or written by a Finish of
    this page (`noteFinished`); what lets a new code take the hand.
- The visit's stored-code sightings: `noteStoredSighting(levelId, visit,
sighting)` keeps the latest per code; `storedSightings()` lists them (the
  visit log reads them).
- `endVisit()` - the visit's sightings go (the stored codes' and the code
  in hand's); `reset()` - a tour closed: the levels its Finishes wrote go.

## Invariants & assumptions

- **Until M5 the session fields are the storage**: `ctx.mintedLevel`,
  `ctx.codeMeasurement` and `ctx.visitCodeSighting`. The tour's close
  (`archive-open.ts`) clears them directly and `scan-open.ts` reads them,
  so this module reads them back on every call rather than keeping a copy
  that a close could leave stale. Within the creator modules nothing else
  writes them.
- A stored code's sighting is tagged with its visit; the visit log reads
  only its own visit's, and `endVisit` empties the map anyway.
- Pure state, no I/O: every method is synchronous and total.

## Examples

```ts
const codes = wireCreatorCodes({ ctx });
codes.setInHand(level, measurement);
if (!codes.isSaved(level.id)) {
  // a new code must wait for a Finish (today's one-code rule)
}
```

## Tests

`creator-codes.test.ts` (the mirror into the session, a close the owner
must read back, the draft restore into an empty hand, the re-mint, stored
poses, the references' order, what counts as saved, the visit's
sightings). Composed, through `wireCreatorSetup`: every creator suite, and
the sampled mutants (`scripts/fixtures/creator-setup.mutants.json`) whose
text moved here.
