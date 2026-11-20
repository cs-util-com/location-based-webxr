# splat-inputs.ts

## Purpose

From a recording's captures to what Splat.js trains one stretch on: each
photo's camera, seeds from the depth readings and a far background shell
(both coloured from the photos), and the stretch's job. Pure: photo
colours come in through a sampler built by the worker.

## Public API

- `CameraPose` - a raw WebXR camera-to-world pose (the camera looks along
  its -z).
- `ColourAt` - `(u, v) -> [r, g, b] | null`, 0..1 per channel, continuous
  pixel coordinates.
- `WindowPhoto` - `{ name, entry, train, camera, pose, depth, shell }`.
- `WindowJob` - everything the worker needs apart from the photo bytes,
  structured-clonable: `photos`, `evalFrames`, `maxIters`, `deadlineMs`,
  `keepM`, `trainPositions`, `seedVoxelM`, `shellVoxelM`,
  `shellDistanceM`, `shellGridPx`, `etaMinIterations`.
- `splatCamera(image, pose, K, width, height) -> SplatCameraEntry` -
  `R = diag(1, -1, -1) * R_c2w^T`, `t = -R * position`.
- `depthSeeds(samples, width, height, colourAt) -> SeedPoint[]` - each
  reading unprojected by the framework's `createDepthUnprojector`,
  coloured at `(screenX * width, screenY * height)`; readings without a
  position or a colour are dropped, a sample without a usable projection
  is skipped.
- `shellSeeds(pose, K, width, height, { distanceM, gridPx }, colourAt)` -
  one point per `gridPx` square at `distanceM` along its centre's ray.
  RangeError for a distance that is not positive or a grid below 1.
- `voxelThin(points, voxelM)` - points in one cube merged into their mean
  position and colour, first-seen order. RangeError for a size that is
  not positive.
- `depthNear(capturedAt, samples, maxDtMs)` - the samples within
  `maxDtMs`; none for an untimed photo.
- `planWindowJob(inputs, planned, timeScale, settings) -> WindowJob`.

## Invariants and decisions

- Cameras stay in the raw WebXR world, so the trained splat shares the
  recording's frame.
- Photos are named `frame-<6 digits>.jpg` by capture index, unique within
  a job, in frame order; held-out photos carry no depth and no shell and
  are Splat.js's test set (`evalFrames`).
- The shell goes on every `shellEveryPhoto`-th training photo.
- `maxIters` is `iterationBudget` of the training photo count;
  `deadlineMs` is `deadlineS * 1000 * timeScale`, a scale that is not a
  positive number counting as 1; `keepM` is `keepFraction *
shellDistanceM`.
- Seeds take their colour from the photos because depth readings carry
  none.

## Tests

`splat-inputs.test.ts`: the camera against a known pose (a point in front
projects to its pixel), depth seeds at their unprojected positions and
colours, the shell's grid, distance and refusals, thinning, the time
window, and the job's photos, names, hold-outs, shell flags, budget,
deadline scale and crop distance.
