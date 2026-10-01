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
- Batch size: a lock is 16 events, a tick 17 - far under the core's
  `MAX_GPS_EVENT_BATCH_SIZE` (256).

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
