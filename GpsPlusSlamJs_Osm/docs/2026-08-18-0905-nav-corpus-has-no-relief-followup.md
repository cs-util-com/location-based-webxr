# No corpus site can exercise the slope rule — follow-up

**Status:** filed. Surfaced by the measurement in §6.2 of
[`2026-08-18-0659-nav-terrain-slope-vs-step-plan.md`](2026-08-18-0659-nav-terrain-slope-vs-step-plan.md).

## The gap

`MAX_GROUND_GRADIENT` refuses ground steeper than 0.5 — a 3.54 m step between two
res-13 cell centres. Measured over the shipped corpus at Terrarium z13, the
**steepest single step anywhere in it is 0.60** (Cologne 0.59, Heidelberg 0.57,
San Francisco 0.60 — the last not even in the corpus). Refusals run at 0.2–1.5 %
of steps and never change a route's outcome.

So the rule's **refusal half is untestable against real data we hold**. Every
assertion that a cliff is impassable is made against a synthetic plane
(`agent-route.slope.test.ts`), and the sidecar sentence "a cliff or a retaining
edge the DEM does resolve still reads as impassable" is, on the corpus, unfalsifiable.

For contrast, outside the corpus the same measurement gives **18–26 % of steps
refused** at the Cliffs of Moher, Victoria Peak and the Lauterbrunnen wall, with
single steps dropping up to **45 m**. The rule is real; the corpus simply has no
relief.

## Why this is not just "add a site"

- **A corpus site is an OSM extract, and the gap is in the DEM.** Adding
  `lauterbrunnen` to `testdata/sites/` buys geometry, not elevation — every nav
  test would still run on flat ground unless a heightfield is captured too, and
  nothing in the package captures one.
- **The existing sites are pinned by exact counts.** `site-extracts.test.ts`,
  `site-barriers.test.ts` and `site-obstacle-index-cost.test.ts` assert figures
  per site; `load-fixtures.ts` warns that mixing the two fixture families
  silently changes them because `loadAllFixtures` enumerates its directory.
- **Payload cost is real.** The six sites are 0.3–1.7 MB each and the package is
  deliberately at six.

## Options, cheapest first

1. **Capture a small DEM patch, not a site.** A single 256×256 Terrarium tile is
   ~50–130 KB — an order of magnitude below one OSM fixture — and one steep tile
   (Lauterbrunnen at z13 is 128 KB) would let a test assert the refusal against
   real elevation with no OSM extract at all. The nav rule needs nothing else: it
   reads a `(cell) => number`.
2. **Assert the distribution rather than a route.** Pin that a known steep tile
   produces steps above the limit and a known flat one does not — which is the
   property that actually matters and does not depend on any routing outcome.
3. **Do nothing, and accept that the refusal half is guarded only synthetically.**
   Defensible: the synthetic plane does pin the arithmetic, and the risk is a
   wrong CONSTANT rather than wrong code — which §6.2's measurement now covers
   out-of-band.

Option 1 is the recommendation, and it is small: one tile, one loader, one test.
