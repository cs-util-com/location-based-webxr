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

import { Box3, Mesh, Vector3, type Object3D } from "three";
import { describe, expect, it } from "vitest";

import { analyzeLecternText, LECTERN_PAGE } from "./lectern-page";
import {
  buildLecternStand,
  drawLecternPage,
  LECTERN_STAND,
  turnLecternUnderTap,
  type LecternHandle,
} from "./lectern-view";

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

describe("turnLecternUnderTap", () => {
  function fake(id: string): LecternHandle & { turns: number } {
    const page = { name: id } as unknown as Object3D;
    const h = {
      blockId: id,
      object: page,
      page,
      turns: 0,
      sentence: () => h.turns,
      turn() {
        h.turns += 1;
      },
      dispose() {},
    };
    return h;
  }

  it("turns the stand whose page is under the tap, and only that one", () => {
    const a = fake("a");
    const b = fake("b");
    const seen: string[][] = [];
    const turned = turnLecternUnderTap(
      [a, b],
      (targets) => {
        seen.push([...targets.keys()]);
        expect(targets.get("b")).toBe(b.page);
        return "b";
      },
      null,
    );
    expect(turned).toBe(true);
    expect([a.turns, b.turns]).toEqual([0, 1]);
    expect(seen).toEqual([["a", "b"]]);
  });

  it("a tap on nothing, or with no stand, turns none and says so", () => {
    const a = fake("a");
    expect(turnLecternUnderTap([a], () => null, null)).toBe(false);
    expect(turnLecternUnderTap([a], () => "other", null)).toBe(false);
    let asked = false;
    expect(
      turnLecternUnderTap(
        [],
        () => {
          asked = true;
          return "a";
        },
        null,
      ),
    ).toBe(false);
    expect(asked).toBe(false);
    expect(a.turns).toBe(0);
  });
});
