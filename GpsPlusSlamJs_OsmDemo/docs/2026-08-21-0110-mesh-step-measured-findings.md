# The mesh step, measured — two hypotheses killed, one load-bearing guard found

Measurements taken 2026-08-21 on devbox-win11 (Node 24.14.1), machine verified
quiet (0 competing processes). Follows
[the plan](./2026-08-20-2340-mesh-step-dominates-the-map-click-plan.md).

Owner's report: a map click costs **12 400 ms**, of which `mesh` is **9 468 ms
(76 %)** and `queue` 2 448 ms (20 %), with fetch/parse/merge all 0 ms.

## The headline for the owner's actual question

**"Is the mesh step needed for the heat map?" — No.** `meshMs` does not time the
heat-map overlay. It wraps `meshUpdateFor` → `buildMesh`, which builds the
**3D scene**: buildings, roads, trees, barriers, area plates, region slabs and
POI markers. The heat map is cell geometry built by `buildCellMesh`, already
benchmarked at **9.9 ms for 2 718 cells**. The two are separable in principle,
so "make it non-blocking for the heat map" is answerable — see the open question
at the end before acting on it.

## What was measured

Real `london-westminster` fixture, replicated on a 0.006° grid (`k×k` copies),
each builder called the way `buildMesh` calls it. At **k=4** (16 copies,
17 552 buildings):

- `buildBuildings` — **465 ms**, 17 552 volumes (~26 µs each)
- `buildAreaPlates` — **128 ms** with the production clip, 1 520 plates
- `annotatePoiHosts` — **118 ms**
- `buildRoads` — **88 ms**, 6 368 ribbons
- `buildPoiMarkers` — **12 ms**, 960 markers
- `buildTrees` — **5 ms**, 1 408 placements

**Total ≈ 816 ms** at that scale.

## Hypothesis 1 — the POI host join. KILLED.

`annotatePoiHosts` walks every (marker, candidate) pair, and its own cost test
asserts `pairsConsidered === markers × candidates`, so the quadratic term is
real and deliberate. The prediction was that this explained the 9.5 s.

Measured growth:

- k=1 — 60 markers × 1 097 candidates = **65 820** pairs, 5 ms
- k=2 — 240 × 4 388 = **1 053 120** pairs, 10 ms
- k=3 — 540 × 9 873 = **5 331 420** pairs, 34 ms
- k=4 — 960 × 17 552 = **16 849 920** pairs, 118 ms

The product relation holds exactly at every scale. **But the constant is ~7 ns
per pair**, not the ~100 ns the prediction assumed — the broad phase really is
four float compares. At the 33 562-candidate operating point the cost is
**~0.43 s**, about 4 % of the reported time. Reaching 9 468 ms this way needs
~1.35 **billion** pairs.

The prediction was wrong by ~20×, and it was wrong in the constant rather than
the exponent. Worth recording: the growth curve was right and the conclusion was
still useless, because a quadratic with a tiny constant beats a linear term with
a large one across every scale that matters here.

## Hypothesis 2 — area plates dominate. KILLED, and it produced the real finding.

The first sub-build measurement put `buildAreaPlates` at **1 947 ms**, four times
the next-largest term. That was an artifact of the spike: production calls it as
`buildAreaPlates(all, { ...options, clipTo: plateClip })` and the spike omitted
`clipTo`.

With the clip restored:

- unclipped — **1 915 ms**, 1 520 plates
- **production clip (±2 400 m × slack) — 128 ms, 1 520 plates**
- deliberately tight clip — 33 ms, 118 plates

### The clip is load-bearing and nothing guards it

**[CORRECTED 2026-08-21] The original wording here said "a 15× speedup for
byte-identical output". The speedup is real and was re-verified; "byte-identical"
was false.**

The first measurement ran the variants in a fixed order, so it could not
separate the clip from JIT warm-up. Re-measured with a discarded warm-up pass
and the variant order alternated across three repeats: **unclipped ~2 160 ms
against ~135 ms clipped**, regardless of which ran first. The ~16× stands.

What was wrong was the claim about the output. Both builds return the **same
1 520 plates**, but not the same geometry:

- unclipped — **329 520** mesh floats
- production clip — **142 530** mesh floats

So the clip removes **~57 % of the vertices** while keeping every plate. The
mechanism is that clipping happens before `ringToEnu` and therefore before
triangulation: a few large ways (parks, water, landuse) reach far beyond the
rendered extent, and trimming them is where the time goes. Equal plate count was
measured and then over-generalised into "identical output" — the kind of
substitution this repo has a lesson about.

**That correction is what made a guard possible.** "Byte-identical" implies
nothing observable to assert; "same plates, far fewer vertices" is a
deterministic, machine-checkable property with no clock in it. It is now pinned
by `GpsPlusSlamJs_Osm/src/mesh/plates-clip.test.ts`, which was
mutation-tested: with `clipTo` ignored, all three assertions fail.

The original consequences still hold:

- Anyone removing or widening `clipTo`, or calling `buildAreaPlates` without it
  from a new call site, gets a ~1.8 s regression **with no visible difference**
  and no test failure.
- `plates.bench.ts` exists but a bench does not fail a gate.
- This is exactly the shape of defect that reaches production: no output change,
  no assertion, only a stopwatch nobody reads.

**DONE 2026-08-21**: `plates-clip.test.ts` asserts equal plate counts and
strictly fewer mesh floats with the production clip, plus a vacuity check that
the fixture genuinely has geometry outside the box. Mutation-tested by making
`polygonsOf` ignore `clipTo`: all three assertions fail on the mutant.

## What is still unexplained, stated rather than guessed

At the operating point the fixtures describe, the full `buildMesh` extrapolates
to roughly **1.5 s**, not 9.5 s. The gap is real and unresolved. Candidates, in
the order worth testing:

1. **The real working set is larger than the fixture's operating point.** The
   most likely explanation and the cheapest to check: log
   `pipeline.features().size` and the building count on the slow click and
   compare against the 17 552 measured here.
2. **The browser/worker environment is not Node.** Different JIT warm-up, and a
   worker under memory pressure from tile payloads. `const all = [...features]`
   materialises the whole feature set on every full build.
3. **Sub-builds not yet measured** — `buildBarriers`, `buildRegionSlabs`,
   `packUnderground`, `dropHostedDuplicates` and the POI assembly.

**Do not optimise anything on the strength of this document alone.** Two
hypotheses died here, one of them mine and confidently argued, and the number
that would settle it — the actual feature count on the slow click — has not been
measured.

## The 20 % queue figure

Consistent with mesh cost being the root of both lines: with fetch/parse/merge at
0 ms, 2 448 ms of queueing means the worker was busy, most plausibly with the
previous ring's mesh. It is not independent evidence and should not be treated
as a second problem until the mesh cost is understood.
