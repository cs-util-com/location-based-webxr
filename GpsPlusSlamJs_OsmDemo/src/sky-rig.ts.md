# `sky-rig.ts`

**Purpose:** the sky as three's Preetham scattering shader, the PMREM
environment map derived from it, and the lifetime of both (§1, DEC-R6-2).

Replaces `sky-gradient.ts`, which painted a 256 × 64 equirectangular
`DataTexture` and could only be a background. Deleted rather than kept: it could
not light anything, so a `HemisphereLight` had to stand in for the fill an
environment map supplies, and two sky implementations would mean two answers to
"what colour is the horizon".

## Public API

- `class SkyRig` — constructed with `{ renderer, scene, pmremFactory? }`.
  - `setSun(angles: SunAngles): Vector3Like` — points the sky at a sun,
    regenerates the environment map, and **returns the unit direction towards the
    sun** so the caller aims its `DirectionalLight` along the SAME vector. Two
    independently-derived sun positions are visible as a sun that disagrees with
    where the highlights fall.
  - `dispose(): void` — releases the mesh, the live render target, and the
    generator, and clears both `scene.environment` and `scene.background`.
  - `mesh: THREE.Object3D` — the `Sky` mesh, for tests and for callers that need
    to reach it. It is **not** in the scene; see the invariant below.
  - `releasedTargetCount: number` — how many render targets have been released.
    Exists so a test can hold the disposal bookkeeping without a GPU.
- `interface PmremLike` — the narrow slice of `PMREMGenerator` this file uses
  (`compileEquirectangularShader`, `fromScene`, `dispose`). Narrowed so it can be
  faked: a real generator needs a live GL context, CI has no GPU, and the
  invariant most worth testing is disposal ORDER, which has nothing to do with
  pixels.
- `TONE_MAPPING_EXPOSURE = 0.5` — the ACES exposure (DEC-R6-4). The prototype's
  value, and a **starting point rather than a constant to import on faith**: the
  prototype had no city, no heat grid and no ground ramp in frame.
- `FOG_RGB = [92, 108, 140]` — the distance-haze colour, inherited from
  `sky-gradient.ts`'s `HORIZON_RGB`.

## Invariants & assumptions

- **The sky mesh is NEVER added to the scene, and it cannot be.** three's example
  runs a far plane of 2 000 000; ours is 2400, tied to `TERRAIN_EXTENT_M` by
  `far-field.test.ts`. A dome large enough to enclose the city is entirely beyond
  it and would be clipped away — silently, with `depthWrite: false`. Scaling it
  down is worse: the 4800 m ground plane's corners reach 3394 m and would poke
  through any dome that fits. **The mesh is a source for
  `PMREMGenerator.fromScene` only**, and the resulting texture is both
  `scene.background` and `scene.environment` — what three's own
  `webgl_shaders_ocean` example does. Held by a test.
- **One texture drives background and environment.** That is what makes the lit
  scene and the visible sky provably the same sky rather than two things tuned to
  match.
- **Exactly one render target is live at any time.** Dispose-then-replace: the
  previous target is released before the new one is assigned, or its GPU memory
  becomes unreachable. Round 5 shipped a leak of exactly this shape (the ground
  colour attribute), found by review rather than by a test — this one is held by
  a test.
- **Generation happens BEFORE disposal**, so a throw inside `fromScene` leaves
  the scene with its existing environment rather than with none. A scene whose
  environment is null still draws; that is the failure mode to prefer.
- **A missing `Sky` uniform throws with its name.** A non-null assertion would
  write to `undefined.value` and throw somewhere unrelated; a silent skip would
  leave the sky subtly wrong with nothing reported. A three upgrade that renames
  a uniform fails where the problem is.
- **The environment map must be PMREM-processed.** W20 assigned a raw equirect
  texture; three routes any environment map through its CubeUV path, emitted
  integer `CUBEUV_*` defines into float assignments, logged the shader error and
  **silently did not draw the material**. Buildings, trees, ground and plates
  were absent for ten work items while the status line still said "21 volumes"
  and every pixel assertion stayed green, satisfied by the one surviving
  `MeshBasicMaterial`. The fix is structural, not care: `fromScene` produces the
  shape three's CubeUV path expects.

## Known limits

- **The sun disc is softer than the prototype's.** The background is the PMREM's
  mip 0 rather than the raw shader. At a 256-pixel cube face that is comparable
  to the hand-painted disc it replaces (0.035 rad on a 256 × 64 equirect), so it
  is a change in kind rather than a loss of detail — but it is a real difference
  from the file the owner approved and is the first thing to check by looking.
- **`FOG_RGB` is a constant where the sky is not.** The old sky had one fixed
  horizon colour so a fixed fog matched exactly; a scattering sky's horizon moves
  with the sun, so this is too warm at noon and too light at night. Deriving it
  means sampling the PMREM at the horizon or evaluating Preetham on the CPU —
  filed as **F43** rather than guessed at.
- **`ATMOSPHERE` is not a set of independent knobs.** Turbidity is haziness,
  rayleigh drives how blue the sky is, and the two Mie terms control the size and
  directionality of the glow around the sun. The values are the prototype's, kept
  together so the look that was approved is the look that ships.

## Examples

```ts
import { SkyRig, TONE_MAPPING_EXPOSURE } from "./sky-rig.js";
import { sunAt, DEFAULT_TIME_OF_DAY } from "./sun-position.js";

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

const rig = new SkyRig({ renderer, scene });
const towardsSun = rig.setSun(sunAt(DEFAULT_TIME_OF_DAY));
light.position.copy(towardsSun).multiplyScalar(1000); // ONE vector, two consumers

// later
rig.dispose();
```

## Tests

- `sky-rig.test.ts` — one live environment map however often the sun moves; the
  last one released on dispose; `scene.environment` and `scene.background` both
  cleared rather than left holding a dead texture; the previous environment kept
  when regeneration throws; the mesh **never** in the scene; background and
  environment driven from one texture; `setSun` returning the same direction the
  light must use. All run against a faked `PmremLike`, so they need no GPU.
- `osm-demo.spec.js` — the console-stays-clean e2e is the guard that would have
  caught W20's outage, and it is the reason this file exists in this shape.
