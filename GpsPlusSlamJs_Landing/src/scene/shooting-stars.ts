import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type Group,
} from "three";
import { namedGroup } from "./palette";

/**
 * Shooting stars (easter-egg catalog №7): a rare meteor streak in the
 * dark palettes (dark/neon/dusk). Every 30–60 s a bright point + short
 * fading trail crosses the upper sky in ~1.2 s. Skipped in light/mono
 * (invisible against a bright sky) — the caller passes `enabled`.
 *
 * The schedule is a DETERMINISTIC function of the clock (no runtime
 * `Math.random`): event k fires at `eventStart(k)` and the streak's
 * trajectory is derived from a hash of k. Animated by the same
 * continuous-render gate as the satellites (scene-controller).
 */

export const SHOOTING_STAR_NAME = "shooting-star";
export const STREAK_DURATION_MS = 1200;

const MIN_GAP_MS = 30_000;
const GAP_JITTER_MS = 30_000; // → 30–60 s spacing
const SKY_HEIGHT = 34;
const CROSS_SPAN = 46; // horizontal distance the streak travels

/** Cheap deterministic hash of an integer → [0, 1). */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Start time of scheduled event k (monotonic, 30–60 s gaps). */
function eventStart(k: number): number {
  // Sum of per-gap jittered spacings — one gap per event INCLUDING event 0,
  // so the first streak lands at 30–60 s rather than at t=0 (the caller
  // feeds the page-load-relative clock, and a t=0 event would greet a fast
  // load with an immediate meteor). Gaps are bounded, so events never
  // reorder.
  let t = 0;
  for (let i = 0; i <= k; i++) {
    t += MIN_GAP_MS + hash01(i * 2 + 1) * GAP_JITTER_MS;
  }
  return t;
}

export function buildShootingStar(): Group {
  const group = namedGroup(SHOOTING_STAR_NAME);
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
  });
  // Bright head + a stretched trail behind it (−z local; the group is
  // oriented along travel at update time).
  const head = new Mesh(new SphereGeometry(0.35, 8, 6), material);
  const trail = new Mesh(new BoxGeometry(0.12, 0.12, 4.5), material);
  trail.position.z = -2.4;
  group.add(head, trail);
  group.visible = false;
  group.userData.starMaterial = material;
  group.frustumCulled = false;
  return group;
}

/** Which scheduled event, if any, is active at time `t`. */
function activeEvent(t: number): { k: number; start: number } | null {
  // Events are ~45 s apart; probe a small neighborhood around t/avgGap.
  const avgGap = MIN_GAP_MS + GAP_JITTER_MS / 2;
  const guess = Math.floor(t / avgGap);
  for (let k = Math.max(0, guess - 2); k <= guess + 2; k++) {
    const start = eventStart(k);
    if (t >= start && t < start + STREAK_DURATION_MS) {
      return { k, start };
    }
  }
  return null;
}

/**
 * Advance the streak to clock time `t`. When `enabled` and an event is
 * active, positions + shows the streak and returns true; otherwise hides
 * it and returns false. Pure in `t` (history-independent).
 */
export function updateShootingStar(
  group: Group,
  t: number,
  enabled: boolean,
): boolean {
  const event = enabled ? activeEvent(t) : null;
  if (!event) {
    group.visible = false;
    return false;
  }
  const progress = (t - event.start) / STREAK_DURATION_MS; // 0..1
  const h = event.k;
  // A start point high on one side and a travel direction across + down.
  const side = hash01(h * 3 + 2) > 0.5 ? 1 : -1;
  const startX = side * (CROSS_SPAN / 2);
  const z = (hash01(h * 5 + 4) - 0.5) * 30;
  const y0 = SKY_HEIGHT + hash01(h * 7 + 6) * 6;
  const x = startX - side * CROSS_SPAN * progress;
  const y = y0 - progress * 8; // slight downward arc
  group.position.set(x, y, z);
  // Orient the trail along travel: look AHEAD along the (constant) travel
  // direction so the −z trail streams out behind the head. A non-camera
  // Object3D faces its lookAt target with +Z. (The previous pure Z-roll
  // left the trail lying sideways along world Z — PR #193 review.)
  group.lookAt(x - side * CROSS_SPAN, y - 8, z);
  const material = group.userData.starMaterial as MeshBasicMaterial;
  // Fade out over the last third of the streak.
  material.opacity = progress < 0.7 ? 1 : Math.max(0, (1 - progress) / 0.3);
  group.visible = true;
  return true;
}
