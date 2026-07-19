/**
 * Why these tests matter: shooting stars (catalog №7) are a rare ambient
 * delight gated exactly like the satellites (dark palettes only, same
 * continuous-render gate). The schedule MUST be a deterministic function
 * of the clock (no runtime Math.random — that would break scrub-path
 * independence and make the effect impossible to reason about), the
 * streak must actually cross the sky during its ~1.2 s window, and it
 * must stay hidden both between events and entirely in light palettes.
 */
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  buildShootingStar,
  SHOOTING_STAR_NAME,
  STREAK_DURATION_MS,
  updateShootingStar,
} from "./shooting-stars";

function poseKey(group: ReturnType<typeof buildShootingStar>): string {
  return `${group.visible}:${group.position.toArray().join(",")}`;
}

/** Scan the schedule for the first active streak window start. */
function firstActiveTime(): number {
  const group = buildShootingStar();
  for (let t = 0; t <= 120_000; t += 200) {
    if (updateShootingStar(group, t, true)) {
      return t;
    }
  }
  throw new Error("no shooting star fired within 2 minutes");
}

describe("shooting stars", () => {
  it("builds a named, initially hidden streak", () => {
    const group = buildShootingStar();
    expect(group.name).toBe(SHOOTING_STAR_NAME);
    expect(group.visible).toBe(false);
    expect(group.children.length).toBeGreaterThanOrEqual(1);
  });

  it("stays hidden in light palettes (enabled = false), always", () => {
    const group = buildShootingStar();
    for (let t = 0; t <= 120_000; t += 250) {
      expect(updateShootingStar(group, t, false)).toBe(false);
      expect(group.visible).toBe(false);
    }
  });

  it("fires at least once within a couple of minutes and crosses the sky", () => {
    const group = buildShootingStar();
    const start = firstActiveTime();
    // Sample across the streak window: it must be visible and MOVE.
    updateShootingStar(group, start, true);
    const a = group.position.clone();
    updateShootingStar(group, start + STREAK_DURATION_MS * 0.6, true);
    const b = group.position.clone();
    expect(group.visible).toBe(true);
    expect(a.distanceTo(b)).toBeGreaterThan(2);
    // High in the sky, not down among the world.
    expect(group.position.y).toBeGreaterThan(15);
  });

  // Why this test matters: the build comment promises "a stretched trail
  // behind it (−z local; the group is oriented along travel at update
  // time)" — but a pure Z-roll cannot orient anything along a travel
  // direction that lies in the XY plane, so the 4.5-long trail lay
  // sideways along world Z (foreshortened to nearly nothing on screen)
  // instead of streaming behind the head (PR #193 review, gemini).
  it("orients the trail behind the head along the travel direction", () => {
    const group = buildShootingStar();
    const start = firstActiveTime();
    updateShootingStar(group, start + 100, true);
    const a = group.position.clone();
    updateShootingStar(group, start + 500, true);
    const travel = group.position.clone().sub(a).normalize();

    // children[1] is the trail (head added first); it sits at local −Z.
    group.updateMatrixWorld(true);
    const trailDir = group.children[1]!.getWorldPosition(new Vector3())
      .sub(group.getWorldPosition(new Vector3()))
      .normalize();
    // The trail must point OPPOSITE the travel direction (behind the head).
    expect(trailDir.dot(travel)).toBeLessThan(-0.95);
  });

  it("delays the first streak by at least the minimum gap (no meteor on load)", () => {
    // Regression: eventStart(0) used to be 0, so scheduled event k=0 fired
    // at clock t=0. The caller (scene-controller) feeds the page-load-
    // relative rAF timestamp, so on a fast load — first frame earlier than
    // STREAK_DURATION_MS — the very first frame lands inside the [0, 1200)
    // window and a meteor greets the visitor on load, contradicting the
    // "rare, every 30–60 s" contract. The first streak must start no
    // earlier than the advertised minimum gap.
    const first = firstActiveTime();
    expect(first).toBeGreaterThanOrEqual(30_000);
  });

  it("hides again after the streak window", () => {
    const group = buildShootingStar();
    const start = firstActiveTime();
    updateShootingStar(group, start + STREAK_DURATION_MS + 500, true);
    expect(group.visible).toBe(false);
  });

  it("is a pure function of the clock (history-independent)", () => {
    const a = buildShootingStar();
    const b = buildShootingStar();
    const t = firstActiveTime() + 300;
    updateShootingStar(a, 999, true);
    updateShootingStar(a, 50_000, true);
    updateShootingStar(a, t, true);
    updateShootingStar(b, t, true);
    expect(poseKey(a)).toEqual(poseKey(b));
  });

  it("spaces events 30–60 s apart (deterministic schedule)", () => {
    const group = buildShootingStar();
    const starts: number[] = [];
    let prevActive = false;
    for (let t = 0; t <= 300_000; t += 100) {
      const active = updateShootingStar(group, t, true);
      if (active && !prevActive) {
        starts.push(t);
      }
      prevActive = active;
    }
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i]! - starts[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(30_000);
      expect(gap).toBeLessThanOrEqual(60_000 + STREAK_DURATION_MS);
    }
  });
});
