/**
 * Why this test matters: the renderer draws a pin as a label itself and
 * sends every other short-text view through this door; a view that went
 * missing here would stand nothing in the world.
 */
import { describe, expect, it } from "vitest";

import { worldEnv } from "../../world-part.js";
import { shortTextWorld } from "./world.js";

const env = worldEnv("edit", [], () => Promise.reject(new Error("none")));
const of = (view: string) =>
  shortTextWorld(
    {
      id: "t",
      kind: "shortText",
      view,
      caption: "Gate",
      pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    } as Parameters<typeof shortTextWorld>[0],
    env,
  );

describe("a short text through the world door", () => {
  it("stands as a sign, an edge hint or a ground arrow, and as nothing in a pin or a card", () => {
    expect(of("sign")?.object.name).toBe("short-text-sign");
    expect(of("edgeHint")?.object.name).toBe("short-text-edge-hint");
    expect(of("ground")?.object.name).toBe("short-text-ground");
    expect(of("pin")).toBeNull();
    expect(of("card")).toBeNull();
  });
});
