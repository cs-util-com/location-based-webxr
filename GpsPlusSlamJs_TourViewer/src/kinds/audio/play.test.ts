import { describe, expect, it } from "vitest";

import { worldPartOf } from "../../play-kinds.js";
import {
  audioBlock,
  recordingEnv,
} from "../../test-support/audio-world-env.js";

describe("an audio item through the world door", () => {
  it("stands a zone for `zone`, a circle for `spot` and nothing for a card", () => {
    // Why: the view alone decides the behaviour (no separate mode field);
    // a story's card stays a card and must not also sound in the world.
    const { env } = recordingEnv();
    const zone = worldPartOf(audioBlock("zone", { maxM: 20, volume: 1 }), env);
    const spot = worldPartOf(audioBlock("spot", { radiusM: 6 }), env);
    const card = worldPartOf(audioBlock("card", {}), env);
    expect(zone).not.toBeNull();
    expect(zone?.tapTarget).toBeUndefined();
    expect(spot?.tapTarget).toBeDefined();
    expect(card).toBeNull();
    zone?.dispose();
    spot?.dispose();
  });
});
