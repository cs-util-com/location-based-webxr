# narration-timing.ts

## Purpose

Reads and judges a narrated long text's read-along timing (`timing/<blockId>.json`), only when its text opens (the reading sheet, or the captions strip), against the text the visitor sees. The answer is a verdict the views follow.

## Public API

- `NarrationVerdict` - `none` (no timing named), `unread`, `pending`, `live` (it fits the text), `stale` (it does not, or could not be read).
- `createNarrationTimings({ readEntry(name, maxBytes), warn?, onSettled? })` returns:
  - `verdict(block)` - the verdict as it stands; never starts a read.
  - `load(block)` - reads and checks once per block id, entry name and body; resolves to the timing when live, null otherwise. Never rejects.

## Invariants and defensive measures

- The read is capped at the framework's `TOUR_TIMING_MAX_BYTES` and parsed by `parseTourTimingText`.
- Structural faults (`TourTimingError`), range faults and a hash that differs from `textHashOf(P)` (`tourTimingStaleReason`), a missing entry and any other throw all give `stale`.
- A stale verdict is never shown to the visitor: the text reads plain, with the voice where there is one. The reason goes to `warn` (the console by default) for the creator.
- An edited body (a different `P`) is judged again; the same body is read once however often it opens.

## Example

```ts
const timings = createNarrationTimings({
  readEntry: (name, max) => tour.loadEntryText(`${wrap}${name}`, max),
});
const timing = await timings.load(block); // null: plain text
```

## Tests

- `narration-timing.test.ts` - nothing read until a text opens, the read under the cap, one read however often it opens, none for a text without a timing, stale (plain and quiet) for each kind of fault and a throwing read, an edited body judged again, and a verdict kept when the page's redraw (`onSettled`) throws.
