# out-of-view-queue.ts

## Purpose

The out-of-view queue of a deferred anchor set (`deferred-anchors.ts`):
for each pending key or member in an out-of-view run, how many passes it
may wait before its out-of-view commit. The set reports it as `queued` on
every out-of-view commit (`DeferredAnchorCommit`, the commit log line), and
the Tour Viewer's `?debug=1` anchor log checks `outFrames <= queued`.

## Public API

- `interface OutOfViewRunState { outFrames, queued, outSince, lastOutPass }`:
  the fields an entry carries. `outFrames` the consecutive passes out of
  view while pending, `queued` its queue in the current run (0 outside a
  run), `outSince` the pass its run began, `lastOutPass` the last pass it
  was out of view in any run (`-Infinity`: never).
- `freshOutOfViewRun()`: the fields of an entry never out of view.
- `advanceOutOfViewRuns(pass, out, all)`: one pass. `out` the entries out
  of view in it (in any order), `all` every entry of the set. An entry
  starting a run starts with `queued = out.length` (the entries out with
  it, itself included); an entry going out adds one to every run in
  progress that it has not been out during already. Then every entry in
  `out` counts one more out frame.
- `endOutOfViewRun(s)`: the run ends (a commit, back in view, no longer
  pending): `outFrames` and `queued` go to 0; `lastOutPass` stays, so a
  key's later re-entry is recognised.

## Invariants

- The queue counts DISTINCT entries out of view during a run. The set's
  round robin picks one entry per pass, out-of-view entries first, and its
  pointer only moves forward past each pick, so during one entry's run
  every other entry is picked at most once before it. A bound that counts
  every entry going out (each re-entry again) grows without limit under a
  churning ring and lets a starved entry pass; the most entries out at
  once is too small (a key waits for keys that went out after it).
- A paused run (a pass of the deferred set with no previous view, `!hasPrev`: the build path) is outside the property oracle's scope. Such a pass sorts no entry, so it picks none and calls `advanceOutOfViewRuns` with no entry out: no run advances, ends or gains a queued entry, and no entry is served ahead of a waiting one. `queued` and `outFrames` stand still across it, so the bound still holds when the run resumes.
- `pass` must increase by one per call within one set; the caller keeps
  the clock. An entry handed to another set starts with
  `freshOutOfViewRun()`, since pass numbers are per set.
- Pure: no three.js, no store, no allocation beyond the `entering` filter.
  Cost per pass is `O(entries x entries going out this pass)`, small for
  the set's sizes (one traversal per pass dominates).

## Example

```ts
const k = { ...freshOutOfViewRun() };
const x = { ...freshOutOfViewRun() };
advanceOutOfViewRuns(0, [k, x], [k, x]); // k.queued 2
endOutOfViewRun(x); // x committed
advanceOutOfViewRuns(1, [k, x], [k, x]); // x again: k.queued stays 2
```

## Tests

- `out-of-view-queue.test.ts`: the churn case (keys going out one after
  another while one waits) stays within its queue, the same sequence as
  the set's churn test in `deferred-anchors.test.ts`; a starved key behind
  a ring of two churning keys is over its queue (8 frames, queue 3; the
  old count of every entry gave 8); a key out only in an earlier run
  counts again in the next.
- `out-of-view-queue.property.test.ts`: over random pass sequences (5
  entries, up to 40 passes), every run's `queued` equals the distinct
  entries out of view during it, recomputed by brute force, and its
  `outFrames` the passes since it began.
- `deferred-anchors.test.ts` ("frames waited"): the set's commit lines
  carry the queue from this bookkeeping.
