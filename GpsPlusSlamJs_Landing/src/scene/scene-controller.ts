import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  VignetteEffect,
} from "postprocessing";
import type { QualityTier } from "../capability";
import type { Theme } from "../theme";
import { applyPaletteToScene, getPalette } from "./palette";
import { applySkyPalette, buildSkyDome } from "./sky-dome";
import {
  applyParticlePalette,
  buildParticleField,
  updateParticles,
} from "./particles";
import { buildSatellites, updateSatellites } from "./satellites";
import { buildShootingStar, updateShootingStar } from "./shooting-stars";
import { buildHeroPeeker, createHeroIdleBeat } from "./hero-idle";
import { applyPortalPalette, PORTAL_NAME, updatePortalSpin } from "./portal";
import { pickEggTarget, type PointerNdc } from "./egg-picker";
import { GEOCACHE_NAME, toggleGeocache, updateGeocache } from "./geocache";
import { VIGNETTE_NODE } from "./use-case-vignettes";
import {
  initGhostRestore,
  triggerGhostRestore,
  updateGhostRestore,
} from "./ghost-restore";
import { DOT_PERSON_NAME } from "./dot-person";
import { parkourOffset, triggerParkourHop } from "./parkour";
import { BIRD_NAME } from "./bird";
import {
  gyroFrameOffset,
  type DeviceOrientationReading,
} from "./gyro-parallax";
import { buildClayWorld } from "./clay-world";
import { buildDotPerson } from "./dot-person";
import { buildMarkerPair } from "./markers";
import { buildPhoneFrame } from "./phone-frame";
import {
  buildIntroTimeline,
  buildStoryTimeline,
  chapterEndTime,
  createStoryStage,
  syncStage,
  type StoryStage,
} from "./story-timeline";
import type { Timeline } from "animejs";

/**
 * The stateful glue between scroll input, the anime.js story timeline and
 * the WebGL renderer. Design goals:
 *
 * - **Render on demand:** a frame renders only when something changed
 *   (scrub, intro, theme, resize) — an idle page burns no GPU.
 * - **Seek-driven animation:** both the story scrub AND the intro are
 *   driven by `tick(nowMs)` seeks, never by anime's own engine loop —
 *   one deterministic driver, trivially testable.
 * - **Smoothing:** scroll input sets a target progress; the displayed
 *   progress eases toward it exponentially, so wheel steps don't jump-cut.
 * - **Fallible construction:** renderer creation failures return `null`
 *   and the caller falls back to the static DOM floor.
 */

/** The renderer surface the controller needs (real: WebGLRenderer). */
export interface RendererLike {
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(ratio: number): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
  readonly shadowMap: { enabled: boolean };
  readonly domElement: HTMLCanvasElement;
}

/**
 * The post-processing surface the controller needs (real: pmndrs
 * EffectComposer, v3 F1). When present it REPLACES the plain render
 * call; it never coexists with direct rendering in the same frame.
 */
