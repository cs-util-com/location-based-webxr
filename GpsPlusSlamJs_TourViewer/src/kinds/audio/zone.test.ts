import { PerspectiveCamera, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  audioBlock,
  recordingEnv,
} from "../../test-support/audio-world-env.js";
import { SOUND_ICON } from "./sound-icon.js";
import { RANGE_RING, rangeRingWidthM, zonePart } from "./zone.js";

const at = (x: number, seconds = 0) => ({
  seconds,
  viewer: [x, 1.5, 0] as const,
});

describe("an ambient zone in the world", () => {
  it("plays in the background at its distance's loudness, silent beyond its reach", () => {
    // Why: ambient plays by itself while within earshot, louder toward
    // the centre, and has no stop of its own (no tap target).
    const { env, sounds } = recordingEnv();
    const part = zonePart(audioBlock("zone", { maxM: 10, volume: 0.5 }), env);
    expect(part.tapTarget).toBeUndefined();
    part.update?.(at(0));
    part.update?.(at(5, 1));
    part.update?.(at(12, 2));
    expect(sounds).toHaveLength(1);
    expect(sounds[0]?.channel).toBe("background");
    expect(sounds[0]?.levels).toEqual([0.5, 0.25, 0]);
    part.dispose();
    expect(sounds[0]?.calls).toContain("dispose");
  });

  it("measures its distance on the ground, from where it stands", () => {
    // Why: the viewer's eye height must not make a zone quieter, and the
    // part's own position in the station is its centre.
    const { env, sounds } = recordingEnv();
    const part = zonePart(audioBlock("zone", { maxM: 10, volume: 1 }), env);
    part.object.position.set(4, 0, 0);
    part.update?.({ seconds: 0, viewer: [4, 30, 0] });
    expect(sounds[0]?.levels).toEqual([1]);
  });

  it("in the editor stands still and silent", () => {
    // Why: the editor shows the same object and must never sound.
    const { env, sounds } = recordingEnv("edit");
    const part = zonePart(audioBlock("zone", { maxM: 10, volume: 1 }), env);
    part.update?.(at(0));
    expect(sounds).toHaveLength(0);
    expect(part.object.children.length).toBeGreaterThan(0);
    part.dispose();
  });

  it("without its fields (a newer file's view floored) uses the defaults", () => {
    // Why: a lenient read may hand a zone no reach; it still plays, at
    // the default reach and full volume, rather than throwing per frame.
    const { env, sounds } = recordingEnv();
    const part = zonePart(audioBlock("zone"), env);
    part.update?.(at(0));
    expect(sounds[0]?.levels).toEqual([1]);
  });

  // Why: in the editor a 20 m glow covered the view, so every press
  // inside it hit the sound; now only the speaker icon is picked, and a
  // press inside the range is a press on the ground.
  it("in the editor is picked by its icon alone, not by its glow or its range", () => {
    const { env } = recordingEnv("edit");
    const part = zonePart(audioBlock("zone", { maxM: 20 }), env);
    const camera = new PerspectiveCamera(50, 1, 0.1, 5000);
    camera.position.set(0, 1.5, 30);
    camera.lookAt(0, 1.5, 0);
    part.update?.({ seconds: 0, viewer: [0, 1.5, 30], camera });
    part.object.updateMatrixWorld(true);
    const ray = new Raycaster();
    // Straight down inside the range and onto its ring: nothing.
    for (const x of [5, 12, 19.95]) {
      ray.set(new Vector3(x, 10, 0), new Vector3(0, -1, 0));
      expect(ray.intersectObject(part.object, true)).toHaveLength(0);
    }
    // At the icon, from the camera: hit.
    const iconY = SOUND_ICON.liftM + SOUND_ICON.sizeM / 2;
    ray.set(new Vector3(0, iconY, 30), new Vector3(0, 0, -1));
    expect(ray.intersectObject(part.object, true).length).toBeGreaterThan(0);
    part.dispose();
  });

  it("draws its range over the ground in the editor only", () => {
    const names = (mode: "play" | "edit") => {
      const part = zonePart(
        audioBlock("zone", { maxM: 20 }),
        recordingEnv(mode).env,
      );
      const found: string[] = [];
      part.object.traverse((o) => {
        if (o.name !== "") found.push(o.name);
      });
      part.dispose();
      return found;
    };
    expect(names("edit")).toEqual(
      expect.arrayContaining(["sound-range", "sound-icon"]),
    );
    expect(names("play")).not.toContain("sound-range");
    expect(names("play")).not.toContain("sound-icon");
  });

  it("keeps its range line at least 3 px wide on the screen from 5 m to 300 m", () => {
    // Swept: two lenses over two view heights; the line never thinner
    // than RANGE_RING.px nor wider than its cap, and never wider than a
    // small range.
    for (const fovDeg of [50, 70]) {
      for (const heightPx of [600, 844]) {
        const perPx = (2 * Math.tan((fovDeg * Math.PI) / 360)) / heightPx;
        for (const distanceM of [5, 10, 20, 40, 80, 150, 300]) {
          const w = rangeRingWidthM(distanceM, perPx, 20);
          expect(w / (distanceM * perPx)).toBeGreaterThanOrEqual(
            RANGE_RING.px - 1e-9,
          );
          expect(w).toBeGreaterThanOrEqual(RANGE_RING.minWidthM);
          expect(w).toBeLessThanOrEqual(RANGE_RING.maxWidthM);
        }
      }
    }
    expect(rangeRingWidthM(300, 0.01, 0.5)).toBe(0.5);
    expect(rangeRingWidthM(Number.NaN, 0.001, 20)).toBe(RANGE_RING.minWidthM);
    expect(rangeRingWidthM(50, 0, 20)).toBe(RANGE_RING.minWidthM);
  });
});
