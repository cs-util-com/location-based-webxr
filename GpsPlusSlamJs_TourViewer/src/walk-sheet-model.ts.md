# walk-sheet-model.ts

## Purpose

What the visitor's sheet in AR and the away block on the start page show,
as pure data: the peek (the next station, its
distance or why there is none), the progress segments, the story card's
title, the list (title, order chip, progress line, completion card, rows)
and the away model. Built from the store's walk (`visitorWalk` progress),
the station guide's `view()` and the tour; the DOM writer is
`walk-sheet.ts`. Today's texts are kept: the peek says what the hidden
`#station-line` says, in the prototype's two lines.

## Public API

- `walkSheetModel(input: WalkSheetInput): WalkSheetModel`
  - `input`: `stations`, `order`, `tourTitle` (the start page's name,
    `visitor-start.ts` `visitorStartView`), `progress` (`WalkProgress`),
    `view` (`GuideView`), `story: { stationId } | null` (the story
    playing), `sheet: "peek" | "list"`.
  - `peek: { kind, eyebrow, title, distance, arrowDeg, nextArrowDeg, tail }`:
    - `walk`: eyebrow "Next - station N of M" (fixed), "N
      stations to find - nearest" (several offered and a distance shown;
      "- your choice" for the visitor's chosen target, the chosen-target rule, in any
      state) or "Next" (one offered, or no distance to rank by: the one
      left to find); the
      distance ("N m") only while the position vouches for one; the tail
      "Waiting for your position…", "GPS too weak to guide you (±N m);
      step into the open." or "Scan one of the tour's codes so the guide
      knows where you are." otherwise;
    - `none`: no station guessed while stations are still to
      find: eyebrow "Position unknown" (`'none'`) or the chip's words
      ("GPS - about N m, too weak", "Finding your position…", "GPS -
      about N m" during the hold), title "N stations to find", tail by
      the position (the scan ask, "GPS too weak ...", "Waiting for your
      position…", "Waiting for a steady position…");
    - `story`: nothing unfound offered while a story plays: "Station
      found" / its title / "Its story is playing.";
    - `there`: the visitor is at a done station (its presence holds, no
      story plays) or a complete tour waits on its last one (the guide's
      `view.there`): "At station N - take your time" / its title / the
      guide's tail ("Next: <title>" with the distance or the position's
      hint, "N stations still to find - ...", or "Every station is
      done."), no distance by the title (it is not the station the
      visitor is at); while the next station's distance is shown and it
      has a direction, the tail adds " - <direction>" and `nextArrowDeg`
      turns the arrow beside the tail to it;
    - `complete`: once the tour finished (or, never expected, complete
      with no `there`): the tour's title / "Tour complete" / "K skipped." or
      "Every station visited."
  - `storyCard: { title } | null` - the card in the peek's place while a
    story plays and the list is closed.
  - `segments` - `each` (one state per listed station) up to
    `WALK_SEGMENT_LIMIT`, else `bar` (found, skipped, to find, by count).
  - `grabLabel` - "Show all stations" / "Hide the list".
  - `list: { title, chip, progress: { lead, rest }, completion, hint, rows }`:
    chip "Any order" for any order and null for fixed (it
    told the visitor nothing they act on; the list hides it); progress "N of M found"
    then "K skipped", "L to find"; `completion`
    (`completionLine` plus "M of N found. A skipped station can still be
    brought back." or "Thank
    you for walking with us.") once FINISHED (not merely complete: the
    card waits while the visitor is still at the last station); `hint` while no
    station is guessed: why, by the position, and "Which one can't you
    reach?" once "Can't get there?" opened the chooser (not while
    tracking is lost: no row offers a Skip then); rows `{ id,
number, title, state, sub, arrowDeg, action, confirm, undoLeftMs,
chosen, choosable, mainLabel }` with
    `state` (`WalkRowState`) one of next (the focus), left (offered, not
    the focus), found (done), here (found, its story playing), skipped,
    later (not offered yet) and the subs Found, "You are here - its story
    is playing", Skipped, Later, "Distance unknown" (no position, or GPS
    too weak), "Waiting…", "N m" (" - your choice" on the chosen target).
    The row's fields: `action` - `skip` ("Skip", for a station to find),
    `bring` ("Bring back", a skipped one) or `undo` ("Undo: bring back
    <title>", the last skip inside its window, with `undoLeftMs` for its
    bar), each with its `ariaLabel` naming the station; null otherwise and
    while the row's `confirm` ("Skip <title> - I can't get there") shows;
    while tracking is lost (the view's `trackingLost`) no row has a Skip
    or a confirm, the undo and Bring back staying;
    `chosen` (the orange edge); `choosable` (a waiting station of a tour
    with a choice: its title button reads "<title>: <sub>. Guide me
    here", `mainLabel`).
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
- The completion card says "A skipped station can still be brought
  back.": the rows can bring a skipped station back at any time.
- In the no-guess condition no text names a station as next or nearest: the
  peek is `none`, every unfound row `left` (the guide's focus is null).
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

- `walk-sheet-model.test.ts` - the being-there peek's next station:
  its arrow (`nextArrowDeg`) and direction with the distance in the tail,
  none without a distance shown or a next station.
- `walk-sheet-model.test.ts` - every peek kind and tail, the eyebrow per
  order, segments and the bar above the limit, rows and their subs, the
  chip, the progress line, the completion card, the story card, the
  away model; the peek with no station guessed per
  no-distance state and the hold, the hint per position and chooser, the
  rows' actions (Skip, confirm, undo with its time, Bring back) and,
  under tracking lost, no Skip and no confirm with the undo and Bring
  back kept; one station left without a distance named "Next", never
  "nearest"; the chosen target in the peek and its row, the completion's
  bring back.
- `walk-sheet-model.property.test.ts` - the real guide on the page's
  store, random steps and measurements: the peek agrees with the hidden
  line, the named station is offered and waiting, the distance matches,
  "next" rows are offered, segments equal the rows' states.

## The direction words and arrows

- `WalkSheetInput.directions?: ReadonlyMap<string, WalkSheetDirection>`
  - each station's word (`walk-direction.ts`, with its hysteresis, kept
    by the caller) and its angle from straight ahead, degrees, positive to
    the right. Absent, or a station missing: no heading for it.
- The peek: `arrowDeg` (whole degrees) and the tail "Ahead." / "To your
  left." / "To your right." / "Behind you." only while a distance is
  shown and the focus has a direction; otherwise `arrowDeg: null` and the
  tail as before. On a being-there peek the arrow is `nextArrowDeg`
  (beside the tail, the next station's) and `arrowDeg` stays null.
- A row still to find: "N m - ahead / to your left / to your right /
  behind you" with `arrowDeg`; without a direction "N m" and no arrow;
  found, here, skipped and later rows never have one; no direction where
  no distance is shown.
- Tests: the "direction words and arrows" describe in
  `walk-sheet-model.test.ts`.
