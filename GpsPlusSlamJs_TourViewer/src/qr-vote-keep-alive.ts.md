# qr-vote-keep-alive.ts

## Purpose

The scanned code's keep-alive (Tour Viewer authoring plan
[2026-09-28-0953](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.2, milestone M2b; owner decisions D8/D9): after a scan's vote budget is
spent, keep re-voting from the last stable pose of the code, so the code holds
the alignment for about two minutes and then hands it back to GPS gradually.
The schedule is the one measured in M0b/M0c
([results](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-1433-viewer-vote-strength-results.md)).
Pure: every time is an argument.

## Public API

- `createQrVoteKeepAlive(settings): QrVoteKeepAlive` - `settings` =
  `{ holdMs, fadeMs, votesPerFix, baselineM, syntheticAccuracyM }`; throws
  `RangeError` for a negative or non-finite hold/fade, a `votesPerFix` that is
  not an integer >= 3, or a non-positive radius/accuracy. The viewer builds
  it through `createViewerKeepAlive()` (`qr-viewer-mode.ts`: 120 s hold,
  120 s fade, 8 votes, 30 m, 5 m).
  - `keep(code, atMs)` - a lock of `code` cast votes from `code.qrPoseWorld`
    (the stable pose): keep it and restart the hold. A different code takes
    over (its credit starts at zero).
  - `relock(text, atMs)` - any lock: a re-scan of the kept code restarts the
    hold from the pose already kept; another code changes nothing.
  - `votesForFix(fixMs)` - one DEVICE fix: the votes to cast now (often
    none), built by the framework's `buildQrGpsVotes` on the ring, stamped
    with the fix time, id prefix `qr-keep`, and the synthetic-QR source.
  - `phase(nowMs)` - `none` | `holding { remainingMs }` | `fading { share }`
    | `ended`, with the kept code's text; the status line's input.
  - `stop()` - forget the kept code (AR exit, tour close).
- `keepAliveShare(elapsedMs, holdMs, fadeMs)` - 1 through the hold (also
  for a small negative elapsed time: a geolocation timestamp is the
  acquisition time and may precede the lock), linear to 0 over the fade, 0
  after it and for a non-finite value.
- `createDeviceFixWatch()` - `(positions) => fixTimestamp | null`: the
  newest stored point's timestamp when it is a device fix not reported
  before. Keyed by the point's identity (immer keeps stored points stable).

## Invariants & assumptions

- **The cadence is the measured one, and only that** (M0b/M0c): after every
  device GPS fix, one ring whose size is `votesPerFix` through the hold and
  `votesPerFix x share` over the fade, carried in a credit accumulator so
  the mean rate follows the schedule exactly while every batch is a ring of
  at least 3 points (the builder's non-collinear minimum). The emitted
  total never exceeds the accumulated credit and trails it by less than 3
  (property-tested for any fix cadence). The time base is the kept code's
  LAST lock, so the hold runs while the visitor keeps the code in view.
- **Per device fix, not per second or per frame.** The M0c harness cast its
  batch after each 1 Hz fix; pinning the vote rate to the fix rate keeps the
  vote-to-fix ratio the measurement credited whatever the phone's GPS rate
  (a 0.5 Hz phone casts half the votes against half the fixes). A timer
  would drift from that ratio; per camera frame would be ~8x it.
- **Only device fixes trigger it.** A synthetic vote (the keep-alive's own
  output, a lock's burst) is never a fix, and neither is a source this
  version does not know (`gpsPointSourceOf` reads it as `unknown`): rounding
  an unknown source toward real GPS is the one direction that must not
  happen. Without the stamp, the watch would answer each of its own votes
  with another ring.
- **The kept pose is not refreshed after the budget is spent**: the config
  stops evaluating a spent code's fused pose (~10 ms per lock, QR
  near-frontal pose plan §61 #6), so a re-scan restarts the hold from the
  pose of the last VOTED lock. Tracking drift since that lock rides along
  (the owner's estimate: little for 1-2 minutes, then 0.5-1 m); a re-scan
  many minutes later re-anchors to a stale pose. A new AR entry votes a
  fresh burst. Measuring real drift is on the plan's field checklist.
- A code whose votes cannot be built (a geo pose with neither heading nor
  rotation, which `parseQrLevel` rejects) is dropped instead of throwing
  into the store listener that asked.
- Wrong saved codes: with the core's hard trim (today) the votes stay
  rejectable as outliers; with soft trimming (M2a keys, not yet dispatched)
  a code saved wrong by up to ~15 m pulls the alignment near it for the hold
  and fade (~4 minutes), then GPS takes over by time (plan §3.2, §5).

## Examples

```ts
const keepAlive = createViewerKeepAlive();
keepAlive.keep({ text, qrPoseWorld, qrGeo, sizeM }, lockMs); // a voted lock
const nextDeviceFix = createDeviceFixWatch();
store.subscribe(() => {
  const fixMs = nextDeviceFix(selectGpsPositions(store.getState()));
  if (fixMs !== null) for (const v of keepAlive.votesForFix(fixMs)) castVote(v);
});
```

## Tests

- `qr-vote-keep-alive.test.ts` - the schedule with a fake clock (full rings
  through the hold, the fade's total and ring sizes, zero after), the credit
  property for any fix cadence, and each lifecycle rule: a refreshed pose, a
  re-scan restarting the hold, a second code taking over, `stop()`,
  non-finite times, an unbuildable code, settings validation; and the device
  fix watch (new device fixes once, never synthetic or unknown sources).
- `qr-viewer-mode.test.ts` - the config hands a voted lock's pose over.
- `viewer-votes.test.ts` - the wiring with the real store: one ring per
  device fix, no answer to a synthetic point, stop at AR exit, a new entry.
- `viewer-vote-strength.test.ts` - the shipped keep-alive measured through
  this module (the harness's shipped-settings arm).
