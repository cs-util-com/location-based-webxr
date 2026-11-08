/**
 * Why this test matters: the reading stand is the one long-text view that
 * stands in the square, and it keeps its pose. The prototype's numbers
 * (a 1.2 x 0.9 m page leaning back 16 degrees, its centre 1.32 m up, legs
 * reaching the ground) and its page (the header, the title, nine lines of
 * the current paragraph with the sentence highlighted, the footer that
 * says how to turn) are what the owner chose; these tests pin them without
 * a browser - a recording 2D context stands in for the canvas. The e2e
 * (`playwright-tests/lectern-check.spec.js`) checks the drawn stand on
 * the page at three viewports.
 */

import {
  Box3,
  Mesh,
  type MeshBasicMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyzeLecternText,
  LECTERN_PAGE,
  wrapLecternParagraph,
} from "./lectern-page";
import {
  buildLecternStand,
  drawLecternPage,
  LECTERN_PAGE_ANISOTROPY,
  LECTERN_STAND,
  mountLectern,
} from "./lectern-view";
import { mountedWorldParts } from "./world-part";

interface Drawn {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fill: string;
  readonly font: string;
}

/** A 2D context that records its text and its filled rounded rects;
 *  every character is 19 px wide. */
function recorder() {
  const texts: Drawn[] = [];
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] =
    [];
  let pending: { x: number; y: number; w: number; h: number } | null = null;
  const g = {
    fillStyle: "",
    font: "",
    letterSpacing: "0px",
    clearRect() {},
    fillRect() {},
    beginPath() {
      pending = null;
    },
    roundRect(x: number, y: number, w: number, h: number) {
      pending = { x, y, w, h };
    },
    rect(x: number, y: number, w: number, h: number) {
      pending = { x, y, w, h };
    },
    fill() {
      if (pending !== null) rects.push({ ...pending, fill: g.fillStyle });
    },
    measureText: (s: string) => ({ width: s.length * 19 }),
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, fill: g.fillStyle, font: g.font });
    },
  };
  return { g: g as unknown as CanvasRenderingContext2D, texts, rects };
}

const TWO = "First one is here. Second one follows it.\n\nThe next paragraph.";

describe("drawLecternPage", () => {
  it("draws the header, the title, the lines and the footer where the prototype does", () => {
    const { g, texts } = recorder();
    drawLecternPage(g, {
      title: "The Guild House",
      text: analyzeLecternText(TWO),
      sentence: 1,
    });
    expect(texts[0]).toMatchObject({ text: "PARAGRAPH 1 OF 2", x: 62, y: 70 });
    expect(texts[1]).toMatchObject({ text: "The Guild House", x: 60, y: 122 });
    const words = texts.slice(2, -1);
    expect(words.map((w) => w.text).join(" ")).toBe(
      "First one is here. Second one follows it.",
    );
    expect(words.every((w) => w.y === LECTERN_PAGE.firstBaselinePx)).toBe(true);
    expect(texts.at(-1)).toMatchObject({
      text: "tap the page to turn  ·  2 / 3",
      x: 62,
      y: 738,
    });
  });

  it("the current sentence is brightest and highlighted, what came before is dimmer than what follows", () => {
    const { g, texts, rects } = recorder();
    drawLecternPage(g, {
      title: "T",
      text: analyzeLecternText(TWO),
      sentence: 1,
    });
    const fill = (word: string) => texts.find((t) => t.text === word)?.fill;
    expect(fill("First")).toBe("#7f7a71");
    expect(fill("Second")).toBe("#fdfaf3");
    expect(fill("it.")).toBe("#fdfaf3");
    const highlight = rects.find((r) => r.fill === "rgba(242,180,90,0.17)");
    // "Second" starts after "First one is here. " (19 characters).
    expect(highlight).toMatchObject({
      x: 62 + 19 * 19 - 8,
      y: 206 - 38,
      h: 52,
    });
    // The footer's track, empty: there is no voice to show progress of.
    expect(rects.filter((r) => r.y === 690)).toHaveLength(1);
  });

  it("an out-of-range sentence is clamped, and an empty text draws only the frame", () => {
    const { g, texts } = recorder();
    drawLecternPage(g, {
      title: "T",
      text: analyzeLecternText(TWO),
      sentence: 99,
    });
    expect(texts[0]?.text).toBe("PARAGRAPH 2 OF 2");
    expect(texts.at(-1)?.text).toBe("tap the page to turn  ·  3 / 3");
    const empty = recorder();
    drawLecternPage(empty.g, {
      title: "T",
      text: analyzeLecternText(""),
      sentence: 0,
    });
    expect(empty.texts.map((t) => t.text)).toEqual([
      "PARAGRAPH 1 OF 1",
      "T",
      "tap the page to turn  ·  0 / 0",
    ]);
  });

  // Why: the page shows nine lines of a paragraph, 54 px apart from the
  // 206 px baseline (the prototype's); a paragraph longer than that must
  // be cut at nine rows, never drawn over the footer, and a window a turn
  // moved inside a long sentence starts where the turn said.
  it("draws at most nine lines of a long paragraph, 54 px apart, from the window's first line", () => {
    const long = Array.from(
      { length: 40 },
      (_, i) => `Line${String(i).padStart(2, "0")} is here.`,
    ).join(" ");
    const text = analyzeLecternText(long);
    const lines = wrapLecternParagraph(text, 0, (w) => w.length * 19);
    expect(lines.length).toBeGreaterThan(LECTERN_PAGE.rows);
    const rows = (start: number | null) => {
      const { g, texts } = recorder();
      drawLecternPage(g, { title: "T", text, sentence: 0, start });
      const words = texts.slice(2, -1);
      return {
        first: words[0]?.text,
        ys: [...new Set(words.map((w) => w.y))],
      };
    };
    const opened = rows(null);
    expect(opened.ys).toEqual(
      Array.from({ length: 9 }, (_, r) => 206 + r * 54),
    );
    expect(opened.first).toBe("Line00");
    const moved = rows(3);
    expect(moved.ys).toHaveLength(9);
    expect(moved.first).toBe(lines[3]?.[0]?.text);
  });

  it("a long title is cut with an ellipsis to the line's width", () => {
    const { g, texts } = recorder();
    drawLecternPage(g, {
      title: "A".repeat(80),
      text: analyzeLecternText(TWO),
      sentence: 0,
    });
    const title = texts[1]?.text ?? "";
    expect(title.endsWith("…")).toBe(true);
    expect(title.length * 19).toBeLessThanOrEqual(LECTERN_PAGE.lineWidthPx);
  });
});

