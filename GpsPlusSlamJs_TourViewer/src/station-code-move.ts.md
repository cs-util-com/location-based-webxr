# station-code-move.ts

## Purpose

A re-measured code takes whole stations with it (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
D17, and the owner's condition). When a code's saved position is IMPROVED,
every station whose ANCHOR is within the code's reach and no nearer to
another of the tour's codes moves rigidly with it. The station's geo pose
changes. Its items do not change at all: their local poses are relative to
the station, so they follow by construction.

## Public API

- `moveStationsWithCode(stations, { from, to, others, claimed? }) -> StationsMoved`
  - `from` and `to`: the code's saved pose before the improvement and the
    improved one.
  - `others`: the tour's other codes and known spots, as they were before
    the settle. A station nearer one of them stays with it.
  - `claimed`: station ids another improved code already took along in
    this settle. They are left as they are, so each station follows one
    code.
  - Returns `{ stations, moved }`. `stations` is every station in its
    order; an unmoved one is the very same object. `moved` is the ids of
    the stations moved, in order.
- `StationCodeMove`, `StationsMoved`: the input and result types.

## Invariants & assumptions

- **Which stations move:** `move-with-code.ts` `takesAlong`, applied to the
  station's anchor. That is today's rule for notes: within
  `CODE_EVENT_REACH_M` (about 40 m, horizontal) of the code's old position,
  and no nearer to any other code. A tie goes to the improved code. Where
  the items stand plays no part.
- **How it moves:** `moveWithCode`, the settle's code correction from the
  old code pose to the new one. It uses yaw and translation only, never the
  two measurements' tilt.
- **Never an item:** a moved station keeps its id, title, radii, steps and
  its `items` array itself (the same reference). Only `geo` is new.
- Pure. The geodesy is licence-gated, as for every caller of
  `move-with-code.ts`.

## Examples

```ts
const { stations, moved } = moveStationsWithCode(manifest.stations, {
  from: storedCodeBefore,
  to: storedCodeAfter,
  others: otherCodes,
  claimed,
});
for (const id of moved) {
  const station = stations.find((s) => s.id === id);
  if (station !== undefined) tour.moveStation(id, station.geo, "a station");
}
```

## Tests

- `station-code-move.test.ts`:
  - a station within reach moves, with its items untouched and in place to
    2 mm;
  - one beyond 40 m, one nearer another code and one already claimed stay;
  - the decision follows the anchor, not the items;
  - a tie goes to the improved code;
  - the order and the ids are kept.
- `station-code-move.property.test.ts` (random tours, codes and
  improvements up to 5 m and 60 degrees):
  - exactly the stations the rule names move;
  - items are reference-equal;
  - every item of a moved station lands where the code's correction puts
    it;
  - each anchor keeps its distance to the code.
  - The asserted bound is 2 mm. The worst error measured over 3000 runs
    was about 1 micrometre.
- Through the settle: `authoring-settle.test.ts` (a hosted pin's station
  moves with an improved code, and the written item pose is unchanged).
