# `ar-scene-environment.ts`

## Purpose

Prepares the framework's scene for AR and hands back an undo. Mostly a list of
things **not** done.

## Why it is its own module — AR milestone 2

**The rule it exists to hold: never assign `scene.environment`.**
`building-view.ts.md` records what that costs in this project. three.js routes
any environment map through its CubeUV path, which expects a PMREM-processed
texture; given a raw equirect `DataTexture` it emits integer `CUBEUV_*` defines
into float assignments and **every `MeshStandardMaterial` fragment shader fails
to compile**.

**three.js does not throw for that — it logs and silently does not draw.**
Buildings, trees, plates and the ground all vanished for ten work items while
the status line still reported "21 volumes" and the whole suite stayed green,
because the one surviving material was the affordance grid's
`MeshBasicMaterial`.

An environment map is exactly how the demo's desktop view lights its standard
materials, so reaching for the same thing in AR is the obvious move. Keeping the
rule in a named module with a test on it means the decision is somewhere a
reader can point at, rather than an absence in `ar-mode.ts` that nobody notices.

## Public API

- `AR_CAMERA_NEAR_M` / `AR_CAMERA_FAR_M` — 0.5 m and 1000 m.
- `AR_FOG_NEAR_M` — 400 m. There is deliberately NO fog-far constant: the fade
  ends at `AR_CAMERA_FAR_M`, and one constant is what makes that unbreakable.
- `applyArEnvironment(scene, camera, renderer?): RestoreArEnvironment` — apply,
  and return the undo. Idempotent undo.
  - The framework objects are **parameters rather than `getScene()`/
    `getCamera()`/`getRenderer()` calls**, so this module needs no framework
    import and tests need no mock.
  - `renderer` is **optional where `camera` is required**, and the asymmetry is
    the point: without a camera the planes are wrong and the city clips at
    200 m, while without the renderer it merely looks over-exposed. One is a
    broken session, the other a worse-looking one. An omitted or `null`
    renderer is normalised once at the top, so an older framework build without
    `getRenderer()` degrades instead of throwing.

## Invariants & assumptions

- **`scene.environment` is set to `null` and never to a texture.** See above. It
  is cleared rather than merely left alone, because inheriting one from
  upstream would fail the same silent way.
- **`scene.background` must be null.** The camera feed IS the background;
  anything in `background` is composited over it, and an AR view with a
  background is an opaque 3D view. The framework's scene sets none today, and
  `background` is a Scene property so reparenting cannot carry the demo's sky
  across — this is a cheap assertion that it stays that way, not a guard on a
  live path. (An earlier version of this file said the opposite; r508 review.)
- **The camera's planes are the demo's to set, and it needs no framework
  change** (plan §2.3). The framework's `0.01 / 200` are module-private, but
  `getCamera()` returns the live camera and three.js copies `camera.near/far`
  into `session.updateRenderState` on every `updateCamera`.
  - `0.01` quantises depth to ~6 cm at 100 m and ~55 cm at 300 m; `0.5 / 1000`
    is ~50× better at every distance while seeing 5× further. 0.5 m is what the
    demo's desktop camera already uses.
  - **`updateProjectionMatrix()` is consistency, NOT the delivery path** — an
    earlier version of this file had that backwards (r508 review). The planes
    reach pixels via `session.updateRenderState`, applied from the next frame,
    and three then overwrites this camera's projection matrix from the XR view
    every frame (`updateUserCamera`). The call still matters before the first
    XR frame and for any non-XR read, and a camera whose `far` and projection
    disagree is a trap for the next reader.
  - **These hold only because depth-sensing is OFF.** three takes
    `depthNear/depthFar` from the depth texture and ignores the camera whenever
    one exists. `ar-mode.ts` passes `enableDepthSensingFeature: false`; turning
    occlusion on silently reverts both planes.
  - A **null camera bails the session out** rather than being tolerated:
    carrying on would leave `0.01 / 200` in place and clip a 2.8 km mesh at
    200 m with no error anywhere.
