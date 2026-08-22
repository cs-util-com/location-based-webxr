/**
 * The three.js view: buildings extruded from the same merged features.
 *
 * WHY IT SHARES THE PIPELINE RATHER THAN FETCHING ITS OWN DATA. The 3D view is
 * here to verify the MESH code — `building:part` suppression, wall normals,
 * roof shapes, the `isApproximate` flag — and it can only do that if it is
 * looking at exactly the features the 2D view scored. Two fetch paths would
 * mean a discrepancy could be the data rather than the geometry.
 *
 * WHY THE PACKAGE DOES NOT DO THIS. `gps-plus-slam-osm` produces `Float32Array`
 * positions and normals plus `Uint32Array` indices and stops there, because it
 * must not depend on `three` (plan §4.2). Everything below is the three lines
 * that turn those buffers into a mesh, and they belong in the consumer.
 *
 * @see building-view.ts.md
 */

import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";

import { recentreOn } from "./recentre-camera.js";
import {
  createPerfStatsOverlay,
  type PerfStatsOverlayHandle,
} from "gps-plus-slam-app-framework/visualization/perf-stats-overlay";

import type { CellMesh } from "./cell-mesh.js";
import {
  groundIsOrderable,
  type GroundAppearance,
  type GroundStrategy,
} from "./ground-mode.js";
import { TERRAIN_EXTENT_M, type Heightfield } from "./heightfield.js";
import { heightRampColours } from "./height-ramp.js";
import {
  DEFAULT_CELL_PRESET,
  cellPreset,
  type CellPreset,
} from "./cell-presets.js";
import { cellFaceMaterial, cellOutlineMaterial } from "./cell-materials.js";
import { installGroundSlope } from "./ground-slope-shader.js";
import { drawMeshLayers } from "./mesh-layers.js";
import { SceneContent, type ContentFrame } from "./scene-content.js";
import { GROUND_COLOUR } from "./surface-colours.js";
import { buildUndergroundLines } from "./underground-lines.js";
import type { MeshLayerContext } from "./mesh-layers.js";
import type { DrawCost } from "./draw-cost.js";
import { RENDER_ORDER } from "./layer-order.js";
import {
  followerAt,
  followerSettled,
  stepFollower,
  type Follower,
} from "./agent-follower.js";
import { isPickGesture, type PointerOrigin } from "./pick-gesture.js";
import { resolvePick, type Pick, type ScenePoint } from "./pick.js";
import { AGENT_SPEED_MPS, pathLengthM, pointAlong } from "./route-path.js";
import { DEFAULT_TIME_OF_DAY, sunAt } from "./sun-position.js";
import { terrainTextureFrom } from "./terrain-texture.js";
import type { BuildingStats, MeshLayers } from "./mesh-layers.js";
import { FOG_RGB, TONE_MAPPING_EXPOSURE, SkyRig } from "./sky-rig.js";
import type { TransferableMesh } from "./worker/protocol.js";

// Re-exported so the many call sites that import these from the view keep working.
// The table owns them because it owns what they describe: `BuildingStats` is
// exactly the union of what the rows count.
export type { BuildingStats, MeshLayers } from "./mesh-layers.js";
export type { Pick } from "./pick.js";

/**
 * Which path displaces the ground plane, or `none` to hide it (W23, W11).
 *
 * THE STRATEGY, NOT THE MODE, and the difference is a real trap. This aliased
 * `GroundMode` until W6 gave that union its ramp entries — after which passing
 * "cpu-ramp" here type-checked and then silently FLATTENED the terrain, because
 * both `uDisplace` and `setTerrain`'s CPU walk compare against the literal
 * "cpu"/"gpu". Nothing would have reported it. `ground-mode.ts` already names the
 * three-value union this actually means; use it.
 */
export type GroundDisplacement = GroundStrategy;

/**
 * Metres between terrain posts. Terrarium z13 is ~12 m per pixel at this latitude.
 *
 * Sampling finer would interpolate detail the DEM never had; sampling coarser would
 * throw away detail already fetched.
 */
export const TERRAIN_SPACING_M = 12;

/*
 * `CELL_EMISSIVE_INTENSITY` moved to `cell-materials.ts` with the shader patch
 * that reads it. Its tuning note went with it: at 0 the grid read visibly
 * darker than the same cells on the 2D map, at 0.85 the rim bevel vanished, and
 * 0.5 is where the value matches and the facets survive (DEC-S1).
 */

/**
 * How far the camera can see, metres (W21, R4-16; W5, R5-4, DEC-R5-3).
 *
 * THE HISTORY IS THE ARGUMENT, because this number has now been set three times
 * and each move was right for what was known then:
 *
 * - **4000** put every building in a res-7 fetch tile inside the frustum, so the
 *   demo drew geometry three to five kilometres away. The whole tile was ONE
 *   merged mesh, so nothing could be culled and all of it was really drawn.
 * - **1200** fixed that, and the next testing session said the world now felt
 *   claustrophobic on the desktop — _"mindestens doppelt so weit"_.
 * - **2400** is that request, and it is affordable now for a reason that has
 *   nothing to do with taste: **W20 chunked the geometry**, so the frustum
 *   actually culls and distance costs what is VISIBLE rather than everything
 *   fetched. The trade the 1200 was priced against no longer exists.
 *
 * **IT IS EXACTLY `TERRAIN_EXTENT_M`, and that is the constraint rather than a
 * coincidence.** The ground plane reaches `TERRAIN_EXTENT_M` along each axis and
 * then stops; a far plane beyond it lets the default view see the edge of the
 * world, which is finding R2-9 (buildings standing on nothing) returning. The
 * three constants move together or not at all — `far-field.test.ts` asserts it.
 *
 * AR will still want its own number: `AR_CAMERA_FAR` is 200 in the framework,
 * nothing in this demo enters AR yet, and the draw-call readout is how that gets
 * chosen on evidence rather than guessed.
 */
export const FAR_PLANE_M = 2400;

/**
 * The scene camera's VERTICAL field of view, degrees (three.js convention).
 *
 * Exported because `map-zoom-to-camera.ts` needs it to convert a map zoom into
 * a camera distance, and a second literal `55` there would silently stop
 * agreeing with this one the first time the FOV is tuned — the two views would
 * then disagree about how much ground is on screen, which is the exact thing
 * that conversion exists to make them agree about.
 */
export const CAMERA_VFOV_DEG = 55;

/**
 * Where the ground plane sits, given the window the terrain was sampled in.
 *
 * ENU `(x, y)` becomes scene `(x, 0, -y)` — the same axis convention every other
 * piece of scene geometry uses. `y` stays 0: the plane's own vertices carry the
 * relief, and the datum is taken at the window's centre, so the surface is zero
 * there by construction.
 *
 * **EXPORTED SO THE RELATIONSHIP IS TESTABLE.** `FAR_PLANE_M <= TERRAIN_EXTENT_M`
 * only means "the ground reaches as far as the camera can see" while the plane
 * is centred under the camera. That used to be true because both sat at the
 * scene origin; since the frame was fixed it is true because the plane follows
 * the sampled window and `recentreOn` puts the orbit target on the same point.
 * A constant cannot notice if that stops holding — this function can, and
 * `far-field.test.ts` asks it.
 */
export function groundPositionFor(centreEnu: {
  readonly x: number;
  readonly y: number;
}): { x: number; y: number; z: number } {
  return { x: centreEnu.x, y: 0, z: -centreEnu.y };
}

/**
 * Where the haze starts, metres.
 *
 * Two thirds of the way out, so the fade is gradual enough to read as distance
 * rather than as a wall — the whole reason the far plane can be lowered at all.
 */
/**
 * Where the haze starts, as a fraction of the far plane.
 *
 * A RATIO RATHER THAN A SECOND DISTANCE, and the shape is deliberate.
 * `ar-scene-environment.ts` records removing exactly the alternative: "This was
 * two constants with `AR_FOG_FAR_M = AR_CAMERA_FAR_M` and a test asserting they
 * were equal -- a test that could not fail. ... One constant makes the invariant
 * unbreakable rather than merely watched." The same argument applies here, and
 * it is what lets `setFarPlane` move both with nothing left to keep in step.
 *
 * NOT EXPORTED: nothing outside this module reads it, and the workspace
 * dead-code check rejects an export with no reader -- as it did for
 * `ENTRY_GROUND_COLOUR` earlier on this branch. `FOG_NEAR_M` below is the
 * exported face of the same relationship.
 */
const FOG_NEAR_RATIO = 0.66;

export const FOG_NEAR_M = FAR_PLANE_M * FOG_NEAR_RATIO;

/**
 * Upper bound on plane subdivisions per axis.
 *
 * RAISED FROM 128 TO 256 ON 2026-07-30, because the measurement that justified
 * 128 does not reproduce. The old comment here read: "Deriving the segment count
 * purely from extent / spacing gives 234 at the 2.8 km extent - a 55 000-vertex
 * plane that setTerrain walks and then re-normals on every terrain update. That
 * tripled three e2e tests (3.7 s -> 12.6 s each) and made the suite flaky."
 *
 * Re-measured directly, by instrumenting `setTerrain` and counting its calls:
 *
 *   128 segments (16 641 vertices)   1 call per load, 12 ms total
 *   234 segments (55 225 vertices)   1 call per load, 30 ms total
 *   full e2e suite at 234            38 passed in 1.5 min, unchanged
 *
 * **One call per load, not hundreds.** A +9 s per-test cost would need roughly 300
 * calls of that walk, so whatever produced the original numbers, it was not the
 * per-update vertex walk this constant was introduced to bound. The most likely
 * culprit is the era it was measured in: the permanent rAF loop that was removed
 * around the same time, or the shader outage that ran from W20 until 2026-07-30
 * and made every ground-touching test behave oddly.
 *
 * RAISED AGAIN, 256 -> 480, WITH THE RE-MEASUREMENT THAT COMMENT DEMANDED (W5,
 * DEC-R5-3, DEC-R5-12). The extent grew from 1400 to 2400 m so the far plane
 * could double, which takes the derived count from 233 to 400. Measured the way
 * the last entry was — the per-call vertex walk plus `computeVertexNormals`, at
 * the sizes actually in play, median of seven:
 *
 *   233 segments (54 756 vertices, extent 1400)   14.3 ms
 *   400 segments (160 801 vertices, extent 2400)  44.4 ms
 *   480 segments (231 361 vertices, extent 2880)  42.3 ms
 *
 * **~3x, once per terrain load rather than per frame**, which is the number that
 * makes this affordable: 44 ms on a position change is a hitch, not a frame-rate
 * cost. (The 480 row measuring the same as 400 is JIT warmth, not a discovery —
 * it is listed because leaving it out would imply a cleaner curve than there is.)
 *
 * 480 is a CEILING, not a target, and it is deliberately STRICTLY above the
 * derived 400. A cap equal to the value it bounds is a ceiling only until someone
 * nudges the extent, and the failure is silent: the plane quietly becomes coarser
 * than the height field, which is the very relief R5-2 reports as invisible.
 * `far-field.test.ts` asserts the strict inequality so that nudge fails a gate
 * instead of costing detail. **If you raise the extent again, re-measure rather
 * than trusting this number.**
 *
 * This also removes the measured payoff that motivated GPU displacement (W23,
 * DEC-R2-24); see the round-2 plan for the deferral and its reasoning.
 */
export const MAX_GROUND_SEGMENTS = 480;

/**
 * Plane subdivisions per axis, DERIVED and then CAPPED.
 *
 * The derivation is the part that matters (finding B2): this was a hard-coded 64
 * with a comment explaining that 64 over 600 m gave a ~9.4 m quad, just finer than
 * the DEM's ~12 m pitch. Prose does not follow a constant — at 2.8 km that same 64
 * is 44 m quads, and the symptom would be "the terrain got blurry" rather than an
 * error. Deriving it enforces the relationship the comment only described.
 *
 * The cap is a ceiling against a much larger extent; see `MAX_GROUND_SEGMENTS`.
 * At the current 4.8 km plane (`TERRAIN_EXTENT_M = 2400`) the derived value is
 * 400 against a cap of 480, so it does not bind: the DEM pitch is matched
 * exactly and every quad of the ground plane carries real data. `far-field.
 * test.ts` asserts the inequality STRICTLY, so the next extent change fails a
 * gate rather than silently coarsening the ground.
 *
 * (This paragraph said "at the current 2.8 km extent" one commit after the
 * extent became 4.8 km — the same trap the first paragraph is about, in the same
 * docstring.)
 */
