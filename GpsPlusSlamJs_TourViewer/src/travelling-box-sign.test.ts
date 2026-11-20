import { describe, expect, it } from "vitest";
import { Group, Mesh, PlaneGeometry, Texture } from "three";

import type { NarrationBox } from "./narration-box.js";
import type { WordsPaintModel } from "./narration-words-paint.js";
import {
  signHideWhy,
  signWordsGrowth,
  signWordsSurface,
  type SignWordsDeps,
} from "./travelling-box-sign.js";
import { plateSizeM, TRAVELLING_BOX_DEFAULTS } from "./travelling-box-rules.js";

const MODEL = {
  layout: { width: 272, height: 108, fontPx: 16, lineHeight: 22 },
  frame: { voiceMs: 0, lit: -1, scroll: 0, scrubbing: false, hint: "" },
} as unknown as WordsPaintModel;

function deps(over: Partial<SignWordsDeps> = {}): SignWordsDeps {
  const calls: string[] = [];
  return {
    id: "text-1",
    sign: {
      wordsPlate: new Mesh(new PlaneGeometry(1, 1)),
      attachWords: (_t, size) => calls.push(`attach ${String(size.widthM)}`),
      detachWords: () => calls.push("detach"),
    },
    box: {
      paintModel: () => MODEL,
      restingRect: () => ({ x: 1, y: 2, w: 3, h: 4 }),
      setGhost: () => undefined,
      setPointer: () => undefined,
      beginPress: () => true,
      movePress: () => undefined,
      endPress: () => undefined,
      state: () => ({ pressing: true }) as ReturnType<NarrationBox["state"]>,
    },
    scale: 2.5,
    travelling: () => true,
    voice: () => true,
    inStation: () => true,
    sheetOpen: () => false,
    ...over,
  };
}

describe("signHideWhy", () => {
  // Why this test matters: the readout and the field log name the first
  // reason only, in the prototype's order; a different order would name
  // the sheet where the voice is missing.
  it("names no voice, then outside the station, then the sheet", () => {
    expect(
      signHideWhy({ voice: false, inStation: false, sheetOpen: true }),
    ).toBe("no voice");
    expect(
      signHideWhy({ voice: true, inStation: false, sheetOpen: true }),
    ).toBe("outside the station");
    expect(signHideWhy({ voice: true, inStation: true, sheetOpen: true })).toBe(
      "sheet open",
    );
    expect(
      signHideWhy({ voice: true, inStation: true, sheetOpen: false }),
    ).toBeNull();
  });
});

describe("signWordsGrowth", () => {
  it("leaves the sign its own growth, or none with the knob off", () => {
    expect(signWordsGrowth(true)).toBeUndefined();
    expect(signWordsGrowth(false)).toBe(1);
  });
});

describe("signWordsSurface", () => {
  // Why: the controller sizes the canvas and hangs the plate anew only
  // when the layout object changes, so the surface must hand back the
  // same object until the box lays out anew, at the painted size.
  it("keeps one layout per box layout, at the canvas size of the scale", () => {
    const s = signWordsSurface(deps());
    const a = s.layout();
    expect(a).toEqual({
      cssW: 272,
      cssH: 108,
      fontPx: 16,
      lineHeightPx: 22,
      canvasW: 680,
      canvasH: 270,
    });
    expect(s.layout()).toBe(a);
    expect(s.id).toBe("words:text-1");
    expect(s.answersTo()).toBe("text-1");
  });

  it("has no layout while the box paints nothing", () => {
    const s = signWordsSurface(
      deps({ box: { ...deps().box, paintModel: () => null } }),
    );
    expect(s.layout()).toBeNull();
    expect(s.paintKey()).toBe("");
  });

  // Why: the plate is the box's shape at one em = 0.136 m; another size
  // would break the side-by-side and the layout e2e.
  it("hangs the plate at the box's shape, and reads the gates by the knob", () => {
    const calls: string[] = [];
    const d = deps();
    const s = signWordsSurface({
      ...d,
      sign: {
        ...d.sign,
        attachWords: (_t, size) =>
          calls.push(`${String(size.widthM)} ${String(size.heightM)}`),
      },
    });
    const l = s.layout();
    if (l === null) throw new Error("no layout");
    s.hang(new Texture(), l);
    const want = plateSizeM(272, 108, 16);
    expect(calls).toEqual([`${String(want.widthM)} ${String(want.heightM)}`]);
    const metrics = { letterPx: 10, letterPxH: 14 } as never;
    expect(s.gates(metrics, TRAVELLING_BOX_DEFAULTS)).toEqual([
      { kind: "letter", px: 10, thr: 12 },
    ]);
    expect(s.pressing()).toBe(true);
    expect(s.restingRect()).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("refuses a words plate that is not a mesh", () => {
    const d = deps();
    expect(() =>
      signWordsSurface({ ...d, sign: { ...d.sign, wordsPlate: new Group() } }),
    ).toThrow(TypeError);
  });
});
