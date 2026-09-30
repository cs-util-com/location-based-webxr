# visit-anchoring.ts

## Purpose

The frame math of the authoring settle (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.2, milestone M2c; owner decisions D2 and D10b): where an authored object
sits in the AR world group's own frame, how that frame maps to GPS-world
NUE, and how a later AR visit is corrected through the printed code.

Pure: three.js math only, no store, no DOM. `visit-settle.ts` and
`creator-setup.ts` are its callers.

## The three frames

- **Raw WebXR odometry** (X = East, Y = Up, Z = South): the camera's pose, a
  photo's capture pose, the code's fused pose.
- **Odometry-NUE** (X = North, Y = Up, Z = East): the local frame of
  `arWorldGroup`, i.e. the domain of the store's alignment matrix. The
  hit-test reticle lives here, and so do the rigid authoring previews.
- **GPS-world NUE**: the scene root, `alignment · odometry-NUE`. Geo is
  minted from here (`mintQrGeoPose`).

## Public API

- `odomNueFromWebXr(pose: Pose): NuePose` - THE raw-to-odometry-NUE
  conversion, `WEBXR_TO_NUE · pose` (basis factor LEADING, as the scene
  graph's `basisChangeNode` and the framework's `qrWorldPoseFromOdom` do).
  Pure math; a non-finite pose gives a non-finite result, which every
  consumer below refuses.
- `throughAlignment(local, alignment): NuePose | null` - `alignment · local`
  into GPS-world NUE. Null when the alignment is not 16 finite numbers.
- `codeCorrection(measured, stored): number[] | null` - the rigid move
  (column-major 4x4) that puts this visit's code measurement onto the
  code's stored pose, both GPS-world NUE: `T(p) = R_yaw (p - m) + s`.
  Null for non-finite input, a zero quaternion, or the one pair with no
  defined yaw (a half turn about a horizontal axis).
- `correctedAlignment(alignment, codeOdomNue, storedCode): number[] | null`
  - `codeCorrection(alignment · codeOdomNue, storedCode) · alignment`, the
    alignment a later visit's objects settle through (D10b). This is the
    function M4's "move to the reticle" reuses.

## Invariants and decisions

- **Yaw and translation only.** Both frames share gravity; the tilt
  difference between two pose solves of the same code is noise of a few
  degrees, and applying it would tilt the whole visit (at 20 m, 3 degrees
  is 1 m of height). The yaw is the twist about Up of
  `stored · measured^-1`. Pinned by the "keeps Up" unit test and the
  height-difference property.
- `T(measured.position) = stored.position` exactly (property test).
- `T` is the identity when `measured = stored` (property test).
- **The corrected alignment does not depend on the visit's alignment** when
  that alignment is yaw-only (the only shape the core's solver produces):
  `T · A (x) = twist(R_s R_c^-1) (x - c) + s`, because the twist projection
  is equivariant under rotations about Up. So an earlier visit's object
  placed through it under `arWorldGroup` stays rigid while GPS re-solves
  (property test "does not depend on the visit's GPS alignment").
- No threshold is introduced here. There is deliberately no agreement guard
  between the two measurements (the rejected code-offset design had one;
  plan §7 finding 9); a wrong sighting moves the visit's notes with it, the
  same way a wrong code pulls the viewer's alignment (plan §3.2).

## Examples

```ts
const codeLocal = odomNueFromWebXr(fusedStablePose); // this visit
const stored = objectPoseNue(level.qr.geo, zero); // GPS-world, earlier visit
const corrected = correctedAlignment(visitAlignment, codeLocal, {
  position: stored.positionNue,
  rotation: stored.rotationNue,
});
const noteWorld = corrected && throughAlignment(noteLocal, corrected);
```

## Tests

- `visit-anchoring.test.ts` - bearings (WebXR forward is North, +X is East,
  a 90-degree turn faces West), agreement with the real scene graph
  (group, basis node, raw pose) with the group yawed 90 degrees, agreement
  with `qrWorldPoseFromOdom`, the correction's identity / exact mapping /
  kept Up, and the cross-visit recovery of the measuring visit's alignment.
- `visit-anchoring.property.test.ts` - identity, exact mapping, distance and
  height preservation, independence from the visit's alignment, the
  recovery of the measuring visit's placement of any point when the second
  session's odometry is the first's moved by any yaw and translation (M2c
  review #3: the only property that tells THIS visit's sighting from the
  measuring visit's pose), and the conversion's agreement with the mint
  composition for any pose.