- **Fog is ADDED, because the framework's AR scene has none.** Without it the
  city clips at the far plane instead of fading — a hard pop-out against a real
  backdrop, which reads as broken rather than as distant.
  - **The fade ends exactly at `AR_CAMERA_FAR_M`** (§2.3, "fog matched to its
    own far plane"). Fog ending short means geometry in the gap is fully
    transformed, rasterised and shaded to produce solid grey; fog ending past
    means the fade never completes and the clip is a visible wall again.
    - **Expressed as ONE constant rather than an asserted equality.** It was
      two, with `AR_FOG_FAR_M = AR_CAMERA_FAR_M` and a test comparing them — a
      test that could not fail. `check:deadcode` flagged the duplicate export,
      which is what surfaced it. The test now pins that the fog OBJECT is built
      from the camera constant, which a hard-coded literal would break.
  - The 600 m fade LENGTH is a judgement, not a measurement: desktop fades over
    816 m of a 2400 m budget because it looks at a city from above, where AR
    stands in it at eye height. M4 measures the far plane; both are cheap to
    change once there are numbers.
  - The colour is neutral grey rather than the desktop's sky horizon, because
    there is no sky to match — a saturated fog would read as coloured haze.
    - **This is the module's weakest decision and M4 measures it** (r508
      review). Desktop's fog fades a building into the sky drawn behind it, so
      the fade completes into something. Here the materials are opaque, so
      `THREE.Fog` cannot reduce their alpha: at `AR_CAMERA_FAR_M` a building is
      100 % grey and still fully occludes the passthrough. Against a dark
      façade or indoors that is a bright slab, not distance. The AR-native
      answer is a distance-driven **alpha** fade, or a nearer far plane —
      neither judgeable without a phone.
  - `NEAR < FAR` is asserted: three.js silently fogs a scene to invisibility if
    they are swapped.
- **Tone mapping is matched to the demo's, because the framework sets none.**
  Its renderer is `NoToneMapping` at exposure 1.0 by deliberate neutrality;
  every colour here was authored under ACES at 0.5, and `building-view.ts` says
  tone mapping "re-maps EVERY colour in the scene". Inheriting the default
  roughly doubles effective exposure and drops the filmic shoulder, so the
  emissive-boosted surfaces clip. **This was the largest look delta in AR and
  M2 originally missed it entirely** (r508 review) — it needed a new framework
  accessor, `getRenderer()`, which M4's draw-cost readout also needs.
- **The framework's own lights are left alone.** AR uses its ambient 0.5 /
  directional 0.8 by decision (plan §2.8) — tuned for content seen against a
  camera feed, where the demo's 0.25 / 1.1 was tuned against its own sky.
  Re-lighting here would fight the framework and create a second source of truth
  for what the desktop view must be restored to.
- **The restore closure snapshots per call**, so two overlapping applies cannot
  have the first restore undo the second's state.
- **The restore exists for hygiene, NOT to prevent a leak.** `initAR` builds a
  fresh scene, camera and renderer on every call and `endARSession` drops all
  three, so nothing here can reach a later session. It is for a caller passing
  objects it does not own, and for the reader: a function that mutates four
  objects and offers no undo invites the next edit to mutate a fifth. **An
  earlier version claimed the framework reused them, in five places, and was
  simply wrong** (r508 review) — the code was the same either way, the reasoning
  a later change would have built on was not.
  - Symmetry is the whole value, so it is asserted: `scene.environment` was
    being cleared and never restored, in the module whose stated purpose is that
    one property.

## The other half of "materials draw", which is NOT here

Clearing `scene.environment` is safe only if the materials can be lit without
one. `ar-content-materials.test.ts` holds that constraint, because it is a
property of the materials rather than of AR: at `metalness = 1` the diffuse term
is zero by definition, so a metallic building would compile, draw, pass every
existing assertion, and be **black**. Nobody editing `mesh-layers.ts` for the
desktop look — which is lit by a PMREM sky through `sky-rig.ts` — is thinking
about a mode that takes that light away, which is exactly why it is a guard and
not a comment.

It covers all three members of the AR content set. Reaching the cell grid's two
materials is why they moved to [`cell-materials.ts`](cell-materials.ts.md): they
were built inline inside a method that needs a `WebGLRenderer`, so the guard
walked the mesh layers and silently skipped the grid — including the one
material in the set carrying an `onBeforeCompile` patch.

**What none of this proves is that pixels appear.** That needs a GL context and
ultimately a phone, and §6 of the plan says so outright.

## Examples

```ts
const restore = applyArEnvironment(getScene()!, getCamera()!, getRenderer());
// …session runs…
restore(); // called from ar-mode's `release`, so it runs on BOTH exits
```

## Tests

`ar-scene-environment.test.ts` — the background cleared, the environment never
set, fog present and ending on the fog OBJECT at the camera's own `far`, the
planes widened past the framework's, the projection matrix rebuilt, the grading
applied, a null renderer tolerated, the framework's lights untouched by
intensity and colour (not merely by child count), and the restore cases: a scene
that had a background AND an environment, one that had nothing, the camera's
planes and projection, the renderer's grading, a double restore, and a restore
that must return what it CAPTURED rather than what is present when it runs.

`ar-mode.test.ts` pins that all of it is **called** — the restore on **both**
exits including the system-initiated end where nothing calls `dispose()`, the
planes actually reaching the camera, the renderer actually graded, the bail-out
when `getCamera()` is null, and the session still starting when `getRenderer()`
is. That split is deliberate: M1 shipped three modules that were each correct in
isolation with nothing asserting they were connected.

`ar-content-materials.test.ts` — the materials survive the missing environment
map (see above).
