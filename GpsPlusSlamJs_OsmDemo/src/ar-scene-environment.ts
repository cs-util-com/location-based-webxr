/**
 * The AR scene's environment — mostly a list of things NOT done.
 *
 * **THE RULE THIS MODULE EXISTS TO HOLD: never assign `scene.environment`.**
 * `building-view.ts.md` records what that costs here. three.js routes any
 * environment map through its CubeUV path, which expects a PMREM-processed
 * texture; given a raw equirect `DataTexture` it emits integer `CUBEUV_*`
 * defines into float assignments and **every `MeshStandardMaterial` fragment
 * shader fails to compile**. three.js does not throw — it logs and silently
 * stops drawing the material. Buildings, trees, plates and the ground all
 * vanished for ten work items while the status line still reported "21 volumes"
 * and the whole suite stayed green, because the one surviving material was the
 * affordance grid's `MeshBasicMaterial`.
 *
 * AR does not need one. The passthrough camera IS the surround, and the
 * framework's own ambient and directional lights are what the borrowed
 * materials read. `ar-content-materials.test.ts` holds the other half of that
 * claim: the materials have to be lightable WITHOUT one, which is a property of
 * the materials rather than of AR.
 *
 * **AND THE BACKGROUND MUST BE NULL**, which is the same class of mistake in
 * the other direction: anything in `scene.background` is composited over the
 * camera feed, and an AR view with a background is an opaque 3D view. The
 * framework's scene sets none today, and `background` is a Scene property so
 * reparenting cannot carry the demo's sky across — this is a cheap assertion
 * that it stays that way, not a guard on a live path.
 *
 * **WHAT IT DOES ADD IS FOG, MATCHED TO THE CAMERA'S FAR PLANE**, and the
 * demo's tone mapping, which the framework's renderer does not set.
 *
 * **WHY APPLY/RESTORE RATHER THAN JUST APPLY.** Not because the framework's
 * objects are shared: `initAR` builds a fresh scene, camera and renderer on
 * every call and `endARSession` drops all three, so nothing here can leak into
 * a later session. The restore is for the caller that passes a scene or
 * renderer it does not own — and for the reader, since a function that mutates
 * four objects and offers no undo invites the next edit to mutate a fifth.
 * **An earlier version of this file claimed the framework reused them and was
 * simply wrong** (r508 review); the code was the same either way, but the
 * reasoning a later change would have built on was not.
 *
 * @see ar-scene-environment.ts.md
 */

import * as THREE from "three";

/**
 * The AR camera's depth budget, metres — plan §2.3.
 *
 * **The framework's own are `0.01 / 200` and module-private**, but `getCamera()`
 * returns the live camera and `WebXRManager.updateCamera` reads `camera.near`
 * and `camera.far` off it directly, so a consumer sets these in two lines and
 * needs no framework change.
 *
 * Since depth resolution goes as `d² / (near · 2^N)`, `0.01 / 200` is already
 * poor at range (~6 cm quantisation at 100 m, ~55 cm at 300 m). `0.5 / 1000` is
 * ~50× better at every distance while seeing 5× further, and 0.5 m is what the
 * demo's desktop camera already uses — city geometry is something you stand
 * outside of.
 *
 * **These hold only because depth-sensing is OFF.** three.js takes
 * `depthNear/depthFar` from the depth texture and ignores the camera whenever
 * one is present (`three.module.js`, `updateCamera`). `ar-mode.ts` passes
 * `enableDepthSensingFeature: false`, so there is no texture — but occlusion is
 * the obvious next thing an AR city wants, and turning it on silently reverts
 * both planes.
 */
export const AR_CAMERA_NEAR_M = 0.5;
export const AR_CAMERA_FAR_M = 1000;

/**
 * Where the AR fade STARTS, metres. Where it ends is `AR_CAMERA_FAR_M`.
 *
 * **THERE IS NO SEPARATE FOG-FAR CONSTANT, and that is the §2.3 invariant
 * expressed structurally** ("AR mode needs its own fog matched to its own far
 * plane"). three's linear fog uses `-mvPosition.z`, the same axis the
 * projection clips on, so at `far` the fog factor is exactly 1 and the clip is
 * invisible. Both ways of breaking that are real: a fog ending short of the
 * clip has every building in the gap transformed, rasterised and shaded to
 * produce solid grey, and a fog ending past it never completes, so the clip is
 * a visible wall again.
 *
 * **This was two constants with `AR_FOG_FAR_M = AR_CAMERA_FAR_M` and a test
 * asserting they were equal — a test that could not fail.** `check:deadcode`
 * flagged the duplicate export, which is what surfaced it. One constant makes
 * the invariant unbreakable rather than merely watched; what the test now pins
 * is that the fog OBJECT is built from it, which a hard-coded literal would
 * break.
 *
 * The 600 m fade LENGTH is a judgement rather than a measurement: desktop fades
 * over 816 m of a 2400 m budget because it looks at a whole city from above; in
 * AR the user stands in it at eye height where the useful content is the street
 * they are on, so the crisp band ends earlier in proportion. M4 measures the far
 * plane and these are cheap to change once there are numbers.
 *
 * **`NEAR < FAR` is asserted rather than assumed**: three.js silently produces
 * a scene fogged to invisibility if they are swapped.
 */
export const AR_FOG_NEAR_M = 400;