export const GROUND_SEGMENTS = Math.min(
  MAX_GROUND_SEGMENTS,
  Math.round((TERRAIN_EXTENT_M * 2) / TERRAIN_SPACING_M),
);

/**
 * The route polyline and the agent share ONE colour, and that is the point.
 *
 * They are two halves of the same answer — the plan and the thing executing it —
 * so a second colour would invite reading them as unrelated. Orange because
 * nothing else in this scene is: the affordance ramp owns the red-to-green axis
 * (DEC-R4-5 requires it to stay the loudest thing on screen), buildings are
 * class-coloured pastels, and roads are grey.
 */
const ROUTE_COLOUR = 0xff7a1a;

/**
 * The agent's size, in metres.
 *
 * VISIBLE AT CITY SCALE rather than human-sized. The camera looks at a 2.4 km
 * scene from ~200 m up; a 1.8 m figure is sub-pixel there, and an agent nobody
 * can find is the same as no agent. 4 m is roughly a storey — big enough to
 * follow, small enough to read as standing on the ground rather than looming
 * over it.
 */
const AGENT_HEIGHT_M = 4;
const AGENT_RADIUS_M = 1.2;

export interface BuildingViewOptions {
  readonly container: HTMLElement;
  /**
   * Called with whatever the user selected (W12).
   *
   * GENERALISED from `onCellClick(cell)`, because a cell is no longer the only
   * selectable thing. Buildings are still not selectable and that is deliberate:
   * they are excluded from the raycast set, so hitting one neither selects it nor
   * silently selects the cell behind it as though it had been chosen.
   */
  readonly onPick?: (pick: Pick) => void;
  /**
   * Called whenever the camera moves, with where it is looking (DEC-R13-7).
   *
   * THE VIEW REPORTS, THE PAGE DECIDES. Debouncing and writing the URL are
   * `main.ts`'s business — this fires on every `MapControls` change, which is
   * once per drag frame, and a view that throttled on its caller's behalf would
   * be guessing at a policy it cannot see.
   */
  readonly onCameraMove?: (view: CameraView) => void;
}

/** Where the camera is aimed, in scene coordinates, and from how far. */
export interface CameraView {
  readonly target: ScenePoint;
  readonly distanceM: number;
}

