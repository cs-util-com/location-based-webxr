# qr-vote-keep-alive.ts

## Purpose

The scanned code's keep-alive (Tour Viewer authoring plan
[2026-09-28-0953](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.2, milestone M2b; owner decisions D8/D9): from a scan's FIRST voted lock
on, re-vote after every device GPS fix from the stable pose of the code's
latest voted lock, so the code holds the alignment for about two minutes
after its last lock and then hands it back to GPS gradually. During the
scan's own burst (the budget's 10 voted locks, ~1.25 s) its rings ride
along with the lock votes; after it they are the code's only votes. (The
docs said "after the budget is spent" until the M2b review, #7.)
The schedule is the one measured in M0b/M0c
([results](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-1433-viewer-vote-strength-results.md)).
Pure: every time is an argument.

## Public API

- `createQrVoteKeepAlive(settings): QrVoteKeepAlive` - `settings` =
  `{ holdMs, fadeMs, votesPerFix, baselineM, syntheticAccuracyM }`; throws
  `RangeError` for a negative or non-finite hold/fade, a `votesPerFix` that is
  not an integer >= 3, or a non-positive radius/accuracy. The viewer builds
  it through `createViewerKeepAlive()` (`qr-viewer-mode.ts`: 120 s hold,
  120 s fade, 16 votes (D13), 30 m, 5 m).
  - `keep(code, atMs)` - a lock of `code` cast votes from `code.qrPoseWorld`
    (the stable pose): keep it and restart the hold. A different code takes
    over (its credit starts at zero).
  - `relock(text, atMs)` - any lock: a re-scan of the kept code restarts the
    hold from the pose already kept, but only while that pose is fresh
    (`holdsFreshPose`); a stale pose or another code changes nothing.
  - `holdsFreshPose(text, atMs)` - whether `text` is the kept code and its
    pose was taken at most `holdMs` before `atMs` (false for a non-finite
    time and after `stop()`). False is the config's cue to re-arm a spent
    code's vote budget, so the re-scan votes afresh.
  - `votesForFix({ atMs, stampMs })` - one DEVICE fix: the votes to cast now
    (often none), scheduled by `atMs` (when the fix ARRIVED, on the clock
    the locks are timed on) and stamped with `stampMs` (the fix's own
    Geolocation time); built by the framework's `buildQrGpsVotes` on the
    ring, id prefix `qr-keep`, the synthetic-QR source. A non-finite
    `stampMs` casts nothing and accrues nothing.
  - `phase(nowMs)` - `none` | `holding { remainingMs }` | `fading { share }`
    | `ended`, with the kept code's text; the status line's input.
  - `stop()` - forget the kept code (AR exit, tour close, a change of
    odometry frame).
- `keepAliveShare(elapsedMs, holdMs, fadeMs)` - 1 through the hold (also
  for a negative elapsed time, which on the hold's one clock is a clock
  step backwards), linear to 0 over the fade, 0 after it and for a
  non-finite value.
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
- **One clock** (M2b review #4): the locks' times and the fixes' ARRIVAL
  times are the page clock (`viewer-placement`'s `now`, `Date.now` - the
  QR controller's detection clock and what the status line reads the hold
  with). A fix's Geolocation timestamp is the phone's acquisition time,
  cached up to `maximumAge` (5 s, `gps.ts`) and set by a clock of its own;
  scheduling by it moved the hand-off by the skew, and a fix stamped before
  the lock read as full strength however late it arrived. It is kept only
  as the votes' stamp, which pairs them with the fix they answer.
- **State changes happen in four places only**: `keep`, `relock`, `stop`,
  and `votesForFix` dropping an unbuildable code. A log of the keep-alive's
  transitions hooks there.
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
- **A kept pose carries a hold for one hold window at most** (M2b review
  #1). The config stops evaluating a spent code's fused pose (~10 ms per
  lock, QR near-frontal pose plan §61 #6), so the keep-alive re-votes from
  the pose of the last VOTED lock, and tracking drift since then rides
  along (the owner's estimate, D8: little for 1-2 minutes, then 0.5-1 m).
  A re-scan within `holdMs` of that lock restarts the hold from it; past
  it, `relock` restarts nothing and the config re-arms the code's budget,
  so the re-scan's own frame votes a fresh burst from the code's current
  stable pose and `keep` takes that. Before the review a re-scan 20
  minutes later restarted a full-strength hold from a pose frozen ~1.25 s
  after the first lock, for as long as the visitor looked. The pose held is
  therefore at most `2 x holdMs` old when its hold ends (a re-scan at the
  window's edge), and a visitor who keeps looking gets a fresh burst about
  every `holdMs` (160 votes at D13). The window rests on D8's drift
  estimate and reuses `holdMs` rather than adding a constant; what would
  change it is a measured drift rate (the plan's field checklist): a phone
  that drifts 0.5 m within a minute would want a shorter window. A new AR
  entry and a change of odometry frame (the caller's `stop()`) also end
  the kept pose.
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
  const stampMs = nextDeviceFix(selectGpsPositions(store.getState()));
  if (stampMs === null) return;
  for (const v of keepAlive.votesForFix({ atMs: Date.now(), stampMs })) {
    castVote(v);
  }
});
```

## Tests

- `qr-vote-keep-alive.test.ts` - the schedule with a fake clock (full rings
  through the hold, the fade's total and ring sizes, zero after), the credit
  property for any fix cadence, and each lifecycle rule: a refreshed pose, a
  re-scan inside the window restarting the hold, a relock refused from a
  pose older than the window (and a fresh keep holding again), freshness
  only for the kept code, the arrival clock against a skewed fix stamp both
  ways, a second code taking over, `stop()`, non-finite times, an
  unbuildable code, settings validation; and the device fix watch (new
  device fixes once, never synthetic or unknown sources).
- `qr-viewer-mode.test.ts` - the config hands a voted lock's pose over
  from the first voted lock, and re-arms a spent code the keep-alive does
  not hold from a fresh pose (20 minutes later, after a stop, after another
  code took over) so its re-scan votes from the current pose.
- `viewer-votes.test.ts` - the wiring with the real store: one ring per
  device fix, no answer to a synthetic point, stop at AR exit, a new entry,
  a moved code re-scanned 20 minutes later, a frame change, the fix clock
  skewed by 5 s and 1 h either way, a tour reopened in the same entry.
- `viewer-vote-strength.test.ts` - the shipped keep-alive measured through
  this module (the harness's shipped-settings arm).