export interface ComposerLike {
  render(deltaTimeSeconds?: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

interface SceneContainer {
  readonly clientWidth: number;
  readonly clientHeight: number;
  appendChild(child: HTMLCanvasElement): unknown;
}

export interface SceneControllerOptions {
  readonly container: SceneContainer;
  readonly tier: QualityTier;
  readonly initialTheme: Theme;
  /** Injectable for tests; defaults to a real WebGLRenderer. */
  readonly createRenderer?: () => RendererLike;
  /**
   * Injectable for tests; defaults to a pmndrs EffectComposer with
   * half-res (mipmap) bloom + vignette. Only consulted when
   * `tier.postprocessing` is true. May return null (e.g. the default
   * cannot compose over a non-WebGLRenderer fake) — the controller then
   * renders directly.
   */
  readonly createComposer?: (
    renderer: RendererLike,
    scene: Scene,
    camera: PerspectiveCamera,
  ) => ComposerLike | null;
  /** rAF seam for `start()`; defaults to window.requestAnimationFrame. */
  readonly requestFrame?: (callback: (nowMs: number) => void) => void;
  /**
   * Fired when the WebGL context is lost at runtime (mobile GPUs and
   * loaded systems genuinely do this) — the caller should engage the
   * static DOM floor, same as when creation fails.
   */
  readonly onContextLost?: () => void;
  /**
   * Fired when the browser restores the context (preventDefault on the
   * lost event allows this; three.js re-uploads GPU resources itself) —
   * the caller can lift the static floor again.
   */
  readonly onContextRestored?: () => void;
}

/** What a pointer click on the 3D world hit (easter-egg catalog §2).
 * Not exported — callers consume it structurally via `clickAt`'s
 * return type (knip keeps the export surface minimal). */
interface EggClickResult {
  readonly egg: "geocache" | "ghost-restore" | "parkour" | "bird";
  /** Geocache: whether this click OPENED the chest (toast on open only). */
  readonly opened?: boolean;
}

export interface SceneController {
  readonly stage: StoryStage;
  /**
   * Egg plumbing (§2): hit-test a genuine click (already drag-filtered
   * by the caller) against the registered egg targets and trigger the
   * hit egg. Returns what happened, or null on a miss.
   */
  clickAt(pointer: PointerNdc): EggClickResult | null;
  /** Gyro parallax egg (№8): feed the latest device-orientation reading
   * (main.ts only attaches the listener on permissionless platforms). */
  setGyroOrientation(orientation: DeviceOrientationReading): void;
  /** Scroll mode: set the story progress target (0..1); eased in tick(). */
  setTargetProgress(progress: number): void;
  /** Reduced-motion mode: jump to a chapter's end composition. */
  showChapterEndState(chapterIndex: number): void;
  applyTheme(theme: Theme): void;
  playIntro(): void;
  skipIntro(): void;
  handleResize(width: number, height: number): void;
  /**
   * Visibility gate for the continuous particle render (v3 F2): the
   * bootstrap wires `visibilitychange` to this. While hidden (or on
   * tiers without particles) the controller falls back to pure
   * render-on-demand.
   */
  setPageVisible(visible: boolean): void;
  /** Advance smoothing/intro and render if dirty. Called by start()'s loop. */
  tick(nowMs: number): void;
  /** Begin the rAF loop (browser only; tests call tick directly). */
  start(): void;
}

/**
 * Exponential smoothing time constant for the scroll scrub (ms).
 * Raised from 120 after round-1 feedback ("hakelig"): at 120 ms discrete
 * wheel steps were still readable as steps; 240 ms glides through them
 * while staying responsive enough that the story doesn't feel laggy.
 */
const SCRUB_TAU_MS = 240;
/** Snap threshold: below this progress delta we stop re-seeking. */
const SCRUB_EPSILON = 0.0005;

/** Shared sun position for every palette without an explicit
 * `directional.position` (dusk overrides it for golden-hour shadows). */
const DEFAULT_LIGHT_POSITION = new Vector3(18, 30, 14);

function defaultCreateRenderer(): RendererLike {
  return new WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
}

/**
 * Default composer (v3 F1): mipmap-blurred (≈half-res cost) selective
 * bloom via luminance threshold — only emissive-bright parts glow — plus
 * a near-free vignette, merged into one effect pass by pmndrs.
 */
function defaultCreateComposer(
  renderer: RendererLike,
  scene: Scene,
  camera: PerspectiveCamera,
): ComposerLike | null {
  if (!(renderer instanceof WebGLRenderer)) {
    return null;
  }
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(
    new EffectPass(
      camera,
      new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.55,
        luminanceSmoothing: 0.25,
        intensity: 0.8,
        radius: 0.8,
      }),
      new VignetteEffect({ offset: 0.32, darkness: 0.42 }),
    ),
  );
  return composer;
}

