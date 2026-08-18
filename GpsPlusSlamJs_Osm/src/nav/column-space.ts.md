# `column-space.ts` — the column model as a searchable state space

**Purpose.** Turn `(cell, heightM)` states into something
[`search.ts`](./search.ts.md) can walk.

## Why this exists

This is the piece that was missing when review on #257 found that pass A
"collapses the column model back to 2D". The collapse had **two** causes, and
both have to be answered or the model is still flat:

- **One state per cell.** A cell-keyed visited set holds the wall foot or the
  wall top, never both. `columnKey` puts the height in the key.
- **One height per cell.** A predicate handed only cell strings must resolve a
  single height. `levelsAt` returns **every standable height** in a cell, so the
  two states are generated in the first place.

The second is the substantive one, and it is easy to miss: keying by height
without a source that can report more than one height per cell still produces a
single-valued field — just with a longer key.

## Public API

- `columnSpace({ levelsAt, stepThresholdM?, maxGroundGradient?, canCross? }) => StateSpace<Column>`
- `columnKey(column) => string`

### `canCross(fromCell, toCell) => boolean`

Whether the agent may pass between two cells **at all, ignoring height**. This
is what makes a wall block laterally, and it is separate from `levelsAt` on
purpose: no answer to "where can I stand" can stop a step at this resolution,
because a res-13 cell is ~8 m across and a wall ~0.5 m thick.
`crossesObstacle` in [`obstacles.ts`](./obstacles.ts.md) is the intended
implementation.

- Defaults to admitting every step — design rung 5.3, where agents wander freely
  and walk up the Tower walls, which is that rung's whole point.
- Checked **after** `columnsAdjacent`, so the cheap arithmetic rejects most
  candidate pairs before any geometry is walked.
- **Never consulted for a move within one cell.** Stepping between two levels of
  the same cell crosses no boundary, and asking the predicate about a cell and
  itself would refuse it wherever the wall's own footprint covers that cell.

### The ground, and why this module is where it is found

`columnsAdjacent` can only tell a hillside from a wall when it is told where
the walking surface is — see [`column.ts.md`](./column.ts.md). **This is the
module that knows: a cell's ground is the LOWEST of its levels.** That holds by
construction of `obstacleLevelsAt`, which seeds the set with the ground and only
ever adds `ground + obstacle.heightM` above it, and `obstacles.test.ts` pins it
rather than leaving it assumed.

Two things about how it is applied, both of which a naive wiring gets wrong:

- **The ground is resolved per cell inside `canEnter`, never read off the states
  handed to it.** The search's START state is built by the caller —
  `planRouteWithIndex` constructs `{ cell, heightM }` from the obstacle levels —
  so a space that trusted its inputs would judge the agent's first step by the
  absolute rule alone and refuse to let it off a hillside.
- **`Math.min`, not `levels[0]`.** The ascending order is a property of
  `obstacleLevelsAt`, not something this interface demands of every caller, and a
  space that mistook a wall top for the ground would let an agent walk off one.

`levelsAt` is **memoised for the life of the space** — it is now consulted on the
`canEnter` path as well as the `candidates` path, and a production `levelsAt`
walks an obstacle index and samples a heightfield per call. A space is built per
search, so the cache cannot outlive the data it came from.

### `levelsAt(cell) => readonly number[]`

Every height at which an agent can stand in that cell.

- **More than one is the point.** A cell containing a wall has the ground beside
  it and the walkway on top; a cell with a footbridge over a road has two.
- **Empty means not standable at all** — inside a building, or off the scored
  working set — and no state is generated for it.
- Returning exactly one everywhere reduces this to the 2D model, which is a
  legitimate configuration (a terrain-only pass B) but not the column model.

## Invariants

- **The cell itself is among its own candidates.** Stepping between two levels
  of one cell — up onto a wall where it is low enough — is a legal move that
  exists _only_ in a column model. The search drops the state's own key, so
  standing still is never generated.
- **Candidates are sorted.** `gridDisk` promises no ordering, and a route that
  depended on it would vary with the H3 version — the same reason
  `connectedComponents` sorts.
- **`canEnter` is `columnsAdjacent`**, so every rule in
  [`column.ts.md`](./column.ts.md) applies unchanged, including the non-finite
  height guard — now called with each state's resolved `groundM`, so the slope
  clause is live for every caller without one of them having to ask for it.

## Height quantisation

`columnKey` rounds to **3 decimal places**, because floats are not identities.
Heights arrive from a DEM interpolation, so two samples of one physical surface
can differ in the last bits — and two states that are the same place must
produce the same key, or the search revisits the same ground indefinitely. A
millimetre is three orders of magnitude below `STEP_THRESHOLD_M`, so nothing the
threshold can distinguish is lost.

## Example

```ts
const space = columnSpace({
  levelsAt: (cell) =>
    isWall(cell) ? [groundOf(cell), wallTopOf(cell)] : [groundOf(cell)],
});
const route = findStatePath(agent, (s) => s.cell === target, space);
```

## Tests

`column-space.test.ts` — key separation and quantisation; that the wall foot and
the wall top **coexist as states** (the case the old composition could not
express); the same-cell climb refused at 8 m and allowed at 0.3 m; empty
`levelsAt`; and the design's end-to-end case — a route that reaches the gate and
never enters a wall cell.

**The control matters as much as the case.** Raising the step threshold above
the wall height makes the same fixture route _over_ the wall and produces a
shorter path. Without it, the detour would not be evidence of the height clause
— it would just be what the fixture always does.

Since the slope rule landed, also: that a step down a ~17 % hillside is
admitted; that a cliff is still refused; that a wall standing ON that hillside
stays unclimbable while the ground beside it does not; that the ground is looked
up rather than taken from the caller's state; and that `levelsAt` is asked once
per cell.

**What these do NOT cover:** where the levels come from. Deriving them from
building volumes, barriers and the DEM is pass B's job — and the end-to-end guard
for the slope rule over a real gradient lives with the caller that has one,
`GpsPlusSlamJs_OsmDemo/src/agent-route.slope.test.ts`.
