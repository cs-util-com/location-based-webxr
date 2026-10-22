# walk-sheet-model.ts

## Purpose

What the visitor's sheet in AR and the away block on the start page show
(visitor walk W4 build plan
`GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md`,
M2, §1.5, §1.6, §1.8), as pure data: the peek (the next station, its
distance or why there is none), the progress segments, the story card's
title, the list (title, order chip, progress line, completion card, rows)
and the away model. Built from the store's walk (`visitorWalk` progress),
the station guide's `view()` and the tour; the DOM writer is
`walk-sheet.ts`. Today's texts are kept: the peek says what the hidden
`#station-line` says, in W4's two lines.

## Public API

- `walkSheetModel(input: WalkSheetInput): WalkSheetModel`
  - `input`: `stations`, `order`, `tourTitle` (the start page's name,
    `visitor-start.ts` `visitorStartView`), `progress` (`WalkProgress`),
    `view` (`GuideView`), `story: { stationId } | null` (the story
    playing), `sheet: "peek" | "list"`.
  - `peek: { kind, eyebrow, title, distance, tail }`:
    - `walk`: eyebrow "Next - station N of M" (fixed and branch), "N
      stations to find - nearest" (several offered) or "Next"; the
      distance ("N m") only while the position vouches for one; the tail
      "Waiting for your position…", "GPS too weak to guide you (±N m);
      step into the open." or "Scan one of the tour's codes so the guide
      knows where you are." otherwise;
    - `none`: several offered and nothing vouches for the position:
      "Position unknown" / "N stations to find";
    - `story`: nothing unfound offered while a story plays: "Station
      found" / its title / "Its story is playing.";
    - `complete`: the tour's title / "Tour complete" / "K skipped." or
      "Every station visited." (branch: "You reached the end of your
      path.").
  - `storyCard: { title } | null` - the card in the peek's place while a
    story plays and the list is closed.
  - `segments` - `each` (one state per listed station) up to
    `WALK_SEGMENT_LIMIT`, else `bar` (found, skipped, to find, by count).
  - `grabLabel` - "Show all stations" / "Hide the list".
  - `list: { title, chip, progress: { lead, rest }, completion, rows }`:
    chip "Any order", "In order" or "Your path"; progress "N of M found"
    then "K skipped", "L to find" (branch: "N found"); `completion`
    (`completionLine` plus "M of N found." or "Thank you for walking with
    us.") once complete; rows `{ id, number, title, state, sub }` with
    `state` (`WalkRowState`) one of next (the focus), left (offered, not
    the focus), found (done), here (found, its story playing), skipped,
    later (not offered yet) and the subs Found, "You are here - its story
    is playing", Skipped, Later, "Distance unknown" (no position, or GPS
    too weak), "Waiting…", "N m".
- `awayModel({ stations, order, progress }): AwayModel` - the start
  page's block after leaving AR: `text` ("You left AR. Your progress is
  kept while this page is open."), the same segments and a row per listed
  station with its status word.
- `walkHasProgress(progress | null): boolean` - any station found, done
  or skipped (the away block and "Back to the tour" need one).
- `WALK_SEGMENT_LIMIT = 47` - above it the segments become one bar (the
  comment argues the number: inside a 360 px phone's sheet, 328 px after
  its padding, 47 segments at 4 px gaps stay at least 3 px wide).

## Invariants & assumptions

- Pure; no DOM, no store, no clock. Every text is computed here, so the
  writer only copies.
- **The peek and the hidden line agree** (the property test): the same
  station, the same distance, the same kind of "why not".
- The named station is offered and waiting; a "next" row is offered; the
  segments are the rows' states.
- Branch order lists only the stations the path reached: offered now, or
  found, done or skipped (a station the path may never reach is not
  promised).
- The completion card drops W4's "A skipped station can still be brought
  back." until M4, where the rows carry the bring back (plan §1.6).
- Defensive: a station the progress lacks reads as "later" (never
  offered); a station without a measured distance reads "Waiting…".
  Whether the progress is the open tour's walk at all is the caller's
  check (`visitor-stations.ts`).

## Examples

```ts
const model = walkSheetModel({
  stations,
  order: "any",
  tourTitle: "Old town walk",
  progress: store.getState().visitorWalk.progress!,
  view: guide.view()!,
  story: null,
  sheet: "peek",
});
model.peek; // { kind: "walk", eyebrow: "3 stations to find - nearest", ... }
```

## Tests

- `walk-sheet-model.test.ts` - every peek kind and tail, the eyebrow per
  order, segments and the bar above the limit, rows and their subs, the
  chip, the progress line, the completion card, the story card, branch
  listing, the away model.
- `walk-sheet-model.property.test.ts` - the real guide on the page's
  store, random steps and measurements: the peek agrees with the hidden
  line, the named station is offered and waiting, the distance matches,
  "next" rows are offered, segments equal the rows' states.
