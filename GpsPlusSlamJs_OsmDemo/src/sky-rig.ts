/**
 * The sky as a scattering shader, and the environment map derived from it
 * (§1, DEC-R6-2).
 *
 * WHAT THIS REPLACES. `sky-gradient.ts` painted a 256 × 64 equirectangular
 * `DataTexture` — a vertical ramp with a sun disc drawn into it — and assigned it
 * to `scene.background`. It was cheap, pure and fully testable, and it is
 * DELETED by this file rather than kept: what it could not do is light
 * anything, so a `HemisphereLight` stood in for the fill an environment map
 * would have supplied, and keeping two sky implementations alive would mean two
 * answers to "what colour is the horizon".
 *
 * THE OUTAGE THIS FILE HAS TO NOT REPEAT, and it is the reason for the
 * `dispose()` discipline and for the e2e guard that comes with it. W20 set
 * `scene.environment` to that raw equirect texture. three routes any environment
 * map through its CubeUV path, which expects PMREM-processed input, and with a
 * raw one it emits integer `CUBEUV_*` defines into float assignments:
 *
 *   ERROR: 0:439: 'assign' : cannot convert from 'const int' to 'highp float'
 *
 * three does not throw for that. It logs and simply DOES NOT DRAW the material —
 * so the buildings, the trees, the ground and the plates all vanished for ten
 * work items while the status line still reported "21 volumes" and every pixel
 * assertion stayed green, satisfied by the one surviving `MeshBasicMaterial`.
 *
 * **The fix is not "be careful"; it is to run the texture through
 * `PMREMGenerator` so it is the shape three's CubeUV path expects.** That is
 * what this file does, and `fromScene` on the `Sky` mesh is the supported route.
 *
 * WHY THE REGENERATION COST IS AFFORDABLE NOW. `fromScene` is a render pass into
 * a cube render target. Under DEC-R4-6's camera-following sun it would have run
 * on every drag, which is exactly the per-frame main-thread cost DEC-R3-9's
 * on-demand renderer exists to avoid. DEC-R6-3 made the sun physical, so it only
 * moves when the user changes the time — a deliberate action, and never
 * otherwise. **The decision to reverse DEC-R4-6 is what pays for this file.**
 *
 * THE SKY MESH IS NEVER IN THE SCENE — A DEVIATION FROM §1, FOR A HARD REASON.
 *
 * §1 described adding the `Sky` mesh to the scene, as three's example does. That
 * cannot work here: the example runs a far plane of 2 000 000 and **ours is
 * 2400**, tied to `TERRAIN_EXTENT_M` by `far-field.test.ts` because the ground
 * plane has to reach at least as far as the camera can see (finding R2-9). A
 * dome at any scale large enough to enclose the city is entirely beyond that far
 * plane, so it would be clipped away and the sky would simply not be drawn —
 * and with `depthWrite: false` it would fail silently, exactly like every other
 * defect this file's header is about.
 *
 * Scaling the dome down to fit is worse rather than better: the ground plane is
 * 4800 m across, so its corners reach 3394 m from the origin and would stick out
 * through any dome that fits inside a 2400 m frustum.
 *
 * **So the sky mesh is never added to the scene.** It exists only as a source
 * for `PMREMGenerator.fromScene`, and the resulting texture is used as BOTH
 * `scene.background` and `scene.environment` — which is what three's own
 * `webgl_shaders_ocean` example does with the same `Sky` object, and which is not
 * geometry and therefore not clipped by anything.
 *
 * **The accepted cost:** the background is the PMREM's mip 0 rather than the raw
 * shader, so the sun disc is softer than the prototype's. At a 256-pixel cube
 * face that is comparable to the hand-painted disc it replaces (0.035 rad on a
 * 256 × 64 equirect), so it is a change in kind rather than a loss of detail —
 * but it is a real difference from the file the owner approved and it is the
 * first thing to check by looking.
 *
 * @see sky-rig.ts.md
 */

import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

import type { SunAngles, Vector3Like } from "./sun-position.js";
import { sunDirection } from "./sun-position.js";

