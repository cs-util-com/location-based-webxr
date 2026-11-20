/**
 * Why this test matters: the reading sign is how a long text in the
 * `reading` view shows in the square, and a tap on it is the visitor's one
 * way into the whole text. The prototype's sign (a 2.5 m plate on a stem,
 * its centre 2.05 m up, an amber ring on the ground; the over-line
 * "READ · N MIN", a serif title of at most two lines, "Tap to open the
 * text") is the chosen look, so these pin its numbers and words
 * without a browser - a recording 2D context stands in for the canvas -
 * and that a tap reaches only a shown sign, and opens the sheet with the
 * station's line above the title.
 */

import {
  Box3,
  Group,
  type Mesh,
  type MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Texture,
  Vector3,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildReadingSign,
  drawReadingSign,
  READING_SIGN,
  READING_SIGN_HEIGHT_M,
  READING_SIGN_HINT,
  readingSheetContent,
  mountReadingSign,
  readingSignOverLine,
  READING_SIGN_VOICE_WORDS,
  turnToward,
  type SignContext,
} from "./reading-sign";
import { pickObject } from "./object-pick";
import { signGrowth, TRAVEL_PLATE } from "./travelling-box-rules";
import { mountedWorldParts, tapShownWorldPart } from "./world-part";

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
    const stem = sign.grow.children.find(
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
    const plate = sign.turn;
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

// Why: a mounted sign is a world part like any kind's: its plate takes
// the tap and the tap opens its text where the page says (the reading
// sheet); a page with no sheet (the 3D editor) gets a sign that takes no
// tap. It sits in the one mounted set while it stands.
describe("mountReadingSign", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCanvas(): void {
    const { g } = recorder();
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => g }),
    });
  }

  const block = { id: "guild", title: "The guild house", body: "Words." };

  it("opens its text on a tap of its plate, mounted until disposed", () => {
    stubCanvas();
    const opened: unknown[] = [];
    const sign = mountReadingSign(block, (b) => opened.push(b));
    expect(sign.tapTarget).toBe(
      sign.object.getObjectByName("reading-sign-plate"),
    );
    expect(sign.object.userData["objectId"]).toBe("guild");
    expect(mountedWorldParts()).toContain(sign);
    sign.tap?.();
    expect(opened).toEqual([block]);
    sign.dispose();
    expect(mountedWorldParts()).not.toContain(sign);
    sign.dispose();
  });

  it("takes no tap on a page with no sheet", () => {
    stubCanvas();
    const sign = mountReadingSign(block);
    expect(sign.tap).toBeUndefined();
    sign.dispose();
  });
});

