# Example recordings

Real-world RecorderApp session recordings, kept in-repo as shared example/test data.

- **Origin:** student field-test sessions ("Task 1", outdoor campus walks), recorded on 2026-06-16 with the RecorderApp at <https://gps.csutil.com/recorder/> on a Google Pixel 6A (Chrome/Android, WebXR).
- **Contents:** 8 session zips in the RecorderApp export format (GPS + SLAM pose streams, reference-point observations, periodic photogrammetry frame captures; loadable via the RecorderApp import/replay flow).
- **Context docs** (in the sibling `gps-plus-slam` repo, `GpsPlusSlamJs_Docs/docs/`):
  - `2026-06-16-2053-team1-user-feedback.md` — the field-test session these zips come from, with the full UX triage.
  - `2026-07-19-1021-recorder-task1-field-test-student-writeup-user-feedback.md` — the testers' own write-up, preserved.
  - `2026-07-19-0739-hud-prototype-retirement-and-demo-sprites-plan.md` — why the zips live here (decision D2: moved out of the deleted `AR_Wayfinding_HUD_Component/` tree).
- **Storage note:** plain git blobs, intentionally **no LFS** (plan decision D6 — the blobs are in history either way; revisit only if this folder starts growing). An in-repo move never shrinks clone size; this folder is about discoverability, not size.
- **Not a package:** deliberately outside the pnpm workspace — data only, no build/test tooling.
