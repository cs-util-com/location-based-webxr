# The worker transfer list has an untestable claim beside an unexplained regression

**Filed:** 2026-08-18, from the PR #315 review.
**Status:** open — a **test-coverage gap**, not a known defect. The suite is
green today.

## What is there

`transferablesOf` in [`worker/demo-worker.ts`](../src/worker/demo-worker.ts)
moves each chunk's `positions`, `normals` and `indices` buffers to the main
thread, plus — since the AR shell work — `height01` and `featureRand`.

`colors` is **deliberately absent**, and its comment says why:

> Adding it on 2026-08-16 turned the demo's e2e suite red — so something
> downstream re-reads that buffer after the post, and transferring it detaches
> the worker's copy. **Reverted rather than chased**, and filed.

The two shell attributes are justified beside it as: *"they are new, and nothing
but the AR material reads them."*

## Why that justification cannot currently be checked

The review's point, verified here:

- **`transferablesOf` is unreachable from a unit test.** `demo-worker.ts`
  registers a `self` listener at import — the very reason
  `obstacle-index-cache.ts` was extracted to be testable.
- **`mesh-shell-attributes.test.ts` tests `chunkMeshes` output**, i.e. the state
  *before* the post, so it cannot observe a detached buffer.
- **The AR material that reads `height01` / `featureRand` only runs inside a
  WebXR session**, which the demo's Playwright suite never enters.

So the exact detector that caught `colors` — the e2e suite — has **no coverage
for the two buffers added next to it**, and the failure mode is silent: the
worker is left holding a zero-length `Float32Array`.

## What was checked, and what it does and does not settle

`height01` / `featureRand` are consumed on the **main thread** by
[`mesh-layers.ts`](../src/mesh-layers.ts) (L418–427), which wraps them in
`THREE.BufferAttribute`. **Transferring is correct for that consumer** — the
main thread wants ownership.

That is consistent with the comment's claim, so nothing here contradicts it.
**It does not settle the question**, because the risk is not the main thread
reading them; it is the **worker retaining a chunk and re-reading it after the
post**, which is precisely the shape the `colors` failure had and precisely what
no test observes.

## Options

- **Option A — chase the `colors` cause first.** Find what re-reads that buffer
  after the post; the answer almost certainly decides the other two as well.
  - **For:** it is the only route that replaces a plausible claim with a known
    one, and it retires a filed unknown that is now shaping later decisions.
  - **Against:** an open-ended debugging task against an e2e failure whose cause
    resisted one attempt already.
- **Option B — drop the two from the transfer list until an AR-path check
  exists.** The review's own suggestion.
  - **For:** removes the risk outright, and the structured-clone cost of two
    `Float32Array`s per chunk is small next to `positions`/`normals`/`indices`,
    which are transferred anyway.
  - **Against:** removes a working optimisation on **suspicion rather than
    evidence** — the suite is green with them in. That is a real cost: "revert
    anything we cannot test" would have removed the transfer list entirely.
- **Option C — make the seam testable.** Extract `transferablesOf` the way
  `obstacle-index-cache.ts` was extracted, and unit-test that every buffer it
  lists is one no one re-reads.
  - **For:** fixes the reason this is unanswerable, and CLAUDE.md's rule is that
    when a guard *should* have caught something, fixing the guard is part of the
    fix.
  - **Against:** a unit test on the list still cannot prove nothing re-reads a
    buffer — that is a whole-program property. It narrows the gap without
    closing it.

**Recommendation: C, then A.** Extraction is cheap and unblocks any later
answer; chasing `colors` is the only thing that actually settles it. **B is not
recommended now** — reverting a green optimisation on suspicion trades a
hypothetical silent failure for a certain performance loss, and the same
argument would justify undoing the transfer list wholesale.

## Related

- `worker/demo-worker.ts` — `transferablesOf` and the `colors` note
- `src/mesh-layers.ts` L405–457 — the main-thread consumer
- `worker/mesh-shell-attributes.test.ts` — covers `chunkMeshes`, before the post