describe("readingSheetContent", () => {
  const block = {
    kind: "shortText",
    view: "pin",
    caption: "A pin",
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  } as const;
  const stations = [
    { title: "Old square", children: [{ ...block, id: "x" }] },
    {
      title: "Market",
      children: [
        { ...block, id: "y" },
        { ...block, id: "text" },
      ],
    },
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
      readingSheetContent([{ children: [{ ...block, id: "t" }] }], {
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

// Why: a sign with a voice says so on its face, in the prototype's words,
// and the chip follows the voice. The face is a 1024 x 420 texture, so it
// is repainted (and uploaded) only when the state changes, never per frame.
describe("the voice chip", () => {
  it("names the voice's state at the bottom right, and nothing without a voice", () => {
    const { g, texts } = recorder();
    drawReadingSign(g, { title: "T", minutes: 1, voice: "playing" });
    // 30 px a character: "Speaking" is 240 px, the chip 82 px wider, its
    // right edge 60 px in from the canvas's.
    expect(texts.at(-1)).toEqual(
      expect.objectContaining({
        text: "Speaking",
        x: 1024 - 60 - 322 + 56,
        y: 369,
      }),
    );
    expect(READING_SIGN_VOICE_WORDS).toEqual({
      idle: "Has a voice",
      playing: "Speaking",
      paused: "Paused",
      ended: "Heard to the end",
    });
    const none = recorder();
    drawReadingSign(none.g, { title: "T", minutes: 1 });
    expect(none.texts.map((t) => t.text)).not.toContain("Has a voice");
  });
});

// Why: the words plate hangs under the sign, turns with it and grows with
// it, and none of that may break what the sign already does. A tap below
// a sign must not open its sheet (three's ray ignores visibility, so the
// plate must not sit under the tap target); the renderer's scale on the
// root (a scaled folder) must survive the growth; and the plate's top
// edge keeps its gap to the sign.
describe("the words plate", () => {
  const SIZE = { widthM: 2.312, heightM: 0.918 };
  const lowerEdge = READING_SIGN.centreM - READING_SIGN_HEIGHT_M / 2;

  function seen(x: number, y: number, z: number) {
    return { seconds: 0, viewer: [x, y, z] as const };
  }

  it("is a sibling of the tap target in the turning group, under the sign", () => {
    const sign = buildReadingSign(null);
    expect(sign.root.children).toEqual([sign.grow]);
    expect(sign.grow.children).toContain(sign.turn);
    expect(sign.turn.children).toEqual([sign.plate]);
    const texture = new Texture();
    sign.attachWords(texture, SIZE);
    expect(sign.turn.children).toEqual([sign.plate, sign.words]);
    expect(sign.plate.getObjectByName("reading-sign-words")).toBeUndefined();
    expect(sign.words.scale.toArray()).toEqual([SIZE.widthM, SIZE.heightM, 1]);
    // Its top edge 0.07 m under the sign's lower edge, 0.04 m in front.
    expect(sign.words.position.y + SIZE.heightM / 2).toBeCloseTo(
      lowerEdge - TRAVEL_PLATE.gapM,
      9,
    );
    expect(sign.words.position.z).toBe(TRAVEL_PLATE.frontM);
    expect(sign.words.position.x).toBe(0);
    expect(sign.words.renderOrder).toBeGreaterThan(sign.plate.renderOrder);
    const material = sign.words.material as MeshBasicMaterial;
    expect(material.map).toBe(texture);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
    sign.detachWords();
    expect(sign.turn.children).toEqual([sign.plate]);
    sign.dispose();
  });

  it("turns with the sign, by update and as either plate is drawn", () => {
    const sign = buildReadingSign(null);
    sign.attachWords(new Texture(), SIZE);
    sign.update(seen(5, 1.6, 0));
    sign.root.updateMatrixWorld(true);
    const face = () =>
      new Vector3(0, 0, 1).transformDirection(sign.words.matrixWorld);
    expect(face().x).toBeCloseTo(1, 6);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.6, -6);
    camera.updateMatrixWorld(true);
    sign.words.onBeforeRender(
      null as never,
      null as never,
      camera,
      null as never,
      null as never,
      null as never,
    );
    expect(face().z).toBeLessThan(-0.99);
    sign.dispose();
  });

  it("grows with the distance only while the words are attached", () => {
    const sign = buildReadingSign(null);
    sign.update(seen(0, 1.6, 9));
    // The editor never attaches words, so its frames never grow a sign.
    expect(sign.grow.scale.x).toBe(1);
    sign.attachWords(new Texture(), SIZE);
    for (const d of [3, 6.3, 9, 40]) {
      sign.update(seen(0, 1.6, d));
      expect(sign.grow.scale.toArray()).toEqual(Array(3).fill(signGrowth(d)));
    }
    sign.detachWords();
    expect(sign.grow.scale.x).toBe(1);
    sign.dispose();
  });

  // Why: the growth is a knob (off for a field test of the plain sign);
  // a growth the caller passes is the one the sign takes, and a bad one
  // grows nothing.
  it("takes the growth its caller passes while the words are attached", () => {
    const sign = buildReadingSign(null);
    sign.attachWords(new Texture(), SIZE);
    sign.update({ viewer: [0, 1.6, 9], growth: 1 });
    expect(sign.grow.scale.x).toBe(1);
    sign.update({ viewer: [0, 1.6, 9], growth: 1.25 });
    expect(sign.grow.scale.x).toBe(1.25);
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      sign.update({ viewer: [0, 1.6, 9], growth: bad });
      expect(sign.grow.scale.x).toBe(1);
    }
    sign.detachWords();
    sign.update({ viewer: [0, 1.6, 9], growth: 1.25 });
    expect(sign.grow.scale.x).toBe(1);
    sign.dispose();
  });

  it("grows on top of a scaled folder's scale, and never writes the root's", () => {
    const sign = buildReadingSign(null);
    const station = new Group();
    station.add(sign.root);
    sign.root.scale.setScalar(2); // the renderer's: a folder scaled 2x
    sign.attachWords(new Texture(), SIZE);
    sign.update(seen(0, 1.6, 9)); // growth 1.6
    station.updateMatrixWorld(true);
    expect(sign.grow.getWorldScale(new Vector3()).x).toBeCloseTo(3.2, 9);
    expect(sign.root.scale.x).toBe(2);
    // A re-placement draws the root at 2x again: the growth stays its own.
    sign.root.scale.setScalar(2);
    sign.update(seen(0, 1.6, 9));
    station.updateMatrixWorld(true);
    expect(sign.grow.getWorldScale(new Vector3()).x).toBeCloseTo(3.2, 9);
    sign.dispose();
  });

  it("leaves the tap target's centre where it was", () => {
    const sign = buildReadingSign(null);
    sign.root.updateMatrixWorld(true);
    const centre = () =>
      new Box3().setFromObject(sign.plate).getCenter(new Vector3()).toArray();
    const before = centre();
    sign.attachWords(new Texture(), SIZE);
    sign.root.updateMatrixWorld(true);
    expect(centre()).toEqual(before);
    sign.dispose();
  });
});

describe("a mounted sign's words plate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCanvas() {
    const rec = recorder();
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => rec.g }),
    });
    return rec;
  }

  const block = { id: "guild", title: "The guild house", body: "Words." };

  it("a tap through the words plate opens nothing", () => {
    stubCanvas();
    const opened: unknown[] = [];
    const sign = mountReadingSign(block, (b) => opened.push(b));
    sign.attachWords(new Texture(), { widthM: 2.312, heightM: 0.918 });
    const scene = new Group();
    const content = new Group();
    content.name = "station-content:a";
    scene.add(content);
    content.add(sign.object);
    sign.update({ viewer: [0, 1, 3] });
    scene.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    const aimAt = (target: Vector3) => {
      camera.position.set(target.x, target.y, target.z + 3);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
    };
    const pick = (targets: ReadonlyMap<string, Object3D>) =>
      pickObject(camera, targets);
    aimAt(sign.wordsPlate.getWorldPosition(new Vector3()));
    expect(tapShownWorldPart(scene, pick, null)).toBe(false);
    expect(opened).toEqual([]);
    // The sign itself still takes the tap.
    aimAt(sign.tapTarget.getWorldPosition(new Vector3()));
    expect(tapShownWorldPart(scene, pick, null)).toBe(true);
    expect(opened).toEqual([block]);
    sign.dispose();
  });

  it("repaints the face only when the voice's state changes", () => {
    const { texts } = stubCanvas();
    const sign = mountReadingSign(block);
    const words: readonly string[] = Object.values(READING_SIGN_VOICE_WORDS);
    const chips = () => texts.filter((t) => words.includes(t.text)).length;
    expect(chips()).toBe(0);
    sign.setVoiceState("idle");
    sign.setVoiceState("idle");
    expect(chips()).toBe(1);
    sign.setVoiceState("playing");
    sign.setVoiceState("playing");
    expect(chips()).toBe(2);
    sign.setVoiceState(null);
    expect(chips()).toBe(2);
    // The mount's paint and three repaints.
    expect(texts.filter((t) => t.text === READING_SIGN_HINT)).toHaveLength(4);
    sign.dispose();
  });
});