/**
 * How large the sky box is built.
 *
 * IRRELEVANT TO CLIPPING, unlike in three's example, because this mesh is never
 * in the rendered scene — see this file's header. `PMREMGenerator.fromScene`
 * renders it from the inside with its own camera, so
 * any non-degenerate scale yields the same texture. Kept at the example's value
 * so a reader comparing the two files does not have to wonder why it differs.
 */
const SKY_SCALE = 450_000;

/**
 * Atmosphere parameters, taken from the prototype the owner chose.
 *
 * These are the `Sky` shader's Preetham coefficients and they are NOT
 * independent knobs to taste-tune one at a time: turbidity is haziness, rayleigh
 * drives how blue the sky is, and the two Mie terms control the size and
 * directionality of the glow around the sun. The values are the prototype's,
 * kept together so the look that was approved is the look that ships.
 */
const ATMOSPHERE = {
  turbidity: 4.8,
  rayleigh: 1.2,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
} as const;

/**
 * `renderer.toneMappingExposure` for the ACES pass (DEC-R6-4).
 *
 * 0.5, the prototype's value. This is a STARTING POINT rather than a constant to
 * import on faith — the prototype had no city, no heat grid and no ground ramp
 * in frame, and DEC-R4-5 requires the affordance ramp to stay the loudest thing
 * on screen. `heat-ramp-dominance` in the e2e suite is what holds that.
 */
export const TONE_MAPPING_EXPOSURE = 0.5;

/**
 * The distance-haze colour, as RGB 0–255.
 *
 * INHERITED FROM `sky-gradient.ts`'s `HORIZON_RGB`, which this file replaces.
 * The colour is the sky's HORIZON rather than an arbitrary grey: anything else
 * and the fade reads as a grey band in front of the sky rather than as distance.
 *
 * **IT IS NOW A CONSTANT WHERE THE SKY IS NOT, AND THAT IS A KNOWN GAP.** The
 * old sky had one fixed horizon colour, so a fixed fog matched it exactly. The
 * scattering sky's horizon changes with the sun, so at noon this is too warm and
 * at night too light. Deriving it from the sky — sampling the PMREM at the
 * horizon, or evaluating the Preetham model on the CPU — is a real follow-up
 * rather than a tweak, and it is filed rather than guessed at here.
 */
export const FOG_RGB: readonly [number, number, number] = [92, 108, 140];

/**
 * The part of `PMREMGenerator` this file uses.
 *
 * NARROWED SO IT CAN BE FAKED, and that is not gold-plating: a real
 * `PMREMGenerator` needs a live GL context, CI has no GPU, and the invariant
 * most worth testing here is the DISPOSAL ORDER — which is pure bookkeeping and
 * has nothing to do with pixels. Round 5 shipped a VRAM leak of exactly this
 * shape (the ground colour attribute, ~1.9 MB abandoned per position change),
 * found by review rather than by a test. This seam is what lets a test hold it.
 */
export interface PmremLike {
  compileEquirectangularShader(): void;
  fromScene(scene: THREE.Scene): { texture: THREE.Texture; dispose(): void };
  dispose(): void;
}

/** What `SkyRig` needs from its host. */
export interface SkyRigOptions {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  /**
   * Builds the PMREM generator. Defaults to a real one.
   *
   * Present only so the disposal bookkeeping can be tested without a GPU; every
   * production caller omits it.
   */
  readonly pmremFactory?: (renderer: THREE.WebGLRenderer) => PmremLike;
}

/**
 * The sky mesh, its PMREM environment map, and the lifetime of both.
 *
 * ONE OBJECT rather than three loose fields on `BuildingView`, because the three
 * have a single invariant between them — the environment map must be
 * regenerated from the sky whenever the sun moves, and the PREVIOUS render
 * target must be disposed when it is. Splitting them is how a leak gets written.
 */
export class SkyRig {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly sky: Sky;
  private readonly pmrem: PmremLike;
  /**
   * The live environment map, held so the NEXT update can dispose it.
   *
   * A render target per sun move, never released, is a VRAM leak that grows with
   * how much the user plays with the time control — which is precisely the thing
   * a demo invites them to do. Round 5 already shipped one leak of this shape
   * (the ground colour attribute), so it is guarded by a test rather than by
   * care.
   */
  private target: { texture: THREE.Texture; dispose(): void } | undefined;
  /** How many targets have been released, so a test can count them. */
  private disposedTargets = 0;