export class BuildingView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  /**
   * The map-derived content, as one subtree with a swappable parent.
   *
   * **THE AR SEAM** (plan milestone 0). Everything geographic hangs off this —
   * the drawn mesh layers, the res-13 cell mesh and outlines, the underground
   * lines — so AR mode can move the lot under the framework's scene root with
   * one call. Lights, the ground plane, the sun rig and the NPC stay on
   * `this.scene` deliberately: AR supplies its own lighting, hides the ground,
   * and does not render the agent.
   *
   * Attached to `this.scene` here, which is the desktop arrangement and is
   * unchanged by the extraction. See `scene-content.ts` for why the subtree is
   * named rather than left implicit.
   */
  private readonly content = new SceneContent(this.scene);
  private readonly camera: THREE.PerspectiveCamera;
  /**
   * Watches the CONTAINER, not the window (W1, finding R3-2).
   *
   * The container is a `1fr` row of a `auto 1fr` grid, so it shrinks whenever the
   * header grows — and the header grows on its own, without any window resize,
   * the moment the status line goes from "Loading the rule table…" to the
   * eight-fact string plus the legend and wraps to more lines. A window listener
   * cannot see that: measured at 1280x800, the drawing buffer stayed **109 px
   * taller than its container** for the whole session, stretching the picture and
   * leaving the camera on a stale aspect ratio.
   *
   * A `ResizeObserver` covers every cause at once — window resize, phone
   * rotation, the mobile sheet drag, the header collapsing — so the explicit
   * `resize()` calls those paths still make are belt-and-braces rather than the
   * mechanism.
   */
  private readonly containerResize: ResizeObserver;
  private readonly group = new THREE.Group();
  private readonly container: HTMLElement;
  private readonly controls: MapControls;
  /**
   * The one sun (W12/W14).
   *
   * ONE VECTOR drives both this light and the sky's painted sun disc. Two
   * independently-set sun positions would be the two-derivations-of-one-thing
   * defect this project keeps removing, and here it would be plainly visible: a
   * sun in the sky that disagrees with where the highlights fall.
   */
  private readonly sun: THREE.DirectionalLight;
  /** The pending rAF handle, so `dispose()` can cancel it. */
  private frame: number | undefined;
  /** Whether the desktop view is hidden and not drawing — see {@link suspend}. */
  private suspended = false;
  /**
   * Frames rendered since construction, published on the container (stage 4).
   *
   * The observable behind the e2e's "the scene goes quiet" assertion. See
   * `requestFrame`, which is the only place it moves.
   */
  private frames = 0;
  /** The planned route's polyline, replaced wholesale like the cell grid. */
  private routeLine:
    | THREE.Line<THREE.BufferGeometry, THREE.Material>
    | undefined;
  /** The agent itself — one marker, created on the first route (DEC-R11-15). */
  private agent: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | undefined;
  /**
   * The walk in progress: the path, when it started, and what to call at the end.
   *
   * HELD RATHER THAN CLOSED OVER, so a second order replaces the first instead
   * of running two walks against one marker — and so `dispose()` can drop it.
   */
  /**
   * The walk in progress: the exact path, when it began, and the BODY on it.
   *
   * `follower` is what the user actually sees (DEC-R13-3/4): the drawn polyline
   * keeps showing the planner's own hex centres, while the agent moves as a mass
   * accelerating towards a target that slides along them. `lastFrameAt` is held
   * because the follower is integrated per elapsed second rather than per frame
   * — a rAF-counted step would make the motion depend on the display's refresh
   * rate, which is the failure `agent-follower.test.ts` pins directly.
   */
  private walk:
    | {
        path: readonly ScenePoint[];
        startedAt: number;
        lastFrameAt: number;
        follower: Follower;
      }
    | undefined;
  /** The affordance grid, kept separate so `clear()` does not drop it. */
  private cellMesh: THREE.Mesh | undefined;
  /** The outline-treated cells' boundaries (W13). Lifecycle follows the grid. */
  private cellOutlines:
    | THREE.LineSegments<THREE.BufferGeometry, THREE.Material>
    | undefined;
  /** The below-surface outlines, replaced wholesale like the cell grid. */
  private undergroundLines:
    | THREE.LineSegments<THREE.BufferGeometry, THREE.Material>
    | undefined;
  /** Triangle index → cell id for the current grid. */
  private cellForTriangle: readonly string[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly onPointerDown: (event: PointerEvent) => void;
  private readonly onPointerStart: (event: PointerEvent) => void;
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.Material>;
  /** The AR shell material while a session runs; see `setArShellMaterial`. */
  private arShellMaterial: THREE.Material | undefined;
  /**
   * The scattering sky and the environment map derived from it (§1).
   *
   * Owns both, because they have one invariant between them: the environment is
   * regenerated whenever the sun moves, and the previous render target must be
   * released when it is. See `sky-rig.ts`.
   */
  private readonly skyRig: SkyRig;
  /**
   * Where the sun is, in `0..1` across the day (DEC-R6-3).
   *
   * A FIELD RATHER THAN A CONSTANT because it is now a control. It replaces the
   * camera-derived azimuth that DEC-R4-6 introduced; see `sun-position.ts` for
   * why that had to go and what pays for it.
   */
  private timeOfDay = DEFAULT_TIME_OF_DAY;
  /** The flat plane's vertex positions, kept so terrain can be re-applied. */
  private flatGround: Float32Array | undefined;
  /** The current field, so a mode switch and the ramp can re-read it. */
  private terrain: Heightfield | undefined;
  /** The ground's normal look, held so the debug ramp can be switched back off. */
  private readonly groundMaterial: THREE.Material;
  /**
   * The height-ramp look (W24).
   *
   * UNLIT (`MeshBasicMaterial`) on purpose, and this is the whole reason it is a
   * separate material rather than `vertexColors` on the existing one. A lit
   * material MULTIPLIES the vertex colour by the incoming light, so the ramp would
   * be modulated by the very shading the ramp exists to see past — dark ground in
   * shadow would read as low, which is precisely the misreading this layer is here
   * to eliminate.
   */
  private readonly groundRampMaterial: THREE.MeshBasicMaterial;
  /** Whether the ramp is showing, so a terrain update knows to recolour. */
  private groundDebug = false;
  /** Which appearance is showing, so a repeated set is a no-op (§2). */
  private groundAppearance: GroundAppearance = "plain";
  /**
   * The affordance grid's look (§3, DEC-R6-9/10).
   *
   * Held so a rebuilt grid comes back with the look already chosen: the mesh is
   * replaced on every publish, so a preset applied only at the moment of the
   * keypress would silently revert on the next position change.
   */
  private cellLook: CellPreset = cellPreset(DEFAULT_CELL_PRESET);
  /**
   * Which path displaces the ground (W23, DEC-R2-24 as revised).
   *
   * BOTH SHIP, and the switch is deliberate rather than a leftover. The
   * measurement that first deferred the GPU path was taken on a desktop at a
   * fixed camera, which says little about a phone in AR where per-frame CPU is
   * the scarce resource — so the owner's call was to build both and compare them
   * on a real device. `terrain-texture.test.ts` asserts the two produce the same
   * ground, which is what stops the toggle moving the buildings.
   */
  private displacement: GroundDisplacement = "cpu";
  /** The height texture the GPU path samples. Undefined when there is no DEM. */
  private heightTexture: THREE.DataTexture | undefined;
  /** Uniforms shared by every ground material, so one write reaches all of them. */
  private readonly groundUniforms = {
    uHeightMap: { value: null as THREE.Texture | null },
    uExtentM: { value: 0 },
    uSpacingM: { value: 0 },
    uSide: { value: 0 },
    /** 1 while the GPU path owns displacement, 0 while the CPU path does. */
    uDisplace: { value: 0 },
    /**
     * 1 while the slope treatment is drawn, 0 for the plain lit ground (§2).
     *
     * A UNIFORM RATHER THAN A SECOND MATERIAL, for the reason the displacement
     * pair already establishes: switching it must not recompile a shader, or
     * every toggle costs a program build and the picker stutters.
     */
    uSlope: { value: 0 },
  };
  /**
   * What the last frame cost the GPU (W10, N5).
   *
   * READ AFTER THE RENDER, not derived from the scene graph. The scene graph
   * says what was BUILT; `renderer.info.render` says what was actually issued
   * after frustum culling — which is the whole difference Stage 3's chunking is
   * meant to create, and the number that would otherwise have to be argued.
   */
  private lastDrawCost: DrawCost | undefined;

  /** Milliseconds the last terrain application took, for the A/B comparison. */
  private lastTerrainMs = 0;
  /**
   * The FPS / frame-ms / MB panels, when they are switched on (W14, DEC-R3-18).
   *
   * OFF BY DEFAULT and mounted on demand, so the demo's default picture — and
   * every pixel assertion in the suite — is unchanged by its existence.
   */
  private perfStats: PerfStatsOverlayHandle | undefined;

  constructor(options: BuildingViewOptions) {
    this.container = options.container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      // Without this the drawing buffer is cleared after each composite, so a
      // readback from JS gets a blank image. It costs a little memory and buys
      // the only way to assert this view drew anything at all: the e2e suite
      // reads the pixels and counts the non-background ones. A 3D pane that
      // silently renders nothing looks exactly like a 3D pane with no
      // buildings nearby.
      //
      // NEEDED PRECISELY BECAUSE THERE IS NO PERMANENT rAF LOOP — see
      // `requestFrame`. Frames are scheduled on demand, so by the time a test
      // reads the canvas nothing is repainting, and without this the buffer has
      // already been cleared after the last composite. (This comment used to say
      // the opposite — "now that there IS a rAF loop" — which contradicted
      // `requestFrame`'s own docstring and the measurement behind it.)
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    options.container.appendChild(this.renderer.domElement);

    // THE SKY IS NOW A SCATTERING SHADER, AND IT LIGHTS THE SCENE (§1, DEC-R6-2).
    //
    // WHAT WAS HERE. A hand-painted 256 x 64 equirect `DataTexture` assigned to
    // `scene.background` and — deliberately — to nothing else, under a long
    // comment explaining why `scene.environment` had to stay unset. That comment
    // was right about the mechanism and its reason has now expired, so the short
    // version stays here and the rest moved to `sky-rig.ts`:
    //
    // W20 set `scene.environment` to that RAW equirect texture. three routes any
    // environment map through its CubeUV path, which expects PMREM-processed
    // input, and with a raw one it emits integer `CUBEUV_*` defines into float
    // assignments. Every `MeshStandardMaterial` then fails to compile, three logs
    // it and silently DOES NOT DRAW the material — so the buildings, the trees,
    // the ground and the plates vanished for ten work items while the status line
    // still reported "21 volumes" and every pixel assertion stayed green.
    //
    // THE FIX IS NOT "LEAVE IT UNSET", IT IS "PMREM IT FIRST", which is what
    // `SkyRig` does. The environment map is what actually makes surfaces shiny —
    // the ingredient DEC-R5-8 deferred to "the shader round", which this is.
    //
    // The guard that must come with it is a DRAWS-ANYTHING check in the e2e
    // suite, not an assertion that the field was set: the outage above was
    // invisible to property assertions.
    this.skyRig = new SkyRig({ renderer: this.renderer, scene: this.scene });

    // ACES FILMIC TONE MAPPING (DEC-R6-4), and it is not optional alongside a
    // scattering sky: unmapped, such a sky blows out to white, because its
    // radiance range is far wider than the display's. It re-maps EVERY colour in
    // the scene, which is why the e2e suite's absolute-colour assertions had to
    // become palette-independent claims BEFORE this landed.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

    // DISTANCE HAZE, and this REVERSES a round-2 decision on its own terms.
    // Fog was offered then and rejected because it would have hidden finding
    // R2-9 — distant buildings standing on fabricated, striped terrain — instead
    // of surfacing it. R2-9 is fixed (W10 of round 3 rewrote the heightfield), so
    // the objection has expired, and without haze a lowered far plane is a wall
    // where the world stops.
    //
    // The colour is the sky's HORIZON, not an arbitrary grey: anything else and
    // the fade reads as a grey band in front of the sky rather than as distance.
    this.scene.fog = new THREE.Fog(
      new THREE.Color(
        (FOG_RGB[0] ?? 0) / 255,
        (FOG_RGB[1] ?? 0) / 255,
        (FOG_RGB[2] ?? 0) / 255,
      ),
      FOG_NEAR_M,
      FAR_PLANE_M,
    );

    this.content.add(this.group);
    // Ambient LOWERED from 0.55. Ambient light is flat by definition — it adds the
    // same amount to every facet regardless of its normal — so it was actively
    // washing out the only cue that distinguishes one ground facet from the next.
    // The environment map now supplies the soft fill it used to.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    // THE HEMISPHERE LIGHT IS GONE (§1), and its own comment said why it would
    // be. It read: "the directional fill the environment map used to contribute,
    // from a LIGHT rather than from a texture" — it was a stand-in for the
    // environment map that could not be used, and `SkyRig` now supplies the real
    // thing. Keeping both would double-count the sky's fill and wash out exactly
    // the facet contrast DEC-R2-1 exists to produce.
    //
    // THE SUN IS PHYSICAL NOW (DEC-R6-3, reversing DEC-R4-6). Its azimuth used
    // to follow the camera's so a specular highlight was never lost as the eye
    // orbited; that is incompatible with a scattering sky, which would then spin
    // as you pan. `sun-position.ts` carries the full argument and the two things
    // that pay for the reversal.
    this.sun = new THREE.DirectionalLight(0xffffff, 1.1);
    this.scene.add(this.sun);
    // NOT aimed here: `aimSun` reads `this.controls`, which is constructed
    // further down. Aiming it at this point threw inside the constructor, took
    // the whole view with it, and turned 58 e2e tests red at once — a useful
    // reminder that a field-order dependency in a long constructor is invisible
    // until it is fatal.
    // A ground plane, so a building with no neighbours still reads as standing
    // on something rather than floating in the void.
    //
    // SIZED BY `TERRAIN_EXTENT_M`, which is 2400 m — a 4.8 km plane (W5, N6).
    // This comment used to argue for 600 m on the grounds that "the scoring
    // working set reaches ~128 m from the user, so a 2 km plane is mostly ground
    // no cell is ever scored on". **Every number in that argument had expired**:
    // the plane has been `TERRAIN_EXTENT_M * 2` since round 3, the working set
    // reaches ~250 m (`SCORE_DISK_MAX_RADIUS = 4`), and the decision it defended
    // was reversed twice — first by DEC-R2-8, then by DEC-R5-3.
    //
    // The size is not a scoring question at all any more, and that is the useful
    // correction: it is a RENDERING one. The plane has to reach at least as far
    // as the camera can see, or the default view looks past the edge of the
    // world. `heightfield.ts` owns the constant and `far-field.test.ts` pins the
    // relationship.
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(
        TERRAIN_EXTENT_M * 2,
        TERRAIN_EXTENT_M * 2,
        GROUND_SEGMENTS,
        GROUND_SEGMENTS,
      ),
      // REFLECTIVE, and flat-shaded (DEC-R2-1). The owner's decision was to keep
      // normal-based shading and accept that genuinely flat ground looks flat,
      // but to make the surface reflective so the facet edges show up as a
      // highlight slides across them while the camera moves.
      //
      // Three changes together, and all three are needed:
      //  - `color` lifted out of near-black (`0x1d2230` -> `0x3a4356`), because a
      //    surface that dark has almost no dynamic range for a highlight to live
      //    in — the shading was mathematically present and perceptually absent.
      //  - `roughness` well below the 1.0 default, which narrows the specular lobe
      //    so neighbouring facets return visibly different amounts of it. Too low
      //    and the ground turns to chrome; 0.42 keeps it reading as ground.
      //  - `flatShading` KEPT, because per-facet normals are what the highlight is
      //    varying over. Smooth shading would average exactly the discontinuity
      //    this is trying to reveal.
      //
      // Accepted, and correct: in genuinely flat terrain this still looks flat.
      // `terrain ±N m` in the status line is the only remaining signal separating
      // that from "the DEM did not load" — see `terrain-note.ts`.
      // LIGHTER AND MORE NEUTRAL SINCE §2 (DEC-R6-6): `0x3a4356` -> `0x6b7280`.
      // The owner liked the prototype's untreated mode, which is a plain mid-grey
      // lambert, and the argument is the same one that lifted this colour out of
      // near-black the first time: a dark surface has almost no dynamic range for
      // a highlight to live in. One step further, and less blue, so the aspect
      // tint §2 adds has somewhere to show rather than fighting a blue base.
      //
      // WHAT THIS TRADES. `sky-gradient.ts` used to guarantee the horizon was
      // lighter than the ground so the plane's far edge silhouetted against the
      // sky; that was two constants and is now a scattering shader, so the
      // relationship is measured from the rendered frame instead of asserted
      // between two arrays.
      new THREE.MeshStandardMaterial({
        // Paired with `PLATE_COLOUR` (DEC-R6b-7): moving this one alone is what
        // inverted the two in round 6, so the relationship is now asserted in
        // `surface-colours.test.ts` rather than left to whoever edits next.
        color: GROUND_COLOUR,
        flatShading: true,
        roughness: 0.42,
        metalness: 0.0,
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.groundMaterial = this.ground.material;
    this.groundRampMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
    });
    // BOTH materials displace, driven by one uniform, so switching the mode does
    // NOT recompile a shader — and so the height ramp is legible in either mode
    // rather than being a CPU-only debug view.
    installGroundDisplacement(this.groundMaterial, this.groundUniforms);
    installGroundDisplacement(this.groundRampMaterial, this.groundUniforms);
    // THE SLOPE TREATMENT GOES ON THE LIT MATERIAL ONLY (§2, DEC-R6-7). The ramp
    // material is `MeshBasicMaterial` — unlit on purpose, so the hypsometric
    // colour cannot be modulated by shading — and it has no `outgoingLight` to
    // patch. Putting isoclines on it would also be answering two questions with
    // one surface.
    //
    // CHAINED onto the displacement hook rather than replacing it; see
    // `ground-slope-shader.ts` for why that is the failure worth guarding.
    installGroundSlope(this.groundMaterial, this.groundUniforms);
    // WHAT MAKES A CLICK ON IT A DESTINATION (DEC-R11-17). The marker and the
    // raycast membership are one fact rather than two that can disagree — the
    // same pairing `regionId` and `poiInstances` already use. Setting one
    // without the other is a silent no-op: the ray hits the plane, `resolvePick`
    // cannot identify the hit, and the click reads as a dead control.
    this.ground.userData["ground"] = true;
    this.scene.add(this.ground);

    // FAR PLANE 2400 m — 4000, then 1200, now 2400. See `FAR_PLANE_M` for why
    // each move was right at the time; the short version is that W20's chunking
    // changed what distance COSTS, so the 1200 was priced against a trade that no
    // longer exists. The ceiling is now the terrain extent rather than a guess.
    //
    // 55° FOV is unchanged and is a different knob: the round-5 note said "field
    // of view" and then corrected itself to the far plane, which was the right
    // correction.
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_VFOV_DEG,
      1,
      0.5,
      FAR_PLANE_M,
    );
    this.camera.position.set(140, 110, 140);
    this.camera.lookAt(0, 10, 0);

    // `MapControls` rather than `OrbitControls` (DEC-5): pan-first suits a
    // top-down city view, where dragging should slide the ground rather than
    // swing the camera around a point the user did not choose. Both ship
    // INSIDE the `three` package this demo already depends on, so neither is a
    // new dependency — the concern that a camera controller would mean pulling
    // one in is out of date. Touch is handled natively: one finger pans, two
    // dolly and rotate.
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    // AIMED ONCE, HERE. It used to be re-aimed on every camera change because
    // the azimuth was derived from the camera; the sun is physical since
    // DEC-R6-3, so it only moves when the time does. It must still run before
    // the first frame, or the scene has no environment map and every PBR
    // surface renders unlit.
    this.aimSun();

    this.resize();
    // Held rather than constructed inline, so `dispose()` can actually
    // disconnect it. An observer that outlives disposal calls `setSize()` and
    // `updateProjectionMatrix()` on a renderer whose GL context is gone.
    this.containerResize = new ResizeObserver(() => {
      this.resize();
    });
    this.containerResize.observe(this.container);
    // Repaint when the camera moves — and ONLY then. See `requestFrame`.
    this.controls.addEventListener("change", () => {
      // NO LONGER RE-AIMS THE SUN, and that is a saving rather than an omission.
      // Under DEC-R4-6 the sun tracked the camera so every drag moved it; the
      // sun is physical since DEC-R6-3. Re-aiming here would now call
      // `PMREMGenerator.fromScene` on every drag — exactly the per-frame
      // main-thread cost DEC-R3-9's on-demand renderer exists to avoid.
      this.requestFrame();
      // WHERE THE CAMERA IS LOOKING, reported raw (DEC-R13-7). The ninth session
      // twice could not point at a finding — "wüsste ich nicht, wie ich dir das
      // irgendwie sinnvoll als Testbereich nennen kann" — and this is the
      // observable that fixes it. Unthrottled on purpose; see `onCameraMove`.
      options.onCameraMove?.(this.cameraView());
    });

    // Picking on `pointerup` after a still pointer, not on `click`: MapControls
    // consumes drags, and a click at the end of a 200 px pan would otherwise
    // select whatever cell happened to be under the pointer when it stopped.
    //
    // WHETHER THE GESTURE COUNTS IS `pick-gesture.ts`'s CALL, not this file's
    // (DEC-R13-8). This class needs a `WebGLRenderer`, so a guard written here
    // is a guard the unit suite cannot reach — the same reason `pick.ts` holds
    // the "what did you click" decision one step later in the chain. Note the
    // ORIGIN IS CLEARED WHATEVER THE ANSWER, so a refused right-click cannot
    // leave a stale press for the next release to measure against.
    let downAt: PointerOrigin | undefined;
    // Held, like every other listener here, so `dispose()` can remove it. An
    // anonymous one outlives disposal and keeps the view reachable.
    this.onPointerStart = (event: PointerEvent): void => {
      downAt = { x: event.clientX, y: event.clientY };
    };
    this.container.addEventListener("pointerdown", this.onPointerStart);
    this.onPointerDown = (event: PointerEvent): void => {
      const from = downAt;
      downAt = undefined;
      if (!isPickGesture(from, event)) return;
      const picked = this.pick(event);
      if (picked !== undefined) options.onPick?.(picked);
    };
    this.container.addEventListener("pointerup", this.onPointerDown);
  }

  /**
   * Move how far the view draws (r541 Q9/Q10, owner decision 2026-08-21).
   *
   * **THE FOG MOVES WITH IT, and that is why this is a method rather than a
   * setter on one field.** `THREE.Fog` is linear and is built with
   * `far = FAR_PLANE_M`, so every fragment past it is already fully fog
   * coloured. Raising the camera's `far` alone draws more geometry and shows
   * the identical image -- a control that reports 'nothing changed' about the
   * engine when it is only true of itself. Not news: `far-field.test.ts`
   * already asserts the relationship and calls it 'the specific way raising
   * the far plane alone goes wrong'.
   *
   * **THE GROUND PLANE DELIBERATELY DOES NOT MOVE.** Seeing empty scene past
   * its edge is acceptable (owner, 2026-08-21). Seeing INVENTED terrain is
   * not, and widening the plane past the height field is how that happens:
   * `surfaceHeight` clamps its sample index per axis and the GPU path uses
   * `ClampToEdgeWrapping`, so the edge profile extrudes outward as stripes
   * that read as relief and are fabricated -- finding R2-9, named in
   * `moveGroundTo`'s own comment. So this touches the camera and the fog and
   * nothing else.
   *
   * **NO LONGER A DEBUG-ONLY INSTRUMENT (DEC-K2, 2026-08-22).** This used to
   * say "a debug instrument, not a new default", and that `far-field.test.ts`
   * pinned the shipped view. `main.ts` now CALLS this at boot with the dial's
   * markup value, so the shipped view is whatever it applies. `FAR_PLANE_M` is
   * still unchanged and passing it here still restores the 1x baseline exactly
   * — that is the part that survived.
   *
   * Non-finite or non-positive input is ignored rather than applied: this
   * number reaches the projection matrix, where a `NaN` renders nothing at all
   * and raises no error -- which reads as 'the 3D view is empty' and is
   * indistinguishable from half a dozen other causes.
   */
  setFarPlane(farPlaneM: number): void {
    if (!Number.isFinite(farPlaneM) || farPlaneM <= 0) return;
    this.camera.far = farPlaneM;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = farPlaneM * FOG_NEAR_RATIO;
      this.scene.fog.far = farPlaneM;
    }
  }

  /**
   * How far the view is currently drawing, metres -- read back from the CAMERA.
   *
   * Read back rather than remembered, so a readout painted from it reports what
   * the projection matrix actually holds. One fed from the REQUESTED value
   * would keep saying 24000 while a `setFarPlane` that had stopped writing the
   * camera did nothing at all.
   */
  farPlaneM(): number {
    return this.camera.far;
  }

  /** Where the haze currently starts, metres -- read back from the FOG. */
  fogNearM(): number {
    return this.scene.fog instanceof THREE.Fog ? this.scene.fog.near : 0;
  }

  /**
   * Displaces the ground plane by a heightfield, or flattens it again.
   *
   * The plane is built in its own XY space and rotated into place, so the
   * height goes into the vertex's **z** before the rotation — putting it in `y`
   * would push the terrain sideways, which looks like a sheared plane rather
   * than like a mistake.
   *
   * The undisplaced positions are kept rather than recomputed: re-applying a
   * new field to already-displaced vertices would accumulate the relief on
   * every refresh, and a city would grow into a mountain over a few clicks.
   */
  setTerrain(
    field: Heightfield | undefined,
    /**
     * Where the window was sampled, in the scene's frame.
     *
     * SEPARATE FROM `field` because a DEM outage leaves `field` undefined while
     * the window still has a place — and the plane must follow it either way.
     * Defaults to the field's own centre so a caller that has one cannot pass a
     * contradictory pair.
     */
    centreEnu:
      | { readonly x: number; readonly y: number }
      | undefined = field?.centreEnu,
  ): void {
    const started = performance.now();
    this.terrain = field;
    // THE PLANE FOLLOWS THE WINDOW. The field is sampled around the USER while
    // the ENU frame stays anchored to the scene, so a plane left at the origin
    // would stop covering the ground under the user as soon as they walked
    // `extentM` — and `surfaceHeight`'s per-axis clamp then extrudes the edge
    // profile outward as stripes that look like terrain and are not (R2-9).
    //
    // Positioning it AT `centreEnu` is also what keeps the shader free of an
    // origin-offset uniform: a plane-local vertex coordinate is then exactly
    // grid-local, which is the space the height texture is indexed in.
    this.moveGroundTo(centreEnu);
    this.uploadHeightTexture(field);
    const attribute = this.ground.geometry.getAttribute("position");
    const positions = attribute.array as Float32Array;
    this.flatGround ??= Float32Array.from(positions);
    const flat = this.flatGround;

    // THE CPU PATH. Skipped entirely in GPU mode — leaving the plane flat is
    // what makes the comparison honest, because a run that does both would
    // measure neither.
    const onCpu = this.displacement === "cpu";
    for (let i = 0; i < positions.length; i += 3) {
      const x = flat[i] ?? 0;
      const planeY = flat[i + 1] ?? 0;
      // The plane's +y becomes the scene's -z under the -90° x rotation, and
      // `cell-mesh.ts` uses the same north convention.
      //
      // PLANE-LOCAL PLUS THE PLANE'S CENTRE, because `heightAt` is in the
      // scene's frame while these vertices are grid-local. Feeding the local
      // coordinates straight in silently desynchronises the plane from the
      // field by exactly the walked distance.
      positions[i + 2] =
        field === undefined || !onCpu
          ? 0
          : field.heightAt({
              x: x + field.centreEnu.x,
              y: planeY + field.centreEnu.y,
            });
    }
    attribute.needsUpdate = true;
    this.ground.geometry.computeVertexNormals();
    // The ramp is normalised over the field's own range, so a new field is a new
    // range: leaving the old colours would show the PREVIOUS position's relief
    // over this position's ground, which is the half-swapped scene this demo has
    // twice had to engineer away.
    if (this.groundDebug) this.applyGroundRamp();
    this.lastTerrainMs = performance.now() - started;
    this.requestFrame();
  }

  /**
   * Puts the ground plane where the window was sampled.
   *
   * **MOVES FOR A FAILED LOAD TOO, and the earlier reasoning for not doing so
   * was wrong.** It said moving a flat plane is invisible — true, and beside the
   * point: the plane is FINITE. It reaches `TERRAIN_EXTENT_M` from its centre
   * and stops, so a plane left behind during a DEM outage stops covering the
   * user as soon as they walk past that, leaving them off the edge of the world
   * with no ground at all. The 5 km re-anchor threshold puts that well inside a
   * single anchor. Raised in review on #269.
   *
   * A centre of `undefined` — a caller with neither a field nor a window — is
   * the only case that still leaves the plane alone.
   */
  private moveGroundTo(
    centreEnu: { readonly x: number; readonly y: number } | undefined,
  ): void {
    if (centreEnu === undefined) return;
    const at = groundPositionFor(centreEnu);
    this.ground.position.set(at.x, at.y, at.z);
  }

  /**
   * How long the last `setTerrain` took, and which path did it.
   *
   * Surfaced so the CPU/GPU comparison is a NUMBER rather than an impression.
   * The whole reason both paths ship is to be measured on a real phone, and
   * "it feels about the same" is not a measurement — this repo has already had
   * one constant justified by a remembered figure that did not reproduce.
   */
  terrainCost(): { ms: number; mode: GroundDisplacement } {
    return {
      ms: Math.round(this.lastTerrainMs * 10) / 10,
      mode: this.displacement,
    };
  }

  /**
   * Switches which path displaces the ground (W23).
   *
   * Re-applies the terrain, because the two paths are mutually exclusive: the
   * CPU path writes heights into the position buffer and the GPU path needs that
   * buffer flat. Leaving the old displacement in place would DOUBLE it.
   */
  setGroundDisplacement(mode: GroundDisplacement): void {
    if (mode === this.displacement) return;
    this.displacement = mode;
    this.groundUniforms.uDisplace.value = mode === "gpu" ? 1 : 0;
    // HIDDEN, NOT REMOVED (W11). The plane keeps its geometry, its material and
    // its displacement, so returning to `cpu`/`gpu` is a visibility flip rather
    // than a rebuild — and nothing else in the scene depends on it existing, so
    // the mesh layers are untouched either way. That last part is the failure
    // mode worth naming: a mode switch that quietly cleared the scene would look
    // exactly like the blanking bug W2 fixed.
    this.ground.visible = mode !== "none";
    this.setTerrain(this.terrain);
  }

  /**
   * Uploads the height field as a texture for the GPU path.
   *
   * HALF-FLOAT, not full float, and that is a portability decision rather than a
   * memory one. `R32F` is not linearly filterable in WebGL 2 without
   * `OES_texture_float_linear`, and a missing extension degrades to NEAREST
   * SILENTLY — which would give the GPU path a visibly blockier surface than the
   * CPU path while every test still passed. `R16F` is filterable in core WebGL 2,
   * and its ~11-bit mantissa resolves datum-relative relief to about 6 cm, which
   * is far finer than the DEM's own ~12 m posting. It would be useless for
   * ABSOLUTE altitude, which is a second, independent reason the texture is built
   * datum-relative.
   */
  private uploadHeightTexture(field: Heightfield | undefined): void {
    this.heightTexture?.dispose();
    this.heightTexture = undefined;
    this.groundUniforms.uHeightMap.value = null;

    const texture = field === undefined ? undefined : terrainTextureFrom(field);
    if (texture === undefined) {
      // No DEM. The uniform stays null and `uDisplace` is irrelevant, so the GPU
      // path draws the same flat plane the CPU path would.
      this.groundUniforms.uSide.value = 0;
      return;
    }

    const half = new Uint16Array(texture.data.length);
    for (let i = 0; i < half.length; i += 1) {
      half[i] = THREE.DataUtils.toHalfFloat(texture.data[i] ?? 0);
    }
    const map = new THREE.DataTexture(
      half,
      texture.side,
      texture.side,
      THREE.RedFormat,
      THREE.HalfFloatType,
    );
    map.minFilter = THREE.LinearFilter;
    map.magFilter = THREE.LinearFilter;
    // CLAMPED, so a sample beyond the field repeats the edge rather than wrapping
    // to the far side of the city — which would put a cliff at the plane's rim.
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.needsUpdate = true;

    this.heightTexture = map;
    this.groundUniforms.uHeightMap.value = map;
    this.groundUniforms.uExtentM.value = texture.extentM;
    this.groundUniforms.uSpacingM.value = texture.spacingM;
    this.groundUniforms.uSide.value = texture.side;
  }

  /**
   * Mounts or removes the performance panels (W14, DEC-R3-9/18).
   *
   * Mounted into the view's own container so it sits over the 3D pane rather
   * than over the map, and disposed on the way out so a session of toggling
   * cannot stack panels — the framework module's own documented hazard.
   */
  setPerfOverlay(enabled: boolean): void {
    if (enabled === (this.perfStats !== undefined)) return;
    if (!enabled) {
      this.perfStats?.dispose();
      this.perfStats = undefined;
      return;
    }
    this.perfStats = createPerfStatsOverlay(this.container);
    // One frame immediately, or the panels sit empty until the camera moves —
    // which reads as "the overlay is broken" rather than "the scene is static".
    this.requestFrame();
  }

  /**
   * Shows or hides the terrain height ramp (W24, DEC-R2-25).
   *
   * A DIAGNOSTIC view, not a change to the look DEC-R2-1 chose: that decision
   * rejected a hypsometric ramp as the PRIMARY appearance and said nothing about a
   * debug layer. What it buys is the answer to "did the DEM load, or is this place
   * just flat?" — a question `terrain ±N m` in the status line is currently
   * carrying alone, and which a picture answers better.
   */
  setGroundDebug(enabled: boolean): void {
    this.setGroundAppearance(enabled ? "ramp" : "plain");
  }

  /**
   * Applies an affordance-tile look preset (§3, DEC-R6-9/10).
   *
   * THE CHEAP HALF ONLY. Opacity, fog and the lift are a material and a
   * transform, so they are applied here and cost nothing. The geometry axes —
   * real extrusion and score-as-height — change the vertex buffers, which are
   * built in the worker; the caller republishes for those and NOT for these,
   * because a republish over ~2 989 cells on every keypress would make the
   * hotkey feel broken.
   *
   * The preset is HELD as well as applied: the grid mesh is replaced on every
   * publish, so a look applied only at the moment of the keypress would revert
   * on the next position change.
   */
  setCellPreset(preset: CellPreset): void {
    this.cellLook = preset;
    const mesh = this.cellMesh;
    if (mesh === undefined) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.opacity = preset.opacity;
    material.transparent = preset.opacity < 1;
    material.depthWrite = preset.opacity >= 1;
    material.fog = preset.fog;
    // `needsUpdate` because `transparent` and `fog` are both compile-time
    // switches in three: changing either without invalidating the program
    // leaves the old shader running, so the preset would appear to do nothing
    // for exactly the two axes that are hardest to see.
    material.needsUpdate = true;
    mesh.position.y = preset.liftM;
    this.requestFrame();
  }

  /**
   * Chooses how the ground is coloured (§2, DEC-R6-5/R6-16).
   *
   * THREE APPEARANCES ON TWO MATERIALS, which is worth stating because the
   * asymmetry looks like an oversight and is not. `plain` and `slope` are the
   * SAME lit material with a uniform flipped — so switching between them costs
   * no shader recompile — while `ramp` is a genuinely different material,
   * unlit, because the hypsometric colour must not be modulated by lighting.
   */
  setGroundAppearance(appearance: GroundAppearance): void {
    if (appearance === this.groundAppearance) return;
    this.groundAppearance = appearance;
    this.groundDebug = appearance === "ramp";
    if (this.groundDebug) this.applyGroundRamp();
    this.groundUniforms.uSlope.value = appearance === "slope" ? 1 : 0;
    this.ground.material = this.groundDebug
      ? this.groundRampMaterial
      : this.groundMaterial;
    // On demand rendering: without this the swap is invisible until the camera
    // moves, which is finding R2-3 in a new place.
    this.requestFrame();
  }

  /**
   * Writes a `color` attribute over the ground plane, from the terrain field.
   *
   * The mechanics — where the heights come from, and why the attribute is
   * written into rather than replaced — are in the body, next to the code they
   * describe. This header said the heights were read back out of the POSITION
   * buffer until W10 corrected the body three lines below it and left the header
   * alone; a summary that contradicts its own function is worse than no summary.
   */
  private applyGroundRamp(): void {
    // SAMPLED FROM THE FIELD, not read back out of the position buffer. The
    // buffer only carries heights in CPU mode — in GPU mode it is deliberately
    // flat — so reading it there would colour the whole plane at the ramp's floor
    // and make the diagnostic silently useless in exactly one of the two modes.
    const flat = this.flatGround;
    const field = this.terrain;
    const positions = this.ground.geometry.getAttribute("position")
      .array as Float32Array;
    const heights = new Float32Array(positions.length / 3);
    for (let i = 0; i < heights.length; i += 1) {
      const source = flat ?? positions;
      // GRID-LOCAL VERTEX PLUS THE PLANE'S CENTRE — the same conversion
      // `setTerrain` makes, and for the same reason: these coordinates are the
      // plane's own, and `heightAt` speaks the scene's frame.
      heights[i] =
        field === undefined
          ? 0
          : field.heightAt({
              x: (source[i * 3] ?? 0) + field.centreEnu.x,
              y: (source[i * 3 + 1] ?? 0) + field.centreEnu.y,
            });
    }
    // WRITTEN INTO THE EXISTING ATTRIBUTE, NOT REPLACED WITH A NEW ONE. three
    // keys its `WebGLBuffer`s off the attribute OBJECT, and only deletes the
    // buffers of the attributes a geometry still holds when it is disposed — so
    // every replaced attribute leaks its buffer until the context goes away.
    // This runs on every terrain load, and since W6 the ramp is the DEFAULT, so
    // that would be ~1.9 MB of VRAM abandoned per position change (160 801
    // vertices x 3 floats) for every user rather than only for someone who had
    // opted into a diagnostic.
    const colours = heightRampColours(heights);
    const existing = this.ground.geometry.getAttribute("color");
    if (
      existing instanceof THREE.BufferAttribute &&
      existing.array.length === colours.length
    ) {
      (existing.array as Float32Array).set(colours);
      existing.needsUpdate = true;
    } else {
      this.ground.geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(colours, 3),
      );
    }
  }

  /**
   * The cell under a pointer event, or `undefined`.
   *
   * Only the grid is raycast — not the buildings — because a building is not a
   * selectable thing in this app and hitting one should not silently select the
   * cell behind it.
   */
  private pick(event: PointerEvent): Pick | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    // THE RAYCAST SET IS THE INVARIANT. Buildings, trees, plates and the ground
    // are absent from it by construction, so no amount of later logic can make
    // them selectable — which is a stronger guarantee than filtering hits after
    // the fact, and it is also much cheaper than raycasting the whole city.
    //
    // REGION SLABS JOINED IT IN ROUND 8 (DEC-R7b-3a), and they are the first
    // member that is not a fine-grained claim. That matters for precedence, not
    // for membership: a slab covers every cell inside it, so a click that hits
    // both must resolve to the cell — see `resolvePick`.
    const targets: THREE.Object3D[] = [];
    if (this.cellMesh !== undefined) targets.push(this.cellMesh);
    for (const child of this.group.children) {
      // `poiInstances` since W7: the markers share one `InstancedMesh`, so the
      // raycast set gains one object rather than one per marker — which is also
      // why picking got cheaper rather than more expensive.
      if (child.userData["poiInstances"] !== undefined) targets.push(child);
      if (child.userData["regionId"] !== undefined) targets.push(child);
      // BUILDINGS JOINED IN STAGE 4, AS BLOCKERS (DEC-R11-17). They are still
      // not selectable — `resolvePick` stops at the first one and never returns
      // it — but they must be RAYCAST, because the whole point is that a click
      // on a facade does not fall through to the ground behind it. Barriers
      // extrude with them (DEC-R11-11), so a wall blocks the click for the same
      // reason it blocks the agent.
      //
      // The cost is real and stated: this is the largest geometry in the scene
      // and it is now in the picking set. It is bounded by W20's chunking —
      // three tests bounding boxes before triangles, so most chunks are rejected
      // on one box test.
      if (child.userData["solid"] === true) targets.push(child);
    }
    // THE GROUND, AND THE REASON THE INVARIANT ABOVE HAD TO CHANGE. Ordering an
    // agent needs a destination, and until stage 4 a click on open ground
    // resolved to nothing at all: the affordance grid is off by default, so on
    // the demo's own default view there was nothing in this list to hit.
    //
    // ONLY WHILE IT IS DRAWN **AND ONLY WHILE IT IS THE PLANE ON SCREEN**, and
    // both halves are load-bearing rather than tidy.
    //
    // `visible` because three's raycaster does NOT skip invisible objects —
    // `intersectObject` tests layers and nothing else — so without it the
    // "none" mode would send the agent to a surface the user cannot see.
    //
    // `groundIsOrderable` because only the CPU path displaces the POSITION
    // BUFFER, which is the only geometry the raycaster reads. `setTerrain`
    // skips that displacement under `gpu` (the W23 A/B measures the two paths
    // against each other), so the ray would meet a FLAT plane while the user
    // looks at a shader-displaced one — and since `main.ts` names a lat/lng
    // from the hit's `x` and `z`, the error is HORIZONTAL: roughly
    // `relief / tan(elevation)` for an oblique click. Raised in review on #274.
    //
    // Together they are also what keeps region slabs selectable in 3D at all:
    // the ground outranks a region (DEC-R11-21), so a plane that was always in
    // this list would make that branch unreachable.
    if (this.ground.visible && groundIsOrderable(this.displacement)) {
      targets.push(this.ground);
    }
    if (targets.length === 0) return undefined;
    // Reduced to what the decision reads. `Intersection` nests `userData` under
    // `object`, and `pick.ts` must be constructible in a test without a renderer,
    // so the flattening happens at this boundary rather than in the pure module.
    return resolvePick(
      this.raycaster.intersectObjects(targets, false).map((hit) => ({
        distance: hit.distance,
        faceIndex: hit.faceIndex,
        instanceId: hit.instanceId,
        // WHERE the ray met the object, flattened like the rest. Only the ground
        // reads it, and `three`'s `point` is already in world space — which for
        // this scene is the ENU-derived frame every other coordinate uses.
        point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        userData: hit.object.userData,
      })),
      this.cellForTriangle,
    );
  }

  /**
   * Draws the affordance grid, replacing any previous one.
   *
   * Kept out of `this.group` (and therefore out of `clear()`) so rebuilding the
   * buildings does not silently drop the grid, and vice versa — they arrive from
   * different parts of the same snapshot and neither should depend on the
   * other's timing.
   */
  /**
   * Draws the outlines of features excluded as below-surface, at their depth.
   *
   * WHY THE 3D VIEW AND NOT ONLY THE MAP. This answers what SHAPE the excluded
   * thing was — a silo or a building dropped wrongly reads as a hole in the
   * skyline, which no 2D outline conveys. The map answers WHERE it is. Neither
   * answers the other's question.
   *
   * DRAWN BELOW THE GROUND, at a fixed depth rather than at the feature's real
   * one, because OSM carries no reliable depth for these: `layer=-1` is an
   * ordering, not a distance. A fixed offset is an honest "this is underneath"
   * rather than a fabricated elevation.
   *
   * Kept out of `this.group` for the same reason the cell grid is: it arrives
   * from a different part of the snapshot and rebuilding the buildings must not
   * silently drop it.
   */
  /**
   * Removes and frees the underground lines, if any are up.
   *
   * SHARED BY THREE CALLERS, and that is the point. `renderUnderground` needs
   * it to replace the previous draw, `clearScene` needs it because underground
   * features describe a specific scored working set and outliving that set
   * makes the scene assert a state nothing produced, and `dispose` needs it
   * because these live outside `this.group` and so escape the group teardown.
   * Three copies of the same four lines is how one of them ends up missing —
   * which is exactly what review found here.
   */
  private clearUnderground(): void {
    if (this.undergroundLines === undefined) return;
    this.scene.remove(this.undergroundLines);
    this.undergroundLines.geometry.dispose();
    this.undergroundLines.material.dispose();
    this.undergroundLines = undefined;
  }

  renderUnderground(outlines: readonly Float32Array[]): void {
    this.clearUnderground();
    // BUILT IN `underground-lines.ts`, not here. This view needs a WebGL
    // context to construct, so anything assembled inside it can only be checked
    // by an e2e — and an e2e can see that lines appeared without being able to
    // say whether they are transparent, at the right depth, or whether a node
    // became a tick rather than nothing at all. Each of those has broken once.
    this.undergroundLines = buildUndergroundLines(outlines);
    if (this.undergroundLines !== undefined) {
      this.scene.add(this.undergroundLines);
    }
    this.requestFrame();
  }

  renderCells(mesh: CellMesh): void {
    if (this.cellMesh !== undefined) {
      this.content.remove(this.cellMesh);
      disposeMesh(this.cellMesh);
      this.cellMesh = undefined;
    }
    if (this.cellOutlines !== undefined) {
      this.content.remove(this.cellOutlines);
      this.cellOutlines.geometry.dispose();
      this.cellOutlines.material.dispose();
      this.cellOutlines = undefined;
    }
    // THE OUTLINE HALF (W13, DEC-R3-16). An `identity` cell says "no rule ever
    // mentioned this ground", and DEC-7 draws that as an outline in 2D because
    // the UNFILLEDNESS is the statement. A filled hexagon cannot say it, so the
    // 3D grid draws the boundary and leaves the face invisible — see
    // `cell-mesh.ts` for why the face is still there at all.
    if (mesh.linePositions.length > 0) {
      const outlineGeometry = new THREE.BufferGeometry();
      outlineGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(mesh.linePositions, 3),
      );
      outlineGeometry.setAttribute(
        "color",
        new THREE.BufferAttribute(mesh.lineColors, 3),
      );
      this.cellOutlines = new THREE.LineSegments(
        outlineGeometry,
        cellOutlineMaterial(),
      );
      this.content.add(this.cellOutlines);
    }
    this.cellForTriangle = mesh.cellForTriangle;
    if (mesh.indices.length === 0) {
      this.requestFrame();
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(mesh.positions, 3),
    );
    // FOUR components. An outline-treated cell carries alpha 0, so its face is
    // present for picking and invisible on screen (DEC-R3-21).
    geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 4));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    this.cellMesh = new THREE.Mesh(
      geometry,
      // The look, and every decision behind it, lives in `cell-materials.ts`.
      // It moved there so a test can reach it without a `WebGLRenderer` — AR's
      // "the content is still visible without an environment map" guard could
      // not see the grid at all while this was inline (r508 review).
      cellFaceMaterial(this.cellLook),
    );
    // THE LIFT (§3). Applied to the mesh rather than baked into the vertices,
    // so cycling it costs a transform instead of a worker republish.
    this.cellMesh.position.y = this.cellLook.liftM;
    // THE OTHER HALF OF THE TRANSPARENT ORDER (DEC-R7b-7). The region slab takes
    // `RENDER_ORDER.areas`; without this the grid keeps three's default 0, which
    // is LOWER — so the coarse slab drew over the fine grid, the exact inversion
    // `layer-order.ts` documents itself as preventing. Pinning one end of a
    // two-ended invariant leaves it stated rather than enforced.
    this.cellMesh.renderOrder = RENDER_ORDER.cells;
    // How `resolvePick` recognises the grid. A flag rather than an identity
    // comparison, so the decision stays a pure function of the hits and can be
    // tested without a renderer.
    this.cellMesh.userData["cellGrid"] = true;
    this.content.add(this.cellMesh);
    this.requestFrame();
  }

  /**
   * Points the sun from the camera's current azimuth (W12).
   *
   * Called from the controls' `change` handler rather than from a loop: the sun
   * only has to move when the camera does, and that is exactly when a frame is
   * already being scheduled. DEC-R3-9's on-demand renderer is untouched.
   *
   * The distance is arbitrary — a `DirectionalLight` has no falloff and only its
   * direction matters — but it must be large enough to sit outside the scene if
   * a shadow camera is ever added.
   */
  /**
   * Moves the sun to a time of day in `0..1` (§1, DEC-R6-3).
   *
   * THE COST LIVES HERE, DELIBERATELY. Each call regenerates the PMREM
   * environment map, which is a render pass. That is affordable precisely
   * because this is a deliberate user action rather than something a drag
   * triggers — see `aimSun` and `sun-position.ts`.
   *
   * Out-of-range values are handled by `sunAt`, which clamps rather than
   * extrapolating: a sun below the horizon puts the scattering shader outside
   * its defined range, where its output is undefined rather than merely dark.
   */
  setTimeOfDay(timeOfDay: number): void {
    this.timeOfDay = timeOfDay;
    this.aimSun();
    // On-demand rendering: without this the new sun is invisible until the
    // camera moves, which is finding R2-3 in a new place.
    this.requestFrame();
  }

  /** Where the sun currently is, in `0..1`. */
  timeOfDayValue(): number {
    return this.timeOfDay;
  }

  private aimSun(): void {
    // ONE VECTOR, TWO CONSUMERS, and it now comes back from the rig rather than
    // being derived twice: `setSun` points the sky shader and returns the same
    // unit direction the light is placed along. Two independently-derived sun
    // positions would be visible as a sun in the sky that disagrees with where
    // the highlights fall.
    //
    // THIS NO LONGER READS THE CAMERA. It used to derive the sun's azimuth from
    // the camera's, at a fixed 45° offset, so the reflective ground's facet
    // highlight was visible from every orbit rather than only the band a fixed
    // sun happened to light (DEC-R4-6). The sun is physical since DEC-R6-3 —
    // a sun that follows the camera spins the whole scattering sky as you pan —
    // so the only input is the time of day, and the helper that measured the
    // camera's azimuth was deleted once nothing had read it for two rounds.
    // That is also what makes the PMREM regeneration inside `setSun`
    // affordable — it runs when the user changes the time, not on every drag.
    const direction = this.skyRig.setSun(sunAt(this.timeOfDay));
    const distance = 1000;
    this.sun.position.set(
      direction.x * distance,
      direction.y * distance,
      direction.z * distance,
    );
    // THE TARGET STAYS AT THE ORIGIN, AND ONLY THE DIRECTION MATTERS.
    //
    // The old comment here said the origin "is always where the user is",
    // which stopped being true when the scene gained a fixed anchor
    // (`scene-anchor.ts`). The CODE is still right and the comment was the
    // defect: three derives a directional light's direction as
    // `position - target`, and there is no shadow map anywhere in this view, so
    // nothing depends on where the pair sits — only on the vector between them.
    //
    // Which is why the obvious "fix" is wrong: moving the target to a user
    // 2 km out, with `position` still at `direction * 1000`, would swing the
    // light by tens of degrees and change the whole scene's lighting for no
    // reason. If this ever gains shadows, position and target must move
    // TOGETHER so the direction is preserved.
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * Schedules exactly one frame, coalescing repeats.
   *
   * WHY NOT A PERMANENT rAF LOOP. That was the first attempt, and it was
   * measured: an always-running loop over a static city scene made the e2e
   * suite ~6× slower (21 s → 2.2 m) and pushed one test into a timeout, because
   * the loop competes for the same CPU as everything else in a headless
   * browser. On a phone it is worse than slow — it is a scene that never stops
   * drawing, burning battery to repaint an identical picture.
   *
   * The scene is static except while the user is moving the camera, so frames
   * are scheduled on demand. This still works with damping, which is the part
   * that looks like it should need a loop: `controls.update()` emits another
   * `change` while the camera is still easing, which schedules the next frame,
   * so the sequence sustains itself until the motion settles and then stops.
   *
   * The handle is HELD so `dispose()` can cancel it. An orphaned frame callback
   * touching a disposed WebGL context is a crash, not a leak — the same reason
   * the resize listener is held rather than passed inline.
   */
  /**
   * Stop drawing and hide the canvas, keeping everything else alive (M5).
   *
   * **HIDDEN BUT RESIDENT — the decision §3 records, not one this makes.** The
   * GL context, the compiled programs, the uploaded geometry and every setting
   * survive; only the loop and the visibility stop. Two live GL contexts on the
   * phone is the accepted cost, and what buys it is an instant return to the
   * map without rebuilding a 2.8 km mesh.
   *
   * **A PENDING FRAME IS CANCELLED, not merely un-scheduled.** `requestFrame`
   * coalesces, so one callback can already be in flight when AR starts — and it
   * would render the desktop scene once, on the frame after the session began,
   * for nothing.
   *
   * Idempotent. Safe to call when no session ever started.
   */
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    // `visibility`, NOT `display`. A `display: none` canvas has a zero-sized
    // box, and the `ResizeObserver` above would fire with 0×0 and resize the
    // drawing buffer to nothing — so returning from AR would find a renderer
    // sized for an element that had no size, which is a blank pane until
    // something else happens to resize it.
    this.container.style.visibility = "hidden";
  }

  /**
   * Draw and show again. Idempotent, and safe without a prior `suspend()`.
   *
   * Schedules a frame explicitly: the scene is static and frames are on demand,
   * so nothing else would repaint it and the pane would stay as it was when the
   * session started — which, having been hidden, means blank.
   */
  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.container.style.visibility = "";
    this.requestFrame();
  }

  private requestFrame(): void {
    // THE GUARD THAT MAKES `suspend` MEAN ANYTHING. Every one of the dozen
    // `requestFrame()` call sites in this file is a path a suspended view can
    // still be driven down — a terrain load landing, a snapshot publishing, a
    // resize — so refusing here is the only place that covers them all.
    if (this.suspended) return;
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.controls.update();
      // BEFORE THE RENDER, so this frame shows where the agent now is rather
      // than where it was one frame ago.
      const walking = this.advanceWalk();
      this.renderer.render(this.scene, this.camera);
      // THE ONE OBSERVABLE BEHIND "THE SCENE GOES QUIET" (stage 4, DEC-R11-15).
      // The regression this stage carries is a reintroduced permanent render
      // loop — measured at ~6x slower e2e with one test into a timeout — and
      // "quiet" had no machine-readable definition before this: a screenshot
      // comparison also passes for a scene that stopped drawing, and a sleep
      // asserts nothing at all.
      //
      // A MONOTONIC COUNTER ON THE CONTAINER, which is the same `#scene`
      // element `publishFrameState` writes `data-frame-origin` and
      // `data-ground-centre` onto, and for the same stated reason: an attribute
      // cannot be read before it is written by mistake. A test polls it, sees it
      // rise while the agent walks, and — the assertion that matters — sees it
      // STOP rising once the agent arrives.
      //
      // Written here rather than in `main.ts` because this is where frames
      // actually happen; a counter published from anywhere else would be
      // counting something adjacent to rendering rather than rendering.
      this.frames += 1;
      this.container.dataset["frames"] = String(this.frames);
      // Captured immediately after the render: three resets these counters at
      // the START of each render, so any later read would describe a frame that
      // has not happened yet.
      this.lastDrawCost = {
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      };
      // DRIVEN FROM THE ON-DEMAND FRAME, and that is the accepted trade
      // (DEC-R3-9). This view deliberately has no permanent rAF loop — one was
      // measured to make the e2e suite ~6x slower and would burn a phone's
      // battery repainting a static city — so FPS and frame-ms read only while
      // the camera is moving, which is exactly when the CPU and GPU ground paths
      // differ. The MB panel is meaningful throughout.
      this.perfStats?.update();
      // THE ONLY THING IN THIS VIEW THAT SCHEDULES A FRAME FROM WITHIN A FRAME,
      // and it stops on its own: `advanceWalk` returns false the moment the
      // agent arrives. That is the whole of DEC-R11-15's accepted risk — a loop
      // that did not stop is the measured ~6x e2e slowdown — and the e2e's
      // second half asserts the stopping rather than the moving.
      if (walking) this.requestFrame();
    });
  }

  /**
   * Matches the renderer and camera to the container, and REPAINTS.
   *
   * The repaint is not optional and is the whole of finding R2-3. `setSize`
   * reallocates the drawing buffer, which clears it — so on a view that renders
   * on demand (see `requestFrame`) a resize leaves the pane **blank** until
   * something else happens to schedule a frame. The next thing that does is the
   * user dragging the camera, which is exactly how the bug was reported: the
   * picture comes back the moment you touch it.
   *
   * `requestFrame` coalesces, so the sheet-drag path calling this many times per
   * second still costs one frame per animation frame rather than one per event.
   */
  resize(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.requestFrame();
  }

  /**
   * Draws a mesh the WORKER built.
   *
   * WHAT MOVED AND WHY. This method used to take the merged features and call
   * `buildBuildings`/`buildTrees` itself. Both now run in the worker, because the
   * features are ~21 MB and must not cross the boundary to be turned into
   * geometry that crosses back — the package's mesh output is `Float32Array`
   * precisely so the BUFFERS can transfer instead (`mesh/extrude.ts` says so).
   * The ENU frame anchoring and the terrain sampling moved with them.
   *
   * So this is now purely "typed arrays in, three.js objects out", which is what
   * `building-view.ts`'s header always claimed the file was for.
   */
  render(
    mesh: TransferableMesh,
    layers?: MeshLayers,
    // Omits `drawnHostLayers`, which `drawMeshLayers` derives from `layers` itself
    // rather than taking from a caller who could disagree with it.
    context?: Omit<MeshLayerContext, "drawnHostLayers">,
  ): BuildingStats {
    this.clear();
    // ONE LINE PER LAYER'S WORTH OF WORK, in `mesh-layers.ts`. This used to be a
    // pair of branches per layer — one to draw it, one ternary per counter to zero
    // its contribution when off — which reached complexity 21 with three layers and
    // had four more (W12–W15) queued behind it. The table also makes a MISSING
    // layer detectable, which the longhand form could not: see that file's header.
    const { objects, stats } = drawMeshLayers(mesh, layers, context);
    for (const object of objects) this.group.add(object);
    // RE-APPLIED AFTER EVERY REBUILD. The objects above are brand new and carry
    // the desktop material; without this a refetch mid-session would silently
    // drop the AR look at whatever moment the user walked far enough to trigger
    // one. Cheap and idempotent when no session is running.
    if (this.arShellMaterial !== undefined) {
      this.setArShellMaterial(this.arShellMaterial);
    }

    // SCHEDULED, not rendered inline. A synchronous `renderer.render()` here does
    // put pixels in the drawing buffer, but with `antialias: true` that buffer is
    // multisampled and is only RESOLVED to the canvas at composite time — which
    // happens on an animation frame. So a mid-task render is invisible to
    // `toDataURL` until something else schedules a frame, which is a real
    // constraint on how any pixel-level test must be written.
    //
    // CORRECTED ATTRIBUTION: this comment used to go on to blame that mechanism
    // for the W11 plates symptom — "a byte-identical canvas even when coloured
    // bright red and lifted 100 m above the terrain". It was not the cause. Every
    // `MeshStandardMaterial` in the scene had failed to compile (see the lighting
    // invariant in `building-view.ts.md`), so the plates were not being drawn at
    // all, on any frame, scheduled or not. The multisample-resolve point above is
    // independently true and is why the render is scheduled; it simply did not
    // explain that bug.
    //
    // `requestFrame` coalesces, so this is also cheaper than rendering per call.
    this.requestFrame();
    // Already narrowed to WHAT WAS DRAWN by the table — a status line reporting
    // 400 buildings while the buildings layer is off would be the status line
    // lying about the picture, which is the class of defect the legend and the
    // store exist to prevent.
    return stats;
  }

  /**
   * Empties the scene and repaints it, leaving the ground plane and lights.
   *
   * The 3D counterpart of `MapView.clear()`: after a failed refresh the
   * buildings on screen belong to a working set that no longer exists. Clearing
   * without repainting would leave the LAST rendered frame in the drawing
   * buffer — the view renders on demand, so nothing else would ever overwrite
   * it, and the pane would keep showing buildings that are no longer anywhere
   * in the app's state.
   */
  /** What the last frame cost, or `undefined` before the first one (W10). */
  drawCost(): DrawCost | undefined {
    return this.lastDrawCost;
  }

  clearScene(): void {
    this.clear();
    // `clear()` only walks `this.group`, and the underground lines are added
    // straight to the scene — so a failed refresh left them on screen,
    // describing a scored working set that no longer exists. Cleared HERE
    // rather than at the call site so the next direct-scene layer does not
    // have to remember to add a line to `drawScene`.
    this.clearUnderground();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Points the camera back at THE USER, by translation only (W11).
   *
   * Called when the user MOVES — a map click, the locate button or the location
   * picker. Without it the chosen place is only on screen while the camera has
   * never been panned.
   *
   * **THE TARGET USED TO BE THE ORIGIN, and that stopped being right.** The ENU
   * frame was rebuilt at the user's position on every publish, so the origin and
   * the user were the same point. `scene-anchor.ts` fixed the frame, so they
   * diverge — and recentring on the origin now drags the camera back to the
   * session start on every step, steadily further away the more the user walks.
   *
   * The position arrives in ENU FROM THE PAGE, converted there rather than
   * fetched: the user's position comes from the store and the anchor from
   * `scene-anchor.ts`'s holder, both of which `main.ts` already has, so the
   * conversion is a pure function of two local values. This was first scoped as
   * a worker round-trip and did not need to be one.
   *
   * The camera is not rotated and the viewing distance is unchanged; see
   * `recentre-camera.ts` for why that is by construction rather than by care.
   */
  recentre(userEnu: { readonly x: number; readonly y: number }): void {
    // ENU x,y becomes scene x,-z — the same axis convention every other piece
    // of scene geometry uses. `y` stays 0: the camera pivots at ground level.
    recentreOn(this.camera, this.controls, {
      x: userEnu.x,
      y: 0,
      z: -userEnu.y,
    });
    this.requestFrame();
  }

  /**
   * Draws the planned route and sends the agent along it (DEC-R11-3/R11-15).
   *
   * THE POLYLINE IS ALWAYS DRAWN, which is the decision rather than a detail:
   * seeing the route go _around_ the wall is the proof, and a line is a far
   * better test artefact than a moving marker. The walk is the demonstration on
   * top of it.
   *
   * ADDED TO `this.scene`, NOT TO `this.group`, for the same reason the
   * affordance grid is kept out of the group: `clear()` empties the group on
   * every mesh rebuild, and a
   * route dropped by an unrelated republish would look like the agent had been
   * cancelled. The scene's frame is fixed (round 5B), so a publish does not
   * invalidate these coordinates — only a re-anchor does, and that calls
   * {@link clearRoute}.
   */
  followRoute(path: readonly ScenePoint[]): void {
    this.clearRoute();
    const start = path[0];
    if (start === undefined) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(path.length * 3);
    for (let i = 0; i < path.length; i += 1) {
      const point = path[i]!;
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.routeLine = new THREE.Line(
      geometry,
      // DEPTH TEST OFF, and it is not decoration. The route is lifted one rung
      // above the affordance ladder (`ROUTE_LIFT_M`), which keeps it off the
      // ground — but a line crossing behind a building would still be occluded
      // by it, and half a route is worse than none for the one thing this stage
      // exists to show. The render order puts it last so it composites on top.
      //
      // **AND TRANSPARENT, WHICH IS WHAT MAKES `RENDER_ORDER.route` MEAN
      // ANYTHING.** `WebGLRenderer` splits its render list into opaque and
      // transparent and draws opaque FIRST; `renderOrder` only sorts WITHIN a
      // list. An opaque material with a high rung therefore ranks above the
      // translucent layers in the table and loses to them on screen — which is
      // exactly the defect review on #256 found in the underground lines, and
      // exactly what this line shipped with until review on #274. `areas`,
      // `cells` and `underground` are all transparent; without this the route
      // drew before all three and the `underground` diagnostic composited over
      // it.
      new THREE.LineBasicMaterial({
        color: ROUTE_COLOUR,
        depthTest: false,
        transparent: true,
      }),
    );
    this.routeLine.renderOrder = RENDER_ORDER.route;
    this.scene.add(this.routeLine);

    this.agent ??= this.makeAgent();
    this.scene.add(this.agent);
    const startedAt = performance.now();
    // THE FOLLOWER STARTS ON THE PATH, not wherever the agent was standing. A
    // new route always begins at the agent's own cell (`main.ts` plans from
    // `agentAt()`), so seeding it here costs nothing and guarantees the first
    // frame cannot show the body sprinting in from a stale position.
    this.walk = {
      path,
      startedAt,
      lastFrameAt: startedAt,
      follower: followerAt(path[0]!),
    };
    this.publishRoute(path);
    this.requestFrame();
  }

  /**
   * Publishes the drawn route's SHAPE onto the container, for the e2e.
   *
   * WHY AN ATTRIBUTE AND NOT A SCREENSHOT. "The route went around something"
   * needs a machine-readable definition, and a pixel comparison cannot supply
   * one — the same argument `publishFrameState` makes in `main.ts`, and this
   * follows its precedent deliberately rather than inventing a second channel.
   *
   * THE PAIR IS THE POINT: walked length AND the straight-line distance between
   * the same two endpoints. Either number alone proves nothing — "the route is
   * 180 m" is equally true of a detour and of a straight line to somewhere far
   * away. Their RATIO is what separates "went around" from "went directly", and
   * it is what lets a control click assert near-straightness without the test
   * having to know where anything is in the world.
   */
  private publishRoute(path: readonly ScenePoint[]): void {
    const first = path[0]!;
    const last = path[path.length - 1]!;
    const straight = Math.hypot(
      last.x - first.x,
      last.y - first.y,
      last.z - first.z,
    );
    this.container.dataset["route"] =
      `${path.length}:${Math.round(pathLengthM(path))}:${Math.round(straight)}`;
  }

  /**
   * Takes the route and the agent down.
   *
   * Called on a RE-ANCHOR, which is the one event that invalidates these
   * coordinates: every point is expressed in the scene's ENU frame, and a
   * teleport re-takes that frame. An ordinary publish does not — the frame has
   * been fixed since round 5B — so the route survives a walk across the map.
   */
  clearRoute(): void {
    this.removeRoute();
    this.requestFrame();
  }

  /**
   * The teardown without the repaint.
   *
   * SPLIT OUT FOR `dispose()`, which cancels the pending frame FIRST and must
   * not have one scheduled behind its back — an orphaned rAF callback touching a
   * disposed GL context is a crash, not a leak, which is exactly why the handle
   * is held in the first place.
   */
  private removeRoute(): void {
    // The walk goes first, so nothing can advance an agent that is being
    // removed. Ending it here is also what lets the render loop go quiet.
    this.walk = undefined;
    if (this.routeLine !== undefined) {
      this.scene.remove(this.routeLine);
      this.routeLine.geometry.dispose();
      this.routeLine.material.dispose();
      this.routeLine = undefined;
    }
    if (this.agent !== undefined) {
      // REMOVED BUT NOT DISPOSED. The agent's geometry and material are built
      // once and reused for every route; freeing them here would make the second
      // route draw nothing at all, which three does not report as an error.
      this.scene.remove(this.agent);
    }
    delete this.container.dataset["route"];
    delete this.container.dataset["agent"];
  }

  /**
   * Where the agent is standing, in scene coordinates, or `undefined`.
   *
   * **THE NEXT ORDER PLANS FROM HERE, NOT FROM THE USER** (raised in review on
   * #274). `main.ts` read the user's position for both, so a second order
   * without moving planned from the user again and `followRoute` snapped the
   * cone back to the start before it began walking — the agent visibly
   * teleported. One agent means the USER's position is only the agent's until
   * the agent has been somewhere.
   *
   * `undefined` until the first route, and again after `clearRoute()` — which a
   * re-anchor triggers, and after a teleport these coordinates would mean a
   * different place anyway.
   */
  agentAt(): ScenePoint | undefined {
    if (this.agent === undefined || this.agent.parent === null)
      return undefined;
    const { x, y, z } = this.agent.position;
    // The cone's ORIGIN is its centre, so its stored `y` sits half a height
    // above the route it walks. Undone here so a caller gets the point on the
    // path rather than the middle of the marker.
    return { x, y: y - AGENT_HEIGHT_M / 2, z };
  }

  /** Where the camera is aimed, and from how far away. */
  /**
   * The camera's height above the scene origin, metres.
   *
   * **Read, not derived.** `cameraView().distanceM` plus the scene's nominal
   * 29° tilt would give an estimate, but `MapControls` lets the user orbit, so
   * that tilt is a starting value rather than an invariant — and the AR entry
   * descent starts from this number, so an estimate would put the session at a
   * height the user was never actually at.
   */
  cameraHeightM(): number {
    return this.camera.position.y;
  }

  cameraView(): CameraView {
    const { target } = this.controls;
    return {
      target: { x: target.x, y: target.y, z: target.z },
      distanceM: this.camera.position.distanceTo(target),
    };
  }

  /**
   * Aims the camera at `target` from `distanceM`, keeping its direction
   * (DEC-R13-7, the read side).
   *
   * TRANSLATION THEN DOLLY, in that order and both relative — the same
   * discipline `recentreOn` exists to enforce. Recomputing the camera from a
   * distance and two angles would put the target in the right place and quietly
   * re-derive the ORIENTATION, which is precisely the pose data DEC-R13-7 chose
   * not to store: a restored link should look at the right place from the
   * default angle, not from a guessed one.
   */
  lookAtFrom(target: ScenePoint, distanceM: number): void {
    recentreOn(this.camera, this.controls, target);
    const away = this.camera.position.clone().sub(this.controls.target);
    const current = away.length();
    // A degenerate offset has no direction to scale; leaving the camera where
    // the recentre put it is better than dividing by zero into `NaN`.
    if (current > 1e-6 && distanceM > 0) {
      away.multiplyScalar(distanceM / current);
      this.camera.position.copy(this.controls.target).add(away);
      this.controls.update();
    }
    this.requestFrame();
  }

  /** The agent's marker: one cone, built once and reused across routes. */
  private makeAgent(): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    return new THREE.Mesh(
      new THREE.ConeGeometry(AGENT_RADIUS_M, AGENT_HEIGHT_M, 10),
      new THREE.MeshStandardMaterial({
        color: ROUTE_COLOUR,
        emissive: ROUTE_COLOUR,
        // Self-lit enough to stay readable against a shadowed facade or a dark
        // sun angle. The agent is the thing the user is watching; losing it to
        // the time of day would read as it having stopped.
        emissiveIntensity: 0.6,
        roughness: 0.4,
        metalness: 0,
      }),
    );
  }

  /**
   * Moves the agent for this frame, and says whether it is still going.
   *
   * **THE RETURN VALUE IS THE FRAME-SCHEDULING CONTRACT** (DEC-R11-15). This
   * view has no permanent rAF loop — one was measured making the e2e suite ~6x
   * slower and pushing a test into a timeout — so the walk drives frames only
   * while it is moving, and `false` here is what lets the scene go quiet again.
   */
  private advanceWalk(): boolean {
    const walk = this.walk;
    if (walk === undefined) return false;
    const now = performance.now();
    const walkedM = ((now - walk.startedAt) / 1000) * AGENT_SPEED_MPS;
    const at = pointAlong(walk.path, walkedM);
    if (at === undefined) {
      this.walk = undefined;
      return false;
    }

    // THE TARGET IS STILL THE EXACT PATH (DEC-R13-3). What changed in round 13
    // is that the agent no longer IS the target: it accelerates towards it, so
    // the staircase the planner produced stays visible in the drawn line and
    // out of the motion. `agent-follower.ts` holds the physics and the property
    // that keeps the smoothed curve inside the corridor the planner cleared.
    walk.follower = stepFollower(
      walk.follower,
      at.point,
      (now - walk.lastFrameAt) / 1000,
    );
    walk.lastFrameAt = now;
    const shown = walk.follower.position;

    // The path sits ON the ground; the cone's origin is its centre, so half its
    // height puts its tip up and its base on the route rather than sunk in it.
    this.agent?.position.set(shown.x, shown.y + AGENT_HEIGHT_M / 2, shown.z);
    // Published for the e2e, in the family `data-frame-origin` started: without
    // it, "the agent did not teleport back to the start on a second order" has
    // no machine-readable definition. Whole metres — the assertion is about
    // tens of metres of jump, and full precision would churn the attribute on
    // every frame of the walk.
    this.container.dataset["agent"] =
      `${Math.round(shown.x)},${Math.round(shown.z)}`;
    if (!at.done) return true;
    // ARRIVAL IS BOTH HALVES NOW, and that is not a detail. The path is
    // consumed a good two metres before the BODY gets there — that gap is the
    // smoothing — so stopping on `at.done` alone would freeze the agent short
    // of its destination and leave the drawn line ending somewhere it never
    // reached. Keeping the frames coming until it settles is also what keeps
    // DEC-R11-15's contract honest: `false` here still means "nothing is
    // moving", which is the only thing that lets the scene go quiet.
    if (!followerSettled(walk.follower, at.point)) return true;
    this.walk = undefined;
    return false;
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      // ASSERTED, not inferred. `instanceof THREE.Mesh` narrows to
      // `Mesh<any, any, any>` because three's generic parameters default to
      // `any`, so `.geometry` and `.material` both arrive untyped and every
      // dispose call below them is unchecked. Naming the real shape once here
      // is the smallest place to put the assertion — everything this view
      // adds to `this.group` is built in `meshFor` or the tree loop, and both
      // use exactly this pairing.
      if (!(child instanceof THREE.Mesh)) continue;
      // BORROWED, not owned. The POI pins share one geometry and one material
      // across every marker and across every render — that is the point of the
      // package emitting placements rather than geometry. Disposing them here
      // would destroy them on the first refresh, and every later frame would draw
      // nothing at all: three.js does not throw for a disposed geometry, the
      // counters would keep reporting the markers, and the layer would simply stop
      // appearing. Exactly the silent-absence shape as the shader outage.
      if (child.userData["sharedResources"] === true) continue;
      const mesh = child as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >;
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const one of material) one.dispose();
      } else {
        material.dispose();
      }
    }
  }

  /**
   * Hand the map-derived content to another scene graph, or take it back.
   *
   * **The AR entry and exit point.** AR mode calls this with the framework's
   * scene root and `"gps-world-nue"`; leaving AR calls it with
   * {@link localRoot} and `"demo-scene"`.
   *
   * **THE FRAME ARGUMENT IS NOT OPTIONAL IN PRACTICE, and an earlier version of
   * this docstring said the coordinates were "already in the right space".**
   * They are not: the demo's scene is X=East, Y=Up, Z=−North; the GPS-world
   * frame is NUE. Attaching without the conversion renders the city 90° off.
   * `scene-content.ts` owns the mapping and pins it.
   *
   * REPARENTING, NOT REBUILDING. The subtree moves whole and keeps its
   * children, so returning costs nothing — which is what makes the M5 decision
   * (hide the desktop renderer rather than dispose it) cheap to honour.
   *
   * **What does NOT move:** the lights, the ground plane, the sun rig and the
   * NPC. See `scene-content.ts` for why each stays.
   */
  /**
   * Swap the building meshes to an AR shell material, or restore the desktop one.
   *
   * **HELD ON THE VIEW, NOT APPLIED ONCE.** A refresh while AR is running
   * rebuilds every layer object from the worker payload, and a rebuilt mesh
   * arrives with the desktop material — so a one-shot swap would silently revert
   * the moment the user walked far enough to trigger a refetch. `render` re-applies
   * from this field for exactly that reason.
   *
   * **THE BUILDING MESHES ARE IDENTIFIED BY THEIR GEOMETRY**, not by a marker:
   * `aHeight01` is attached only to the buildings layer (owner decision — ground
   * layers stay solid), so its presence *is* the membership test and there is no
   * second thing to keep in sync.
   *
   * @param material the shell material, or `undefined` to restore.
   */
  setArShellMaterial(material: THREE.Material | undefined): void {
    this.arShellMaterial = material;
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // NARROWED EXPLICITLY: `THREE.Mesh`'s default generics leave `geometry`
      // as `any`, which this package's lint bans — and an unchecked `any` here
      // would silently accept a mesh with no geometry at all.
      const geometry = object.geometry as THREE.BufferGeometry;
      if (geometry.getAttribute("aHeight01") === undefined) return;
      const original = object.userData["desktopMaterial"] as
        | THREE.Material
        | undefined;
      if (material === undefined) {
        // RESTORE ONLY IF WE SWAPPED IT. A mesh built after the swap already
        // carries the desktop material, and overwriting it with `undefined`
        // would leave a mesh with no material at all.
        if (original !== undefined) {
          object.material = original;
          delete object.userData["desktopMaterial"];
        }
        return;
      }
      // The FIRST swap is the one that records the original; a second swap must
      // not record the shell material as the thing to restore.
      object.userData["desktopMaterial"] ??= object.material;
      object.material = material;
    });
    this.requestFrame();
  }

  attachContentTo(
    root: THREE.Object3D,
    frame: ContentFrame,
    /**
     * Where this content's ENU origin sits in the target frame, in metres.
     *
     * Required in practice for AR: the city is authored about the demo's scene
     * anchor and the GPS-world frame is about the framework's `zero`. See
     * `scene-content.ts`.
     */
    originOffset?: {
      readonly north: number;
      readonly up: number;
      readonly east: number;
    },
  ): void {
    this.content.attachTo(root, frame, originOffset);
  }

  /**
   * This view's own scene, so a caller that took the content can give it back.
   *
   * Exposed rather than remembered by the caller: the parent to restore is a
   * property of this view, and a caller holding its own copy is a caller that
   * can restore the wrong one.
   */
  get localRoot(): THREE.Object3D {
    return this.scene;
  }

  dispose(): void {
    // Cancelled FIRST: a frame already queued would otherwise fire against a
    // disposed context, which crashes rather than leaks.
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.container.removeEventListener("pointerdown", this.onPointerStart);
    this.container.removeEventListener("pointerup", this.onPointerDown);
    this.controls.dispose();
    this.containerResize.disconnect();
    // DETACH BEFORE FREEING, and this only matters once AR has reparented the
    // content: the framework's scene root outlives this view, so disposing
    // without detaching leaves a subtree of freed geometry attached to a live
    // scene. three.js does not report drawing a disposed geometry — the
    // symptom is silent absence. On desktop this is a no-op in effect, because
    // the root dies with `this.scene`.
    this.content.detach();
    this.clear();
    // `clear()` only walks `this.group`. The ground sits on the scene and the
    // affordance grid on `this.content`, both OUTSIDE the group — so that
    // rebuilding the buildings cannot drop them — which also means nothing frees
    // their GPU buffers. Missing these leaks a geometry and a material per
    // disposed view, and the whole point of holding the resize listener and the
    // rAF handle is that this method actually cleans up.
    // BOTH GROUND MATERIALS BY NAME, not whichever one is currently assigned
    // (raised in review on #233). `disposeMesh` frees `mesh.material`, and the
    // height ramp SWAPS that field — so with the ramp active it disposed the ramp
    // material twice and never freed the standard one. Naming both is the only
    // form that does not depend on which mode the view happened to be in.
    this.ground.geometry.dispose();
    this.groundMaterial.dispose();
    // The sky owns a PMREM render target as well as its own geometry and
    // material, and it is now BOTH `scene.background` and `scene.environment` —
    // so leaving it behind keeps the whole scene reachable AND abandons GPU
    // memory. `SkyRig.dispose()` clears both fields as well as freeing, because
    // a disposed texture left assigned is a use-after-free three does not
    // report: it silently stops drawing the materials that sample it.
    this.skyRig.dispose();
    this.perfStats?.dispose();
    this.perfStats = undefined;
    this.groundRampMaterial.dispose();
    this.heightTexture?.dispose();
    this.clearUnderground();
    // The route and the agent live on the SCENE, like the grid and the ground,
    // so `clear()` never sees them and nothing else would free their buffers.
    // `clearRoute` removes the agent without disposing it — it is reused across
    // routes — so the disposal has to happen here, once, at the end of the
    // view's life.
    this.removeRoute();
    if (this.agent !== undefined) disposeMesh(this.agent);
    this.agent = undefined;
    if (this.cellMesh !== undefined) disposeMesh(this.cellMesh);
    this.cellMesh = undefined;
    if (this.cellOutlines !== undefined) {
      this.cellOutlines.geometry.dispose();
      this.cellOutlines.material.dispose();
    }
    this.cellOutlines = undefined;
    this.renderer.dispose();
  }
}

