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

import { recentreOnOrigin } from "./recentre-camera.js";
import {
  createPerfStatsOverlay,
  type PerfStatsOverlayHandle,
} from "gps-plus-slam-app-framework/visualization/perf-stats-overlay";

import type { CellMesh } from "./cell-mesh.js";
import type { GroundMode } from "./ground-mode.js";
import { TERRAIN_EXTENT_M, type Heightfield } from "./heightfield.js";
import { heightRampColours } from "./height-ramp.js";
import { drawMeshLayers } from "./mesh-layers.js";
import type { MeshLayerContext } from "./mesh-layers.js";
import type { DrawCost } from "./draw-cost.js";
import { resolvePick, type Pick } from "./pick.js";
import { SUN_ELEVATION_RAD, cameraAzimuth, sunDirection } from "./sun.js";
import { terrainTextureFrom } from "./terrain-texture.js";
import type { BuildingStats, MeshLayers } from "./mesh-layers.js";
import {
  HORIZON_RGB,
  SKY_GRADIENT_COLUMNS,
  SKY_GRADIENT_ROWS,
  skyGradientPixels,
  skyRotationForSun,
} from "./sky-gradient.js";
import type { TransferableMesh } from "./worker/protocol.js";

// Re-exported so the many call sites that import these from the view keep working.
// The table owns them because it owns what they describe: `BuildingStats` is
// exactly the union of what the rows count.
export type { BuildingStats, MeshLayers } from "./mesh-layers.js";
export type { Pick } from "./pick.js";

/**
 * Which path displaces the ground plane, or `none` to hide it (W23, W11).
 *
 * Re-exported from `ground-mode.ts`, which owns the union because it also owns
 * parsing it out of the store's plain string and deciding what a mode disables.
 * Two definitions of "the ground modes" is the shape of drift this demo keeps
 * finding.
 */
export type GroundDisplacement = GroundMode;

/**
 * Metres between terrain posts. Terrarium z13 is ~12 m per pixel at this latitude.
 *
 * Sampling finer would interpolate detail the DEM never had; sampling coarser would
 * throw away detail already fetched.
 */
export const TERRAIN_SPACING_M = 12;

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
 * Where the haze starts, metres.
 *
 * Two thirds of the way out, so the fade is gradual enough to read as distance
 * rather than as a wall — the whole reason the far plane can be lowered at all.
 */
export const FOG_NEAR_M = FAR_PLANE_M * 0.66;

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
 * At the current 2.8 km extent it does not bind, so the DEM pitch is matched
 * exactly and every quad of the ground plane carries real data.
 */
export const GROUND_SEGMENTS = Math.min(
  MAX_GROUND_SEGMENTS,
  Math.round((TERRAIN_EXTENT_M * 2) / TERRAIN_SPACING_M),
);

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
}

