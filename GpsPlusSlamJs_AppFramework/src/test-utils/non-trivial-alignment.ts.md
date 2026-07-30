# `non-trivial-alignment.ts` — non-symmetric alignment fixture

## Purpose

One-line: build a deliberately ugly, non-symmetric **rigid** alignment
matrix (non-axis rotation + non-zero translation, unit scale) for
coordinate-frame tests, so a degenerate identity fixture cannot hide a
missing or doubled transform.

## Public API

- `makeNonTrivialAlignment(seed = 1): readonly number[]`
  - **Input:** optional integer `seed` for deterministic variation. Same
    seed → same matrix; different seeds → different non-trivial matrices.
  - **Output:** 16-element **column-major** matrix array (matches
    gl-matrix `mat4` and `THREE.Matrix4.fromArray`).
  - **Error modes:** none. A degenerate zero rotation axis (astronomically
    unlikely from the PRNG) falls back to a fixed non-axis direction.

## Invariants & assumptions

- The matrix is **rigid**: rotation + translation, **scale = 1**. This
  mirrors the production alignment matrix (alignment-solver scale ≈ 1) and
  guarantees Euclidean distances are preserved, so threshold-gate tests
  that compare metre distances stay meaningful across the frame change.
- Rotation is about a **tilted, non-axis** direction with a substantial
  angle (20°–80°), and translation is non-zero (≈ ±20 m per axis), so the
  transform is unmistakably non-identity and non-symmetric.
- Column-major output: index 12/13/14 hold the translation.

## Examples

```ts
import * as THREE from 'three';
import { makeNonTrivialAlignment } from '../test-utils/non-trivial-alignment.js';

const m = new THREE.Matrix4().fromArray(makeNonTrivialAlignment());
arWorldGroup.matrix.copy(m);
arWorldGroup.matrixAutoUpdate = false;
arWorldGroup.updateMatrixWorld(true);
```

## Tests

- Used as the default fixture in `../visualization/gps-anchor.test.ts` and
  `../visualization/gps-anchor.property.test.ts` (alignment-frame bug
  regression and the alignment-independence invariant). No dedicated test
  of its own — its correctness is exercised transitively by those suites
  (e.g. the `inverse(M) ∘ M ≈ I` round-trip property).
