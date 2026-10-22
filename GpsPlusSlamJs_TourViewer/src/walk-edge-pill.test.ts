import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  WALK_EDGE_PILL_BAND_DEG,
  WALK_EDGE_PILL_SHARE,
  walkEdgePill,
  wireWalkEdgePill,
  type WalkEdgePill,
  type WalkEdgePillInput,
} from "./walk-edge-pill";

/**
 * Why these tests matter: the edge pill is the one cue that names the
 * station the walk is about while it is off screen. It must show only
 * when every part of what it says is true - a station in focus, a
 * distance the guide shows, a heading to tell "off screen" by - and get
 * out of the way of the list and the story card. A phone's jitter must
 * not blink it at the screen's edge or flip it from side to side straight
 * behind.
 */

const FOV = 64;
const EDGE = (FOV / 2) * WALK_EDGE_PILL_SHARE;

function input(over: Partial<WalkEdgePillInput> = {}): WalkEdgePillInput {
  return {
    title: "The well",
    distanceM: 34.4,
    angleDeg: 90,
    word: "right",
    fovDeg: FOV,
    listOpen: false,
    storyPlaying: false,
    ...over,
  };
}

describe("walkEdgePill: when it shows", () => {
  it("shows for a focus off screen with a distance and a heading, on its side", () => {
    expect(walkEdgePill(input())).toEqual({
      side: "right",
      text: "The well - 34 m",
    });
    expect(walkEdgePill(input({ angleDeg: -60, word: "left" }))).toEqual({
      side: "left",
      text: "The well - 34 m",
    });
  });

  it("says behind you when the direction word does", () => {
    expect(walkEdgePill(input({ angleDeg: 170, word: "behind" }))?.text).toBe(
      "The well - 34 m, behind you",
    );
    // The word decides, not the angle: its own band holds it.
    expect(walkEdgePill(input({ angleDeg: 138, word: "right" }))?.text).toBe(
      "The well - 34 m",
    );
  });

  it("hides on screen: inside the edge share of half the field of view", () => {
    expect(walkEdgePill(input({ angleDeg: EDGE - 0.1 }))).toBeNull();
    expect(walkEdgePill(input({ angleDeg: -(EDGE - 0.1) }))).toBeNull();
    expect(walkEdgePill(input({ angleDeg: EDGE + 0.1 }))).not.toBeNull();
  });

  it("hides without a focus, a distance or a heading, with the list open, and while a story plays", () => {
    expect(walkEdgePill(input({ title: null }))).toBeNull();
    expect(walkEdgePill(input({ distanceM: null }))).toBeNull();
    expect(walkEdgePill(input({ angleDeg: null, word: null }))).toBeNull();
    expect(walkEdgePill(input({ listOpen: true }))).toBeNull();
    expect(walkEdgePill(input({ storyPlaying: true }))).toBeNull();
  });

  it("refuses input that is no number", () => {
    expect(walkEdgePill(input({ distanceM: Number.NaN }))).toBeNull();
    expect(
      walkEdgePill(input({ angleDeg: Number.POSITIVE_INFINITY })),
    ).toBeNull();
    expect(walkEdgePill(input({ fovDeg: 0 }))).toBeNull();
    expect(walkEdgePill(input({ fovDeg: Number.NaN }))).toBeNull();
  });

  it("writes whole metres", () => {
    expect(walkEdgePill(input({ distanceM: 1234.6 }))?.text).toBe(
      "The well - 1.2 km",
    );
    expect(walkEdgePill(input({ distanceM: 7.6 }))?.text).toBe(
      "The well - 8 m",
    );
  });
});

describe("walkEdgePill: the band against jitter", () => {
  it("stays until the angle is back inside the edge by the band", () => {
    const shown = walkEdgePill(input({ angleDeg: EDGE + 1 }));
    expect(shown).not.toBeNull();
    expect(
      walkEdgePill(
        input({ angleDeg: EDGE - WALK_EDGE_PILL_BAND_DEG + 0.5 }),
        shown,
      ),
    ).not.toBeNull();
    expect(
      walkEdgePill(
        input({ angleDeg: EDGE - WALK_EDGE_PILL_BAND_DEG - 0.5 }),
        shown,
      ),
    ).toBeNull();
  });

  it("keeps its side across straight behind until the angle is past it by the band", () => {
    const right = walkEdgePill(input({ angleDeg: 178, word: "behind" }));
    expect(right?.side).toBe("right");
    expect(
      walkEdgePill(input({ angleDeg: -178, word: "behind" }), right)?.side,
    ).toBe("right");
    expect(
      walkEdgePill(
        input({
          angleDeg: -(180 - WALK_EDGE_PILL_BAND_DEG - 0.5),
          word: "behind",
        }),
        right,
      )?.side,
    ).toBe("left");
  });

  it("property: a heading jittering by less than the band never toggles the pill nor flips its side", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.array(
          fc.double({
            min: -(WALK_EDGE_PILL_BAND_DEG / 2) + 0.01,
            max: WALK_EDGE_PILL_BAND_DEG / 2 - 0.01,
            noNaN: true,
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (centre, jitter) => {
          // Settle on the centre once (two frames: the band's memory).
          let shown: WalkEdgePill | null = walkEdgePill(
            input({ angleDeg: centre }),
          );
          shown = walkEdgePill(input({ angleDeg: centre }), shown);
          const first = shown;
          for (const j of jitter) {
            shown = walkEdgePill(input({ angleDeg: centre + j }), shown);
            // Shown once, it stays shown and on its side (a pill that was
            // not shown may appear on the outward swing, never go away
            // after: it is held by the band from then on).
            const held = first === null || shown?.side === first.side;
            expect(held, `${String(centre)} + ${String(j)}`).toBe(true);
          }
        },
      ),
    );
  });
});

describe("wireWalkEdgePill", () => {
  function fakeDom() {
    const writes = { text: 0, side: 0, arrow: 0 };
    let text = "";
    let d: string | null = null;
    const dataset: Record<string, string> = {};
    const dom = {
      root: {
        hidden: true,
        dataset: new Proxy(dataset, {
          set(target, key: string, value: string) {
            writes.side += 1;
            target[key] = value;
            return true;
          },
        }) as DOMStringMap,
      },
      text: {
        get textContent() {
          return text;
        },
        set textContent(v: string) {
          writes.text += 1;
          text = v;
        },
      },
      arrow: {
        getAttribute: () => d,
        setAttribute: (_: string, v: string) => {
          writes.arrow += 1;
          d = v;
        },
      },
    };
    return { dom, writes, read: () => ({ text, d, side: dataset["side"] }) };
  }

  it("writes the pill, then only what changed, and hides it", () => {
    const { dom, writes, read } = fakeDom();
    const view = wireWalkEdgePill(dom);
    expect(view.render(input())).not.toBeNull();
    expect(dom.root.hidden).toBe(false);
    expect(read()).toEqual({
      text: "The well - 34 m",
      d: "M5 2l5 5-5 5",
      side: "right",
    });
    // The next frame says the same: nothing is written again.
    view.render(input({ angleDeg: 91 }));
    expect(writes).toEqual({ text: 1, side: 1, arrow: 1 });
    view.render(input({ angleDeg: -90, word: "left" }));
    expect(read().side).toBe("left");
    expect(read().d).toBe("M9 2L4 7l5 5");
    view.render(null);
    expect(dom.root.hidden).toBe(true);
  });
});