/**
 * The fog colour.
 *
 * NEUTRAL GREY rather than the desktop view's sky horizon, because there is no
 * sky in AR to match and a saturated colour would read as coloured haze.
 *
 * **THIS IS THE WEAKEST DECISION IN THE MODULE and M4 is where it gets
 * measured** (r508 review). Desktop's fog fades a building into the sky drawn
 * behind it, so the fade completes into something; here the materials are
 * opaque, so `THREE.Fog` cannot reduce their alpha and a building at
 * `AR_CAMERA_FAR_M` is 100 % this colour while still fully occluding the
 * passthrough. Against a dark façade or indoors that is a bright grey slab, not
 * distance. The AR-native answer is a distance-driven ALPHA fade — geometry
 * dissolving into the real world — or simply a nearer far plane; both are
 * changes worth making against a measurement rather than against a guess, and
 * neither can be judged without a phone.
 */
const AR_FOG_COLOUR = 0x9aa3b8;

/**
 * Tone mapping, copied from the demo's own renderer (DEC-R6-4).
 *
 * **THE LARGEST LOOK DELTA IN AR, and the least obvious.** The framework's
 * renderer sets no tone mapping and no output colour space — deliberately, as
 * it has no opinion about a consumer's grading — so it renders at
 * `NoToneMapping` and exposure 1.0. Every colour in this demo was authored
 * under ACES at exposure 0.5, and `building-view.ts` states the consequence
 * outright: tone mapping "re-maps EVERY colour in the scene", which is why the
 * e2e suite's absolute-colour assertions had to become palette-independent
 * before it landed. Rendering the same materials ungraded roughly doubles
 * effective exposure and drops the filmic shoulder, so the emissive-boosted
 * surfaces clip to white.
 *
 * Matched rather than re-tuned: the point of AR mode is the same city seen from
 * inside, and a second grade would be a second source of truth for a look the
 * owner judges on a phone.
 */
const AR_TONE_MAPPING = THREE.ACESFilmicToneMapping;
const AR_TONE_MAPPING_EXPOSURE = 0.5;

/** Undo the changes {@link applyArEnvironment} made. Idempotent. */
export type RestoreArEnvironment = () => void;

/**
 * Prepare a scene, camera and renderer for AR, and return the undo.
 *
 * Touches `scene.background`, `scene.fog`, the camera's `near`/`far`, and the
 * renderer's tone mapping — and asserts `scene.environment` stays clear. The
 * framework's lights are left exactly as they are: AR uses them by decision
 * (plan §2.8), and re-lighting here would fight the framework and create a
 * second source of truth for what the desktop view has to be restored to.
 *
 * The framework objects are PARAMETERS rather than `getScene()`/`getCamera()`
 * calls so this module stays free of framework imports and testable with bare
 * three.js objects.
 *
 * @param renderer the session's renderer, or `null` to leave grading alone.
 *   Null is tolerated here where a null CAMERA is not, and the asymmetry is the
 *   point: without a camera the planes are wrong and the city clips at 200 m,
 *   while without the renderer the city merely looks over-exposed. One is a
 *   broken session, the other is a worse-looking one.
 */
export function applyArEnvironment(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer?: THREE.WebGLRenderer | null,
): RestoreArEnvironment {
  // NORMALISED ONCE at the boundary, so every check below is a single `null`
  // comparison. The framework's accessor returns `null`, but an omitted
  // argument gives `undefined` and a `!== null` test would let that through to
  // a property assignment on nothing.
  const target = renderer ?? null;
  // SNAPSHOTTED PER CALL, so a closure restores what IT captured rather than
  // whatever is present when it runs. Two overlapping applies would otherwise
  // have the first restore undo the second's state.
  const previousBackground = scene.background;
  const previousEnvironment = scene.environment;
  const previousFog = scene.fog;
  const previousNear = camera.near;
  const previousFar = camera.far;
  const previousToneMapping = target?.toneMapping;
  const previousExposure = target?.toneMappingExposure;
  let restored = false;

  scene.background = null;
  // Belt and braces against the failure in the header: if something upstream
  // set an environment map, AR is the worst place to inherit it, because the
  // symptom is silence.
  scene.environment = null;
  // FROM `AR_CAMERA_FAR_M`, NOT A LITERAL — the fade has to end exactly where
  // the projection clips, and one constant is what makes that unbreakable.
  scene.fog = new THREE.Fog(AR_FOG_COLOUR, AR_FOG_NEAR_M, AR_CAMERA_FAR_M);

  camera.near = AR_CAMERA_NEAR_M;
  camera.far = AR_CAMERA_FAR_M;
  // CONSISTENCY, NOT THE DELIVERY PATH — and an earlier comment here had that
  // backwards. The planes reach pixels because `WebXRManager.updateCamera`
  // reads `camera.near/far` and calls `session.updateRenderState`, which
  // applies from the NEXT frame; three then overwrites this camera's
  // projection matrix from the XR view on every frame, so what is computed
  // here is discarded as soon as the session presents. It still matters before
  // the first XR frame and for anything that reads the camera outside the XR
  // loop, and leaving a camera whose planes and projection disagree is a trap
  // for the next reader.
  camera.updateProjectionMatrix();

  if (target !== null) {
    target.toneMapping = AR_TONE_MAPPING;
    target.toneMappingExposure = AR_TONE_MAPPING_EXPOSURE;
  }

  return () => {
    if (restored) return;
    restored = true;
    scene.background = previousBackground;
    scene.environment = previousEnvironment;
    scene.fog = previousFog;
    camera.near = previousNear;
    camera.far = previousFar;
    camera.updateProjectionMatrix();
    if (target !== null && previousToneMapping !== undefined) {
      target.toneMapping = previousToneMapping;
    }
    if (target !== null && previousExposure !== undefined) {
      target.toneMappingExposure = previousExposure;
    }
  };
}
