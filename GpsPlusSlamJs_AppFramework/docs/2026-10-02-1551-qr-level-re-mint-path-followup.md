# Re-minting existing QR levels after the D28 alignment change - followup

Status: open, needs an owner decision. Filed 2026-10-02 from the milestone
review of the Recorder code-heading fix (finding G1).

## What changed, and what it does not reach

The owner's decision D28 (Tour Viewer authoring plan, §6, superseding DEC-3
of the Recorder QR plan) composes a code's rotation AND position through the
alignment as it stands when the code is saved, not through each sighting's
own snapshot. A code scanned as a recording started was minted 72 degrees off
p50 before (89 degrees in the M3a measurement); see
`../src/ar/qr/qr-anchor-mint.ts.md`.

The fix changes only NEW mints. A `qr/<id>.json` level already written keeps
its heading and position:

- the mint runs only inside the Recorder's QR level zip contributor
  (`GpsPlusSlamJs_RecorderApp/src/qr/qr-level-zip-contributor.ts`), on live
  crash-safety syncs and on the final save of a live recording;
- replaying a recording never re-mints: the contributors are built only for
  a live recording (the crash-safety sync armed at Start Recording and the
  final export at Stop, `GpsPlusSlamJs_RecorderApp/src/recording/zip-contributors.ts`);
- the Tour Viewer's guided-setup finish step can write a `qr/<id>.json` of
  its own (through `rebuildZipWithEntries`, from its own settle of the code,
  not this mint), but only when a creator measures the code again there; it
  never re-mints a Recorder level from the recorded sightings.

So every level minted from a recording that started at its code before this
fix still carries the wrong heading (and the 2.9 m p50 position), and a
visitor relocalizing against it inherits that error.

## The question for the owner

Is a re-mint path wanted, and for which recordings?

- **Option A - none (default until decided).** Old levels stay as they are;
  an author re-records the affected codes. Cheap; relies on the author
  knowing which codes were affected (any code whose recording started at
  it).
- **Option B - re-mint on replay, opt-in.** Feed the replayed QR detections
  through the same accumulator and mint at the end of the replay, writing a
  new level only when the author asks. Needs the replay to reproduce the
  live detections (RAW QR records are in the zip by decision D-A) and a UI
  affordance; the replay re-solves the same alignment, so the result equals
  what a live save under the new rule would have written.
- **Option C - flag old levels.** Stamp a mint-rule version into
  `mintQuality` from now on, so a viewer can tell a pre-D28 level and warn.
  Does not repair anything; makes the problem visible.

Risk to weigh before B: a re-mint changes a published anchor, so every note
placed relative to the old pose shifts with it (the authoring plan's D26
discussion of a moved code applies).

## Related

- `../CHANGELOG.md` (Unreleased, Fixed: the mint entry names this limit).
- `2026-10-02-1552-qr-mint-yaw-observability-floor-followup.md` (the other
  follow-up from the same review).
- `GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
  §6 D28 (in the private repo).
