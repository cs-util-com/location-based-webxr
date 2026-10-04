# viewer-vote-sink.ts

## Purpose

The viewer's one way into the store for code votes, per visitor AR entry
(Tour Viewer authoring plan
[2026-09-28-0953](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.2, M2e; owner decisions D9, D17, D18). Two jobs, kept together because
both must hold for EVERY vote:

- **One solve per voted lock and per keep-alive tick (D18).** A lock's ring
  is one `recordGpsEventBatch`; a device fix the keep-alive answers travels
  with its ring as one batch, the fix first. Core 1.26 stores the same events
  and solves once; the compass memory steps once per batch (D18).
- **The per-entry solver overrides** (the seam contract in
  `viewer-placement.ts.md`): clear at the entry's start, the soft trimming
  on right before the entry's first vote, and on until AR exit (a tour
  switch included).

## Public API

- `VIEWER_SOFT_TRIM` - the frozen override set M0c adopted:
  `{ outlierFalloffEnabled: true, outlierFalloffRadiusMeters: 1,
outlierFalloffExponent: 1, outlierRejectionEnabled: false }`.
- (module-private) `RETRACT_BATCH_SIZE` (256) - the core's per-batch
  limit, the re-feed's batch size. The framework does not re-export the core's
  `MAX_GPS_EVENT_BATCH_SIZE`; a test reads it from the core the framework
  resolves and pins it to 256 (M5c review L5).
- `startEntryVoteSink(store): ViewerVoteSink` - dispatches
  `setAlignmentOverrides(null)` at once (the entry's FIRST store action from
  the viewer, before any fix or vote, on every entry - a plain-AR one too),
  then returns the entry's sink. `store` needs `dispatch` and `getState`
  (the viewer store, or the vote-strength harness's measured store).
  - `castLockVotes(votes)` - one voted lock: the soft trimming on (once per
    entry), then ONE `recordGpsEventBatch` of the votes. Empty: no-op.
  - `recordFix(fix, ring)` - one device fix: with a non-empty ring, the soft
    trimming on (once), then ONE batch `[fix, ...ring]`; with an empty ring,
    the plain `recordGpsEvent(fix)` and no override change.

## Retracting a moved code's votes (D20, M5c)

- `retractVotes(): { refedFixes, batches }` - the M5a recovery arm the owner
  approved ("refeed-soft-off"): `setAlignmentOverrides(null)` first, then
  `resetGpsSessionData()` (the zero stays), then every device fix this sink
  stored (`recordFix`'s fix, in order; never a ring or a lock vote) re-fed
  in `recordGpsEventBatch` batches of at most 256, one solve each. With
  the soft keys off the result IS the GPS answer; aged-out votes held the
  alignment 5-8 m off after 10 minutes, soft keys off without the reset
  jumped 7.2 m in one fix (results doc "Recovery after a veto").
- **Its cost** (M5c review L1): `ceil(N / 256)` full solves, N being the
  device fixes this sink stored since the entry began (each batch is one
  solve over the whole re-fed history so far). Measured on the desktop
  (2026-10-02, the machine loaded by other sessions' suites, one run each,
  a synthetic 40 m walk): N = 600 in 3 batches 82 ms, N = 1,800 in 8
  batches 193 ms, N = 3,600 (an hour at 1 Hz) in 15 batches 525 ms. It runs
  once per veto, synchronously in the store subscription that judged the
  code; on a phone expect several times that (not measured).
- **A recording of the entry carries the device fixes twice** after a veto
  (M5c review L4): the original dispatches, then the reset and the re-feed
  batches. A replay is right as it stands; any other recompute of the
  recording must honour the reset (`tour-viewing-actions.ts.md`,
  `codeIgnored`).
- The soft trimming is marked off, so the next vote (another code's) turns
  it on again before it is stored.
- What the re-feed cannot carry: a device fix stored before this sink
  existed (none in the viewer: the sink is created at the entry's start,
  before its first fix), and another code's earlier votes - they go with the
  vetoed code's (that code's keep-alive re-votes while it holds).

## Invariants & assumptions

- **No vote reaches the solver under the hard trim**, because every viewer
  vote goes through `castLockVotes` or `recordFix` and both turn the soft
  trimming on first. The keep-alive is unsafe under the hard trim (M2b/M2d
  milestone review #3: B = 5 m fails the rule, 8 m jumps, 15 m never hands
  off).
- **The soft trimming never outlives its entry, and is never turned off
  inside it.** The core keeps overrides across `resetGpsSessionData`, and
  the soft kernel was never credited on the corpus for GPS-only solving, so
  the next entry's start clears them. Inside the entry it stays on, a tour
  switch included: every vote the entry cast stays in the GPS history until
  AR exit, and the hard trim back on those votes is the 2.8-5.8 m jump
  M0b/M2b measured at a 5-8 m bias (M2e milestone review #1; the seam
  contract, rule 3). A fix with no ring (no code holding) changes no
  override.
- **Every alignment override in the Tour Viewer is the viewer's.** The
  entry-start clear wipes every key, so nothing set before the entry
  survives it. The soft keys then go over whatever is set (the action
  replaces the whole object), so the merge only protects keys set between
  the entry's start and its first vote. Nothing else in the Tour Viewer
  sets any today.
- **The fix comes first in a tick's batch**, as it did when the fix was
  dispatched and the ring answered it; the core judges each event as a
  single dispatch would, so a malformed fix is dropped alone (with a core
  warning) and its ring is still stored. A fix whose time is not finite
  never gets a ring (the keep-alive casts none for it), so it takes the
  plain path, where the core gives it weight 0.
- Before a session zero the core stores neither overrides nor votes; the
  sink then turns nothing on and tries again at the next vote (the viewer
  casts none before the zero anyway: `canAcceptVotes`).
- Batch size: a lock is 16 events, a tick up to 19 (a re-lock during the
  fade with leftover keep-alive credit under 3 gives up to 18 votes, plus
  the fix) - far under the core's `MAX_GPS_EVENT_BATCH_SIZE` (256).

## Examples

```ts
const sink = startEntryVoteSink(arStore); // clears the overrides
sink.castLockVotes(lockVotes); // soft on, then one batch
sink.recordFix(fix, keepAlive.votesForFix({ atMs, stampMs })); // one batch
```

## Tests

- `viewer-vote-sink.test.ts` - against the real viewer store: the clear at
  entry start, the merge right before the first vote and once only, a
  keep-alive tick bringing the first vote, a ringless fix changing nothing,
  the soft trimming staying on for the rest of the entry until the next
  entry's start, the soft keys as
  M0c measured them and accepted by the installed core, one batch per lock,
  the tick's fix-first batch, a malformed fix dropped alone without a throw.
- `viewer-votes.test.ts` - the same rules through `viewer-placement` (a
  plain-AR entry, a re-entry, a tour switch, the composed GPS handler).
- `viewer-vote-strength.test.ts` - the `m2e` arm measures the shipped
  keep-alive through this sink.
