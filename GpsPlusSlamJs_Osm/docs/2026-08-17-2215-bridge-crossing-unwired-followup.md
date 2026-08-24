# `isBridgeCrossing` ships unwired — bridge routing is red

**Filed:** 2026-08-17, from the PR #313 review pass
([report](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/location-based-webxr_pr_review_comments_handled.md)).

> ## ✅ RESOLVED the same day — owner chose "wire it now"
>
> This file was written recommending **Option B** (leave red, document it). The
> owner overrode that and chose to wire it, which was the better call: the
> mechanism turned out to be one the codebase already had, so none of the three
> "unanswered questions" below actually needed answering.
>
> **What shipped:** `bridgeDeckLines()` in
> [`nav/obstacles.ts`](../src/nav/obstacles.ts) collects every ground-level deck
> once per index build and attaches them to each water obstacle as **`passages`**
> — the field `blockedDespitePassages` already consumes for building passages.
>
> **The "how wide is the opening" question dissolved.** It was the question that
> made this look risky, and it was a wrong question: the answer is
> `PASSAGE_CORRIDOR_M`, already chosen, already justified against the res-13
> lattice, already tested. Cutting the ring — the approach this file assumed —
> is not merely harder but **impossible**: `segmentCrossesRing` treats a ring as
> closed whether or not the first vertex was repeated, which
> `blockedDespitePassages`'s own docstring had recorded since 2026-08-10.
>
> **The lesson worth keeping: this file over-estimated the work because it
> reasoned from the reviewer's suggested mechanism ("cut the bank rings, the way
> `barrier-gates.ts` cuts a barrier centreline") instead of from the codebase.**
> The reviewer's finding was right and its proposed fix was wrong, and those are
> separate judgements.
>
> **Tests:** three in `obstacles.test.ts` — a step across the bank at the deck is
> admitted, the same bank away from the deck still blocks, and a non-ground-level
> `bridge` (the 4-of-18 case) does not open anything.
>
> The sections below are kept as the state of knowledge when the decision was
> made.

## The defect, stated plainly

**An NPC cannot route across any bridge over water.** `addWater` bands every ring
of every `natural=water` feature, and `crossesObstacle` rejects any step that
crosses a bank ring. A bridge deck crosses its river's banks by definition, so
the step is refused. `london-tower-bridge` is in the **shipped site picker
corpus**, so this is reachable from the UI, not hypothetical.

`nav/obstacles.ts:289` already documents this accurately:

> ⚠️ **NO BRIDGE EXEMPTION YET, AND WATER IS LIVE IN THE DEMO — so a route over
> a bridge is refused right now.**

## Why this is worth a file rather than a silent TODO

**The fix was written and then not connected.** `isBridgeCrossing` was added in
the same PR (`6f1988db`, "add isBridgeCrossing, the ground-level bank opener"),
lives in [`mesh/roads.ts:193`](../src/mesh/roads.ts), is exported from
`mesh/index.ts`, and is pinned against a real Tower Bridge extract by
`bridge-crossing.corpus.test.ts` — **14 of 18 `bridge`-tagged ways** are
ground-level decks, with bare `bridge=*` (18) and `bridge=yes` (8) both measured
and rejected as the selector.

Its **only importers are `mesh/index.ts` and two test files.** There is no
production consumer. Verified 2026-08-17 against the workspace, four branches
after the PR that added it — so this is not a mid-PR snapshot.

A predicate whose entire justification is *"the opener for a water bank
(DEC-R1)"*, sitting beside a warning that nothing opens a bank, reads to the
next person as if it were live. That is the actual hazard here: not the missing
feature, but the **appearance of a shipped one**.

## What the wiring would involve

`barrier-gates.ts` is the precedent — it cuts a barrier centreline where a gate
is mapped on it. The analogue is to cut the bank rings where a ground-level deck
crosses them, in `addWater` (or immediately after it) inside
[`buildObstacleIndex`](../src/nav/obstacles.ts).

Open questions that make this a decision rather than a task:

- **Where does the cut go — the bank ring, or the step test?** Cutting the ring
  changes the indexed geometry for every consumer; special-casing
  `crossesObstacle` keeps the index honest but puts routing knowledge in the
  obstacle test.
- **How wide is the opening?** The deck has width; the bank ring is a line. Too
  narrow and the route still fails; too wide and an agent walks off the deck
  into the river, which is the defect `addWater` exists to prevent.
- **What about the 4 of 18 that are not ground-level decks?** They must stay
  closed, and there is currently no test that an agent cannot route along one.

## Options

- **Option A — wire it now.** For: a corpus-pinned predicate already exists, and
  the site is in the shipped picker. Against: the three questions above are all
  unanswered, and the failure mode of getting the width wrong is "agent walks
  into the Thames" — worse than the current honest refusal.
- **Option B — leave red, keep it documented (status quo + this file).** For: the
  current behaviour is a clean refusal, not a wrong route. Against: a shipped
  site that cannot be routed is a visible defect.
- **Option C — remove `london-tower-bridge` from the picker corpus until wired.**
  For: removes the reachable broken case without touching routing. Against:
  hides the gap rather than closing it, and the corpus is also test input.

**Recommendation: B for now, and A as its own planned piece of work** — the
width question needs a measurement, and CLAUDE.md's rule for exactly this shape
is to file rather than to improvise a geometry decision inside an unrelated pass.

## Related

- [`mesh/roads.ts`](../src/mesh/roads.ts) — `isBridgeCrossing`
- `src/mesh/bridge-crossing.corpus.test.ts` — the 14/18 pinning
- Sibling follow-up filed the same day:
  [`2026-08-17-2210-obstacle-index-water-clipping-followup.md`](./2026-08-17-2210-obstacle-index-water-clipping-followup.md)
