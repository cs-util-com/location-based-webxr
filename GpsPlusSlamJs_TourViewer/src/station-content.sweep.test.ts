import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";

import { CONTENT_FADE_MS } from "./content-fade.js";
import { createStationContent, type ContentPart } from "./station-content.js";

/**
 * Why this test matters: the fade's length is a chosen number, so it is
 * swept (200-1000 ms) through the real side table at 30 frames a second
 * and the verdict is stated against the criteria it was chosen by:
 * - a switch (the left station out, then the next one in) under 1 s, so a
 *   museum visitor stepping from one exhibit to the next is not kept
 *   waiting: needs a fade under 500 ms;
 * - a step per frame of at most 10 % of the range, so the fade reads as a
 *   fade and not a pop: needs a fade of at least 334 ms at 30 fps.
 * Also measured: how far a visitor walking 1.4 m/s carries the left
 * station's content past its exit. If either criterion moves (a 0.7 s
 * switch budget, a 60 fps floor), the window this test prints moves too.
 */

const FRAME_MS = 1000 / 30;
const WALK_M_PER_S = 1.4;

function part(): ContentPart {
  return {
    kind: "content",
    render(parent) {
      const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
      parent.add(mesh);
      return Promise.resolve({
        count: 1,
        skipped: [],
        dispose: () => {
          parent.remove(mesh);
        },
      });
    },
  };
}

/** Let a render settle: it resolves through a few microtasks. */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

/** One switch from "a" to "b" at 30 fps with a fade of `fadeMs`. */
async function measure(fadeMs: number) {
  const scene = new Group();
  const clock = { ms: 0 };
  const content = createStationContent({ scene, now: () => clock.ms, fadeMs });
  content.setPart("a", "items", part());
  content.setPart("b", "items", part());
  const opacity = (id: string): number | null => {
    const group = scene.children.find(
      (c) => c.name === `station-content:${id}`,
    );
    const mesh = group?.children[0] as Mesh | undefined;
    return mesh === undefined
      ? null
      : (mesh.material as MeshBasicMaterial).opacity;
  };
  content.show(new Set(["a"]));
  await settle();
  for (let t = 0; t <= fadeMs + 3 * FRAME_MS; t += FRAME_MS) {
    clock.ms = t;
    content.update(t);
  }
  expect(opacity("a")).toBe(1);
  // The visitor crosses a's exit into b at `left`: the store says so then.
  const left = clock.ms + FRAME_MS;
  clock.ms = left;
  content.show(new Set(["b"]));
  let aGoneAt: number | null = null;
  let bInAt: number | null = null;
  let largestStep = 0;
  let previous = 1;
  let maxGroups = 0;
  for (let t = left; t < left + 3 * fadeMs + 10 * FRAME_MS; t += FRAME_MS) {
    clock.ms = t;
    await settle();
    content.update(t);
    maxGroups = Math.max(maxGroups, scene.children.length);
    const a = opacity("a");
    const b = opacity("b");
    const current = a ?? b ?? 0;
    if (a !== null) largestStep = Math.max(largestStep, Math.abs(previous - a));
    if (a === null && aGoneAt === null) aGoneAt = t;
    if (b !== null && previous !== current && aGoneAt !== null) {
      largestStep = Math.max(largestStep, Math.abs(previous - b));
    }
    previous = a === null && b === null ? 0 : current;
    if (b === 1 && bInAt === null) bInAt = t;
  }
  return {
    switchMs: (bInAt ?? Infinity) - left,
    pastExitM: (((aGoneAt ?? Infinity) - left) / 1000) * WALK_M_PER_S,
    largestStep,
    maxGroups,
  };
}

describe("the content fade's length (the sweep)", () => {
  it("a switch takes about two fades and one group stands at a time, at every length", async () => {
    for (const fadeMs of [200, 250, 300, 400, 500, 600, 800, 1000]) {
      const m = await measure(fadeMs);
      expect(m.maxGroups).toBe(1);
      // Out, then in, each whole fade rounded up to a frame, plus the
      // frame on which the next station is mounted.
      expect(m.switchMs).toBeGreaterThanOrEqual(2 * fadeMs);
      expect(m.switchMs).toBeLessThanOrEqual(2 * fadeMs + 3 * FRAME_MS);
      expect(m.pastExitM).toBeCloseTo((fadeMs / 1000) * WALK_M_PER_S, 0);
    }
  });

  it("400 ms is inside the window both criteria leave (334-499 ms); 300 ms pops, 500 ms switches too slowly", async () => {
    const chosen = await measure(CONTENT_FADE_MS);
    expect(CONTENT_FADE_MS).toBe(400);
    expect(chosen.switchMs).toBeLessThan(1000);
    expect(chosen.largestStep).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(chosen.pastExitM).toBeLessThan(0.7);
    // Each edge of the window reverses one criterion.
    expect((await measure(300)).largestStep).toBeGreaterThan(0.1);
    // Exactly 1 s at 500 ms (float rounding aside): not under it.
    expect((await measure(500)).switchMs).toBeGreaterThan(1000 - 1e-6);
  });
});
