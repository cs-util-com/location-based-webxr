/**
 * Why this test matters: the reading sign is how a long text in the
 * `reading` view shows in the square, and a tap on it is the visitor's one
 * way into the whole text. The prototype's sign (a 2.5 m plate on a stem,
 * its centre 2.05 m up, an amber ring on the ground; the over-line
 * "READ · N MIN", a serif title of at most two lines, "Tap to open the
 * text") is what the owner chose, so these pin its numbers and words
 * without a browser - a recording 2D context stands in for the canvas -
 * and that a tap reaches only a shown sign, and opens the sheet with the
 * station's line above the title.
 */

import {
  Group,
  PerspectiveCamera,
  Vector3,
  type Mesh,
  type Object3D,
} from "three";
import { describe, expect, it } from "vitest";

import {
  buildReadingSign,
  drawReadingSign,
  READING_SIGN,
  READING_SIGN_HEIGHT_M,
  READING_SIGN_HINT,
  readingSheetContent,
  readingSignOverLine,
  readingSignUnderTap,
  shownReadingSignUnderTap,
  turnToward,
  type ReadingSignHandle,
  type SignContext,
} from "./reading-sign";

interface Drawn {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly fill: string;
}

/** A 2D context that records its text; every character is 30 px wide. */
function recorder() {
  const texts: Drawn[] = [];
  const g = {
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    strokeStyle: "" as string | CanvasGradient | CanvasPattern,
    lineWidth: 1,
    font: "",
    letterSpacing: "0px",
    clearRect() {},
    beginPath() {},
    roundRect() {},
    arc() {},
    fill() {},
    stroke() {},
    fillText(text: string, x: number, y: number) {
      texts.push({
        text,
        x,
        y,
        font: g.font,
        fill: typeof g.fillStyle === "string" ? g.fillStyle : "pattern",
      });
    },
    measureText(text: string) {
      return { width: text.length * 30 } as TextMetrics;
    },
  };
  return { g: g as unknown as SignContext, texts };
}

describe("drawReadingSign", () => {
  it("draws the over-line, the title and the hint where the prototype does", () => {
    const { g, texts } = recorder();
    drawReadingSign(g, { title: "The guild house", minutes: 4 });
    expect(texts).toEqual([
      expect.objectContaining({ text: "READ  ·  4 MIN", x: 218, y: 112 }),
      expect.objectContaining({ text: "The guild house", x: 216, y: 210 }),
      expect.objectContaining({ text: READING_SIGN_HINT, x: 218, y: 352 }),
    ]);
    expect(texts[1]?.font).toMatch(/^600 64px .*serif$/);
    expect(texts[0]?.fill).toBe("#f2b45a");
    expect(READING_SIGN_HINT).toBe("Tap to open the text");
  });

  it("wraps a long title to two lines 74 px apart, starting higher, and drops the rest", () => {
    const { g, texts } = recorder();
    // 30 px a character, 760 px a line: 25 characters fit.
    drawReadingSign(g, {
      title:
        "The old weighing house and its scales by the river gate of the town",
      minutes: 1,
    });
    const title = texts.filter((t) => t.y !== 112 && t.y !== 352);
    expect(title.map((t) => t.y)).toEqual([188, 262]);
    for (const line of title) {
      expect(line.text.length * 30).toBeLessThanOrEqual(760);
    }
  });

  it("an empty title reads Untitled", () => {
    const { g, texts } = recorder();
    drawReadingSign(g, { title: "  ", minutes: 1 });
    expect(texts.map((t) => t.text)).toContain("Untitled");
  });

  it("the over-line names the minutes", () => {
    expect(readingSignOverLine(10)).toBe("READ  ·  10 MIN");
  });
});

