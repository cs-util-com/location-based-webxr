# skin-pose.ts

## Purpose

Poses a skinned model so the level-of-detail pass (`model-lod.ts`) can
measure a level's deviation in the shapes the model really takes. It gives
the rest pose (the nodes as the file stores them) and up to `CLIP_POSES`
poses sampled from the file's clips, each as a world matrix per node. It
also skins a primitive's positions into one of those poses with linear
blend skinning, as glTF defines it.

## Public API

- `type Matrix = Float64Array`: a 4 x 4 matrix, column-major (the order
  glTF and three.js use).
- (internal) `CLIP_POSES = 3`: the most clip poses sampled, across all
  clips.
- `interface Poses { worlds }`
  - `worlds[k][node]`: the world matrix of every node in pose `k`.
    `worlds[0]` is the rest pose, any further one a clip's. Whether a
    clip pose bends a given skin is the caller's question (`model-lod.ts`
    keeps only the poses that move one of that skin's joints).
- `posesOf(parts): Poses | null`
  - Reads the nodes, their transforms and the clips.
  - Each clip is sampled at a third, two thirds and its end. Of all those
    times, at most `CLIP_POSES` are kept, spread evenly over the list.
    With up to three clips every clip is sampled; with more, only the
    first, a middle one and the last are, so a model with k clips leaves
    k - 3 of them unmeasured. Sampling a clip at a sixth, a half and five
    sixths instead was tried and refused: it misses the clip's end, the
    largest bend of the tube test, which then fails at 90 degrees.
  - Null when the nodes are no forest (a child out of range, two parents,
    a cycle), a transform is not finite, a clip channel does not read, or
    a clip animates a node given by a matrix (glTF does not allow that).
- `jointMatrices(parts, skin, worlds): Matrix[] | null`
  - One matrix per joint of skin `skin`: the joint's world matrix in the
    pose, times its inverse bind matrix (identity when the skin has none).
  - Null when the skin does not exist, has no joints, names a joint past
    the nodes, or has inverse bind matrices that are not one finite `MAT4`
    per joint.
- `skinPositions(positions, joints, weights, matrices): Float32Array | null`
  - `joints[set]` and `weights[set]` hold 4 values a vertex, one pair per
    influence set (`JOINTS_n`, `WEIGHTS_n`).
  - Each vertex becomes the weighted sum of its joints' transforms of it,
    the weights normalized to sum to 1.
  - Null when the sets do not pair up or have the wrong length, a weight is
    negative or not finite, a vertex's weights sum to 0, or a vertex names
    a joint `matrices` does not have.

## Invariants and assumptions

- Everything comes from an untrusted file. Every read is checked, and a
  shape that does not read gives null, never a guessed pose. The caller
  then leaves the skinned primitive as it is.
- Channels animate translation, rotation and scale. Morph `weights` and
  `pointer` channels are ignored: morph targets are not posed.
- Interpolation:
  - `LINEAR`: lerp, and slerp for rotations (the shorter way round).
  - `STEP`: holds each key until the next.
  - `CUBICSPLINE`: sampled LINEARLY between its key values (the middle of
    each in-tangent, value, out-tangent triple). The tangents are not
    used. That is close enough to measure a shape in, not an exact replay.
- Key times must be finite and strictly increasing, and the output count
  must match the input count (three times it for a cubic spline).
- Rotations are normalized before they are composed (T * R * S).
- Cost: one world-matrix pass per pose, and one skinning pass per pose
  and primitive, all linear in the nodes and the vertices.

## Limits

- Only up to `CLIP_POSES` poses are measured. A clip whose worst shape
  falls between the sampled times is not measured there.
- Skinning is linear blend skinning only. Dual-quaternion skinning is not
  part of glTF and is not modelled.
- Morph targets are not applied.

## Examples

```ts
const poses = posesOf(parts);
if (poses !== null) {
  for (const worlds of poses.worlds) {
    const matrices = jointMatrices(parts, skinIndex, worlds);
    const posed =
      matrices && skinPositions(positions, [joints0], [weights0], matrices);
  }
}
```

## Tests

- `skin-pose.test.ts`
  - The rest pose and the clip at 30, 60 and 90 degrees match an
    independent skinning (`bendTube` in `test-support/glb-fixtures.ts`).
  - No clip gives the rest pose alone.
  - STEP and CUBICSPLINE clips are read as stated above.
  - A cycle, a clip with too few values, an unknown interpolation, an
    animated node given by a matrix and a non-finite rotation each give
    null, as do a bad skin, a bad joint and bad weights.
- `skin-pose.property.test.ts`
  - For any clip, the pose at its end matches the independent skinning.
  - For any positive weights, a vertex whose joints all move alike moves
    rigidly with them.
- Fixture: `bendingTube` in `test-support/glb-fixtures.ts`, an open tube
  with two bones and one bending clip. It is synthetic and smooth; see the
  limits in `model-lod.ts.md`.
