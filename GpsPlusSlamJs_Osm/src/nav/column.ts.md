# `column.ts` — the column model

**Purpose.** Decide whether an agent can move directly between two navigable
states, where a state is `(cell, heightM)` rather than a bare H3 cell.

## Why this exists at all

The navigation design puts it plainly: **an agent on top of the Tower wall and
an agent at its foot occupy the same H3 cell.** Pass A (reachability) is 2D and
cannot tell them apart, so anything built on cells alone lets a path go straight
through 8 m of masonry.

Treating a cell as a **column** rather than a position fixes that. Adjacency
needs two things, not one: the cells must be neighbours, _and_ the height
between them must be a climbable step. The second clause is what forces a route
**around** a wall instead of over it, and it applies **within** one cell as much
as between two — which is the case a purely 2D model has no way to express.

The design names this its **highest-risk assumption** and says it should be
tested before anything is built on it. That is why this module is pure: no
graph, no geometry, no rendering. There is nothing here for a passing test to be
passing _because of_ except the rule itself.

## A hillside is not a wall — the second rule, and why it had to exist

**The step threshold was doing two incompatible jobs, and one of them broke.**
It is calibrated against DISCONTINUITIES — kerb 0.15 m, riser 0.18 m, wall
metres — but in production the heights compared are **DEM samples at cell
centres**, and neighbouring res-13 cells are only 6.34–6.91 m apart. As a single
absolute limit it therefore meant:

> any continuous ground steeper than **~7.5 %** is impassable.

A live session reported the Cologne Frankenwerft promenade as unreachable in
every downhill direction while the `walkable` heat map rated it highly. Four of
the agent's six neighbours were refused outright. The navigation design had in
fact **specified** the missing rule — "the two-point rise-over-run is a few lines
and belongs in pass B" — and it was never built.

So adjacency now asks two questions and admits the step when **either** says yes:

1. **As a step between two surfaces** — the absolute height change against
   `stepThresholdM`. This is the original rule, kept verbatim. It is what lets an
   agent walk off a wall top onto a terrace at the same height: it moves
   horizontally, and what the ground does far below either surface is not its
   problem.
2. **As a walk along one continuous surface** — the GROUND change against
   `maxGroundGradient × run`, _and_ the height above that ground against
   `stepThresholdM`. The second half is what keeps a wall unclimbable however
   steep the hill it stands on: its top is a fixed height above the ground
   beneath it, and no relief adds to the budget for climbing it.

**Because clause 1 is the old rule, supplying a ground can only ADD edges** — no
route a caller has today can vanish. `column.property.test.ts` machine-checks
that rather than trusting the argument.

⚠️ **The grade rule cannot tell a 26° hillside from a 2 m retaining wall smeared
across one cell**, and nothing at this resolution can — both are the same rise
over the same run. Mapped barriers refuse those, through `crossesObstacle`; an
**unmapped** retaining edge under the limit stays walkable. See
[`../../docs/2026-08-18-0659-nav-terrain-slope-vs-step-plan.md`](../../docs/2026-08-18-0659-nav-terrain-slope-vs-step-plan.md).

## Public API

- `Column` — `{ cell: string; heightM: number; groundM?: number }`.
  - `heightM` is metres in whatever vertical datum the caller's height source
    uses. Only differences matter, so the datum never has to be pinned down —
    but it must be **consistent between the two states compared**.
  - `groundM` is the **walking surface of the cell**, in the same datum, so
    `heightM - groundM` is how far the agent stands above it. **Optional, and
    its absence is a real mode**: without it there is nothing to tell a hillside
    from a wall with, and the predicate uses clause 1 alone.
  - **`groundM` is not part of a state's identity.** The ground is a property of
    the cell, so two states in one cell cannot disagree about it, and
    `columnKey` deliberately omits it.
- `STEP_THRESHOLD_M = 0.5` — the default climbable height change, confirmed by
  the owner as DEC-R11-1.
- `MAX_GROUND_GRADIENT = 0.5` — the steepest walkable ground, rise over run
  (1 in 2, ~26.6°), owner decision DEC-S2. Above any street or promenade; a
  cliff in a 12 m-post DEM still reads as impassable.
- `neighbourSpacingM(resolution) => number` — the run a grade is measured over.
  **The resolution's AVERAGE spacing** (`edgeLengthAvg × √3` = 7.09 m at res 13),
  not the exact distance between the two cells: `columnsAdjacent` is the
  search's hottest arithmetic path, and the +3…+12 % error against the measured
  6.34–6.91 m errs **permissive**, which is the safe direction for a rule whose
  failure mode is a confident "cannot reach that spot".
- `columnsAdjacent(a, b, limits?: StepLimits) => boolean`, where `StepLimits` is
  `{ stepThresholdM?, maxGroundGradient? }`.
  - Throws `RangeError` if either limit is not finite and non-negative, or if
    the two cells are at different H3 resolutions.

## Invariants

- **Symmetric.** `columnsAdjacent(a, b) === columnsAdjacent(b, a)`. An agent
  that could descend a drop it could not climb needs a _directed_ graph; the
  design does not ask for one, so a one-way drop must be a deliberate feature
  rather than an artefact of argument order.
