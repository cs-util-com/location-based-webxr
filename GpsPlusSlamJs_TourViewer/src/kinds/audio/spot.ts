/**
 * A narration's part in the world (`spot` view): one circle on the ground.
 * The voice plays on a tap only, and only inside the circle; it pauses
 * when the visitor leaves (beyond the radius plus `NARRATION_MARGIN_M`)
 * and carries on at return; the visitor's own pause (a second tap) keeps
 * it off until tapped again. Heard through the voice channel, so one
 * voice at a time (`world-sound.ts`). Its look is `narrationLook`'s; the
 * player card listens to `onInside`. In the editor: the same circle,
 * still and silent.
 *
 * @see spot.ts.md
 */

import type { TourAudioBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";

import type { WorldEnv, WorldPart } from "../../world-part.js";
import type { SoundHandle } from "../../world-sound.js";
import { narrationLook } from "./narration-look.js";
import {
  circleInside,
  NARRATION_DEFAULT_RADIUS_M,
  NARRATION_MARGIN_M,
} from "./sound-reach.js";

/** A narration circle: a world part that also says when the visitor is
 *  inside it. */
export interface SpotPart extends WorldPart {
  /** `listener` hears every change of inside; returns its unsubscribe. */
  onInside(listener: (inside: boolean) => void): () => void;
}

export function spotPart(block: TourAudioBlock, env: WorldEnv): SpotPart {
  const radiusM = block.radiusM ?? NARRATION_DEFAULT_RADIUS_M;
  const look = narrationLook(radiusM);
  const listeners = new Set<(inside: boolean) => void>();
  const play = env.mode === "play";
  let inside = false;
  let voice: SoundHandle | null = null;
  const sound = (): SoundHandle => (voice ??= env.sound(block.audio, "voice"));
  return {
    object: look.object,
    tapTarget: look.tapTarget,
    onInside(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...(play
      ? {
          update(frame) {
            look.tick(frame.seconds);
            const [x, , z] = frame.viewer;
            const { position } = look.object;
            const d = Math.hypot(x - position.x, z - position.z);
            const now = circleInside(d, radiusM, NARRATION_MARGIN_M, inside);
            if (now === inside) return;
            inside = now;
            look.inside(inside);
            if (voice !== null) {
              if (inside) voice.carryOn();
              else voice.hold();
            }
            for (const listener of listeners) listener(inside);
          },
        }
      : {}),
    tap() {
      if (!play || !inside) return;
      const v = sound();
      if (v.playing()) v.pause();
      else v.play();
    },
    dispose() {
      listeners.clear();
      voice?.dispose();
      voice = null;
      look.dispose();
    },
  };
}
