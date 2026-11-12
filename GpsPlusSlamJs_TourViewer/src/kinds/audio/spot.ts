/**
 * A narration's part in the world (`spot` view): one circle on the ground.
 * The voice plays on a tap only, and only inside the circle; it pauses
 * when the visitor leaves (beyond the radius plus `NARRATION_MARGIN_M`)
 * and carries on at return; the visitor's own pause (a second tap) keeps
 * it off until tapped again. Heard through the voice channel, so one
 * voice at a time (`world-sound.ts`). Its look is `narrationLook`'s; its
 * player card (`narrationCard`) opens on the page's screen while the
 * visitor is inside, at the same change `onInside` reports. In the editor:
 * the same circle, still and silent, and no card, with the editor's
 * speaker icon at its centre (`soundIcon`, as an ambient sound has), which
 * is all the editor picks it by.
 *
 * @see spot.ts.md
 */

import type { TourAudioBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { Matrix4, Vector3 } from "three";

import { inheritedScaleOf } from "../../placement/place-scale.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";
import type { SoundHandle } from "../../world-sound.js";
import { narrationCard, type NarrationCard } from "./narration-card.js";
import {
  narrationLook,
  type NarrationLookOptions,
  type NarrationState,
} from "./narration-look.js";
import { soundIcon, type SoundIcon } from "./sound-icon.js";
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

/** The plate's canvas and texture, on a page that has a document. */
function plateOf(env: WorldEnv): NarrationLookOptions["plate"] {
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  return { canvas, texture: env.canvasTexture(canvas) };
}

/** The viewer in the look's own frame, and the inverse that takes it
 *  there: made once, so a frame allocates nothing. */
const seen = new Vector3();
const toLocal = new Matrix4();

export function spotPart(block: TourAudioBlock, env: WorldEnv): SpotPart {
  const radiusM = block.radiusM ?? NARRATION_DEFAULT_RADIUS_M;
  const play = env.mode === "play";
  const plate = plateOf(env);
  const look = narrationLook(radiusM, {
    mode: play ? "play" : "edit",
    title: block.title ?? "Narration",
    ...(plate === undefined ? {} : { plate }),
  });
  const listeners = new Set<(inside: boolean) => void>();
  /** The editor's mark; the visitor sees none. */
  const icon: SoundIcon | null = play ? null : soundIcon();
  if (icon !== null) {
    // The editor picks it by its icon alone: the circle, the particles
    // and the invisible tap cylinder take no ray there.
    look.object.traverse((o) => {
      o.raycast = () => undefined;
    });
    look.object.add(icon.object);
  }
  let inside = false;
  let voice: SoundHandle | null = null;
  const sound = (): SoundHandle => (voice ??= env.sound(block.audio, "voice"));
  /** The tap rule: pause a playing voice, else play it (from the start
   *  once it was heard to the end). */
  const toggle = (): void => {
    const v = sound();
    if (v.playing()) {
      v.pause();
      return;
    }
    const duration = v.durationMs();
    if (duration > 0 && v.timeMs() >= duration) v.seek(0);
    v.play();
  };
  /** What the voice does now, for the look. */
  const stateNow = (): NarrationState => {
    if (voice === null) return "idle";
    if (voice.playing()) return "playing";
    const duration = voice.durationMs();
    const time = voice.timeMs();
    if (duration > 0 && time >= duration) return "heard";
    if (time <= 0) return "idle";
    return voice.wanted() ? "away" : "paused";
  };
  let card: NarrationCard | null = null;
  let closeCard: (() => void) | null = null;
  const openCard = (): void => {
    if (env.screen === undefined || closeCard !== null) return;
    closeCard = env.screen.show((host) => {
      card = narrationCard(host, block, {
        toggle,
        seek: (ms) => sound().seek(ms),
        timeMs: () => voice?.timeMs() ?? 0,
        durationMs: () => voice?.durationMs() ?? 0,
        playing: () => voice?.playing() ?? false,
      });
      return () => {
        card?.dispose();
        card = null;
      };
    });
  };
  const shutCard = (): void => {
    const close = closeCard;
    closeCard = null;
    close?.();
  };
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
            const [x, y, z] = frame.viewer;
            const { object } = look;
            object.updateMatrix();
            seen
              .set(x, y, z)
              .applyMatrix4(toLocal.copy(object.matrix).invert());
            look.face(seen.x, seen.z);
            look.show(stateNow(), inside);
            const { position } = look.object;
            // In its own metres: a folder that draws it larger widens
            // its circle with it.
            const d =
              Math.hypot(x - position.x, z - position.z) /
              inheritedScaleOf(look.object);
            const now = circleInside(d, radiusM, NARRATION_MARGIN_M, inside);
            if (now === inside) {
              card?.render();
              return;
            }
            inside = now;
            if (inside) openCard();
            else shutCard();
            look.show(stateNow(), inside);
            if (voice !== null) {
              if (inside) voice.carryOn();
              else voice.hold();
            }
            for (const listener of listeners) listener(inside);
          },
        }
      : {
          update(frame) {
            icon?.update(frame);
            if (frame.camera === undefined) return;
            frame.camera.getWorldPosition(seen);
            look.object.worldToLocal(seen);
            look.face(seen.x, seen.z);
          },
        }),
    tap() {
      if (!play || !inside) return;
      toggle();
      card?.render();
    },
    dispose() {
      shutCard();
      listeners.clear();
      voice?.dispose();
      voice = null;
      look.dispose();
      icon?.dispose();
    },
  };
}
