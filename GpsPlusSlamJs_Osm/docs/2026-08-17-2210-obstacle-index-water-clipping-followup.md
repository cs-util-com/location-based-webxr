# Water is indexed unclipped in production — follow-up

**Filed:** 2026-08-17, from the PR #313 review pass
([report](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/location-based-webxr_pr_review_comments_handled.md)).
**Status:** open — needs an owner decision, not just an implementation.

## What is true today

`buildObstacleIndex(features, resolution = AFFORDANCE_RES, options = {})` accepts
`options.clipWaterTo?: Bbox` and forwards it to `addWater`
([`nav/obstacles.ts:151,178`](../src/nav/obstacles.ts)).

**Nothing in production supplies it.** The demo's single call site is

```ts
// GpsPlusSlamJs_OsmDemo/src/worker/demo-worker.ts:505
const obstacleIndex = createObstacleIndexCache(buildObstacleIndex);
```

and `createObstacleIndexCache`'s `build` parameter is typed
`(features: Iterable<OsmFeature>) => ObstacleIndex` — **one argument**
([`obstacle-index-cache.ts:71-87`](../../GpsPlusSlamJs_OsmDemo/src/worker/obstacle-index-cache.ts)).
So `resolution` and `options` both default and water is banded **unclipped**.

The only place `clipWaterTo` is ever passed is
[`site-water-index-cost.test.ts`](../src/testdata/sites/site-water-index-cost.test.ts).

## Why it matters

`water.ts:74` gives the size directly: Westminster's Thames relation spans
**16.3 km** inside a 350 m extract.

- **13 052 cells unclipped** against **1 517 clipped**
- stated budget for a whole site's obstacle index: **1 000 – 10 000 cells**

So the shipped path is ~8.6× the measured one and **over** the budget, not
inside it. This is a res-13 `coverCells` sweep paid on the **first route request
of every session that has fetched a tile containing a river** — the cache holds
per key, so it is once per key rather than per request, but it is on the
interactive path.

## What was already done (2026-08-17)

Only the false claim was corrected — the test's `bandCells` docstring said
*"`clipWaterTo` is passed through, so this measures exactly what production
indexes"*, which is inverted. It now states that the clipped columns describe a
path production never takes. **No production behaviour was changed.**

The band-vs-filled comparison the table exists for is unaffected: both columns
are measured identically. What must not be read off it is a budget claim about
the shipped path.

## The decision this needs

Threading a bbox through is not mechanical — it is a choice about *which* box,
and the wrong one silently under-indexes water and lets an agent walk into a
river, which is the defect `addWater` was added to prevent
(`1a04703b`, "water blocks its banks").

- **Option A — thread the fetch/working-set bbox.** `createObstacleIndexCache`
  would need its `build` type widened and the box plumbed from the worker.
  - **For:** restores the measured 1 517-cell figure and puts the index back
    inside budget; the table then describes reality.
  - **Against:** an agent near the clip edge sees water end at the boundary.
    Whether that is reachable depends on the relationship between the clip box
    and the routable area — **this must be measured, not assumed.**
- **Option B — leave production unclipped, keep the corrected docstring.**
  - **For:** no behaviour change, no new edge case; the cost is bounded by the
    cache and paid once per key.
  - **Against:** the 10 000-cell budget stays violated, and the budget stops
    meaning anything if it is documented-but-exceeded.
- **Option C — clip to the working set plus a margin ≥ the agent's horizon.**
  - **For:** the boundary artefact of A becomes unreachable by construction.
  - **Against:** needs the horizon stated as a number somewhere it can be
    checked; a margin nobody can cite decays into A.

**Recommendation: measure before choosing.** The deciding evidence is whether a
routable cell can ever sit within one agent step of the clip boundary. If it
cannot, A is strictly better than B. If it can, C.

**Do not "fix" this by deleting the `clipWaterTo` option** — that would remove
the cheap half of the measurement that makes the gap visible.

## Related

- [`nav/obstacles.ts`](../src/nav/obstacles.ts) — `buildObstacleIndex`, `addWater`
- Sibling follow-up filed the same day:
  [`2026-08-17-2215-bridge-crossing-unwired-followup.md`](./2026-08-17-2215-bridge-crossing-unwired-followup.md)
