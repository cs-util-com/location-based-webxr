# code-spots.ts

**Purpose.** It decides, with no question to the creator, whether a stored
code moved, was seen back at the spot it left, or was seen at a second print.
This is code book plan M6 v5, under the owner's decisions:

- the system decides by itself;
- one reliable walk is enough;
- a code seen again at its OLD spot was a second copy, and the move is
  undone.

The module is pure. The settle measures distances with the viewer's rigid
fit and applies the result to the level file.

## Public API

- `type SpotRef` - a known spot of one code: `current`, `previous`, or
  `copy` (with its index).
- `interface SightingFit { distancesM: { spot, m }[] }` - one sighting's
  fit against each known spot.
  - Each entry is the distance (m) at which the fit reads the code from
    that spot.
  - An empty list means the visit had no gated fit.
- `nearestSpot(fit, floorM = MOVED_CODE_FLOOR_M)` returns one of:
  - the nearest spot whose distance is under the floor;
  - `"new"` when none is;
  - `null` without a fit.

  The current spot wins a tie. A non-finite distance never matches.

- `decideCodeSpot({ sightings, candidateDistancesM, reliable, frameChanged,
floorM? })` returns a `CodeSpotDecision`:
  - `none`, with one of three reasons:
    - `not-judged` - an unreliable walk, an odometry frame change, or no
      gated fit;
    - `at-current` - ANY sighting of the visit belongs to the current
      spot;
    - `near-known` - the code is seen at no spot, but the pose a move
      would mint lies within the floor of a known spot;
  - `undo` - the latest judged sighting belongs to `previous`;
  - `copy` (with its index) - it belongs to a second print;
  - `move` - it belongs to no spot, and the minted pose clears every spot.
- `MAX_CODE_COPIES = 4`.
- `applyCodeSpotDecision(memory, decision, moveTo)`, over a
  `CodeSpotMemory<S> { current, previous, copies }`:
  - a move: `previous` becomes the old current, and `moveTo` becomes
    current;
  - an undo: `previous` becomes current again (exactly), and the spot it
    had moved to joins `copies`, the oldest dropped beyond 4;
  - anything else returns the same object.

## Invariants and defensive measures

- **The floor is the only radius.** There is no band where a sighting is
  neither "at a spot" nor safe from a move. v4 had one: a second print kept
  moving the code (M6 v4 review #1).
- **Known spots stay at least the floor apart.**
  - A move requires both the fit and the minted pose to clear every spot.
  - An undo only swaps poses between slots.
  - Pinned by a property test.
- **A visit that also saw the code at its current spot changes nothing**,
  whatever it saw last (v3 review #1, counterexample C).
- `floorM` must be positive and finite, else `RangeError`.
- An undo without `previous` throws `RangeError`: the settle only offers
  an undo when `previous` exists.

## Measured (`code-displacement.recordings.test.ts`, `D20_REAL=m6`)

The real-walk corpus, cross-day, floor 20 m, 300 s window:

- **False moves:** 0.4 % of unmoved code-visits move the code, at 1 of
  42 points (the church walk).
- **Detection:** 50 % of 20 m moves and 94 % of 30 m moves are caught.
  The 5.3 % of visits too short for a gated fit judge nothing.
- **Undo after a false move:** every later walk at the point (70 of 70)
  undoes a false move from a biased visit. A biased SAVE is moved to the
  true spot and never undone (0 of 240), which is correct.
- **False undo after a real move:** 0.5 % of 20 m moves, 0.1 % of 30 m
  moves, none of 50 m moves.

## Example

```ts
const d = decideCodeSpot({
  sightings: [{ distancesM: [{ spot: { kind: "current" }, m: 31 }] }],
  candidateDistancesM: [30],
  reliable: true,
  frameChanged: false,
});
// d = { kind: "move" }
const memory = applyCodeSpotDecision(
  { current: oldPose, previous: null, copies: [] },
  d,
  newPose,
);
// memory = { current: newPose, previous: oldPose, copies: [] }
```

## Tests

- `code-spots.test.ts`:
  - the nearest-spot test and its boundaries;
  - the four outcomes;
  - the same-visit guard, the latest sighting, and the minted-pose check;
  - not judged;
  - the memory transitions and the copy limit.
- `code-spots.property.test.ts` - a simulated world of prints and visits
  in any order:
  - the spots stay apart;
  - two prints change the code at most twice;
  - an unmoved print read within the floor never changes it.
- Five hand mutations were each caught: the guard, the floor boundary, the
  minted-pose check, the copy on undo, and the tie.