export class BuildingView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
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
  /** The affordance grid, kept separate so `clear()` does not drop it. */
  private cellMesh: THREE.Mesh | undefined;
  /** The outline-treated cells' boundaries (W13). Lifecycle follows the grid. */
  private cellOutlines:
    | THREE.LineSegments<THREE.BufferGeometry, THREE.Material>
    | undefined;
  /** Triangle index → cell id for the current grid. */
  private cellForTriangle: readonly string[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly onPointerDown: (event: PointerEvent) => void;
  private readonly onPointerStart: (event: PointerEvent) => void;
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.Material>;
  /** The sky gradient. BACKGROUND ONLY — never `scene.environment`, see below. */
  private readonly sky: THREE.DataTexture;
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

    // The sky is the BACKGROUND, and only the background (DEC-R2-2). It replaces
    // the near-black that the ground could not lift off.
    //
    // This comment used to say it was "both the background and the environment
    // map... one texture, two jobs", and that second job took the whole scene down
    // for ten work items — see the block at the `scene.background` assignment
    // below, and `building-view.ts.md`'s lighting invariant.
    // 256 x 64 since W14, not 1 x 64. A one-column equirectangular map has no
    // azimuth at all, so it could not hold the sun the notes asked for.
    this.sky = new THREE.DataTexture(
      skyGradientPixels({ sunElevationRad: SUN_ELEVATION_RAD }),
      SKY_GRADIENT_COLUMNS,
      SKY_GRADIENT_ROWS,
      THREE.RGBAFormat,
    );
    this.sky.mapping = THREE.EquirectangularReflectionMapping;
    this.sky.colorSpace = THREE.SRGBColorSpace;
    // `flipY` DEFAULTS TO FALSE ON `DataTexture` — unlike an image-backed texture,
    // where it is true. So row 0 of the array lands at `v = 0`, which on an
    // equirectangular map is the NADIR, and the sky comes out upside down: bright
    // overhead, dark at the horizon. Measured before fixing: 63.5 luma at the top
    // against 52.9 near the horizon, i.e. exactly reversed.
    //
    // Corrected here rather than by reversing `skyGradientPixels`, so the pure
    // function keeps the contract its tests assert ("top row first", which is the
    // intuitive reading) and the three.js-specific quirk stays in the three.js
    // file.
    this.sky.flipY = true;
    this.sky.needsUpdate = true;
    this.scene.background = this.sky;
    // NO `scene.environment`, AND THAT IS THE FIX FOR A REAL OUTAGE.
    //
    // W20 set `scene.environment = this.sky` — a raw equirect `DataTexture`.
    // three.js routes any environment map through its CubeUV path, which expects a
    // PMREM-processed texture, and with a raw one it emits integer `CUBEUV_*`
    // defines into float assignments. Every `MeshStandardMaterial` fragment shader
    // then fails to compile:
    //
    //   ERROR: 0:439: 'assign' : cannot convert from 'const int' to 'highp float'
    //
    // three.js does not throw for that. It logs to the console and simply DOES NOT
    // DRAW the material. So the buildings, the trees, the ground plane and the
    // plates all disappeared from the demo, while the status line still reported
    // "21 volumes" and the suite stayed green — every pixel assertion was satisfied
    // by the one surviving `MeshBasicMaterial`, the affordance grid.
    //
    // THE REASON PMREM WAS UNAVAILABLE HAS EXPIRED, AND SAYING SO IS THE POINT
    // OF THIS PARAGRAPH (N1, W10). It used to read: "PMREM-processing it was
    // tried and does NOT help here: the gradient is one pixel wide, which is
    // degenerate for the equirect-to-cube-UV projection." **W14 widened the sky
    // to SKY_GRADIENT_COLUMNS x SKY_GRADIENT_ROWS = 256 x 64 the same day**, so
    // it is no longer degenerate and a `PMREMGenerator` pass is available again.
    //
    // It is NOT taken, and that is a DEFERRAL rather than an impossibility
    // (DEC-R5-8): the round-5 notes ask for a better-looking ground, and the
    // answer is being searched for by prompt rather than guessed at here — see
    // `2026-08-01-1356-terrain-shader-prototype-prompt.md`. Doing the lighting
    // twice is the thing being avoided.
    //
    // IF IT IS PICKED UP, the test that must come with it is a DRAWS-ANYTHING
    // check — a difference count against a materials-off frame — not an
    // assertion that the field was set. The outage above was invisible to
    // property assertions: every pixel test in the suite stayed green while the
    // buildings, the trees, the ground and the plates were all absent.
    //
    // Removing it costs almost nothing against DEC-R2-1. That decision asked for a
    // surface reflective enough that facet edges show as the camera moves, and the
    // mechanism for that is the SPECULAR HIGHLIGHT from the directional light
    // sliding across per-facet normals — which needs low roughness, not an
    // environment map. My original note here claimed a lone directional light
    // "produces a lobe narrow enough to miss almost every facet"; that was wrong,
    // and it cost the entire scene. The hemisphere light below supplies the
    // sky-tinted fill the environment map was actually contributing.

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
        (HORIZON_RGB[0] ?? 0) / 255,
        (HORIZON_RGB[1] ?? 0) / 255,
        (HORIZON_RGB[2] ?? 0) / 255,
      ),
      FOG_NEAR_M,
      FAR_PLANE_M,
    );

    this.scene.add(this.group);
    // Ambient LOWERED from 0.55. Ambient light is flat by definition — it adds the
    // same amount to every facet regardless of its normal — so it was actively
    // washing out the only cue that distinguishes one ground facet from the next.
    // The environment map now supplies the soft fill it used to.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    // Sky above, ground below — the directional fill the environment map used to
    // contribute, from a LIGHT rather than from a texture the PBR shader has to
    // sample. Colours match the sky gradient's horizon and the ground, so the scene
    // still reads as lit by its own sky, with no shader-compilation surface at all.
    this.scene.add(new THREE.HemisphereLight(0x5c6c8c, 0x3a4356, 0.55));
    // THE SUN FOLLOWS THE CAMERA'S AZIMUTH (W12, DEC-R4-6). It was fixed at
    // (60, 120, 40), which is why the reflective ground only showed its relief
    // from some angles: a highlight appears where the half-vector between light
    // and eye aligns with a facet normal, so with a still light and a moving eye
    // the condition is met over a band of azimuths and missed everywhere else.
    //
    // NOT a headlight — see `sun.ts` for why that would make it worse, and for
    // the property test that keeps it from drifting into one.
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
      new THREE.MeshStandardMaterial({
        color: 0x3a4356,
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
    this.scene.add(this.ground);

    // FAR PLANE 2400 m — 4000, then 1200, now 2400. See `FAR_PLANE_M` for why
    // each move was right at the time; the short version is that W20's chunking
    // changed what distance COSTS, so the 1200 was priced against a trade that no
    // longer exists. The ceiling is now the terrain extent rather than a guess.
    //
    // 55° FOV is unchanged and is a different knob: the round-5 note said "field
    // of view" and then corrected itself to the far plane, which was the right
    // correction.
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, FAR_PLANE_M);
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
    // The sun's azimuth is derived from the camera-to-target offset (W12), so it
    // can only be aimed once the controls own that target.
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
      // The sun first, so the frame this schedules is drawn with it (W12).
      this.aimSun();
      this.requestFrame();
    });

    // Picking on `pointerup` after a still pointer, not on `click`: MapControls
    // consumes drags, and a click at the end of a 200 px pan would otherwise
    // select whatever cell happened to be under the pointer when it stopped.
    let downAt: { x: number; y: number } | undefined;
    // Held, like every other listener here, so `dispose()` can remove it. An
    // anonymous one outlives disposal and keeps the view reachable.
    this.onPointerStart = (event: PointerEvent): void => {
      downAt = { x: event.clientX, y: event.clientY };
    };
    this.container.addEventListener("pointerdown", this.onPointerStart);
    this.onPointerDown = (event: PointerEvent): void => {
      const from = downAt;
      downAt = undefined;
      if (from === undefined) return;
      const moved =
        Math.abs(event.clientX - from.x) + Math.abs(event.clientY - from.y);
      if (moved > 4) return;
      const picked = this.pick(event);
      if (picked !== undefined) options.onPick?.(picked);
    };
    this.container.addEventListener("pointerup", this.onPointerDown);
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
  setTerrain(field: Heightfield | undefined): void {
    const started = performance.now();
    this.terrain = field;
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
      positions[i + 2] =
        field === undefined || !onCpu ? 0 : field.heightAt({ x, y: planeY });
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
    if (enabled === this.groundDebug) return;
    this.groundDebug = enabled;
    if (enabled) this.applyGroundRamp();
    this.ground.material = enabled
      ? this.groundRampMaterial
      : this.groundMaterial;
    // On demand rendering: without this the swap is invisible until the camera
    // moves, which is finding R2-3 in a new place.
    this.requestFrame();
  }

  /**
   * Writes a `color` attribute from the plane's current displaced heights.
   *
   * The heights are read back out of the POSITION buffer rather than kept
   * alongside it, so the colours cannot disagree with the surface they describe —
   * there is one source of truth and it is the geometry that is actually drawn.
   * The plane is built in its own XY space, so height lives in `z`.
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
      heights[i] =
        field === undefined
          ? 0
          : field.heightAt({
              x: source[i * 3] ?? 0,
              y: source[i * 3 + 1] ?? 0,
            });
    }
    this.ground.geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(heightRampColours(heights), 3),
    );
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
    const targets: THREE.Object3D[] = [];
    if (this.cellMesh !== undefined) targets.push(this.cellMesh);
    for (const child of this.group.children) {
      // `poiInstances` since W7: the markers share one `InstancedMesh`, so the
      // raycast set gains one object rather than one per marker — which is also
      // why picking got cheaper rather than more expensive.
      if (child.userData["poiInstances"] !== undefined) targets.push(child);
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
  renderCells(mesh: CellMesh): void {
    if (this.cellMesh !== undefined) {
      this.scene.remove(this.cellMesh);
      disposeMesh(this.cellMesh);
      this.cellMesh = undefined;
    }
    if (this.cellOutlines !== undefined) {
      this.scene.remove(this.cellOutlines);
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
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.9,
        }),
      );
      this.scene.add(this.cellOutlines);
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
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    this.cellMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        // Matches the 2D map's fill opacity, so the same cell reads as the same
        // strength of claim in both views.
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    // How `resolvePick` recognises the grid. A flag rather than an identity
    // comparison, so the decision stays a pure function of the hits and can be
    // tested without a renderer.
    this.cellMesh.userData["cellGrid"] = true;
    this.scene.add(this.cellMesh);
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
  private aimSun(): void {
    const azimuth = cameraAzimuth(this.camera.position, this.controls.target);
    const direction = sunDirection(azimuth);
    // THE SAME VECTOR TURNS THE SKY (W14). The disc is baked at one azimuth and
    // the whole background is rotated, so the painted sun and the light cannot
    // disagree — and it costs a uniform rather than a texture upload per drag.
    this.scene.backgroundRotation.y = skyRotationForSun(azimuth);
    const distance = 1000;
    this.sun.position.set(
      direction.x * distance,
      direction.y * distance,
      direction.z * distance,
    );
    // The light aims at its target, which stays at the origin: the scene is
    // re-origined on every move (see `recentre-camera.ts`), so the origin is
    // always where the user is.
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
  private requestFrame(): void {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
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
   * features are 28–68 MB and must not cross the boundary to be turned into
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
    context?: MeshLayerContext,
  ): BuildingStats {
    this.clear();
    // ONE LINE PER LAYER'S WORTH OF WORK, in `mesh-layers.ts`. This used to be a
    // pair of branches per layer — one to draw it, one ternary per counter to zero
    // its contribution when off — which reached complexity 21 with three layers and
    // had four more (W12–W15) queued behind it. The table also makes a MISSING
    // layer detectable, which the longhand form could not: see that file's header.
    const { objects, stats } = drawMeshLayers(mesh, layers, context);
    for (const object of objects) this.group.add(object);

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
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Points the camera back at the scene origin, by translation only (W11).
   *
   * Called when the user MOVES — a map click, the locate button or the location
   * picker — because every refresh rebuilds the world in a frame centred on the
   * new position, so the place the user chose is always at the origin. Without
   * this, that is only on screen while the camera has never been panned.
   *
   * The camera is not rotated and the viewing distance is unchanged; see
   * `recentre-camera.ts` for why that is by construction rather than by care.
   */
  recentre(): void {
    recentreOnOrigin(this.camera, this.controls);
    this.requestFrame();
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

  dispose(): void {
    // Cancelled FIRST: a frame already queued would otherwise fire against a
    // disposed context, which crashes rather than leaks.
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.container.removeEventListener("pointerdown", this.onPointerStart);
    this.container.removeEventListener("pointerup", this.onPointerDown);
    this.controls.dispose();
    this.containerResize.disconnect();
    this.clear();
    // `clear()` only walks `this.group`. The ground and the affordance grid are
    // deliberately added straight to the scene — so that rebuilding the
    // buildings cannot drop them — which also means nothing else ever frees
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
    // The sky is a GPU texture like any other and nothing else frees it. It is
    // small, but `scene.background` holds it, so leaving it behind keeps the
    // whole scene reachable. (It is no longer also `scene.environment` — that
    // assignment took every `MeshStandardMaterial` off screen and was removed;
    // this comment still named it.)
    this.sky.dispose();
    this.perfStats?.dispose();
    this.perfStats = undefined;
    this.groundRampMaterial.dispose();
    this.heightTexture?.dispose();
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