export function createSceneController(
  options: SceneControllerOptions,
): SceneController | null {
  const { container, tier, initialTheme } = options;

  let renderer: RendererLike;
  try {
    renderer = (options.createRenderer ?? defaultCreateRenderer)();
  } catch {
    // No WebGL: the caller switches to the static DOM floor.
    return null;
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 220);
  const world = buildClayWorld(tier.geometryDetail);
  const markers = buildMarkerPair();
  const stage = createStoryStage({
    world,
    person: buildDotPerson(),
    markers,
    phone: buildPhoneFrame(),
    camera,
  });
  const hemisphere = new HemisphereLight();
  const directional = new DirectionalLight();
  directional.position.copy(DEFAULT_LIGHT_POSITION);
  directional.castShadow = tier.shadows;
  if (tier.shadows) {
    directional.shadow.mapSize.set(1024, 1024);
    // Blurred PCF edges for the golden-hour look (shadow.radius is
    // sampled by the default PCFShadowMap path; PCFSoftShadowMap would
    // IGNORE it). Bounds ±38: dusk's low sun casts long shadows that
    // would clip the old ±30 box.
    directional.shadow.radius = 4;
    const shadowCam = directional.shadow.camera;
    shadowCam.left = -38;
    shadowCam.right = 38;
    shadowCam.top = 38;
    shadowCam.bottom = -38;
    // Mutating the bounds does nothing until the projection is rebuilt —
    // without this call the shadow camera keeps its default ±5 box and
    // clips every shadow beyond ~5 units (PR #189 review, test-pinned).
    shadowCam.updateProjectionMatrix();
  }
  const sky = buildSkyDome();
  // Ambient particles (v3 F2): scroll mode + high tier only — reduced
  // motion must stay still and the low tier keeps its cost profile, so
  // neither even builds the field.
  const particles =
    tier.mode === "scroll" && tier.geometryDetail === "high"
      ? buildParticleField()
      : null;
  // Permanent GPS satellites (easter-egg catalog №0): built on EVERY
  // tier — reduced motion / low tier show them parked at the built
  // t=0 pose; only the continuous loop below animates the orbits.
  const satellites = buildSatellites();
  // Shooting stars (easter-egg №7): dark palettes only; built always,
  // gated per-theme + by the continuous loop below.
  const shootingStar = buildShootingStar();
  // Forest portal (round-14 R14-10): the story timeline opens/closes it;
  // the render loop swirls its rings while it's open.
  const portal = world.getObjectByName(PORTAL_NAME) ?? null;
  // Hero idle beat (easter-egg №6): a second dot-person peeks from behind
  // a hero-side bush after 60 s idle at the hero. Scroll mode only.
  const heroPeeker = tier.mode === "scroll" ? buildHeroPeeker() : null;
  const heroIdleBeat = heroPeeker
    ? createHeroIdleBeat(heroPeeker.group, heroPeeker.peeker)
    : null;
  scene.add(
    world,
    sky,
    satellites,
    shootingStar,
    stage.person,
    markers.raw,
    markers.fused,
    markers.connectors,
    camera,
  );
  if (particles) {
    scene.add(particles);
  }
  if (heroPeeker) {
    scene.add(heroPeeker.group);
  }
  scene.add(hemisphere, directional);

  let dirty = true;
  const story: Timeline = buildStoryTimeline(stage, () => {
    dirty = true;
  });
  const intro: Timeline = buildIntroTimeline(stage, () => {
    dirty = true;
  });
  story.seek(0);
  syncStage(stage);

  // Shooting stars show only over a dark sky (dark/neon/dusk/terminal),
  // never light/mono where they'd be invisible.
  let darkSky = false;
  function applyThemeInternal(theme: Theme): void {
    darkSky = theme !== "light" && theme !== "mono";
    const palette = getPalette(theme);
    applyPaletteToScene(scene, palette);
    applySkyPalette(sky, palette);
    if (portal) {
      // The vertex-colored interior can't ride the role traversal.
      applyPortalPalette(portal, palette);
    }
    if (particles) {
      applyParticlePalette(particles, palette);
    }
    scene.background = new Color(palette.background);
    scene.fog = new Fog(palette.fog.color, palette.fog.near, palette.fog.far);
    hemisphere.color.setHex(palette.hemisphere.sky);
    hemisphere.groundColor.setHex(palette.hemisphere.ground);
    hemisphere.intensity = palette.hemisphere.intensity;
    directional.color.setHex(palette.directional.color);
    directional.intensity = palette.directional.intensity;
    // Per-palette sun position (golden-hour restyle): explicitly restore
    // the default when absent — a sticky dusk position would relight
    // every other theme from the wrong side after one visit to dusk.
    const lightPos = palette.directional.position;
    if (lightPos) {
      directional.position.set(lightPos.x, lightPos.y, lightPos.z);
    } else {
      directional.position.copy(DEFAULT_LIGHT_POSITION);
    }
    dirty = true;
  }

  renderer.setPixelRatio(tier.dprCap);
  renderer.shadowMap.enabled = tier.shadows;
  renderer.setSize(
    Math.max(1, container.clientWidth),
    Math.max(1, container.clientHeight),
    false,
  );
  camera.aspect =
    Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight);
  camera.updateProjectionMatrix();
  container.appendChild(renderer.domElement);

  // Post-processing path (v3 F1): high tier only. The composer owns GPU
  // render targets, so it is disposed on context loss and rebuilt on
  // restore — three.js only re-uploads its OWN resources.
  const composerFactory = options.createComposer ?? defaultCreateComposer;
  let composer: ComposerLike | null = tier.postprocessing
    ? composerFactory(renderer, scene, camera)
    : null;

  if (typeof renderer.domElement.addEventListener === "function") {
    renderer.domElement.addEventListener("webglcontextlost", (event) => {
      // preventDefault ALLOWS the browser to restore the context later
      // (three.js re-uploads its GPU resources on restore). Until then
      // the caller shows the static DOM floor.
      event.preventDefault?.();
      composer?.dispose();
      composer = null;
      options.onContextLost?.();
    });
    renderer.domElement.addEventListener("webglcontextrestored", () => {
      if (tier.postprocessing) {
        composer = composerFactory(renderer, scene, camera);
      }
      dirty = true;
      options.onContextRestored?.();
    });
  }
  applyThemeInternal(initialTheme);

  let targetProgress = 0;
  let displayedProgress = 0;
  let pageVisible = true;
  let lastTickMs: number | null = null;
  // Egg targets (§2 plumbing): resolved once — hit-testing is limited
  // to these registered objects, never the whole scene.
  const geocache = world.getObjectByName(GEOCACHE_NAME) ?? null;
  const castle = world.getObjectByName(VIGNETTE_NODE.castle) ?? null;
  const bird = world.getObjectByName(BIRD_NAME) ?? null;
  if (castle) {
    initGhostRestore(castle);
  }
  // The dot-person lives on the stage, not the world graph.
  const person = stage.person;
  const eggTargets = [geocache, castle, person, bird].filter(
    (t): t is NonNullable<typeof t> => t !== null,
  );
  let parkourActive = false;
  // Latest device-orientation reading for the gyro-parallax egg (№8);
  // null until a permissionless reading arrives.
  let gyroReading: DeviceOrientationReading | null = null;
  let introStartedAt: number | null = null;
  // The camera pose the timelines produced, BEFORE the ambient hero drift
  // is layered on top (the drift is an additive offset, never baked in).
  const scrubbedCameraPos = stage.camera.position.clone();
  let ambientRampStartMs: number | null = null;

  function seekStory(progress: number): void {
    displayedProgress = progress;
    story.seek(progress * story.duration);
    syncStage(stage);
    scrubbedCameraPos.copy(stage.camera.position);
    dirty = true;
  }

  function advanceIntro(nowMs: number): void {
    if (introStartedAt === null) {
      return;
    }
    const elapsed = nowMs - introStartedAt;
    intro.seek(Math.min(elapsed, intro.duration));
    syncStage(stage);
    scrubbedCameraPos.copy(stage.camera.position);
    dirty = true;
    if (elapsed >= intro.duration) {
      introStartedAt = null;
    }
  }

  /**
   * Gentle time-based camera sway while the visitor rests at the hero
   * (round-1 feedback: a frozen hero reads as buggy). Additive on top of
   * the scrubbed pose, faded out by scroll progress AND ramped in over a
   * second so the intro/scrub handover never pops. Scroll mode only —
   * reduced motion must stay still.
   */
  function applyAmbientDrift(nowMs: number): void {
    // Restore the pure scrubbed pose first (also cleans up the last
    // ambient offset after scrolling away from the hero).
    if (!stage.camera.position.equals(scrubbedCameraPos)) {
      stage.camera.position.copy(scrubbedCameraPos);
      dirty = true;
    }
    if (tier.mode !== "scroll" || introStartedAt !== null) {
      ambientRampStartMs = null;
      return;
    }
    const weight = Math.max(0, 1 - displayedProgress * 12);
    if (weight <= 0.001) {
      ambientRampStartMs = null;
      return;
    }
    if (ambientRampStartMs === null) {
      ambientRampStartMs = nowMs;
    }
    const ramp = Math.min(1, (nowMs - ambientRampStartMs) / 1200);
    const s = nowMs * 0.001;
    stage.camera.position.addScaledVector(
      new Vector3(
        Math.sin(s * 0.33) * 0.9,
        Math.sin(s * 0.21) * 0.35,
        Math.cos(s * 0.26) * 0.9,
      ),
      weight * ramp,
    );
    dirty = true;
  }

  function advanceScrub(dtMs: number): void {
    const delta = targetProgress - displayedProgress;
    if (Math.abs(delta) < SCRUB_EPSILON) {
      return;
    }
    const blend = 1 - Math.exp(-dtMs / SCRUB_TAU_MS);
    const next =
      Math.abs(delta) < SCRUB_EPSILON * 4
        ? targetProgress
        : displayedProgress + delta * blend;
    seekStory(next);
  }

  const controller: SceneController = {
    stage,
    clickAt(pointer: PointerNdc): EggClickResult | null {
      if (eggTargets.length === 0) {
        return null;
      }
      // Clicks are rare — refreshing matrices here keeps the pick
      // correct even when no frame rendered since the last scrub. The
      // person is a scene child (not under `world`), so update each
      // target explicitly rather than just the world subtree.
      stage.camera.updateMatrixWorld(true);
      for (const target of eggTargets) {
        target.updateWorldMatrix(true, true);
      }
      const hit = pickEggTarget(pointer, stage.camera, eggTargets);
      if (hit === GEOCACHE_NAME && geocache) {
        const { opened } = toggleGeocache(geocache, lastTickMs ?? 0);
        dirty = true;
        return { egg: "geocache", opened };
      }
      if (hit === VIGNETTE_NODE.castle && castle) {
        triggerGhostRestore(castle, lastTickMs ?? 0);
        dirty = true;
        return { egg: "ghost-restore" };
      }
      if (hit === DOT_PERSON_NAME) {
        triggerParkourHop(person, lastTickMs ?? 0);
        dirty = true;
        return { egg: "parkour" };
      }
      if (hit === BIRD_NAME) {
        // No scene change — main.ts opens the profile link.
        return { egg: "bird" };
      }
      return null;
    },
    setGyroOrientation(orientation: DeviceOrientationReading) {
      gyroReading = orientation;
    },
    setTargetProgress(progress: number) {
      if (Number.isFinite(progress)) {
        targetProgress = Math.min(1, Math.max(0, progress));
      }
    },
    showChapterEndState(chapterIndex: number) {
      const time = Math.min(
        Math.max(0, chapterEndTime(chapterIndex)),
        story.duration,
      );
      const progress = story.duration === 0 ? 0 : time / story.duration;
      // Also retarget the scrub: otherwise the next ticks would ease the
      // composition back toward the stale target (visible as a slow
      // slide to the hero framing in reduced-motion mode).
      targetProgress = progress;
      seekStory(progress);
    },
    applyTheme: applyThemeInternal,
    playIntro() {
      // Started on the next tick; tick() timestamps it.
      introStartedAt = Number.NaN; // sentinel: waiting for first tick
    },
    skipIntro() {
      if (introStartedAt !== null) {
        intro.seek(intro.duration);
        syncStage(stage);
        scrubbedCameraPos.copy(stage.camera.position);
        introStartedAt = null;
        dirty = true;
      }
    },
    setPageVisible(visible: boolean) {
      pageVisible = visible;
      if (visible) {
        dirty = true;
      }
    },
    handleResize(width: number, height: number) {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      renderer.setSize(w, h, false);
      composer?.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
    },
    tick(nowMs: number) {
      const dt = lastTickMs === null ? 16 : Math.max(1, nowMs - lastTickMs);
      lastTickMs = nowMs;
      if (introStartedAt !== null && Number.isNaN(introStartedAt)) {
        introStartedAt = nowMs;
      }
      if (introStartedAt !== null) {
        advanceIntro(nowMs);
      } else {
        advanceScrub(dt);
      }
      applyAmbientDrift(nowMs);
      // Continuous ambient animation (v3 F2), gated by tab visibility:
      // a hidden tab burns no GPU, everything else renders every frame.
      // This consciously supersedes strict render-on-demand (sidecar).
      // The satellites (№0) ride the same gate: on tiers without the
      // particle loop they stay parked at their built pose.
      if (particles && pageVisible) {
        updateParticles(particles, nowMs);
        updateSatellites(satellites, nowMs);
        // The meteor is mid-streak only ~1.2s per 30–60s; it rides the
        // particle loop's dirty flag while a streak is crossing.
        updateShootingStar(shootingStar, nowMs, darkSky);
        if (portal) {
          updatePortalSpin(portal, nowMs);
        }
        dirty = true;
      }
      // Event-driven egg transitions (wall-clock, not scroll-driven).
      if (geocache && updateGeocache(geocache, nowMs)) {
        dirty = true;
      }
      if (castle && updateGhostRestore(castle, nowMs)) {
        dirty = true;
      }
      // Gyro parallax (№8): a light additive rotation on the phone frame
      // while it's flown in (dive). SET (not add) each frame — the
      // timeline never rotates the phone, so this is idempotent and
      // returns to neutral when no reading arrives.
      if (gyroReading && stage.phone.scale.x > 0.05) {
        const off = gyroFrameOffset(gyroReading);
        stage.phone.rotation.x = off.x;
        stage.phone.rotation.y = off.y;
        dirty = true;
      }
      // Hero idle beat (№6): only "idle at hero" while the intro is done,
      // the tab is visible, and the scrub rests at the top (progress ≈ 0).
      if (heroIdleBeat) {
        const idleAtHero =
          introStartedAt === null && pageVisible && displayedProgress < 0.01;
        if (heroIdleBeat.update(nowMs, idleAtHero)) {
          dirty = true;
        }
      }
      // Parkour hop: an additive offset layered on the freshly placed
      // walk pose. syncStage runs each active frame (and once more when
      // the hop ends) so the offset never accumulates and resets clean.
      const hop = parkourOffset(person, nowMs);
      if (hop.active || parkourActive) {
        syncStage(stage);
        person.position.y += hop.y;
        person.rotation.y += hop.spin;
        dirty = true;
      }
      parkourActive = hop.active;
      if (dirty) {
        camera.lookAt(stage.lookTarget);
        if (composer) {
          composer.render(dt / 1000);
        } else {
          renderer.render(scene, camera);
        }
        dirty = false;
      }
    },
    start() {
      const requestFrame =
        options.requestFrame ??
        ((callback: (nowMs: number) => void) =>
          requestAnimationFrame(callback));
      const loop = (nowMs: number): void => {
        controller.tick(nowMs);
        requestFrame(loop);
      };
      requestFrame(loop);
    },
  };
  return controller;
}
