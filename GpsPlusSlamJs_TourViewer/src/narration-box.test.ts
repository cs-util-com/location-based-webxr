// @vitest-environment jsdom
/**
 * Why this test matters: the narration box is where a visitor follows a
 * narrated text without looking away from the place. What it shows must be
 * the voice: the speaker's name once at the start of the words, the words
 * already said white and the rest grey, the spoken line kept in view. Its
 * two gestures act on the one shared voice: a tap pauses or plays (and
 * starts again at the end), a drag moves the voice by the lines dragged
 * and lets it carry on from there. And the page's store must hear what
 * the box shows, only when it changes, for the other views that read it.
 */
import { configureStore } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import { wordsOf } from "./plain-words.js";
import {
  createNarrationBox,
  type NarrationBox,
  type NarrationBoxContent,
} from "./narration-box.js";
import {
  narrationBoxReducer,
  selectNarrationBox,
  selectNarrationSpeaking,
} from "./narration-box-slice.js";
import type { NarrationClock } from "./narration-player.js";
import { cancelsXrSelect } from "./pin-sheet.js";

/** 16 words; the stub layout puts 4 on a line, so 4 lines. */
const TEXT =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.";
const WORD_MS = 400;
const LINE_PX = 22;

class FakeClock implements NarrationClock {
  now = 0;
  dur = 16 * WORD_MS;
  on = false;
  nowMs(): number {
    return this.now;
  }
  durationMs(): number {
    return this.dur;
  }
  playing(): boolean {
    return this.on;
  }
  play(): void {
    this.on = true;
  }
  pause(): void {
    this.on = false;
  }
  seek(ms: number): void {
    this.now = Math.max(0, Math.min(this.dur, ms));
  }
  onChange(): () => void {
    return () => undefined;
  }
}

function wordTrack(): Pick<TourTiming, "segments"> {
  return {
    segments: wordsOf(TEXT, 0, TEXT.length).map((w, i) => ({
      startMs: i * WORD_MS,
      endMs: (i + 1) * WORD_MS,
      from: w.from,
      to: w.to,
    })),
  };
}

// jsdom lays nothing out: each word's top is its line by its place, four
// words to a line, as a browser would put them.
const offsetTop = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetTop",
);
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      const all = this.parentElement?.querySelectorAll(".nb-w");
      const i = all === undefined ? -1 : [...all].indexOf(this);
      return i < 0 ? 0 : Math.floor(i / 4) * LINE_PX;
    },
  });
});
afterEach(() => {
  if (offsetTop !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "offsetTop", offsetTop);
  }
  document.body.replaceChildren();
});

function make(clock = new FakeClock()) {
  const store = configureStore({
    reducer: { narrationBox: narrationBoxReducer },
  });
  const actions: string[] = [];
  const spy = {
    dispatch: (a: Parameters<typeof store.dispatch>[0]) => {
      actions.push(a.type);
      return store.dispatch(a);
    },
  };
  let t = 0;
  const box = createNarrationBox({
    host: document.body,
    store: spy,
    now: () => (t += 1000),
  });
  const content: NarrationBoxContent = {
    key: "text-1",
    title: "The Guild House",
    speaker: { name: "Narrator", color: "#f9a8d4" },
    plain: TEXT,
    timing: wordTrack(),
    player: clock,
    synthetic: true,
  };
  return { box, clock, store, actions, content };
}

function pointer(type: string, x: number, y: number): Event {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
}

function lit(box: NarrationBox): string[] {
  return [...box.element.querySelectorAll(".nb-w.nb-on")].map(
    (w) => w.textContent ?? "",
  );
}

