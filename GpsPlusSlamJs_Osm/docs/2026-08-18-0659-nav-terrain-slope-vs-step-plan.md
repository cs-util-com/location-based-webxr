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
bounded — real res-13 neighbours are 5.18–7.82 m apart worldwide against the
model's 7.088 m, so the worst case is an effective gradient of 0.453 instead of
0.5. **This paragraph claimed the error "errs permissive"; it does not** — see
§6.2. A
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

One fixture changed meaning, and one thing that reads like a second did not:

- `column-space.test.ts` "routes THROUGH a same-cell level change" was built on
  cells with a single level each and an origin 0.5 m below its neighbour, so its
  blocked moves were blocked by an ABSOLUTE difference that the ground rule now
  reads as a 7 % slope and walks. Rebuilt with a flat ground and a ladder of
  levels above it, so the offsets do the blocking and no slope allowance exists.
- `columnsAdjacent` with a **non-finite** `groundM` falls back to the absolute
  rule rather than refusing — the heights are still known, and a DEM miss costs
  only the ability to tell a hillside from a wall, which is what an absent ground
  already describes. **This is a pure addition, not a changed fixture** (PR
  review): `groundM` did not exist before this commit, so no shipped behaviour
  moved. Listing it beside the rewrite above made the change look larger and less
  safe than it is.

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

**No refusal that survives the fix is caused by the slope limit.** Re-running with
the limit effectively removed (`maxGroundGradient: 1000`) yields **exactly** the
post-fix figures at all three sites checked — Heidelberg 80, Tokyo 136,
Manhattan 120. Every surviving refusal is **geometry**: a destination inside a
building, a barrier, water.

⚠️ **An earlier draft of this paragraph read "`MAX_GROUND_GRADIENT` does not bind
anywhere in the corpus" and called DEC-S2 under-determined. Both were wrong**, and
they were wrong in the same way: a conclusion about individual STEPS inferred from
a measurement of route OUTCOMES. See §6.2, which measures the steps.

### 6.2 Does the rail ever fire? — measured at the step, not the outcome

§6.1's first draft concluded from equal route counts that the gradient limit
never binds. **That does not follow**: a blocked step only changes an outcome when
there is no way around it, and on open ground there almost always is. Measured
directly instead — every res-13 cell within ~300 m of a point, each of its six
neighbours, the ground step between them against the 3.54 m that a 0.5 grade buys
over the 7.088 m model run:

| site | steps | blocked (> 0.5) | > 0.3 | > 1.0 | steepest step |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cologne Frankenwerft | 39 180 | **0.21 %** | 1.04 % | 0 % | 4.16 m |
| Heidelberg castle | 38 826 | 0.20 % | **16.82 %** | 0 % | 4.01 m |
| Tokyo Shinjuku | 38 550 | 1.51 % | 5.23 % | 0.08 % | 9.03 m |
| San Francisco, Filbert St | 37 056 | 0.35 % | 9.03 % | 0 % | 4.27 m |
| Rio, Morro Dois Irmãos | 37 512 | 3.00 % | 7.60 % | 0.39 % | 12.42 m |
| Hong Kong, Victoria Peak | 38 394 | **22.86 %** | 43.22 % | 3.69 % | 16.01 m |
| Cliffs of Moher | 38 568 | 18.15 % | 28.40 % | 9.46 % | **45.32 m** |
| Lauterbrunnen wall | 38 226 | **26.03 %** | 36.46 % | 13.04 % | 25.96 m |

Terrarium z13 for each site; the last five are outside the corpus and were chosen
because they have relief the six shipped sites do not.

**Three conclusions, and the third replaces DEC-S2's rationale.**

- **The rail fires everywhere, including at the reported location** — 0.21 % of
  steps at the Frankenwerft. The accurate version of §6.1's claim is the narrow
  one: it never changed whether a **destination** was reachable in that
  1 200-route sample, because the agent detours around the few blocked steps.
- **It is load-bearing where cliffs exist.** A fifth to a quarter of all steps at
  Moher, Victoria Peak and Lauterbrunnen, with single steps dropping **45 m**
  between adjacent cells. The six-site corpus containing nothing steeper than 0.60
  is a fact about the corpus, not about the rule.
- **0.5 is no longer a defensible guess; it is the value the evidence picks.**
  - **0.3 would be actively harmful:** it refuses **16.8 %** of steps around the
    Heidelberg castle hill — ordinary walkable hillside, i.e. the reported defect
    returning in a milder form.
  - **1.0 would be meaningfully less protective:** it admits 9.5 % of Moher's
    steps and 3.7 % of Victoria Peak's that 0.5 refuses — real cliff faces.
  - 0.5 sits in the gap: 0.2–1.5 % of city steps, most genuine cliff steps.

