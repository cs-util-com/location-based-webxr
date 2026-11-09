/**
 * An ambient sound's part in the world (`zone` view): it plays by itself,
 * looping, while the visitor is within its reach, louder toward the
 * centre, through the background channel; it has no stop of its own, so
 * it takes no tap. Its mark is a glow on the ground whose gradient is the
 * loudness curve (`zoneGlow`). In the editor it is the same glow, still
 * and silent.
 *
 * @see zone.ts.md
 */

import type { TourAudioBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  CircleGeometry,
  Group,
  Mesh,
  ShaderMaterial,
  type Object3D,
} from "three";

import type { WorldEnv, WorldPart } from "../../world-part.js";
import type { SoundHandle } from "../../world-sound.js";
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

export function zonePart(block: TourAudioBlock, env: WorldEnv): WorldPart {
  const reach = zoneReachOf(block);
  const object = new Group();
  const glow = zoneGlow(reach);
  object.add(glow.object);
  let sound: SoundHandle | null = null;
  return {
    object,
    ...(env.mode === "play"
      ? {
          update(frame) {
            const [x, , z] = frame.viewer;
            const d = Math.hypot(x - object.position.x, z - object.position.z);
            sound ??= env.sound(block.audio, "background");
            sound.level(zoneGain(d, reach), frame.seconds);
          },
        }
      : {}),
    dispose() {
      sound?.dispose();
      sound = null;
      glow.dispose();
    },
  };
}