describe("buildReadingSign", () => {
  it("stands on the ground: the plate 2.5 m wide at the canvas's aspect, its centre 2.05 m up", () => {
    const sign = buildReadingSign(null);
    expect(sign.root.name).toBe("reading-sign");
    expect(READING_SIGN.widthM).toBe(2.5);
    expect(READING_SIGN_HEIGHT_M).toBeCloseTo((2.5 * 420) / 1024, 6);
    expect(sign.plate.position.y).toBe(2.05);
    const params = (
      sign.plate.geometry as { parameters?: { width: number; height: number } }
    ).parameters;
    expect(params).toEqual({
      width: 2.5,
      height: READING_SIGN_HEIGHT_M,
      widthSegments: 1,
      heightSegments: 1,
    });
    // The stem reaches from the ground to the plate's lower edge.
    const stem = sign.root.children.find(
      (c) => (c as Mesh).geometry?.type === "CylinderGeometry",
    ) as Mesh | undefined;
    const height = (stem?.geometry as { parameters?: { height: number } })
      ?.parameters?.height;
    expect(height).toBeCloseTo(2.05 - READING_SIGN_HEIGHT_M / 2, 6);
    expect(stem?.position.y).toBeCloseTo((height ?? 0) / 2, 6);
    sign.dispose();
  });

  it("the plate turns about the upright axis to face the viewer, from any side", () => {
    const sign = buildReadingSign(null);
    const plate = sign.plate;
    for (const [x, z, yaw] of [
      [0, 5, 0],
      [5, 0, Math.PI / 2],
      [0, -5, Math.PI],
      [-5, 0, -Math.PI / 2],
    ] as const) {
      turnToward(plate, new Vector3(x, 1.6, z));
      expect(Math.abs(Math.cos(plate.rotation.y - yaw) - 1)).toBeLessThan(1e-9);
      expect(plate.rotation.x).toBe(0);
      expect(plate.rotation.z).toBe(0);
      // Its face (local +z) points at the viewer.
      const face = new Vector3(0, 0, 1).applyEuler(plate.rotation);
      expect(face.x).toBeCloseTo(Math.sign(x), 9);
      expect(face.z).toBeCloseTo(Math.sign(z), 9);
    }
    sign.dispose();
  });

  it("turns as it is drawn, toward the camera, in its parent's frame", () => {
    const sign = buildReadingSign(null);
    const parent = new Group();
    parent.rotation.y = Math.PI / 2; // the pose turns the sign a quarter
    parent.add(sign.root);
    parent.updateMatrixWorld(true);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.6, 6);
    camera.updateMatrixWorld(true);
    sign.plate.onBeforeRender(
      null as never,
      null as never,
      camera,
      null as never,
      null as never,
      null as never,
    );
    const face = new Vector3(0, 0, 1).transformDirection(
      sign.plate.matrixWorld,
    );
    expect(face.x).toBeCloseTo(0, 6);
    expect(face.z).toBeGreaterThan(0.99);
    sign.dispose();
  });
});

function handle(id: string, parent: Object3D): ReadingSignHandle {
  const sign = buildReadingSign(null);
  sign.root.userData["objectId"] = id;
  parent.add(sign.root);
  return {
    block: { id, title: `Title ${id}`, body: "Words." },
    object: sign.root,
    plate: sign.plate,
    dispose: () => sign.dispose(),
  };
}

describe("shownReadingSignUnderTap", () => {
  function scene() {
    const root = new Group();
    const shown = new Group();
    shown.name = "station-content:square";
    const hidden = new Group();
    hidden.name = "station-content:market";
    hidden.visible = false;
    root.add(shown, hidden);
    return { root, shown, hidden };
  }

  it("offers only the shown signs to the pick, and returns the one under the tap", () => {
    const s = scene();
    const a = handle("a", s.shown);
    const b = handle("b", s.hidden);
    const offered: string[][] = [];
    const hit = shownReadingSignUnderTap(
      s.root,
      (targets) => {
        offered.push([...targets.keys()]);
        expect(targets.get("a")).toBe(a.plate);
        return "a";
      },
      "tap",
      [a, b],
    );
    expect(offered).toEqual([["a"]]);
    expect(hit).toBe(a);
  });

  it("no sign for a hidden one, nothing under the tap, or no scene", () => {
    const s = scene();
    const b = handle("b", s.hidden);
    let picks = 0;
    const pick = () => {
      picks += 1;
      return "b";
    };
    expect(shownReadingSignUnderTap(s.root, pick, "tap", [b])).toBeNull();
    expect(shownReadingSignUnderTap(null, pick, "tap", [b])).toBeNull();
    expect(picks).toBe(0);
    const a = handle("a", s.shown);
    expect(shownReadingSignUnderTap(s.root, () => null, "tap", [a])).toBeNull();
  });
});

describe("readingSignUnderTap", () => {
  it("a pick naming an id no sign has gives none", () => {
    const root = new Group();
    const a = handle("a", root);
    expect(readingSignUnderTap([a], () => "zz", 0)).toBeNull();
    expect(readingSignUnderTap([], () => "a", 0)).toBeNull();
  });
});

describe("readingSheetContent", () => {
  const stations = [
    { title: "Old square", blocks: [{ id: "x" }] },
    { title: "Market", blocks: [{ id: "y" }, { id: "text" }] },
  ];

  it("names the station holding the text and its place in the tour", () => {
    expect(
      readingSheetContent(stations, {
        id: "text",
        title: "The hall",
        body: "It stood.",
      }),
    ).toEqual({
      over: "Market · Station 2",
      title: "The hall",
      body: "It stood.",
    });
  });

  it("an untitled station is named by its place alone", () => {
    expect(
      readingSheetContent([{ blocks: [{ id: "t" }] }], {
        id: "t",
        title: "T",
        body: "B",
      }).over,
    ).toBe("Station 1");
  });

  it("no station holds it: no line above the title", () => {
    expect(
      readingSheetContent(stations, { id: "zz", title: "T", body: "B" }).over,
    ).toBe("");
  });
});