describe("buildLecternStand", () => {
  const stand = buildLecternStand(null);
  stand.root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(stand.root);

  it("stands on the ground, the page's centre 1.32 m up, as wide as the board", () => {
    expect(box.min.y).toBeCloseTo(0, 6);
    const centre = new Vector3();
    stand.page.getWorldPosition(centre);
    expect(centre.y).toBeCloseTo(LECTERN_STAND.pageCentreM, 6);
    expect(box.max.x - box.min.x).toBeCloseTo(
      LECTERN_STAND.pageWidthM + 0.08,
      6,
    );
  });

  it("the page leans back 16 degrees and faces local +z, so the stand keeps its pose's facing", () => {
    const normal = new Vector3(0, 0, 1).transformDirection(
      stand.page.matrixWorld,
    );
    expect(normal.z).toBeGreaterThan(0.9);
    expect(normal.y).toBeCloseTo(Math.sin((16 * Math.PI) / 180), 6);
    expect(normal.x).toBeCloseTo(0, 6);
  });

  it("the legs reach from the ground to the board's lower edge", () => {
    const legs = stand.root.children.filter(
      (c): c is Mesh =>
        c instanceof Mesh && c.position.x !== 0 && c.position.y > 0.05,
    );
    expect(legs).toHaveLength(2);
    const tilt = (16 * Math.PI) / 180;
    const bottom = 1.32 - (Math.cos(tilt) * 0.9) / 2;
    for (const leg of legs) {
      const b = new Box3().setFromObject(leg);
      expect(b.min.y).toBeCloseTo(0, 6);
      expect(b.max.y).toBeCloseTo(bottom, 6);
    }
    stand.dispose();
  });
});

// Why: a mounted stand is a world part like any kind's: its page (not its
// legs) takes the tap and the tap turns it, it sits in the one mounted set
// while it stands, and seen at a slant from the square its page would blur
// without the prototype's anisotropy (the renderer's maximum; three
// clamps a texture's to it).
describe("mountLectern", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a world part whose page takes the tap and turns, mounted until disposed", () => {
    const { g } = recorder();
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => g }),
    });
    const stand = mountLectern({ id: "gate", title: "The Gate", body: TWO });
    expect(stand.tapTarget).toBe(stand.page);
    expect(stand.object.userData["objectId"]).toBe("gate");
    expect(mountedWorldParts()).toContain(stand);
    const map = (stand.page as Mesh).material as MeshBasicMaterial;
    expect(map.map?.colorSpace).toBe(SRGBColorSpace);
    expect(LECTERN_PAGE_ANISOTROPY).toBe(16);
    expect(map.map?.anisotropy).toBe(LECTERN_PAGE_ANISOTROPY);
    const before = stand.sentence();
    stand.tap();
    expect(stand.sentence()).not.toBe(before);
    stand.dispose();
    expect(mountedWorldParts()).not.toContain(stand);
    stand.dispose();
  });
});
