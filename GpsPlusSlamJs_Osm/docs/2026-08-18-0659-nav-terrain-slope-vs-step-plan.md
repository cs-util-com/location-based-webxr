# Terrain slope is not a step — plan

**Status:** SHIPPED 2026-08-18. Owner decisions in §3; results, and the one
departure from §2, in §6.

**Reported as:** the NPC in `GpsPlusSlamJs_OsmDemo` refuses every destination at
`/osm/?clat=50.94005&clng=6.96252&cdist=58&lat=50.94016&lng=6.96243` — the
Frankenwerft promenade in Cologne — with `no route: the agent cannot reach that
spot`, while the `walkable` heat map rates the whole area highly.

Related documents:

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §7 — navigation is geometry _and_
  heat, and this defect lives entirely in the geometry half.
- [`../src/nav/column.ts.md`](../src/nav/column.ts.md) — the column model and the
  step threshold this plan splits in two.
- [`../src/nav/column-space.ts.md`](../src/nav/column-space.ts.md) — where the
  ground level is derivable, and therefore where the split is applied.
- `GpsPlusSlamJs_Docs/docs/2026-08-04-0812-osm-npc-navigation-design.md` §3.1 —
  **the design specified this test and it was never built**: _"Is the slope
  between two adjacent points walkable? … the two-point rise-over-run is a few
  lines and belongs in pass B."_
- [`2026-08-17-2215-bridge-crossing-unwired-followup.md`](2026-08-17-2215-bridge-crossing-unwired-followup.md)
  — the previous instance of the same shape: a rule the design named, left
  unwired, surfacing as a confident "no route".

---

## 1. What is wrong

`columnsAdjacent` admits a step when the two states' heights differ by at most
`STEP_THRESHOLD_M = 0.5 m`. That constant was chosen against **discontinuities**
— a kerb is 0.15 m, a stair riser 0.18 m, a curtain wall is metres — and the
sidecar bounds it at 0.3–0.8 m on exactly those grounds.

But in production the heights it compares are **DEM samples at cell centres**
(`cell-ground.ts` → Terrarium z13), and neighbouring res-13 cells are **6.34,
6.83 and 6.91 m apart** (measured, `h3-js` 4.4.0, at this latitude). So the rule
silently became:

> **any continuous ground steeper than ~7.2–7.9 % is impassable.**

That is below the gradient of an ordinary steep street, and far below a river
embankment. Nothing in `nav/` computes a gradient; the step threshold is doing
two jobs at once and cannot do both.

### 1.1 Measured on the reported location

Real Overpass extract + the real Terrarium z13 tile (13/4254/2744), through
`planRouteWithIndex` — i.e. the production planner, not a synthetic field:

```
start ground = 48.51 m
  neighbour 6.92 m away: dh =  0.52 m -> REFUSED
  neighbour 6.83 m away: dh =  0.81 m -> REFUSED
  neighbour 6.35 m away: dh =  0.36 m -> steppable
  neighbour 6.92 m away: dh = -0.47 m -> steppable
  neighbour 6.83 m away: dh = -0.83 m -> REFUSED
  neighbour 6.35 m away: dh = -0.34 m -> steppable
30 m N : ground 45.5 m, route = NONE      30 m S : ground 51.6 m, route = 10 points
30 m NE: ground 43.3 m, route = NONE      30 m SW: ground 51.2 m, route =  8 points
30 m E : ground 41.2 m, route = NONE      30 m W : ground 50.2 m, route =  9 points
30 m SE: ground 46.1 m, route = NONE      30 m NW: ground 47.7 m, route =  5 points
```

Four of six neighbours refused; every downhill destination unreachable. The four
that succeed are the uphill side, where the same DEM is gentler (~10 %).

**It is not the Rhine and not the heat map.** Water blocks geometrically, via
`crossesObstacle` against the bank bands, and that mechanism is untouched here.

### 1.2 Why no test caught it

Every nav fixture stands on ground of a **constant height** — mostly
`field: undefined`, which `cell-ground.ts` turns into a flat zero, and otherwise
a sampler returning one number — so `Δground` is 0 in every existing test and the absolute
threshold and the decomposed rule are indistinguishable on them. The corpus site
chosen for relief — `heidelberg-altstadt` — is used by the scoring and mesh
tests, never by a route test. **The gate could not have caught this**, and the
guard this plan adds is a sloped-ground route test, which is the thing that was
missing.

---

## 2. The fix

Split the one comparison into the two questions it was conflating.

> ⚠️ **§2 describes the plan as written; the shipped rule is a UNION of this
> reading and the original absolute one.** See §6 for the case that forced it —
> a wall top and a terrace at the same height, which a decomposition-only rule
> would have severed. Everything below still holds as the second arm.

For a step between columns `a` and `b`, with `groundM` the walking surface of
each cell:

- **Discontinuity** — `|(a.heightM − a.groundM) − (b.heightM − b.groundM)|` must
  be at most `STEP_THRESHOLD_M`. This is the wall/kerb rule, unchanged in
  meaning.
