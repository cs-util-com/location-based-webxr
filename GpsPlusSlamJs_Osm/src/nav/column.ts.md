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

## Public API

- `Column` — `{ cell: string; heightM: number }`.
  - `heightM` is metres in whatever vertical datum the caller's height source
    uses. Only differences matter, so the datum never has to be pinned down —
    but it must be **consistent between the two states compared**.
- `STEP_THRESHOLD_M = 0.5` — the default climbable height change.
- `columnsAdjacent(a, b, stepThresholdM?) => boolean`.
  - Throws `RangeError` if the threshold is not finite and non-negative, or if
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
- **Monotone in the threshold.** Raising the limit never removes an edge. A more
  capable agent must reach at least everywhere a less capable one can; the
  alternative is a route that gets _worse_ after a tuning change, which is
  miserable to debug.
- **The height clause can only remove adjacency, never create it.** Cells
  outside ring 1 stay unreachable at any height and any threshold.
- **Sharing a neighbour is not adjacency.** Two members of `gridDisk(o, 1)` need
  not be neighbours of each other — opposite spokes are two steps apart. A graph
  builder that expanded a neighbourhood into a clique would let paths cut
  corners. The first draft of the property test assumed otherwise and fast-check
  produced the counterexample on the third case.

## Defensive behaviour

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

## Open: the threshold value (design Q1)

`STEP_THRESHOLD_M` is **provisional and the design leaves it open.** The bounds
it must sit between: a kerb is ~0.15 m and a stair riser ~0.18 m, so a lower
threshold makes ordinary steps impassable; a curtain wall is metres, so anything
under ~1 m severs it. 0.5 m clears both. Any value in ~0.3–0.8 m is defensible
and **the choice changes which routes exist**, which is why it is a parameter
with a default rather than a constant baked into the comparison.

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
- `column.property.test.ts` — symmetry, reflexivity, threshold monotonicity, an
  independent origin-to-ring oracle, and the non-adjacent-ring-members case.
- **Mutation-checked.** Six mutations — dropping the height clause, dropping the
  neighbourhood clause, flipping the boundary to exclusive, dropping the `NaN`
  guard, dropping the resolution guard, and ignoring the caller's threshold —
  are each caught by at least one test.

**What these do NOT cover:** where `heightM` comes from. Nothing here reads a
DEM or a building volume; resolving a cell to a height is pass B's job.
