/**
 * Why these tests matter: a decoded picture can arrive stored upside down
 * (decoded pre-flipped for the GPU, its texture marked not to flip
 * again), and a canvas draws an image as stored. The card's thumbnail
 * must still show the picture the right way up, and drawing it must not
 * turn the rest of the card over.
 */
import { describe, expect, it } from "vitest";

import { canvasPicturePainters } from "./picture-paint.js";

type Call = readonly [string, ...unknown[]];

/** A document whose canvases record every 2D call, in order. */
function recordingDoc(): { doc: Document; calls: Call[] } {
  const calls: Call[] = [];
  const g = new Proxy<Record<string, unknown>>(
    {},
    {
      get(state, key: string) {
        if (key in state) return state[key];
        return (...args: unknown[]) => {
          calls.push([key, ...args]);
          return key === "measureText" ? { width: 10 } : undefined;
        };
      },
      set(state, key: string, value: unknown) {
        state[key] = value;
        return true;
      },
    },
  );
  const doc = {
    createElement: () => ({ width: 0, height: 0, getContext: () => g }),
  } as unknown as Document;
  return { doc, calls };
}

const IMAGE = { width: 200, height: 100 } as unknown as CanvasImageSource;

function cardCalls(flipped: boolean | undefined): Call[] {
  const { doc, calls } = recordingDoc();
  canvasPicturePainters(doc).card({
    widthM: 0.8,
    heightM: 0.6,
    year: "1902",
    line1: "Walk to the marked spot",
    ppm: 100,
    thumb: {
      image: IMAGE,
      aspect: 0.5,
      ...(flipped === undefined ? {} : { flipped }),
    },
  });
  return calls;
}

describe("the card's thumbnail", () => {
  it("draws a picture stored upside down the right way up, inside its clip", () => {
    const calls = cardCalls(true);
    const names = calls.map((c) => c[0]);
    const draw = names.indexOf("drawImage");
    const save = names.lastIndexOf("save", draw);
    const restore = names.indexOf("restore", draw);
    // pad 4.5 px, thumb 71 x 35.5 px at y = 4.5: mirrored about its middle.
    const between = calls.slice(save, restore);
    expect(between).toContainEqual(["translate", 0, 2 * 4.5 + 35.5]);
    expect(between).toContainEqual(["scale", 1, -1]);
    expect(calls[draw]).toEqual(["drawImage", IMAGE, 4.5, 4.5, 71, 35.5]);
    // The words after it are drawn upright again.
    expect(calls.slice(restore).some((c) => c[0] === "scale")).toBe(false);
  });

  it("draws a picture stored upright as it is", () => {
    for (const flipped of [false, undefined]) {
      const calls = cardCalls(flipped);
      expect(calls.some((c) => c[0] === "scale")).toBe(false);
      expect(calls).toContainEqual(["drawImage", IMAGE, 4.5, 4.5, 71, 35.5]);
    }
  });
});