- **Grade** — `|a.groundM − b.groundM|` must be at most
  `MAX_GROUND_GRADIENT × horizontalDistance`. This is the missing rise-over-run.

`Column` gains an **optional** `groundM`. When either state omits it the
predicate keeps today's absolute rule exactly, so every existing caller and
fixture means what it meant.

`columnSpace` fills it in: the ground of a cell is `min(levelsAt(cell))`, which
is true by construction — `obstacleLevelsAt` seeds the set with the ground and
only ever ADDS `ground + heightM` above it. That invariant gets its own test
rather than being assumed.

**The horizontal distance is the resolution's average neighbour spacing**
(`getHexagonEdgeLengthAvg(res) × √3` = 7.09 m at res 13), not the exact
great-circle distance between the two centres. Two reasons: `canEnter` is the
search's hottest arithmetic path and this keeps it trig-free; and the error is
+3…+12 % against the measured 6.34–6.91 m, i.e. it errs **permissive**, which is
the safe direction for a rule whose failure mode is a confident "no route". A
same-cell step uses distance 0, so climbing onto a wall inside one cell is
governed by the discontinuity rule alone — unchanged.

### 2.1 What this does NOT change

- **Walls.** On flat ground the decomposition is arithmetically identical to
  today. On a slope it is _stricter_ than a distance-scaled single threshold
  would be, because the slope allowance never applies to the wall's own height.
- **Water, buildings, barriers, gates, bridge passages.** All of that is
  `crossesObstacle`, which this plan does not touch.
- **Cost and the heuristic.** Cost stays horizontal-only (owner decision, §3),
  so the heuristic remains a lower bound and needs no re-derivation.

---

## 3. Owner decisions (2026-08-18)

- **DEC-S1 — decompose rather than rescale.** Split ground slope from step
  height, over the two alternatives (one distance-scaled threshold; raising the
  0.5 m constant). Both alternatives make walls climbable from a neighbouring
  cell, which is the property the column model exists to provide.
- **DEC-S2 — `MAX_GROUND_GRADIENT = 0.5`** (1 in 2, ~26.6°). Above any street or
  promenade; a cliff or retaining wall in a 12 m-post DEM still reads as
  impassable. Keeping NPCs out of the Rhine does not depend on it — the bank
  geometry does that — so a generous limit costs nothing there.
- **DEC-S3 — no climb cost.** Out of scope; `agent-route.ts`'s horizontal-only
  cost decision stands.

---

## 4. Milestones

1. **The predicate.** `Column.groundM`, `MAX_GROUND_GRADIENT`, the decomposed
   rule in `columnsAdjacent`, and its property invariants (symmetry, reflexivity,
   monotonicity in BOTH limits, the absolute rule preserved when `groundM` is
   absent). Sidecar updated.
2. **The state space.** `columnSpace` derives and attaches `groundM`, threads
   `maxGroundGradient`, and pins "the lowest level is the ground" against
   `obstacleLevelsAt`. Sidecar updated.
3. **The reported case, end to end.** A demo-level route test over a ground
   field at the measured Cologne grade: red before the fix, green after, and a
   control at a grade steep enough that the refusal is still correct.
4. **Docs.** `ARCHITECTURE.md` §7 gains the slope clause; this plan gains its
   results.

## 5. Verification

- `column.test.ts` / `column.property.test.ts` — the rule and its invariants.
- `column-space.test.ts` — ground derivation, and the flat control that proves
  the wall fixtures are unmoved.
- `agent-route.slope.test.ts` (demo) — **the regression guard**: a route across a
  12 % grade exists, and a route up a 100 % cliff still does not.
- The full gate of each package touched.

---

## 6. Results (2026-08-18)

**Shipped, and the reported case is fixed.** The same real-data reproduction as
§1.1 — live Overpass extract, Terrarium tile 13/4254/2744, through
`planRouteWithIndex` — now routes in all eight directions:

```
30 m N : ground 45.5 m, route = 6 points     (was NONE)
30 m NE: ground 43.3 m, route = 6 points     (was NONE)
30 m E : ground 41.2 m, route = 6 points     (was NONE)
30 m SE: ground 46.1 m, route = 6 points     (was NONE)
30 m S : ground 51.6 m, route = 7 points     30 m W : ground 50.2 m, route = 5 points
30 m SW: ground 51.2 m, route = 5 points     30 m NW: ground 47.7 m, route = 5 points
```

Water is unaffected: the cells across the Rhine bank are still unreachable, as
they were before, because that veto is `crossesObstacle` and not a height rule.

### What changed against the plan

**The rule is a UNION of two readings, not a straight replacement** — this is the
one substantive departure from §2 and it was forced by a case found while
re-deriving the arithmetic:

> An agent on an 8 m wall top, stepping onto a terrace whose own ground is 8 m
> up. Both surfaces are at the same height and the move is horizontal, but the
> two GROUNDS differ by 8 m, so a decomposition-only rule refuses it — removing
> an edge that exists today.

