# `src/route-penalty.ts`

## Purpose

Turns a cell's affordance score into the multiplier its metres are charged at,
which is the whole of "prefer the walkable tiles" (DEC-R13-1). The one tunable
here decides whether the NPC cuts across the grass or follows the park paths.

## Public API

- `WALKABLE_CATEGORY = "walkable"` — the category the planner routes on.
- `NEUTRAL_SCORE = 1` — the score of a cell nothing has anything to say about.
- `PATH_SCORE = 5_000` — the score at or above which a cell is as cheap as it
  gets.
- `PATH_PREFERENCE = 2` — **the tunable**. How much dearer neutral ground is
  than a mapped path.
- `MAX_PENALTY = 3` — the ceiling, for scores below neutral.
- `penaltyFor(score | undefined) → number` in `[1, MAX_PENALTY]`. Never throws.
- `walkableScoreOf(scores | undefined) → number | undefined`.

## The three decisions this file holds

- **Which category** (DEC-R13-11) — `walkable`, by name, ignoring the UI
  selector.
  - `CellScore.scores` is keyed by category and the demo **opens on
    `battleArea`** (DEC-G3: the geo-event is the headline feature, and "a
    geo-event for walkable?" read as nonsense). Reading `snapshot.category`
    would have routed the shipped default by battle-area suitability while the
    session that asked for this talked entirely about walkability.
  - A rule table with no `walkable` column is an **already-shipping case**
    (`data-and-caching.spec.js` boots one), so it degrades to a flat penalty
    rather than throwing. A flat penalty everywhere is plain distance: a uniform
    multiplier cannot change which route is cheapest.
- **What an unscored cell costs** (DEC-R13-12, amending DEC-R13-2) — the neutral
  value, **not** 1.
  - One is also the admissibility floor. "Unscored costs 1" would make unknown
    ground at least as cheap as the best mapped path and strictly cheaper than
    ordinary grass, so A\* would gain a standing incentive to route **around**
    the ~250 m scored disk — the inverse of what was asked for, appearing
    exactly at the boundary DEC-R13-9 keeps in place.
  - An unscored cell prices as the score **identity** instead, which is the same
    `?? 1` `demo-pipeline.ts` already applies when building the heat scale.
- **What the log is measured against** (DEC-R13-13) — fixed constants, **not** a
  maximum derived from what is currently scored.
  - Such a maximum moves on every pan, so the same click would give a different
    route after the working set grows — making the corpus assertions flaky and a
    user's bug report irreproducible, in the same round that adds camera-target
    URLs so a finding can be pointed at.
  - **The colours have since followed this file (DEC-H5).** `snapshot.heatMax`
    no longer exists; `heat-colours.ts` anchors on a fixed `HEAT_CAP` for
    exactly this reason, a round later and about pixels rather than paths.
  - **The two anchors are different numbers on purpose** — `PATH_SCORE` is
    5 000, `HEAT_CAP` is 1e4 — because they answer different questions: what a
    good path costs, versus where the ramp tops out. Unifying them would need an
    argument, not an assumption.

## Invariants & assumptions

- **`penaltyFor` returns a finite number in `[1, MAX_PENALTY]` for every input**,
  including `undefined`, `NaN`, `±Infinity`, `0` and negatives. The A\*
  heuristic is unpenalised metres, so it stays a lower bound only while this
  cannot dip below 1 — a slip here does not crash anything, it silently returns
  routes that are merely plausible.
- **Monotone non-increasing in the score.** A higher score never costs more;
  that sentence is the user's request restated.
- **Log-linear between the anchors**, because scores span five orders of
  magnitude (0.2 … 24 000 in the session's own examples) and a linear map would
  put every ordinary cell in one bucket.
- **Clamped above `PATH_SCORE`**, so a 24 000 is not preferred over a 5 000. Past
  "this is definitely a path" there is nothing left to buy, and letting the top
  of the range keep pulling would make the NPC seek out one kind of way over
  every other perfectly good one.
- **Clamped below at `MAX_PENALTY`**, because the log curve has no bottom: a
  score approaching zero would otherwise cost unboundedly much, which stops being
  a preference and becomes an obstacle — and obstacles are `crossesObstacle`'s
  job alone in this demo.
- **Non-finite means unknown, not terrible.** `NaN` here means the score pipeline
  produced something uninterpretable; bending routes around a data fault is a
  confidently wrong answer where "nothing is known about this cell" is honest.
- **`PATH_PREFERENCE` is also the expansion dial.** The A\* heuristic is
  unpenalised metres while edges cost metres × penalty, so the larger it is the
  looser the guidance and the closer the search runs to Dijkstra. Raising it
  means re-running `agent-route.test.ts` › "plans a long route inside the default
  expansion cap", not just watching the demo — an over-strong value ships as an
  NPC that silently refuses long clicks.

## Examples

```ts
// In the worker, where the pipeline already is:
scoreFor: (cell) => walkableScoreOf(pipeline.scoreFor(cell)?.scores);

// In the cost function:
cost: (from, to) => metres(from, to) * penaltyFor(scoreFor?.(to.cell));
```

## Tests

`route-penalty.test.ts`: the `[1, MAX_PENALTY]` bound as a property over
adversarial inputs; unscored priced as neutral rather than as the floor, with
the ratio to a mapped path pinned at `PATH_PREFERENCE`; the clamp above
`PATH_SCORE`; monotonicity as a property; the session's own examples ordered
(0.2 < 2 < 270 < 5 000); zero and negative at the ceiling; non-finite treated as
unscored; and `walkableScoreOf` reading `walkable` past a `battleArea` score,
returning `undefined` for a table without the column, and degrading to the
neutral penalty rather than throwing.

`agent-route.test.ts` › "planRoute, weighted by the walkable score" is where the
numbers become routes.

## `pathFactor` / `NON_PATH_PENALTY` — the second multiplier (DEC-R2)

`penaltyFor` prices the GROUND; `pathFactor` prices the WAY. The planner
multiplies both, and the split exists because `walkable` was answering two
questions at once — see `gps-plus-slam-osm`'s `roads.ts.md` on
`isPedestrianPath`.

- `NON_PATH_PENALTY = 1.5` — a starting value, expected to want tuning by eye.
  It makes an off-path detour worth taking only when the path costs more than
  half as much again in distance.
- `pathFactor(onPath)` → `1` on a path, `NON_PATH_PENALTY` otherwise.

**A SURCHARGE OFF PATHS, NOT A DISCOUNT ON THEM, and that is forced.**
`agent-route.ts`'s heuristic is unpenalised straight-line metres, a lower bound
only while every edge costs at least its own metres. A factor below 1 would
destroy that and yield non-optimal routes that still look plausible — the worst
kind of wrong, because nothing reports it. `route-penalty.test.ts` asserts the
combined multiplier is `>= 1` across the whole input space, not at a sample.

**Unknown counts as off-path.** Outside the scored disk nothing is known, so
every cell takes the same surcharge — a uniform multiplier cannot change which
route is cheapest. Pricing unknown as a path would make unmapped ground
preferable to mapped ground, the same trap DEC-R13-12 records for the score.
