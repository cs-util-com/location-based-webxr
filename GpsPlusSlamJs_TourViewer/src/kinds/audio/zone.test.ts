import { describe, expect, it } from "vitest";

import {
  audioBlock,
  recordingEnv,
} from "../../test-support/audio-world-env.js";
import { zonePart } from "./zone.js";

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
});
