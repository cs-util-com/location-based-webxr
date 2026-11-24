# capture-geo-join.ts

## Purpose

The capture-time geo join's pure core (plan
`2026-08-26-1130-capture-time-geo-join`, Rev 2): decide whether a REPLAYED
recording supports trustworthy photo placement, and compute a world pose
for every captured photo — so the AR view places photos where they were
taken. Its one caller is the desktop editor's debug layer
(`debug-captures.ts`, `debugCapturesOf`); a visitor never sees a camera
capture and never runs a join.

## Public API

- `CAPTURE_ACTION` (`"gpsData/add2dImage"`), the recorder's photo action,
  and `NEWEST_KNOWN_ODOM_COORD_VERSION` (**5**), the newest era this viewer
  knows. The preflight lets a NEWER era replay, so `debug-captures.ts`
  uses both to decide whether an empty replay may be read as "the walk
  took no camera capture" (only for a known era with no capture action;
  PR #638 review) - else its decline says none could be placed.
- `preflightCaptureJoin(meta, actionTypes, options?)` — the BEFORE-replay half (the era
  gate and the segmenting-action scan) so a declined zip never pays the
  seconds-long replay. `options.correctsRelocalization: true` (the debug
  layer, which places through `computeCaptureGeoJoin`) skips
  `arSpaceCorrection/relocalizationObserved`; a caller reading raw poses
  itself (the splat trainer) leaves it off and still declines it.
  - The era gate is `odomCoordVersion >= MIN_SUPPORTED_ODOM_COORD_VERSION`
    (**4**), and the value must also be a **number** and an **integer** — a
    hand-edited `session.json` carrying `null` or `"9"` would otherwise slip
    past a bare comparison into a raw replay of an unknown era. This sidecar
    said `=== 5` until the PR #368 review caught it, which had it declining
    era-4 zips on paper while the code accepted them.