⚠️ **Nothing in the test suite can exercise this**, because no corpus site has the
relief for it — filed as
[`2026-08-18-0905-nav-corpus-has-no-relief-followup.md`](2026-08-18-0905-nav-corpus-has-no-relief-followup.md).

**Corollary worth knowing when the next report arrives:** "the agent cannot reach
that spot" is still the correct answer for a click **inside a building** — a cell
with no standable level — and that is now the commonest cause of the message
rather than the rarest. Manhattan refuses 80 of 200 for exactly that reason.

---

## 7. Cold review, and what it changed (2026-08-18)

The review required by the plan-to-pr loop's Phase 2 did not run before this
shipped — the session's harness forbids launching sub-agents unasked, and the
owner authorised it afterwards. It ran against the plan plus commits `0ea91ba2`
and `5b17de20`. **Eight findings, all accepted**; each was independently
re-measured before being applied, and two came back worse than reported.

### 7.1 Accepted and fixed

- **A refusal on steep open ground went from instant to cap-bound.** Contour
  steps stay legal at any grade, so on an open cliff the frontier is an unbounded
  line rather than empty. Reproduced: the `agent-route.slope.test.ts` plane at
  grade 1.5 exhausts 20 000 expansions in **481 ms** and 60 004 `levelsAt` calls,
  against 3 ms and 23 calls for the walkable case. The expansion cap doubles as
  the worker's publish-latency bound (`route-order.ts`), so this is user-visible.
  **Accepted as a known cost rather than fixed**: it is the same cost
  `agent-cycle.ts` already documents for every unreachable click ("'No route' is
  the SLOWEST reply, not the quickest"), and the UI already shows a wait for it.
  Now named in `column.ts`, `column.ts.md` and `ARCHITECTURE.md`.
- **The safety claim was scoped too widely.** "Can only add edges" is a property
  of the PREDICATE; a bounded search built on it can reach its cap sooner, and
  `planRouteWithIndex` reports a cap as `undefined`. Corrected everywhere it
  appeared, with §6.1's 1 200-route zero-regression measurement as the empirical
  bound.
- **`agent-route.slope.test.ts` › "refuses a cliff" passed for the wrong reason** —
  its `undefined` came from the cap, not from a refusal, so it could not tell
  "too steep" from "gave up", and it burned the full budget on every unit run.
  Both refusal controls now name their own `maxExpansions`, and a new test
  asserts the refusal at the step predicate, where it can be stated without
  ambiguity. The file's unit time falls from ~1.2 s to ~0.9 s with one more test.
- **The property suite did not cover what the docs claimed for it.** Symmetry,
  reflexivity, step-threshold monotonicity and the ring-2 oracle all ran on an
  arbitrary carrying no `groundM`, so every one proved its invariant for the
  original arm only. The grounded arbitrary is hoisted and those four now run
  over both shapes; the ring-2 case also sweeps the gradient.
- **`column.ts.md`'s worked example still called the old signature**
  (`columnsAdjacent(foot, top, 10)`), in the very commit that changed it.
  Markdown is not type-checked, which is why the gate stayed green.
- **§6 called the non-finite-`groundM` case a changed fixture.** It is a pure
  addition — the field did not exist before — and describing it as changed made
  the diff look riskier than it is. Corrected above.
- **The perf follow-up's headline numbers did not reproduce**, and its 14×
  comparison was ~4× off. Re-measured over 1 200 distinct pairs and corrected in
  place, together with the end-to-end 35 % saving that actually decides whether
  the work is worth doing.
- **`grounded()` allocates two objects per edge.** Noted in the follow-up so it
  is priced with the rest of that work rather than separately.

### 7.2 The claim that was worse than the review said

**"The average-spacing approximation errs permissive" is false, and not
marginally.** The review measured real res-13 spacing at 5.207–7.817 m globally
against the model's 7.088 m. Re-measured independently over a 24 000-pair global
sample: **5.182–7.818 m, and 64 % of pairs have a real run LONGER than the
model** — so erring strict is the normal case, not the exception the wording
implied.

The consequence is still bounded and the constant still stands: the worst case is
an effective gradient of `0.5 × 7.088/7.818 = 0.453`, which passes any street.
What was wrong was the argument, not the number — a measurement taken at one
latitude was written up as a property of the approximation. Corrected in
`column.ts`, `column.ts.md` and §2, in place rather than by deletion, because the
retracted sentence was the reason to believe the approximation was safe.

### 7.3 Left as reported

- Plan §1.1 and §6's live-data reproductions are **unverifiable offline**, as the
  review notes: nothing in the repo captures the Overpass extract or the DEM tile.
  That is why the shipped guard is a synthetic plane. Accepted — capturing a
  fixture for one bug would add a multi-megabyte file to a package whose corpus
  is already deliberately six sites.