/** Frees a mesh GPU-side. Materials may be an array; three does not do this. */
function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const one of material) one.dispose();
  } else {
    material.dispose();
  }
}

/**
 * Injects GPU height displacement into a ground material (W23).
 *
 * WHY `onBeforeCompile` RATHER THAN A `ShaderMaterial`. The ground is lit by the
 * scene's own lights and DEC-R2-1's look depends on `MeshStandardMaterial`'s PBR
 * response; reimplementing that in a raw shader would be a second source of truth
 * for how the ground looks. Patching the stock shader keeps every lighting change
 * automatic.
 *
 * WHY A UNIFORM RATHER THAN TWO MATERIALS. `uDisplace` flips between the paths
 * with no recompile, and the same injection serves the height-ramp material — so
 * the ramp stays legible in GPU mode instead of being a CPU-only view.
 *
 * THE PLANE'S LOCAL AXES ARE NOT THE WORLD'S. The geometry is built flat in its
 * own XY and rotated -90 degrees about X, so local `z` becomes world `y` (height)
 * and local `y` becomes world `-z` (north). Displacement therefore goes into
 * `transformed.z`, and the object-space normal of a surface `z = h(x, y)` is
 * `(-dh/dx, -dh/dy, 1)`.
 *
 * ON NORMALS AND `flatShading`. The ground material sets `flatShading: true`, and
 * three.js then derives the fragment normal from screen-space derivatives of the
 * displaced view position — so facets are shaded correctly even without the code
 * below. The vertex normal is computed anyway, because it makes this path correct
 * if `flatShading` is ever turned off, and because shipping displacement with
 * knowingly wrong normals is what `geo-three` does: its shader rewrites
 * `gl_Position` only, so its terrain is lit as if flat.
 */
