/**
 * The cloud volume in the globe lab (volume-cloud plan 2026-10-05-0016, C2):
 * the framework's ray-marched cloud slab near the camera, its clouds from
 * the globe's own cloud map, drawn after the Earth so a ridge in front of a
 * cloud hides it.
 *
 * - **The slab is the ground sky's** (`SkyAtmosphere` in slab mode, cover 1,
 *   the coverage chunk `CLOUD_VOLUME_COVERAGE_GLSL` reading the globe's map
 *   with its drift, a disc of `radiusKm` x the altitude share).
 * - **The relief's depth** comes from a depth-only pass of the relief's own
 *   meshes (their colour writes off; the displacement is in their vertex
 *   shader, so an override material would draw them flat) into a depth
 *   texture the slab reads (`setCloudSceneDepth`): the march ends at the
 *   ground. Drawn with the relief alone as the scene, the relief's program
 *   compiles once more without the page's fog, on the first volume frame.
 * - **The height**: the framework's slab sits at fixed heights (1.8-2.2 km);
 *   the volume draws it with a copy of the camera lowered by "the shell's
 *   height minus the slab's middle", which raises the slab to the shell's
 *   height without touching the framework. Noise, depth and distances are
 *   unchanged by a vertical shift. Its thickness is not scaled with E.
 * - **The composite**: the slab into its own half-float target (cleared to
 *   alpha 0), then over the frame after the Earth: straight colour, three's
 *   tone mapping and colour space, its alpha blended.
 *
 * Only in the target's local frame (F2a), below the ceiling, with the relief.
 *
 * @see globe-cloud-volume.js.md
 */
import * as THREE from "three";

import { CLOUD_LAYER } from "/fw/visualization/atmosphere/cloud-layer.js";
import {
  CLOUD_SLAB,
  CLOUD_SLAB_REACH,
} from "/fw/visualization/atmosphere/cloud-slab.js";
import { CloudShadow } from "/fw/visualization/atmosphere/cloud-shadow.js";
import {
  CLOUD_VOLUME_COVERAGE_GLSL,
  cloudVolumeDiscCentre,
  cloudVolumeNoiseOffset,
  cloudVolumeShare,
} from "/globe/globe-cloud-volume.js";