describe("createNarrationBox", () => {
  it("starts the words with the speaker's name, bold in their colour, once", () => {
    const { box, content } = make();
    box.show(content);
    const col = box.element.querySelector(".nb-col");
    const who = col?.firstElementChild as HTMLElement | null;
    expect(who?.tagName).toBe("B");
    expect(who?.textContent).toBe("Narrator");
    expect(who?.style.color).toBe("rgb(249, 168, 212)");
    expect(box.element.querySelectorAll(".nb-who")).toHaveLength(1);
    // The words follow it on the same line, with nothing in between.
    expect(col?.textContent?.startsWith(`Narrator ${TEXT.slice(0, 3)}`)).toBe(
      true,
    );
    expect(box.element.getAttribute("aria-label")).toContain(
      '"The Guild House", a synthetic voice',
    );
    expect(box.element.classList.contains("nb-off")).toBe(false);
  });

  it("whitens the words said and keeps the rest grey", () => {
    const { box, clock, content } = make();
    clock.now = 2 * WORD_MS + 10;
    box.show(content);
    expect(lit(box)).toEqual(["one", "two", "three"]);
    expect(box.state().word).toBe("three");
    clock.now = WORD_MS; // a seek back greys again
    box.tick();
    expect(lit(box)).toEqual(["one"]);
    clock.now = 0;
    box.tick();
    expect(lit(box)).toEqual([]);
  });

  it("keeps the spoken line in the middle row", () => {
    const { box, clock, content } = make();
    box.show(content);
    expect(box.state()).toMatchObject({ lines: 4, rows: 3, scroll: 0 });
    clock.now = 9 * WORD_MS + 10; // word 10, line 2
    for (let i = 0; i < 20; i += 1) box.tick();
    expect(box.state().scroll).toBe(1);
    clock.now = 15 * WORD_MS; // line 3: never past the last rows
    for (let i = 0; i < 20; i += 1) box.tick();
    expect(box.state().scroll).toBe(1);
  });

  // Why: the two gestures act on the voice every other view follows.
  it("pauses and plays on a tap, with a sign at the finger", () => {
    const { box, clock, content } = make();
    box.show(content);
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointerup", 103, 704));
    expect(clock.on).toBe(true);
    const sign = document.querySelector<HTMLElement>(".nb-tapfx");
    expect(sign?.dataset.sign).toBe("play");
    expect(sign?.style.left).toBe("103px");
    sign?.dispatchEvent(new Event("animationend"));
    expect(document.querySelector(".nb-tapfx")).toBeNull();
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointerup", 100, 700));
    expect(clock.on).toBe(false);
    expect(document.querySelector<HTMLElement>(".nb-tapfx")?.dataset.sign).toBe(
      "pause",
    );
  });

  it("starts again from the beginning on a tap at the end", () => {
    const { box, clock, content } = make();
    clock.now = clock.dur;
    box.show(content);
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointerup", 100, 700));
    expect(clock.now).toBe(0);
    expect(clock.on).toBe(true);
  });

  it("scrubs by the lines dragged, then plays on from there", () => {
    const { box, clock, content, store } = make();
    clock.now = 4 * WORD_MS; // the start of line 1
    clock.on = true;
    box.show(content);
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointermove", 100, 700 - LINE_PX));
    // Held while the finger moves; the store says scrubbing, not speaking.
    expect(clock.on).toBe(false);
    expect(box.state().scrubbing).toBe(true);
    expect(selectNarrationBox(store.getState()).scrubbing).toBe(true);
    expect(selectNarrationSpeaking(store.getState())).toBe(false);
    // One line up is one line ahead: the words light as the finger goes.
    expect(lit(box).at(-1)).toBe("eight");
    box.element.dispatchEvent(pointer("pointermove", 100, 700 - 2 * LINE_PX));
    box.element.dispatchEvent(pointer("pointerup", 100, 700 - 2 * LINE_PX));
    expect(clock.now).toBe(12 * WORD_MS);
    expect(clock.on).toBe(true);
    expect(selectNarrationSpeaking(store.getState())).toBe(true);
    // A drag is not a tap: no sign.
    expect(document.querySelector(".nb-tapfx")).toBeNull();
  });

  it("leaves a paused voice paused after a drag, and stops a drag past the end", () => {
    const { box, clock, content } = make();
    box.show(content);
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointermove", 100, 650));
    box.element.dispatchEvent(pointer("pointerup", 100, 650));
    expect(clock.on).toBe(false);
    expect(clock.now).toBeGreaterThan(0);
    clock.on = true;
    const s0 = box.state().scroll;
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointermove", 100, 0));
    // Past the last line the words stretch only 0.3 as far.
    expect(box.state().scroll).toBeCloseTo(1 + (s0 + 700 / LINE_PX - 1) * 0.3);
    box.element.dispatchEvent(pointer("pointerup", 100, 0));
    expect(clock.now).toBe(clock.dur);
    expect(clock.on).toBe(false);
  });

  it("answers the keyboard: Space plays, the arrows move a line", () => {
    const { box, clock, content } = make();
    box.show(content);
    box.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(clock.on).toBe(true);
    box.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(clock.now).toBe(4 * WORD_MS);
    box.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(clock.now).toBe(0);
  });

  // Why: a frame loop shows the box sixty times a second; the store is
  // told only of a change, or every subscriber runs every frame.
  it("tells the store what it shows, only when it changes", () => {
    const { box, clock, content, store, actions } = make();
    box.show(content);
    box.show(content);
    box.tick();
    expect(
      actions.filter((a) => a === "narrationBox/narrationBoxShown"),
    ).toHaveLength(1);
    const follows = () =>
      actions.filter((a) => a === "narrationBox/narrationBoxFollowed").length;
    const before = follows();
    box.tick();
    box.show(content);
    expect(follows()).toBe(before);
    clock.now = 5 * WORD_MS + 10;
    clock.on = true;
    box.tick();
    expect(follows()).toBe(before + 1);
    expect(selectNarrationBox(store.getState())).toMatchObject({
      key: "text-1",
      playing: true,
      word: 5,
      line: 1,
    });
    box.hide();
    expect(selectNarrationBox(store.getState()).key).toBeNull();
    box.hide();
    expect(
      actions.filter((a) => a === "narrationBox/narrationBoxHidden"),
    ).toHaveLength(1);
  });

  it("hides out of reach of taps, and a new text starts afresh", () => {
    const { box, clock, content } = make();
    clock.now = 3000;
    box.show(content);
    box.hide();
    expect(box.element.classList.contains("nb-off")).toBe(true);
    expect(box.element.inert).toBe(true);
    expect(box.state().shown).toBe(false);
    const other = new FakeClock();
    box.show({
      ...content,
      key: "text-2",
      plain: "Just this.",
      player: other,
      timing: { segments: [{ startMs: 0, endMs: 300, from: 0, to: 4 }] },
    });
    expect(box.state()).toMatchObject({
      key: "text-2",
      lit: -1,
      lines: 1,
      rows: 1,
    });
    expect(
      box.element.querySelector(".nb-sbar")?.classList.contains("nb-none"),
    ).toBe(true);
  });

  it("is a surface whose taps do not reach the AR scene", () => {
    const { box, content } = make();
    box.show(content);
    const word = box.element.querySelector(".nb-w");
    expect(cancelsXrSelect(word)).toBe(true);
    expect(cancelsXrSelect(box.element)).toBe(true);
  });

  it("shows a text with no words without failing", () => {
    const { box, content } = make();
    box.show({ ...content, plain: "", timing: { segments: [] } });
    expect(box.state()).toMatchObject({ shown: true, lit: -1, lines: 1 });
    box.element.dispatchEvent(pointer("pointerdown", 1, 1));
    box.element.dispatchEvent(pointer("pointermove", 1, -200));
    box.element.dispatchEvent(pointer("pointerup", 1, -200));
  });

  it("goes away whole on dispose", () => {
    const { box, content, store } = make();
    box.show(content);
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointerup", 100, 700));
    box.dispose();
    expect(document.querySelector(".narration-box")).toBeNull();
    expect(document.querySelector(".nb-tapfx")).toBeNull();
    expect(selectNarrationBox(store.getState()).key).toBeNull();
  });
});