  constructor(options: SkyRigOptions) {
    this.renderer = options.renderer;
    this.scene = options.scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(SKY_SCALE);
    for (const [name, value] of Object.entries(ATMOSPHERE)) {
      this.uniform(name).value = value;
    }
    this.pmrem =
      options.pmremFactory?.(this.renderer) ??
      new THREE.PMREMGenerator(this.renderer);
    // Compiled up front rather than lazily on the first `fromScene`, so the
    // shader cost lands during boot instead of as a hitch the first time the
    // user touches the time control.
    this.pmrem.compileEquirectangularShader();
    // NOT added to the scene — see the file header for why it cannot be.
  }

  /** The sky mesh, for tests and for callers that need to hide it. */
  get mesh(): THREE.Object3D {
    return this.sky;
  }

  /**
   * One of the `Sky` shader's uniforms, or a NAMED failure.
   *
   * `noUncheckedIndexedAccess` makes the lookup optional, and the tempting fix
   * is a non-null assertion. That would be wrong in a specific way: if a three
   * upgrade renamed a uniform, the assertion would write to `undefined.value`
   * and throw somewhere unrelated, while a silent skip would leave the sky
   * looking subtly wrong with nothing reported. Naming the missing uniform makes
   * a three upgrade fail where the problem is.
   */
  private uniform(name: string): THREE.IUniform {
    const found = this.sky.material.uniforms[name];
    if (found === undefined) {
      throw new Error(
        `three's Sky shader has no uniform "${name}" — it was renamed or removed by a three upgrade`,
      );
    }
    return found;
  }

  /** How many render targets this rig has released. */
  get releasedTargetCount(): number {
    return this.disposedTargets;
  }

  /**
   * Points the sky at a sun and rebuilds the environment map.
   *
   * Returns the unit direction towards the sun, so the caller can aim its
   * `DirectionalLight` along the SAME vector rather than deriving a second one.
   * Two independently-derived sun positions would be visible: a sun in the sky
   * that disagrees with where the highlights fall.
   */
  setSun(angles: SunAngles): Vector3Like {
    const direction = sunDirection(angles);
    (this.uniform("sunPosition").value as THREE.Vector3).set(
      direction.x,
      direction.y,
      direction.z,
    );
    this.refreshEnvironment();
    return direction;
  }

  /**
   * Regenerates `scene.environment` from the current sky.
   *
   * DISPOSE-THEN-REPLACE, in that order, and the order is the whole of it: the
   * old target must be released before the new one is assigned, or the reference
   * to it is gone and the GPU memory is unreachable.
   */
  private refreshEnvironment(): void {
    const previous = this.target;
    // Generated BEFORE disposing, so a throw inside `fromScene` leaves the
    // scene with its existing environment rather than with none — a scene whose
    // environment is null still draws, which is the failure mode to prefer.
    const next = this.pmrem.fromScene(this.sky as unknown as THREE.Scene);
    if (previous !== undefined) {
      previous.dispose();
      this.disposedTargets += 1;
    }
    this.target = next;
    this.scene.environment = next.texture;
    // BACKGROUND TOO, from the same texture. One PMREM pass serves both, and
    // using one texture for both is what makes the lit scene and the visible
    // sky provably the same sky rather than two things tuned to match.
    this.scene.background = next.texture;
  }

  /**
   * Releases everything this rig owns.
   *
   * `scene.environment` is cleared as well as the target disposed: leaving a
   * disposed texture assigned is a use-after-free that three does not report —
   * it simply stops drawing the materials that sample it, which is this file's
   * own outage in a new form.
   */
  dispose(): void {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    if (this.target !== undefined) {
      this.target.dispose();
      this.disposedTargets += 1;
      this.target = undefined;
    }
    this.scene.environment = null;
    this.scene.background = null;
    this.pmrem.dispose();
  }
}
