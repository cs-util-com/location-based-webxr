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

import { CLOUD_SLAB } from "/fw/visualization/atmosphere/cloud-slab.js";
import {
  CLOUD_VOLUME_COVERAGE_GLSL,
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
 * The volume for `renderer`, drawing the ground sky's `atmosphere` slab
 * found in `skyScene`, its coverage from the globe's `surfaceUniforms`.
 */
export function createGlobeCloudVolume(
  renderer,
  { atmosphere, skyScene, surfaceUniforms },
) {
  const origin = { value: new THREE.Vector2() };
  const shareUniform = { value: 0 };
  const gainUniform = { value: 1 };
  const depthTexture = new THREE.DepthTexture(1, 1);
  const depthTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    depthTexture,
  });
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
  let enabled = false;
  let share = 0;
  let radiusM = 0;
  let liftM = 0;
  let drawn = 0;

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
        atmosphere.setCloudCoverage({
          glsl: CLOUD_VOLUME_COVERAGE_GLSL,
          uniforms: {
            uVolumeClouds: surfaceUniforms.uClouds,
            uVolumeLonOffset: surfaceUniforms.uCloudLonOffset,
            uVolumeOpacity: surfaceUniforms.uCloudOpacity,
            uVolumeOrigin: origin,
            uVolumeShare: shareUniform,
            uVolumeGain: gainUniform,
          },
        });
        atmosphere.setCloudSceneDepth(depthTexture);
      } else {
        atmosphere.setCloudCoverage(null);
        atmosphere.setCloudSceneDepth(null);
        atmosphere.setCloudDiscRadius(null);
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
      }
      if (enabled) atmosphere.setCloudDiscRadius(radiusM > 0 ? radiusM : null);
      return { share, radiusM };
    },
    /**
     * Draws the volume over the frame, after the Earth: the relief's depth,
     * the slab with the lifted camera, the composite. Nothing at share 0.
     */
    render(camera, relief) {
      const mesh = slab();
      if (!enabled || share <= 0 || mesh === undefined) return;
      renderer.getDrawingBufferSize(size);
      fit(depthTarget);
      fit(volumeTarget);
      const previous = renderer.getRenderTarget();
      // The relief's depth: its own meshes (the displacement is in their
      // vertex shader), colour off.
      const written = [];
      relief.traverse((o) => {
        if (o.isMesh && o.material?.colorWrite) {
          o.material.colorWrite = false;
          written.push(o.material);
        }
      });
      renderer.setRenderTarget(depthTarget);
      renderer.clear(false, true, false);
      renderer.render(relief, camera);
      for (const m of written) m.colorWrite = true;
      // The slab alone, from the lifted camera, into a clear target.
      lifted.copy(camera);
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
    state() {
      return { enabled, share, radiusM, liftM, drawn };
    },
    dispose() {
      depthTarget.dispose();
      depthTexture.dispose();
      volumeTarget.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