const COMPOSITE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tVolume;
varying vec2 vUv;
void main() {
  vec4 c = texture2D( tVolume, vUv );
  if ( c.a < 1e-4 ) discard;
  gl_FragColor = vec4( c.rgb / c.a, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.a = c.a;
}`;

/** The slab's middle (m): the height the lift moves to the shell's. */
const SLAB_MIDDLE_M = (CLOUD_SLAB.baseM + CLOUD_SLAB.topM) / 2;

/**
 * The slab's reach never ends before its default (m): a small disc keeps
 * the look-dev page's fade.
 */
const MIN_REACH_END_M = CLOUD_SLAB_REACH.farEndM;

/**
 * The volume for `renderer`, drawing the ground sky's `atmosphere` slab
 * found in `skyScene`, its coverage from the globe's `surfaceUniforms`.
 */
export function createGlobeCloudVolume(
  renderer,
  { atmosphere, skyScene, surfaceUniforms, sceneDepth },
) {
  const origin = { value: new THREE.Vector2() };
  const shareUniform = { value: 0 };
  const gainUniform = { value: 1 };
  const volumeTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  const material = new THREE.ShaderMaterial({
    uniforms: { tVolume: { value: volumeTarget.texture } },
    vertexShader: COMPOSITE_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const triangle = new THREE.Mesh(geometry, material);
  triangle.frustumCulled = false;
  const compositeScene = new THREE.Scene();
  compositeScene.add(triangle);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const lifted = new THREE.PerspectiveCamera();
  const size = new THREE.Vector2();
  const clearColour = new THREE.Color();
  // The volume's shadow on the relief (C3): the framework's cloud shadow
  // with the same coverage chunk and uniforms, the disc and the lift, so it
  // falls from exactly the clouds the volume draws. Off until asked for.
  const coverage = {
    glsl: CLOUD_VOLUME_COVERAGE_GLSL,
    uniforms: {
      uVolumeClouds: surfaceUniforms.uClouds,
      uVolumeLonOffset: surfaceUniforms.uCloudLonOffset,
      uVolumeOpacity: surfaceUniforms.uCloudOpacity,
      uVolumeOrigin: origin,
      uVolumeShare: shareUniform,
      uVolumeGain: gainUniform,
    },
  };
  const shadow = new CloudShadow();
  shadow.configureMap({ coverage, disc: true });
  shadow.sync(atmosphere);
  shadow.setEnabled(false);
  let shadowOn = false;
  let enabled = false;
  let share = 0;
  let radiusM = 0;
  let liftM = 0;
  let drawn = 0;
  /** The reach's end last handed to the slab (m), or null (the default). */
  let lastReachEndM = null;
  /** How far ahead of the camera the disc's centre is (m), this frame. */
  let aheadM = 0;

  const slab = () => skyScene.getObjectByName("atmosphere-cloud-slab");
  const fit = (target) => {
    if (target.width !== size.x || target.height !== size.y) {
      target.setSize(size.x, size.y);
    }
  };

  return {
    /** Turns the slab on (or off) in the ground sky; idempotent. */
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (on) {
        atmosphere.configure({ cloudMode: "slab", cloudCover: 1 });
        atmosphere.setCloudCoverage(coverage);
        atmosphere.setCloudSceneDepth(sceneDepth.texture);
      } else {
        atmosphere.setCloudCoverage(null);
        atmosphere.setCloudSceneDepth(null);
        atmosphere.setCloudDiscRadius(null);
        atmosphere.setCloudReach(null);
        atmosphere.setCloudDiscCentre(null);
        lastReachEndM = null;
        atmosphere.configure({ cloudMode: "dome", cloudCover: 0 });
      }
    },
    /**
     * This frame's share and disc: `altitudeKm` the camera's height, `target`
     * the frame's target (degrees; null before one), `shellHeightM` the
     * shell's height. Returns `{ share, radiusM }` (0 when not drawn).
     */
    update({
      altitudeKm,
      target,
      radiusKm,
      ceilingKm,
      fadeKm = 10,
      cover = 1,
      shellHeightM,
      view = null,
      maxAheadM = 0,
    }) {
      gainUniform.value = cover;
      share =
        enabled && target !== null
          ? cloudVolumeShare(altitudeKm, {
              ceilingKm,
              fadeKm: Math.min(fadeKm, ceilingKm),
            })
          : 0;
      radiusM = radiusKm * 1000 * share;
      liftM = shellHeightM - SLAB_MIDDLE_M;
      shareUniform.value = share;
      if (target !== null) {
        origin.value.set(
          (target.lat * Math.PI) / 180,
          (target.lng * Math.PI) / 180,
        );
        // The noise belongs to the ground and drifts with the map: without
        // it every place put the same (clear) patch under its target.
        if (enabled) {
          const [u, v] = cloudVolumeNoiseOffset(
            {
              latRad: origin.value.x,
              lonRad: origin.value.y,
              lonOffsetRad: surfaceUniforms.uCloudLonOffset.value,
            },
            CLOUD_LAYER.tileKm * 1000,
          );
          atmosphere.cloudUniforms.atmCloudOffset.value.set(u, v);
        }
      }
      // The disc's centre (volume-cloud plan §15): where the view meets the
      // deck (the shell's height), at most `maxAheadM` ahead; the camera
      // without a view or with no reach ahead.
      const centre =
        view === null
          ? null
          : cloudVolumeDiscCentre({
              camera: view.position,
              direction: view.direction,
              deckY: shellHeightM,
              maxAheadM,
            });
      aheadM = centre?.aheadM ?? 0;
      const discCentre =
        centre === null || maxAheadM === 0
          ? null
          : { x: centre.x, z: centre.z };
      if (enabled) {
        atmosphere.setCloudDiscRadius(radiusM > 0 ? radiusM : null);
        atmosphere.setCloudDiscCentre(discCentre);
        // The slab's reach follows the disc (volume-cloud plan §13, R2; §15:
        // out to the disc's far side): its default ends 21 km from the
        // camera, which left the horizon the owner looked at without volume
        // clouds (2026-10-06). Moved in 1 km steps, not every frame.
        const reachEndM =
          Math.ceil(Math.max(aheadM + radiusM, MIN_REACH_END_M) / 1000) * 1000;
        if (reachEndM !== lastReachEndM) {
          lastReachEndM = reachEndM;
          atmosphere.setCloudReach({
            farStartM: (2 / 3) * reachEndM,
            farEndM: reachEndM,
          });
        }
      }
      shadow.setLiftM(liftM);
      if (radiusM > 0) shadow.setDiscRadiusM(radiusM);
      shadow.setDiscCentre(discCentre);
      shadow.setEnabled(shadowOn && enabled && radiusM > 0);
      return { share, radiusM };
    },
    /**
     * Draws the volume over the frame, after the Earth: the relief's depth
     * and `extra`'s (the city; `globe-scene-depth.js`, drawn here unless
     * already drawn this frame),
     * the slab with the lifted camera, the composite. Nothing at share 0.
     */
    render(camera, relief, extra = []) {
      const mesh = slab();
      if (!enabled || share <= 0 || mesh === undefined) return;
      renderer.getDrawingBufferSize(size);
      fit(volumeTarget);
      const previous = renderer.getRenderTarget();
      // The depth's own near plane (at most 10 m): the camera's is fitted to
      // the ground, and the deck can be far nearer than the ground (3 km
      // under a 2.8 km near plane at the 12 km hold), so with it every view
      // down clipped the deck away. The slab reads the depth back through
      // its own inverse projection, so it draws from that camera too.
      if (!sceneDepth.fresh) sceneDepth.render(camera, relief, extra);
      // The slab alone, from the lifted camera, into a clear target.
      lifted.copy(sceneDepth.camera);
      lifted.position.y -= liftM;
      lifted.updateMatrixWorld();
      const hidden = [];
      for (const child of skyScene.children) {
        if (child !== mesh && child.visible) {
          child.visible = false;
          hidden.push(child);
        }
      }
      renderer.getClearColor(clearColour);
      const clearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(volumeTarget);
      renderer.clear(true, false, false);
      renderer.render(skyScene, lifted);
      renderer.setClearColor(clearColour, clearAlpha);
      for (const child of hidden) child.visible = true;
      renderer.setRenderTarget(previous);
      renderer.render(compositeScene, quadCamera);
      drawn += 1;
    },
    /**
     * Patches every lit mesh `tiles` loads from now on with the volume's
     * shadow (call before the haze's patch: the haze is applied last).
     */
    patchShadow(tiles) {
      tiles.addEventListener("load-model", ({ scene: model }) => {
        shadow.applyToObject(model);
      });
    },
    /** The volume's shadow on (C3, `cloudShadowFrom=1`) or off. */
    setShadow(on) {
      shadowOn = Boolean(on);
    },
    /**
     * The last volume frame read back (debug, slow): the share of its pixels
     * the clouds cover (alpha over 0.05), over the whole frame and over its
     * lower half (the view down, where the deck is nearest), and the largest
     * alpha. Null before a frame was drawn.
     */
    coverage() {
      if (drawn === 0) return null;
      const w = volumeTarget.width;
      const h = volumeTarget.height;
      const pixels = new Uint16Array(w * h * 4);
      renderer.readRenderTargetPixels(volumeTarget, 0, 0, w, h, pixels);
      let covered = 0;
      let lower = 0;
      let maxAlpha = 0;
      // Read back bottom row first: the lower half is the first h/2 rows.
      const lowerEnd = Math.floor(h / 2) * w * 4;
      for (let i = 3; i < pixels.length; i += 4) {
        const a = THREE.DataUtils.fromHalfFloat(pixels[i]);
        if (a > 0.05) {
          covered += 1;
          if (i < lowerEnd) lower += 1;
        }
        if (a > maxAlpha) maxAlpha = a;
      }
      return {
        share: covered / (w * h),
        lowerShare: lower / (Math.floor(h / 2) * w),
        maxAlpha,
      };
    },
    state() {
      return {
        enabled,
        share,
        radiusM,
        aheadM,
        liftM,
        drawn,
        shadow: shadowOn && enabled && radiusM > 0,
      };
    },
    dispose() {
      volumeTarget.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