function installGroundDisplacement(
  material: THREE.Material,
  uniforms: Record<string, { value: unknown }>,
): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uHeightMap;
        uniform float uExtentM;
        uniform float uSpacingM;
        uniform float uSide;
        uniform float uDisplace;

        // Mirrors \`textureUv\` in terrain-texture.ts. Texel CENTRES: a coordinate
        // of 0 is the outer edge of the first texel, so grid index g maps to
        // (g + 0.5) / side. Half a texel out shifts the surface by half a post.
        float groundUv(float v) {
          float last = uSide - 1.0;
          float grid = clamp(((v + uExtentM) / (uExtentM * 2.0)) * last, 0.0, last);
          return (grid + 0.5) / uSide;
        }

        float groundHeight(vec2 plan) {
          if (uSide < 2.0) return 0.0;
          return texture2D(uHeightMap, vec2(groundUv(plan.x), groundUv(plan.y))).r;
        }`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        if (uDisplace > 0.5 && uSide >= 2.0) {
          // Four taps one POST apart, so the difference is over the DEM's real
          // pitch rather than an arbitrary epsilon.
          float hL = groundHeight(position.xy - vec2(uSpacingM, 0.0));
          float hR = groundHeight(position.xy + vec2(uSpacingM, 0.0));
          float hD = groundHeight(position.xy - vec2(0.0, uSpacingM));
          float hU = groundHeight(position.xy + vec2(0.0, uSpacingM));
          vec2 gradient = vec2(hR - hL, hU - hD) / (2.0 * uSpacingM);
          objectNormal = normalize(vec3(-gradient.x, -gradient.y, 1.0));
        }`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        if (uDisplace > 0.5) {
          transformed.z += groundHeight(position.xy);
        }`,
      );
  };
  // Materials are cached by program; changing the compile hook has to invalidate
  // that cache or the patch never reaches the GPU.
  material.needsUpdate = true;
}

/*
 * `installCellEmissive` — the shader patch that routes the per-vertex score
 * colour into EMISSIVE as well as diffuse — moved to `cell-materials.ts` with
 * the material it patches (r508 review). It was unreachable from a test here,
 * because the only path to it runs through `drawCells`, which needs a
 * `WebGLRenderer`.
 */