- **Reflexive.** A state is adjacent to itself, because `gridDisk(cell, 1)`
  includes its own origin and this rule is defined over that same neighbourhood
  — the one `connectedComponents` already uses. Skipping self-edges is the graph
  builder's job, not the predicate's.
- **Monotone in BOTH limits.** Raising the step threshold or the gradient never
  removes an edge. A more capable agent must reach at least everywhere a less
  capable one can; the alternative is a route that gets _worse_ after a tuning
  change, which is miserable to debug.
- **The height clause can only remove adjacency, never create it.** Cells
  outside ring 1 stay unreachable at any height and any threshold.
- **Sharing a neighbour is not adjacency.** Two members of `gridDisk(o, 1)` need
  not be neighbours of each other — opposite spokes are two steps apart. A graph
  builder that expanded a neighbourhood into a clique would let paths cut
  corners. The first draft of the property test assumed otherwise and fast-check
  produced the counterexample on the third case.

## Defensive behaviour

- **A non-finite GROUND is treated as an absent one**, not as a refusal. The two
  heights are still known, so the surface-to-surface reading is still answerable;
  what a DEM miss costs is only the ability to tell a hillside from a wall, which
  is precisely what an absent `groundM` already describes.
- **A non-finite height yields `false`, never `true`.** The DEM lookup misses by
  returning `NaN`, not by throwing, and every comparison against `NaN` is false
  — so `Math.abs(NaN) > threshold` is false and a naive implementation declares
  an **unknown** height walkable. That is the worse of the two failure modes,
  because it invents connectivity. Failing towards "no route" is at least
  visible.
- **Mixed resolutions throw.** `gridDisk` on a res-13 origin never returns a
  res-8 cell, so a mixed pair would come back non-adjacent and read as "there is
  no way across" — an answer that looks entirely plausible and is entirely
  wrong.

## Using this in a search

`columnsAdjacent` is the edge test, not the search. Pairing it with a
**cell-keyed** search silently reduces it to a step filter over a single-valued
height field: with one slot per cell, the wall foot and the wall top cannot both
exist, and `columnsAdjacent(foot, top)` — the example above, and the design's
motivating case — is never even asked. Review on #257 found exactly that.

Use [`column-space.ts`](./column-space.ts.md), which keys states by
`(cell, height)` and generates every standable level per cell.

## Open: the two limits (design Q1, and its sibling)

`STEP_THRESHOLD_M` is **provisional and the design leaves it open.** The bounds
it must sit between: a kerb is ~0.15 m and a stair riser ~0.18 m, so a lower
threshold makes ordinary steps impassable; a curtain wall is metres, so anything
under ~1 m severs it. 0.5 m clears both. Any value in ~0.3–0.8 m is defensible
and **the choice changes which routes exist**, which is why it is a parameter
with a default rather than a constant baked into the comparison.

`MAX_GROUND_GRADIENT` is open in the same way. 0.5 is DEC-S2 and is bounded
below by the real world — the steepest city streets approach 30 %, and the
reported Cologne bank measures ~24 % — and above by what a DEM can still be
trusted to resolve. Anything in ~0.3–1.0 is arguable; the failure at the low end
is the defect this rule was written to remove, and at the high end an agent
walking down an embankment.

## Example

```ts
const foot = { cell, heightM: 0 };
const top = { cell, heightM: 8 }; // same cell — the wall above it

columnsAdjacent(foot, top); // false: the step is not climbable
columnsAdjacent(foot, { cell, heightM: 0.2 }); // true
columnsAdjacent(foot, top, 10); // true — an agent that can climb 10 m
```

## Tests

- `column.test.ts` — the design's own wall case (two states in one cell 8 m
  apart), the lawn-beside-a-wall case, the threshold boundary in both
  directions, and the defensive paths.
- `column.property.test.ts` — symmetry, reflexivity, monotonicity in BOTH
  limits, an independent origin-to-ring oracle, the non-adjacent-ring-members
  case, and the two properties the slope rule rests on: **a grounded step is
  never refused where the absolute rule admitted it**, and for two states that
  both stand ON the ground, adjacency is the grade alone.
- **Mutation-checked.** Six mutations — dropping the height clause, dropping the
  neighbourhood clause, flipping the boundary to exclusive, dropping the `NaN`
  guard, dropping the resolution guard, and ignoring the caller's threshold —
  are each caught by at least one test.

**What these do NOT cover:** where `heightM` and `groundM` come from. Nothing
here reads a DEM or a building volume; resolving a cell to its levels is pass B's
job, and `column-space.ts` is what derives the ground from them.

⚠️ **And that gap is exactly how the slope defect survived.** Every fixture in
this module, and every route fixture in the demo, stands on ground of a CONSTANT
height, so `Δground` was zero in all of them and the
absolute rule and the decomposed one were indistinguishable. The guard that can
see it is a route over sloped ground, and it lives with the caller that has one:
`GpsPlusSlamJs_OsmDemo/src/agent-route.slope.test.ts`.
