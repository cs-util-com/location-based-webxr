# A moved-code veto is recorded BEFORE the fix that triggered it

Found by the QR-first M0 replay instrument (plan
`GpsPlusSlamJs_Docs/docs/2026-10-14-0445-qr-first-alignment-field-study-plan.md`
in the primary repo, §3 M0; harness `src/test-support/qr-hold-recording.ts`)
on the 2026-10-10 visitor recording. Filed, not fixed (DEC-A3: the honest fix
changes how the viewer reacts to the store, which needs a design decision).

## What happens

- `viewer-placement.ts` `startMovedCodeChecks` judges the moved-code check
  inside `arStore.subscribe`, and `vetoMovedCode` then dispatches the
  retraction (`setAlignmentOverrides(null)`, `resetGpsSessionData`, the
  re-fed batches) synchronously from that subscription.
- The recorder numbers an action when its dispatch RETURNS, so the
  retraction is recorded before the fix batch whose notification triggered
  it - exactly the pitfall in `GpsPlusSlamJs_Docs/docs/lessons-learned.md`
  ("Never dispatch a persisted action synchronously from `store.subscribe`",
  2026-06-28 ordering plan).
- In the 2026-10-10 recording: actions #421-#423 (the retraction) precede
  the fix-and-ring batch that triggered the veto (stamp 1791672183858, its
  16-vote ring included).

## Consequence

- **On the phone nothing is wrong**: the retraction re-feeds every stored
  device fix (the triggering one included) and the ring that batch carried
  is wiped by the reset.
- **A verbatim replay of the recording is wrong after a veto**: it applies
  the retraction first, then the triggering batch - the fix twice and the
  16-vote ring of a code that has just been vetoed. Every replay of a vetoed
  session after the veto (the Investigation readers, `tour-recording.field`)
  sees an alignment the phone never had. The M0 parser works around it by
  placing the veto after the next fix.

## Candidate fix (needs a decision)

Run the check from a prepended `createListenerMiddleware` effect (the
pattern of `state/slam-app-store-listener.ts` in the framework), or queue
the veto to a microtask, so its dispatches are recorded after their
trigger. Test-first: a recorded session with a veto replays to the phone's
alignment after the veto.
