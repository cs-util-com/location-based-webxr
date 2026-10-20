# The Tour Viewer never tells the solver that WebXR reset its origin (follow-up)

Filed by the M5c review follow-up (finding M4) of the Tour Viewer authoring
plan, `GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.6 and §7 (D20). Not fixed here: it needs a decision about the viewer's
AR wiring and a field check, not a local patch.

## What is wrong

- The Recorder wires the framework's tracking pipeline with an
  `onRestarted` callback that dispatches `odometryTrackingRestarted`
  (`GpsPlusSlamJs_RecorderApp/src/main.ts`, the `tracking:` option of the AR
  session, about line 1210). That reducer clears the stale odometry data and
  accumulates the frame offsets, so the GPS alignment continues correctly
  across a WebXR reference-space reset.
- The Tour Viewer dispatches it nowhere (`grep odometryTrackingRestarted
GpsPlusSlamJs_TourViewer/src` finds nothing outside tests). Its own
  code only watches `qrDetected.frameEpoch` to end the keep-alive and the
  moved-code checks (`viewer-placement.ts`, `startKeepAlive` and
  `startMovedCodeChecks`).
- Consequence: after an origin reset in a viewer session the solver keeps
  pairing the new frame's odometry with fixes recorded in the old frame, and
  the alignment blends the two frames until the old fixes are outvoted. The
  placed tour drifts or jumps by the reset's offset for that time.

## Since 2026-10-13: the restart callback exists, for the mesh only

The AR config now passes the framework's `tracking.onRestarted`
(`ar-mode.ts` `onTrackingRestarted`, polish-round follow-up F11), which
clears the mesh cursor's grid (a creator's default since 2026-10-15). It deliberately does NOT dispatch
`odometryTrackingRestarted`: that is still this document's decision.
Step 2 below needs more than a dispatch in that callback: `ar-mode.ts`
drops the restart's payload and hands the app a `() => void`, so the
payload must be forwarded; the guard
`visit-alignment-picks.no-segments.test.ts` bans the action by name; and
that guard's header asks for a segment notion in the alignment picks
first (r837 review #5).

## What the moved-code check does about it today

The check ends every pin at a frame change, and since M5c review M4 a reset
of the history that follows a frame change (the veto's own recovery, which
re-feeds both frames' device fixes) ends every check instead of folding the
old frame again (`moved-code-check.ts`). That only protects the check; the
solve itself still blends frames.

## Proposed next step

1. Measure first: does an origin reset happen in viewer sessions at all on
   the owner's phones (the viewer logs `qrDetected.frameEpoch`; a field
   recording with a deliberate tracking loss would show it)?
2. If it does, wire the same `onRestarted` handler as the Recorder in the
   viewer's AR start (and note the frame change to the authoring sighting
   accumulator where creator mode uses one), with a test that a reset
   during a viewing session leaves the alignment continuous.
3. Re-check the veto's recovery (`viewer-vote-sink.ts` `retractVotes`): it
   re-feeds the device fixes it stored, across frames; with the reducer
   wired, the re-fed fixes would need the restart replayed between them.

## Related

- `GpsPlusSlamJs_TourViewer/src/moved-code-check.ts.md` (Invariants)
- `GpsPlusSlamJs_TourViewer/src/viewer-vote-sink.ts.md` (the re-feed)
- `GpsPlusSlamJs_TourViewer/src/viewer-placement.ts.md` (the veto)
- `GpsPlusSlamJs_TourViewer/src/visit-alignment-picks.no-segments.test.ts`
  (the guard that bans the restart action, narrowed for F11)
- Follow-up F11 (the mesh cursor's restart hook):
  `GpsPlusSlamJs_Docs/docs/2026-10-12-0759-tour-viewer-m0c-followups.md`
  in the `gps-plus-slam` repo
