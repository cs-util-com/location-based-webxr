# globe-cloud-step.ts

## Purpose

The globe's clouds frame by frame: who draws them at the camera's altitude
(the flat layer, the slab `globe-cloud-volume-pass.ts`, the spherical
volume `globe-cloud-shell-volume-pass.ts`), the two volumes' per-frame
update, and their drawing after the Earth. Moved out of the globe lab
(`labs/globe/globe-lab.js`: its `shellStations`, `shellCascade`,
`cloudShares`, `shellShadow`, `slabDisc` and the cloud part of
`afterScene`) as a pure refactor (editor-on-the-full-globe plan, clouds
part b): the calls, their order and their conditions are the lab's.

What stays in the lab, and why: the globe's own writes (the shell's share
`globe.setCloudShellShare`, the map's shadow factor `uCloudShadow`, the
flat share the readout shows) are the globe's state, not the clouds'; the
cost probes (`timeCloudShell`, `timeCloudVolume`) are page debugging. The
lab calls `plan` where it computed the shares, writes those from its
result, and calls `updateVolumes` after the sky's step as before.

## Public API

- `cloudShellStationsFromKnobs(p)`: the law's stations from the lab's
  knobs (`cloudShellStationsFor`; the bottom station at the slab's ceiling
  or above). RangeError for a knob it refuses.
- `cloudShellCascadeFromKnobs(altitudeKm, p)`: the noise's two fields and
  weights at the altitude (`cloudShellNoiseCascade` from the top of the
  shell's fade-in to its bottom station, `cloudShellFields` rounded).
  RangeError when the law has no station or the cascade refuses.
- `createGlobeCloudStep({ cloudVolume, shellVolume })` (either null where
  the page has none) returns a `GlobeCloudStep`:
  - `plan(p, { cameraAltM, framed })` -> `{ shellOn, flat, flatShadow,
shares, shadow }`. The shell draws only with the slab on
    (`cloudVolume > 0` and a slab), `cloudShellVolume=1`,
    `cloudNoise=live` and a frame; `shares` from
    `cloudShellVolumeShares` at the camera (null when the shell does not
    draw or the altitude is unknown), the top from the stations so the
    shares never refuse the knobs; `flat` / `flatShadow` from
    `flatCloudShare` (1 / 1 with `cloudFlat` off or no altitude; the
    flat layer's own band only with the shell). The shares and shadows
    are kept for the update and the drawing.
  - `updateVolumes(p, { observerKm, cameraAltM, target, view, deck })`:
    the slab's switches (on, shadow, noise, fine gain), its update (the
    disc ahead along the view for `cloudVolume=2`, on the camera for 1;
    `mixed` while the shell draws) and the deck's hole (only for 1); then
    the shell's on (while it has shares), resolution and frame (the law's
    stations, the cascade at the camera's height, the high layer's knobs,
    the shell's shadow).
  - `render(camera, { relief, extra, worldFromEcef, sunEcef,
sunIntensity, sceneDepthWeight, flatten })`: the slab over the Earth
    (its own composite unless the shell mixes it), then the shell with
    the slab's texture when the slab drew, and the slab's disc. Nothing
    without the slab.
  - `shares`, `shadow` (the last plan's), `slabDisc()` (null without the
    slab), `readBack(bands)`, `alphaGrid(nx, ny)` (the shell's, high
    layer's, shadow's and slab's alpha; the window hook
    `cloudShellAlphaGrid`), `seamGrid(nx, ny, frame)` (one `frame()` then
    the shell's own drawing and the slab's alpha; null where either does
    not draw).

## Invariants

- Pure orchestration: no GPU state of its own; every number it passes is
  the lab's formula, unchanged.
- The order the lab had: `plan` before the globe's writes and the sky's
  step, `updateVolumes` after them, `render` in `afterScene`.
- The shell is told it is off whenever `plan` gave no shares, so a frame
  that leaves the shell's band never draws it from an older law.

## Tests

`globe-cloud-step.test.ts`, recording fakes of the slab, the shell and
the deck: the knobs-to-law mapping (stations and cascade, and their
refusals), every plan condition (slab, switch, noise, frame, altitude),
the flat shares, the update's order and arguments for both slab variants,
the render mix with and without the slab drawn, and the debug hooks'
nulls. Key lines were checked to fail on a mutant. The look is the lab's
smokes and reference captures.