- `assessReplayedJoin(state): JoinAssessment` — the AFTER-replay half; every
  `ok: false` carries a plain-words reason and means "place no capture".
  - Preflight declines: wrong/unknown era, or a segmenting action present
    (`odometryTrackingRestarted` / `arLoopClosureDetected` — a restart
    WIPES and a loop closure DEFORMS the alignment's odometry history
    while `odometryPath.points` keeps every capture, so the final
    alignment is only valid for the last segment; V1 declines whole
    recordings, per-segment joins are the filed follow-up). A
    relocalization is in the same list but is corrected, not declined,
    when the caller says so (see the next item).
  - State declines: null `gpsData`, missing zero, pairs <
    `MIN_ALIGNMENT_SAMPLES`, malformed or IDENTITY alignment (the
    degenerate solve's default), zero captures.
    - "Malformed alignment" covers the ROTATION beside the matrix, not
      only the matrix (PR #376/#378 review). `alignmentRotation` must be
      length-4, finite, AND a UNIT quaternion - checked with the
      framework's own `renormalizeUnitQuaternion`, the same contract
      `parseQrLevel` and `mintQrGeoPose` use. Length + finiteness alone
      admits `[0,0,0,0]`, which `Matrix4.compose` turns into the
      IDENTITY, so every photo would face East while the status line
      still reported success.
  - `ok: true` carries `{ pairCount, gpsAccuracyMedianM }` — the honest
    quality the viewer surfaces ("placed from N fixes, ±X m").
- `createCapturePickTracker({ extentOf? }): CapturePickTracker` (scan-pass
  plan S-D11, D33's rule for photos): fed every replayed action with the
  state it produced (`observe`, from the framework replay's `onAction`), it
  picks each photo's alignment as the first one at or after the photo whose
  session GPS extent reached the shared floor (`state/alignment-maturity`,
  40 m), else the last usable one; a settled pick never moves.
  `alignmentFor(imageFile)` gives that `{ matrix, rotation, epoch }`, or
  undefined for a photo it never saw. `extentOf` defaults to the
  framework's `createGpsExtentTracker` over the store's device fixes.
  - **The fit epoch follows the matrix, not the moment.** A
    relocalization leaves `alignmentMatrix` untouched, so the tracker
    remembers the observation count at the last change of its 16 values
    (compared by value: a new array with equal values is not a refit) and
    stamps each moment with it: an alignment fit wholly
    before a jump stays an epoch-0 alignment after it, and its epoch-0
    captures get no correction. `fitEpochOf(matrix)` gives that epoch for
    the matrix of the last state observed (the final alignment, after the
    whole replay), undefined for any other matrix or before anything was
    observed.
  - **Linear in the walk** (S1 milestone review #10): one shared "latest
    usable" moment is every open photo's pick once it came after the
    photo, and a mature moment settles every open photo at once, so a walk
    costs actions + photos, not actions x photos (a walk that never reaches
    40 m keeps every photo open to the end). A file captured again starts
    over. The property test pins it to the per-photo fold of
    `advanceMatureAlignmentPick` over random walks.
  - A picked alignment that is the IDENTITY (the store's value before the
    first solve, which the maturity rule counts as usable once a zero
    exists) is refused by `computeCaptureGeoJoin`'s check, like an unsolved
    final one, and that photo uses the final alignment (review #6).
- `computeCaptureGeoJoin(state, alignmentFor?, finalAlignmentEpoch?): CaptureWorldPose[]` - with
  `alignmentFor`, each capture is placed through its own alignment, checked
  like the final one (16 entries, a unit rotation); a capture without one,
  or whose alignment fails the checks, uses the final alignment, exactly as
  without the argument. Per capture:
  `fusedGpsFromOdom(alignmentMatrix, odomPos, zero)` → geo with ABSOLUTE
  altitude (the library's documented contract — NOT zero-relative), plus
  `rotationNue = alignmentRotation ∘ captureRotation ∘ WEBXR_TO_NUE` —
  the trailing basis factor is LOAD-BEARING because the state stores
  CONJUGATED quaternions (milestone review, finding 1; the directional
  tests pin it). D3: photos face as captured. Throws if called without a passing assessment.
  - **Across relocalizations** (`state.arSpaceCorrection.observations`
    not empty): each capture is first moved from the raw frame of its own
    epoch `c = epochAt(times, capturedAt)` into the raw frame of the
    alignment that places it (epoch `a`: the pick's `epoch`, else
    `finalAlignmentEpoch`), by `Delta(a)^-1 * Delta(c)` from `selectCorrectionTrack`,
    in the replayed state's NUE frame: `p' = T p`, `R_nue' = q_T * R_nue`.
    A capture without a finite `capturedAt`, or whose alignment's epoch
    is unknown (absent) or one the recording does not have, is DROPPED:
    its frame is unknown, and a guessed one would be placed silently
    wrong. Without observations nothing changes, also for captures
    without a time or an epoch.
  - **The remaining limit: an alignment fit from GPS pairs of mixed
    epochs.** An alignment refit after a jump is labelled with the new
    epoch and taken to be valid in that epoch's raw frame, although its
    GPS pairs were solved from odometry poses of every earlier epoch too
    (the solve does not correct them). Its placements are off by up to the
    jump, weighted by the share of pre-jump pairs. Provisional, like the
    live correction; the cure is a solve over corrected pairs.
  - **Returns FEWER poses than captures when a capture cannot be placed**
    (PR #370 review). A capture whose fused geo has a missing or non-finite
    lat/lon/altitude is DROPPED. It used to default the altitude to 0, and
    since the caller converts back with a zero altitude of 0 — so NUE y IS
    absolute altitude — that put the photo at sea level, hundreds of metres
    under an inland visitor, while the status line still claimed
    "N photos at capture spots". Zero is a VALID altitude, so the drop keys
    on missing-or-non-finite, never on falsy. When nothing survives, the
    join declines.
  - **A capture's own `rotation` is dropped on the same terms** (PR #378
    review): length-4, finite, and unit-norm, via the same
    `renormalizeUnitQuaternion`. A non-unit quaternion survives
    `image-planes.ts`'s own check, reaches `mesh.quaternion.copy(...)`,
    and the plane silently never renders - while `viewerPlanesInfo` still
    counts it, because `count` is `meshes.length`.
    - **The hand-written finiteness preludes are GONE** (PR #383 review).
      They existed because `renormalizeUnitQuaternion` did not reject
      non-finite or short input while its JSDoc said it did, so this file
      grew the same `length === 4 && every(Number.isFinite)` guard at THREE
      sites, one per review round (#377, #379, #381). Three copies of one
      check is the signal it belonged in the callee, and it now lives there.
    - Both COMPOSED rotations use the RETURNED value, not the call as a
      predicate, so `rotationNue` is exactly unit rather than unit only to
      within the 1e-3 tolerance: the per-capture rotation since PR #379, and
      the ALIGNMENT rotation since PR #380 - which matters more, because
      `alignmentQuat` multiplies into every plane at once, `image-planes.ts`
      copies it with no normalise, and Three composes the matrix as
      `R * |q|^2`. An off-unit alignment therefore scaled the whole photo
      constellation by up to ~0.2 %. Fixing one and not the other is the
      same asymmetry this file has now been corrected for three times.
    - The ASSESSMENT path at `assessReplayedJoin` still uses it as a
      predicate, correctly: it returns a verdict, not a rotation.
    - `computeCaptureGeoJoin` refuses an alignment rotation that is not
      length-4, finite AND unit - all three now enforced by the one shared
      contract rather than by a prelude here (PR #381 raised the gap, #383
      moved the fix into the callee).
    - With that guard in place the claim holds: this function re-derives
      `toAlignmentMatrix` itself and throws on a bad alignment rotation, so a
      caller that skips `assessReplayedJoin` fails loudly rather than feeding
      NaN quaternions into `ThreeQuaternion`.
- `ReplayedJoinState` — structural slice of the replayed
  `CombinedRootState`, deliberately narrow so tests need no full store.

## Invariants & assumptions

- **Inputs are REPLAYED STATE (NUE)**, never raw action payloads (those
  are raw WebXR; the reducer converts on dispatch). The caller loads the
  stream ONCE (`loadRecordingActions`), gates, then replays the SAME
  array via `replayActions` - never `replayRecording` over the source,
  which would re-read the zip and replay before the era gate (milestone
  review, finding 8).
- **Accuracy model (owner-corrected, plan Rev 2):** the captures are a
  rigid constellation in SLAM space; the whole set shares the final
  alignment's error. Quality is reported, not guessed.
  - Since scan-pass S1 (owner decision S-D11) the viewer and the Finish
    pass each photo's own pick (`createCapturePickTracker`, through
    `debug-captures.ts`), so the constellation is rigid only among photos
    sharing a pick; `computeCaptureGeoJoin(state)` without the argument
    keeps the old end-of-walk behaviour. Each pick carries the
    relocalization `epoch` its matrix was fit in (the observation count
    at the matrix's last change).
- This module never touches the zip: the caller feeds it `loadSessionMeta()`,
  the action-type list, and the replayed state.

## Examples

```ts
const actions = await session.loadRecordingActions();
const pre = preflightCaptureJoin(
  await session.loadSessionMeta(),
  actions?.map((a) => a.type) ?? [],
);
// As the editor's debug layer does (`debug-captures.ts`): a declined
// preflight or verdict is the reason the captures are not shown.
if (!pre.ok) return { kind: "declined", reason: pre.reason };
if (actions === null) return { kind: "declined", reason: "no walk" };
const state = await replayActions(actions, { onChunk: showProgress });
const verdict = assessReplayedJoin(state);
if (!verdict.ok) return { kind: "declined", reason: verdict.reason };
const poses = computeCaptureGeoJoin(state);
// each pose's geo is where the debug layer draws that capture
```

## Tests

`capture-geo-join.test.ts` — every decline reason non-vacuously, the
hand-checkable translation transform (absolute altitude, magnitude guard
against a degrees/metres confusion), the rotation composition, the
assess-first throw. `capture-geo-join.property.test.ts` — the round-trip
property: geo re-projected into the zero's NUE equals the aligned odom
position for arbitrary translations and capture positions (mm-level
geodesy tolerance); and the relocalization property: over 1 to 3 random
jumps and captures in random epochs, each capture lands where its copy,
moved by an independent three.js product of the later jumps, lands in a
recording without jumps. The unit tests pin the oracle case, a capture
after the jump, the dropped timeless capture, a pick at epoch 0 with one
jump, a pick at epoch 1 with two jumps (the product order), an unknown
pick epoch, a final alignment fit before the jump (the photo placed raw), a
final alignment or a pick without a fit epoch (dropped), a walk whose fixes
all came before the jump settling after it (its photo placed with no jump,
against the same walk with no relocalization), and the tracker's fit epoch
following a refit while `fitEpochOf` vouches only for the last matrix,
and a new matrix array with equal values keeping the fit epoch while a
changed value bumps it.
