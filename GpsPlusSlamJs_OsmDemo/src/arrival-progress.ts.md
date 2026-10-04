# arrival-progress.ts - the arrival prefetch's progress, 0 to 1

- Purpose: turn the arrival prefetch's real signals (jobs settled as cache
  hits, fetches or failures) into the one number the globe's flight clock
  reads every frame (round-5 plan
  `2026-10-01-0945-globe-round-5-fly-in-and-terrain-blend-plan.md` §3.6;
  the globe package's `flight-pace.ts`). Pure.
- Public API:
  - `JobCounts` `{ total, warm, fetched, failed }`, `ArrivalCounts`
    `{ overpass, dem }`.
  - `ARRIVAL_JOB_WEIGHTS` - expected bytes per job: Overpass 21 MB (a cold
    res-7 tile, `fetch-extent.ts`), DEM 0.2 MB (between an AWS PNG and a
    Mapterhorn WebP).
  - `arrivalProgress(counts, weights?)` - the share of the expected bytes
    whose jobs have settled, in [0, 1]; 1 exactly when settled; an empty
    plan is 1.
  - `arrivalSettled(counts)` - whether every job has settled.
- Invariants & assumptions:
  - A failure counts as settled: the number answers "how much of the wait
    is over", and waiting longer for a failed job warms nothing. How much
    actually warmed is `warm + fetched` in the counts.
  - Weighted by bytes, so eight DEM tiles landing in a second do not read
    as 80 % done while the one Overpass tile that matters has not started.
  - Never 1 before everything settled (clamped below 1 against rounding):
    the flight reads 1 as "go".
  - Defensive: a count that is NaN, negative or fractional is floored to a
    non-negative integer; settled jobs beyond the total are capped.
- Examples:

  ```ts
  arrivalProgress({
    overpass: { total: 2, warm: 0, fetched: 1, failed: 0 },
    dem: { total: 18, warm: 0, fetched: 0, failed: 0 },
  }); // about 0.46
  ```

- Tests: `arrival-progress.test.ts` - 0 before anything, 1 when settled
  whichever way, the byte weighting, the empty plan, the defensive clamps,
  and two properties over random counts: bounded and never falling as jobs
  settle, and 1 exactly when settled.
