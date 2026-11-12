/**
 * An ambient sound's part in the world (`zone` view): it plays by itself,
 * looping, while the visitor is within its reach, louder toward the
 * centre, through the background channel; it has no stop of its own, so
 * it takes no tap. Its mark is a glow on the ground whose gradient is the
 * loudness curve (`zoneGlow`). In the editor it is the same glow, still
 * and silent, with two marks the visitor never sees: the hearing range as
 * a ring drawn over the ground (`rangeRing`), and a speaker icon at the
 * centre (`soundIcon`), which is all the editor picks it by - a press
 * inside the range is a press on the ground.
 *
 * @see zone.ts.md
 */

import type { TourAudioBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  CircleGeometry,
  Group,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from "three";

import { inheritedScaleOf } from "../../placement/place-scale.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";
import type { SoundHandle } from "../../world-sound.js";
import { soundIcon } from "./sound-icon.js";
import {
  AMBIENT_DEFAULT_MAX_M,
  zoneGain,
  type ZoneReach,
} from "./sound-reach.js";

/** The zone's reach as its block holds it, defaults for what is absent. */
function zoneReachOf(block: TourAudioBlock): ZoneReach {
  return {
    maxM: block.maxM ?? AMBIENT_DEFAULT_MAX_M,
    ...(block.minM === undefined ? {} : { minM: block.minM }),
    volume: block.volume ?? 1,
  };
}

/** How strong the glow is where the sound is at full volume. */
const GLOW_ALPHA = 0.35;

/**
 * The ground glow: a disc of the zone's reach, lying a little above the
 * ground, its alpha the loudness curve (`zoneGain`'s, the same linear
 * fall from `minM` to `maxM`) in the shader. No lights, no texture.
 */
function zoneGlow(reach: ZoneReach): {
  readonly object: Object3D;
  dispose(): void;
} {
  const geometry = new CircleGeometry(reach.maxM, 64);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMin: { value: Math.min(reach.minM ?? 0, reach.maxM) },
      uMax: { value: reach.maxM },
      uAlpha: { value: GLOW_ALPHA },
    },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uMin;
      uniform float uMax;
      uniform float uAlpha;
      varying vec2 vPos;
      void main() {
        float d = length(vPos);
        float g = 1.0 - clamp((d - uMin) / max(uMax - uMin, 1e-3), 0.0, 1.0);
        gl_FragColor = vec4(1.0, 0.82, 0.45, g * uAlpha);
      }`,
  });
  const disc = new Mesh(geometry, material);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  disc.renderOrder = -1;
  return {
    object: disc,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** The range ring's line: at least `px` CSS px wide on the screen and
 *  `minWidthM`, never wider than `maxWidthM` (nor the range). */
export const RANGE_RING = Object.freeze({
  px: 3,
  minWidthM: 0.12,
  maxWidthM: 4,
});

/** Draws over the scene's default order, under the icon and the
 *  found-radius rings (20). */
const RANGE_RING_RENDER_ORDER = 19;

/**
 * The range ring's width (m) seen `distanceM` from the camera through a
 * lens of `metresPerPxAtOneM` (metres one CSS px covers 1 m from the
 * camera): `RANGE_RING.px` on the screen, within `minWidthM` and
 * `maxWidthM` and never wider than the range `maxM`. A distance or lens
 * that is not a positive finite number gives `minWidthM`.
 */
export function rangeRingWidthM(
  distanceM: number,
  metresPerPxAtOneM: number,
  maxM: number,
): number {
  const cap = Math.min(RANGE_RING.maxWidthM, Math.max(maxM, 0));
  const ok =
    Number.isFinite(distanceM) &&
    distanceM > 0 &&
    Number.isFinite(metresPerPxAtOneM) &&
    metresPerPxAtOneM > 0;
  const wanted = ok
    ? Math.max(
        RANGE_RING.minWidthM,
        RANGE_RING.px * distanceM * metresPerPxAtOneM,
      )
    : RANGE_RING.minWidthM;
  return Math.min(cap, wanted);
}

/**
 * The hearing range for the editor: a line on the circle of `maxM`, its
 * inner edge drawn by a shader so its width follows the camera without new
 * geometry. Flat, it cannot follow a sloped ground, so it is drawn with no
 * depth test, over the relief and buildings, as the found-radius ring is.
 */
function rangeRing(maxM: number): {
  readonly object: Mesh;
  setWidthM(widthM: number): void;
  dispose(): void;
} {
  const geometry = new RingGeometry(
    Math.max(maxM - RANGE_RING.maxWidthM, 0),
    maxM,
    128,
  );
  const material = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uOuter: { value: maxM },
      uWidth: { value: RANGE_RING.minWidthM },
    },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOuter;
      uniform float uWidth;
      varying vec2 vPos;
      void main() {
        if (length(vPos) < uOuter - uWidth) discard;
        gl_FragColor = vec4(1.0, 0.75, 0.32, 0.9);
      }`,
  });
  const ring = new Mesh(geometry, material);
  ring.name = "sound-range";
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.renderOrder = RANGE_RING_RENDER_ORDER;
  return {
    object: ring,
    setWidthM(widthM) {
      const uniform = material.uniforms["uWidth"];
      if (uniform !== undefined) uniform.value = widthM;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Not hit by a ray: the editor picks a sound by its icon alone. */
const unpicked = (object: Object3D): void => {
  object.raycast = () => undefined;
};

const camWorld = new Vector3();
const centreWorld = new Vector3();

export function zonePart(block: TourAudioBlock, env: WorldEnv): WorldPart {
  const reach = zoneReachOf(block);
  const object = new Group();
  const glow = zoneGlow(reach);
  object.add(glow.object);
  let sound: SoundHandle | null = null;
  if (env.mode === "play") {
    return {
      object,
      update(frame) {
        const [x, , z] = frame.viewer;
        // In its own metres: a folder that draws it larger widens its
        // range with it.
        const d =
          Math.hypot(x - object.position.x, z - object.position.z) /
          inheritedScaleOf(object);
        sound ??= env.sound(block.audio, "background");
        sound.level(zoneGain(d, reach), frame.seconds);
      },
      dispose() {
        sound?.dispose();
        sound = null;
        glow.dispose();
      },
    };
  }
  const ring = rangeRing(reach.maxM);
  const icon = soundIcon();
  unpicked(glow.object);
  unpicked(ring.object);
  object.add(ring.object, icon.object);
  return {
    object,
    update(frame) {
      icon.update(frame);
      const camera = frame.camera;
      if (camera === undefined) return;
      camera.getWorldPosition(camWorld);
      object.getWorldPosition(centreWorld);
      ring.setWidthM(
        rangeRingWidthM(
          camWorld.distanceTo(centreWorld),
          frame.metresPerPxAtOneM ?? Number.NaN,
          reach.maxM,
        ),
      );
    },
    dispose() {
      glow.dispose();
      ring.dispose();
      icon.dispose();
    },
  };
}