So a step is admitted when **either** reading accepts it: the absolute change
between the two surfaces against `stepThresholdM` (**the old rule, verbatim**),
or the ground grade plus the height-above-ground step. Two consequences worth
naming:

- **The change can only ADD edges**, since one arm is the previous rule. No route
  a caller has today can vanish. `column.property.test.ts` machine-checks it.
- **A caller who had tuned `stepThresholdM` upward keeps exactly what they had.**
  The `column-space.test.ts` "walks over the wall once the agent can climb it"
  control passes unchanged, which it would not have under a pure decomposition.

Two fixtures did change meaning, both honestly:

- `column-space.test.ts` "routes THROUGH a same-cell level change" was built on
  cells with a single level each and an origin 0.5 m below its neighbour, so its
  blocked moves were blocked by an ABSOLUTE difference that the ground rule now
  reads as a 7 % slope and walks. Rebuilt with a flat ground and a ladder of
  levels above it, so the offsets do the blocking and no slope allowance exists.
- `columnsAdjacent` with a **non-finite** `groundM` now falls back to the
  absolute rule rather than refusing. The heights are still known; a DEM miss
  costs only the ability to tell a hillside from a wall, which is exactly what an
  absent ground already describes.

### Milestones, as delivered

1. **The predicate** — `Column.groundM`, `MAX_GROUND_GRADIENT`,
   `neighbourSpacingM`, `StepLimits`, the union rule. `columnsAdjacent`'s third
   parameter changed from `stepThresholdM: number` to a `StepLimits` object;
   the package has no external consumers, so this is a clean break rather than
   an overload. **Mutation-checked**: reverting the decomposition fails 5 of the
   new assertions.
2. **The state space** — `columnSpace` resolves the ground per cell inside
   `canEnter` (not from the states handed to it, which is what the search's
   caller-built start state would have broken), memoises `levelsAt` for the life
   of the space, and threads `maxGroundGradient`. `obstacles.test.ts` pins
   "the lowest level is the ground" at four ground heights.
3. **The reported case** — `agent-route.slope.test.ts` in the demo: a route down
   and up the measured 24 % grade, with a 150 % cliff and a sealed wall on the
   same slope as controls. Red before the fix, green after.
4. **Docs** — `ARCHITECTURE.md` §7, `column.ts.md`, `column-space.ts.md`,
   `obstacles.ts.md`, `agent-route.ts.md`, the progress log and two
   `lessons-learned.md` entries.

### Still open

- **`MAX_GROUND_GRADIENT` cannot distinguish a 26° hillside from a 2 m retaining
  wall smeared over one cell.** Mapped barriers refuse those; an unmapped
  retaining edge under the limit stays walkable. Not fixable at this resolution,
  recorded in `column.ts.md` rather than left implicit.
- **Cost is still horizontal-only** (DEC-S3), so an agent takes a steep shortcut
  over a gentle path of the same ground distance.

### 6.1 Corpus-wide effect, and the zero-regression check

Measured after the fix over the **checked-in six-site corpus** plus the real
Terrarium z13 tile for each centre. 25 start points per site on a 60 m lattice,
each routed 30 m in 8 directions — 200 routes per site — through
`columnSpace` + `findCheapestPath` with the real obstacle index.

**`maxGroundGradient: 0` reproduces the OLD rule exactly**, which is what makes
this a true A/B in one binary: with a zero grade allowance the second arm
degenerates to `|Δground| = 0 ∧ |Δoffset| ≤ step`, i.e. the absolute rule, which
is the first arm.

- `heidelberg-altstadt` (the relief site) — **73 → 80** of 200
- `cologne-cathedral` — **115 → 116**
- `london-tower-bridge` — **172 → 183**
- `berlin-alexanderplatz` — **145 → 145**
- `manhattan-midtown` — **120 → 120**
- `tokyo-shinjuku` — **49 → 136**

**Zero regressions across all 1 200 routes**, which is the "can only add edges"
property observed rather than argued.

**Tokyo Shinjuku is the site that was most broken** — it lost more than half its
destinations to a rule about kerbs — and nothing in the package would have said
so, because no route test has ever run over any corpus site.

⚠️ **And the honest reading of the same run: `MAX_GROUND_GRADIENT` does not bind
anywhere in the corpus.** Re-running with the limit effectively removed
(`maxGroundGradient: 1000`) yields **exactly** the post-fix figures at all three
sites checked — Heidelberg 80, Tokyo 136, Manhattan 120. So every refusal that
survives the fix is **geometry** (a destination inside a building, a barrier,
water), not slope, and DEC-S2's value is under-determined by this evidence: 0.3
and 1.0 would have produced the same corpus numbers. The value matters only where
a DEM resolves something genuinely cliff-like, which these six cities do not
contain at 12 m posts.

**Corollary worth knowing when the next report arrives:** "the agent cannot reach
that spot" is still the correct answer for a click **inside a building** — a cell
with no standable level — and that is now the commonest cause of the message
rather than the rarest. Manhattan refuses 80 of 200 for exactly that reason.
