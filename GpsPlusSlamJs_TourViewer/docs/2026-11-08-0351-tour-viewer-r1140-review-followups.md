# Tour Viewer review follow-ups left open by r1140 (followups)

Branch r1140 worked through the review notes of PR #874 (r1133) and PR #876
(r1131). Two notes were not fixed there; this file holds them.

## F1 - photos held from the draft's open (PR #874 notes 11 and 14)

- **What:** `readDraft` (`GpsPlusSlamJs_TourViewer/src/draft-persistence.ts`)
  copies every captured photo's bytes into memory when the phone creator
  opens a draft, and they stay held for the whole session.
- **Estimate, not a measurement:** the photo is the WebXR camera frame
  encoded by `encodeRgbaAsJpeg` (`src/seams.ts`) at quality 0.85, not a
  full-resolution sensor photo. A camera-access frame on an Android phone is
  about 1920 x 1080 or smaller; such a JPEG at 0.85 is roughly 300-500 KB.
  40 photos are therefore about 12-20 MB, not the review's 100 MB (which
  assumed about 2.5 MB per full-sensor JPEG).
  - What would reverse it: a phone whose camera-access frame is much larger
    (4K would be about 1.5-2 MB a photo, so 60-80 MB for 40). Measure on the
    device: log `blob.size` of each capture in a field test.
- **Proposed fix, when measured worth it:** read a photo's bytes lazily (on
  its first draw or save) rather than at open. Not cheap: the readers of
  `StoredDraft.photos` assume the bytes are in hand.

## F2 - `targetOf` refusing a door part directly (PR #876 note 2)

- **What:** the reviewer asked for a unit test that `targetOf`
  (`src/editor3d/editor3d-scene-editing.ts`) refuses a door part.
- **Why not done:** `createSceneEditing` needs a WebGL canvas and has no unit
  test of its own (its sidecar says so). The rule it relies on is pinned one
  level down: the stations test pins that `worldBlocks` leaves the door part
  out. A direct test needs the function split from the canvas wiring first.

Related: the Tour Viewer [lessons-learned.md](lessons-learned.md); the
progress entry is written in GpsPlusSlamJs_Docs when the branch is published.
