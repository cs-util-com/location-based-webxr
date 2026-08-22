# `ar-walking.ts`

## Purpose

The two pure decisions AR makes while the user walks: whether this position
change should trigger a refetch, and whether to warn about drift.

## The failure it prevents is silent work — AR milestone 3

The demo has no GPS→position path today; every position change comes from the
map, and `positionChanged` fires `loadTerrain` and `refresh` on each one with no
gate. Wiring the framework's GPS watch in looks like one line, and **that line
starves the cycle** (plan §2.6):

- `refresh` is `latestOnly` — a new run aborts the one in flight.
- A watch delivers roughly 1 Hz; a scoring pass takes 15–90 s.
- So every run is aborted by the next and **nothing ever publishes**. No error,
  no empty state, no failed request. Just a view that never changes while the
  worker runs flat out.

## Public API

- `AR_REFRESH_DISTANCE_M` — 100 m.
- `FAR_TRAVEL_WARN_M` — 2000 m.
- `shouldRefreshFor({ from, to, passInFlight }): boolean`
- `farTravelMessage(distanceM): string | null`

## Invariants & assumptions

- **The gate is closed by EITHER condition**, and `passInFlight` is not implied
  by the distance: a fast walker crosses the threshold again before a slow pass
  finishes, and re-triggering there aborts the run that was about to publish.
- **`AR_REFRESH_DISTANCE_M` is bounded from both sides, and the bounds are what
  the tests pin** — the number is a choice inside them.
  - **Above ~30 m**, because an urban fix wanders 10–30 m while the phone sits
    still. A threshold inside that band turns standing on a corner into a
    continuous refresh loop: the starvation case with no walking involved.
  - **Below ~124 m**, because the scoring working set reaches ~326 m
    (`SCORE_DISK_MAX_RADIUS = 4`). A refresh triggered after D metres lands
    1.4·T metres later at walking pace, so the user is `D + 1.4·T` from the last
    scored centre when the data arrives — `D + 126` at the 90 s worst case. Past
    250 m they are standing outside the scored disc.
  - **`T` is the 90 s END, not a "typical" pass.** `resolutions.ts` measured
    15.1 / 32.9 / 82.9 / 91.1 s across four fetches and says outright that "a
    single latency quoted here is quoting noise", with three prior retractions
    on record for exactly this pattern. An earlier version of this file called
    15 s typical; it is the fastest of the four (r509 review).
  - **The upper bound is what the 30 m lower one is NOT.** A too-low threshold
    wastes a 21 MB fetch and a re-scored working set per completed pass — it
    cannot starve the cycle, because `passInFlight` makes that impossible at any
    threshold. Saying otherwise (as this file did) is the argument someone would
    later use to decide the flag is redundant.
- **§2.6 asked for the threshold and the PREFETCH RING to be chosen together,
  and only the threshold was chosen.** Recording the state honestly rather than
  claiming the pairing was done: `prefetch.replace(neighbourTilesFor(position))`
  runs inside the worker's `update` handler, so the ring is now refreshed once
  per 100 m instead of once per fix. It is derived from a res-7 cell (inradius
  ~1218 m), which is an order of magnitude beyond the gate, so it is very likely
  still sufficient — **"very likely" is exactly the state §2.6 asked not to be
  left in, so M4 measures it.**
- **`FAR_TRAVEL_WARN_M` is the LOWER edge of an open band. There is no upper
  one**, and the "2–5 km" this replaced was a real defect rather than a wording
  slip (r504 review): 5000 m is `REANCHOR_THRESHOLD_M`, so a band ending there
  stops warning exactly where the projection error is worst and — since AR
  suppresses the re-anchor — where nothing else will fire either.
  - It sits BELOW the re-anchor threshold so the two cannot collide: the user
    hears about drift before the distance at which un-suppressed code would have
    re-taken the origin.
- **Report, do not correct** (§2.4). `zero` is immutable and re-anchoring
  mid-session would reintroduce the disagreement the fixed-origin work removed,
  so the honest response to drift is to name it — with the number, because the
  user's decision is whether to reload the page here. NOT "leave AR and
  re-enter": `setZeroPos` is a no-op once set, so a new session re-reads the
  same `zero` and the drift is unchanged (r509 review).
- **Both functions are closed/silent on non-finite input.** `greatCircleDistance`
  returns `NaN` rather than throwing and every comparison against `NaN` is
  false, so "never refresh again" is what a bad fix produces anyway — this makes
  it the deliberate answer rather than an accident of operator choice.
- **`> threshold`, matching `nextAnchor`'s convention**, so the two modules round
  the same way.

## Examples

```ts
if (shouldRefreshFor({ from: lastRefetchedAt, to: fix, passInFlight })) {
  // …refetch terrain AND scoring, from this one position
}
const warning = farTravelMessage(distanceFromZero);
if (warning !== null) showError(warning);
```

## Tests

`ar-walking.test.ts` — the small-step refusal, a real walk passing, the
in-flight veto holding at ten times the threshold, the boundary, the four
jitter distances, the worst-case-pass inequality (asserted as a RELATIONSHIP, so
it survives a change to the constant only if the reasoning survives too), and
`NaN`. For the warning: silence below, fires at the threshold, still fires at
5001 m and 50 km, sits below the re-anchor threshold, names the distance.

The state this needs to be useful lives in
[`ar-walk-controller.ts`](ar-walk-controller.ts.md); that it is CALLED at all is
pinned by `ar-walk-wiring.test.ts`.
