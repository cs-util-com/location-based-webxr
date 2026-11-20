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
import type { NarrationClock, NarrationPlayer } from "./narration-player.js";
import { cancelsXrSelect } from "./pin-sheet.js";
import { createVoiceFocus, focusedPlayer } from "./voice-focus.js";

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

/** An audio player that tells its listeners of every change, as the
 *  real one does, for the voice focus to follow. */
function innerPlayer(): NarrationPlayer {
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of [...listeners]) l();
  };
  let on = false;
  let at = 0;
  return {
    nowMs: () => at,
    durationMs: () => 16 * WORD_MS,
    playing: () => on,
    play() {
      on = true;
      notify();
    },
    pause() {
      on = false;
      notify();
    },
    seek(ms) {
      at = ms;
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
    },
  };
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
/** Lines the name and its disclosure take before the first word's. */
let headLines = 0;
beforeEach(() => {
  headLines = 0;
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      const all = this.parentElement?.querySelectorAll(".nb-w");
      const i = all === undefined ? -1 : [...all].indexOf(this);
      return i < 0 ? 0 : (headLines + Math.floor(i / 4)) * LINE_PX;
    },
  });
});
afterEach(() => {
  setHidden(false);
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

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
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
    expect(box.element.querySelectorAll(".nb-col .nb-who")).toHaveLength(1);
    // The words follow it on the same line, after the synthetic voice's
    // disclosure.
    expect(
      col?.textContent?.startsWith(
        `Narrator · synthetic voice ${TEXT.slice(0, 3)}`,
      ),
    ).toBe(true);
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
    const { box, clock, content, store, actions } = make();
    clock.now = 4 * WORD_MS; // the start of line 1
    clock.on = true;
    box.show(content);
    // A scrub is no pause: neither the store nor a screen reader hears of
    // the voice stopping and starting under the finger.
    const live = box.element.querySelector<HTMLElement>(".nb-live");
    const said = live?.textContent;
    const plays = () =>
      actions.filter((a) => a === "narrationBox/narrationBoxPlaying").length;
    const playsBefore = plays();
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
    expect(plays()).toBe(playsBefore);
    expect(live?.textContent).toBe(said);
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
    // Past the last line the words stretch 0.3 as far at first, and
    // flatten out before the last line (the read one) leaves the window.
    const over = s0 + 700 / LINE_PX - 1;
    expect(box.state().scroll).toBeCloseTo(
      1 + 2 * (1 - Math.exp(-(over * 0.3) / 2)),
    );
    expect(box.state().scroll).toBeLessThan(3);
    box.element.dispatchEvent(pointer("pointerup", 100, 0));
    expect(clock.now).toBe(clock.dur);
    expect(clock.on).toBe(false);
  });

  // Why: a press at either end starts the drag with the read line at the
  // window's edge: at the end the last line sits in the bottom row with
  // the voice inside it, at the start the first line in the top row. A drag
  // back from the end (or ahead from the start) then moved the read line
  // part-way out of the window before the voice left it, at any speed:
  // the main way the words left the box on a phone. The words now wait at
  // the edge and move on with the finger from there, and slowly (1 px a
  // move) never jump once the voice reaches the next line.
  for (const [where, from, sign] of [
    ["back from the end", "end", 1],
    ["ahead from the start", "start", -1],
  ] as const) {
    for (const step of [1, 60]) {
      it(`keeps the read line in the window on a drag ${where}, ${step} px a move`, () => {
        const { box, clock, content } = make();
        clock.now = from === "end" ? clock.dur - 40 : 0;
        box.show(content);
        const rows = box.state().rows;
        let last = box.state().scroll;
        box.element.dispatchEvent(pointer("pointerdown", 100, 700));
        for (let px = step; px <= 3 * LINE_PX; px += step) {
          box.element.dispatchEvent(
            pointer("pointermove", 100, 700 + sign * px),
          );
          const { lit, scroll, scrubbing } = box.state();
          // Past the tap slop (8 px) a move is a drag.
          expect(scrubbing).toBe(px > 8);
          const read = Math.floor(Math.max(0, lit) / 4);
          expect(read).toBeGreaterThanOrEqual(scroll - 1e-9);
          expect(read + 1).toBeLessThanOrEqual(scroll + rows + 1e-9);
          // A move of 1 px moves the words at most 1 px: no jump. (A fast
          // move may move them a line or more.)
          const jump = step === 1 ? Math.abs(scroll - last) : 0;
          expect(jump).toBeLessThanOrEqual(1 / LINE_PX + 1e-9);
          last = scroll;
        }
        box.element.dispatchEvent(
          pointer("pointerup", 100, 700 + sign * 3 * LINE_PX),
        );
        expect(box.state().scrubbing).toBe(false);
      });
    }
  }

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
      actions.filter((a) => a === "narrationBox/narrationBoxPlaying").length;
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
    clock.on = true;
    box.show(content);
    expect(box.element.dataset.speaking).toBe("yes");
    box.hide();
    // A hidden box does not breathe on in the background.
    expect(box.element.dataset.speaking).toBe("no");
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
    const { box, clock, content } = make();
    box.show({ ...content, plain: "", timing: { segments: [] } });
    expect(box.state()).toMatchObject({ shown: true, lit: -1, lines: 1 });
    box.element.dispatchEvent(pointer("pointerdown", 1, 1));
    box.element.dispatchEvent(pointer("pointermove", 1, -200));
    box.element.dispatchEvent(pointer("pointerup", 1, -200));
    // No words, one line spanning the whole voice: the drag still moves
    // the voice (here past its end), and leaves it paused.
    expect(box.state()).toMatchObject({ lit: -1, scrubbing: false });
    expect(clock.now).toBe(clock.dur);
    expect(clock.on).toBe(false);
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

  // Why: leaving a station mid-drag, or a new text arriving, must not
  // restart the old voice: the drag ends there, without its replay.
  it("does not play the voice again when a drag is cut off by hide or a new text", () => {
    for (const cut of ["hide", "show"] as const) {
      const { box, clock, content } = make();
      clock.now = 4 * WORD_MS;
      clock.on = true;
      box.show(content);
      box.element.dispatchEvent(pointer("pointerdown", 100, 700));
      box.element.dispatchEvent(pointer("pointermove", 100, 700 - LINE_PX));
      expect(clock.on).toBe(false);
      if (cut === "hide") box.hide();
      else box.show({ ...content, key: "text-2", player: new FakeClock() });
      expect(clock.on).toBe(false);
      expect(box.state().scrubbing).toBe(false);
      box.element.dispatchEvent(pointer("pointerup", 100, 700 - LINE_PX));
      expect(clock.on).toBe(false);
      document.body.replaceChildren();
    }
  });

  // Why: a drag only holds the voice for the finger; it must not hand the
  // one voice channel to another voice meanwhile, nor take a held voice
  // out of it.
  it("keeps the voice channel through a drag (a voice it holds stays held)", () => {
    const focus = createVoiceFocus();
    const other = focusedPlayer(innerPlayer(), focus);
    const voiced = focusedPlayer(innerPlayer(), focus);
    other.play();
    voiced.play(); // the text's voice holds the other one
    expect(other.playing()).toBe(false);
    const { box, content } = make();
    box.show({ ...content, player: voiced });
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointermove", 100, 700 - LINE_PX));
    expect(voiced.playing()).toBe(false);
    expect(other.playing()).toBe(false);
    box.element.dispatchEvent(pointer("pointerup", 100, 700 - LINE_PX));
    expect(voiced.playing()).toBe(true);
    expect(other.playing()).toBe(false);
    // The text's voice ending still carries the other one on.
    voiced.pause();
    expect(other.playing()).toBe(true);
  });

  it("keeps a held text voice held through a drag, to carry on later", () => {
    const focus = createVoiceFocus();
    const voiced = focusedPlayer(innerPlayer(), focus);
    const clip = focusedPlayer(innerPlayer(), focus);
    voiced.play();
    clip.play(); // a clip holds the text's voice
    expect(voiced.wanted()).toBe(true);
    const { box, content } = make();
    box.show({ ...content, player: voiced });
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointermove", 100, 700 - LINE_PX));
    box.element.dispatchEvent(pointer("pointerup", 100, 700 - LINE_PX));
    expect(voiced.playing()).toBe(false);
    expect(voiced.wanted()).toBe(true);
    clip.pause(); // the clip ends: the text's voice carries on
    expect(voiced.playing()).toBe(true);
  });

  // Why: some voice services ask for a visible disclosure and credit; it
  // must be on screen, not only in the label a screen reader reads.
  it("says a synthetic voice and its credit after the name, on the first line", () => {
    const { box, content } = make();
    box.show({ ...content, voiceCredit: "Read by the archive" });
    const disc = box.element.querySelector<HTMLElement>(".nb-disc");
    expect(disc?.textContent).toBe(" · synthetic voice · Read by the archive");
    expect(disc?.previousElementSibling?.classList.contains("nb-who")).toBe(
      true,
    );
    expect(disc?.tagName).not.toBe("B");
    box.show({ ...content, key: "t2", synthetic: false, voiceCredit: "Ann" });
    expect(box.element.querySelector(".nb-disc")?.textContent).toBe(" · Ann");
    box.show({ ...content, key: "t3", synthetic: false });
    expect(box.element.querySelector(".nb-disc")).toBeNull();
  });

  // Why: after the 0.75 s sign the box must still show, and tell a screen
  // reader, whether the voice plays.
  it("shows and announces whether the voice plays", () => {
    const { box, clock, content } = make();
    box.show(content);
    expect(box.element.dataset.speaking).toBe("no");
    const live = box.element.querySelector<HTMLElement>(".nb-live");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.textContent).toBe("");
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointerup", 100, 700));
    expect(clock.on).toBe(true);
    expect(box.element.dataset.speaking).toBe("yes");
    expect(live?.textContent).toBe("Playing");
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointerup", 100, 700));
    expect(box.element.dataset.speaking).toBe("no");
    expect(live?.textContent).toBe("Paused");
    expect(box.element.getAttribute("aria-label")).toMatch(/arrow keys/u);
  });

  // Why: the page's own sound gate silences a hidden page and carries the
  // voice on at the return; the box pausing it too would break that.
  it("leaves a hidden page's voice to the page", () => {
    const { box, clock, content } = make();
    clock.on = true;
    box.show(content);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(clock.on).toBe(true);
  });

  // Why: every dispatch runs the AR store's subscribers; the store hears
  // of the play state only, never of each word.
  it("tells the store nothing as the words go by", () => {
    const { box, clock, content, actions } = make();
    clock.on = true;
    box.show(content);
    const before = actions.length;
    for (let i = 1; i < 12; i += 1) {
      clock.now = i * WORD_MS + 10;
      box.tick();
    }
    expect(actions.length).toBe(before);
    clock.on = false;
    box.tick();
    expect(actions.slice(before)).toEqual(["narrationBox/narrationBoxPlaying"]);
  });
  // Why: a drag cut off, or let go past the end, must hand the voice
  // channel back for real: with a voice that has hold(), a hold left in
  // place would keep the voice behind it waiting for nothing.
  it("hands the channel back when a drag is cut off or ends past the end", () => {
    for (const end of ["hide", "show", "dispose", "past-end"] as const) {
      const focus = createVoiceFocus();
      const behind = focusedPlayer(innerPlayer(), focus);
      const voiced = focusedPlayer(innerPlayer(), focus);
      behind.play();
      voiced.play(); // the other one waits behind the text's voice
      const { box, content } = make();
      box.show({ ...content, player: voiced });
      box.element.dispatchEvent(pointer("pointerdown", 100, 700));
      box.element.dispatchEvent(pointer("pointermove", 100, 700 - LINE_PX));
      expect(behind.playing()).toBe(false);
      if (end === "hide") box.hide();
      else if (end === "show") {
        box.show({ ...content, key: "text-2", player: new FakeClock() });
      } else if (end === "dispose") box.dispose();
      else {
        box.element.dispatchEvent(pointer("pointermove", 100, 0));
        box.element.dispatchEvent(pointer("pointerup", 100, 0));
      }
      expect(voiced.playing(), end).toBe(false);
      expect(voiced.wanted(), end).toBe(false);
      expect(behind.playing(), end).toBe(true);
      document.body.replaceChildren();
    }
  });

  // Why: the page's sound gate carries a voice on when the page comes
  // back; with a finger still on the words, the box keeps it held.
  it("keeps the voice held while the finger is down, whoever carries it on", () => {
    const { box, clock, content } = make();
    clock.on = true;
    box.show(content);
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointermove", 100, 700 - LINE_PX));
    expect(clock.on).toBe(false);
    clock.on = true; // the page carries it on, the finger still down
    box.tick();
    expect(clock.on).toBe(false);
    box.element.dispatchEvent(pointer("pointerup", 100, 700 - LINE_PX));
    expect(clock.on).toBe(true);
  });
  // Why: a long voice credit can push the first words to line 2. The
  // name and its disclosure must still open the box, not be scrolled out
  // of view before a word is said: the disclosure is there to be seen.
  it("opens on the name and its disclosure when they take lines of their own", () => {
    headLines = 2;
    const { box, clock, content } = make();
    box.show(content);
    for (let i = 0; i < 20; i += 1) box.tick();
    expect(box.state()).toMatchObject({ lines: 6, rows: 3, scroll: 0 });
    clock.now = WORD_MS + 10; // still the first words' line
    for (let i = 0; i < 20; i += 1) box.tick();
    expect(box.state().scroll).toBe(0);
    clock.now = 4 * WORD_MS + 10; // line 3: the follow takes over
    for (let i = 0; i < 20; i += 1) box.tick();
    expect(box.state().scroll).toBe(2);
  });

  // Why: a page hidden mid-scrub has its voice quiet by the page's sound
  // gate; a cancelled pointer arriving then must not start it in the
  // hidden page. It stays held, the channel's voice, for the gate.
  it("does not play on from a drag that ends while the page is hidden", () => {
    const focus = createVoiceFocus();
    const voiced = focusedPlayer(innerPlayer(), focus);
    voiced.play();
    const { box, content } = make();
    box.show({ ...content, player: voiced });
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointermove", 100, 700 - LINE_PX));
    setHidden(true);
    box.element.dispatchEvent(pointer("pointercancel", 100, 700 - LINE_PX));
    expect(box.state().scrubbing).toBe(false);
    expect(voiced.playing()).toBe(false);
    expect(voiced.running()).toBe(true);
    expect(voiced.nowMs()).toBe(4 * WORD_MS);
  });

  // Why: a voice the channel holds can be carried on while the finger is
  // down (a story clip ends mid-scrub). It must not play from its old
  // place under the scrubbing finger, and the finger's release must let it
  // go on from where the words were dragged to.
  it("holds a voice the channel carries on mid-drag, and plays it on from the dragged place", () => {
    const focus = createVoiceFocus();
    const voiced = focusedPlayer(innerPlayer(), focus);
    const clip = focusedPlayer(innerPlayer(), focus);
    voiced.play();
    clip.play(); // the clip holds the text's voice
    const { box, content, store } = make();
    box.show({ ...content, player: voiced });
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointermove", 100, 700 - LINE_PX));
    expect(voiced.playing()).toBe(false);
    clip.pause(); // the clip ends: the channel carries the text's voice on
    box.tick();
    expect(voiced.playing()).toBe(false);
    expect(box.state().scrubbing).toBe(true);
    // Held for the finger only: it counts as playing, not as a pause.
    expect(selectNarrationBox(store.getState()).playing).toBe(true);
    box.element.dispatchEvent(pointer("pointerup", 100, 700 - LINE_PX));
    expect(voiced.playing()).toBe(true);
    expect(voiced.nowMs()).toBe(4 * WORD_MS);
  });

  // Why: the disclosure after the name and the label a screen reader
  // reads come from the content; a change to the credit, the synthetic
  // flag or the title alone must not leave the old ones on screen.
  it("redraws the disclosure and the label when only the credit or title changes", () => {
    const { box, content } = make();
    box.show(content);
    const sameTiming = { ...content };
    box.show({ ...sameTiming, voiceCredit: "Ann" });
    expect(box.element.querySelector(".nb-disc")?.textContent).toBe(
      " · synthetic voice · Ann",
    );
    box.show({ ...sameTiming, voiceCredit: "Ann", synthetic: false });
    expect(box.element.querySelector(".nb-disc")?.textContent).toBe(" · Ann");
    expect(box.element.getAttribute("aria-label")).not.toContain("synthetic");
    box.show({
      ...sameTiming,
      voiceCredit: "Ann",
      synthetic: false,
      title: "Mill",
    });
    expect(box.element.getAttribute("aria-label")).toContain('"Mill"');
  });

  // Why: the system can take a captured pointer away (a notification, the
  // browser taking the gesture) without a pointerup or pointercancel; the
  // box must not stay in a drag with the voice held for a gone finger.
  it("ends a drag when the pointer capture is lost, as on pointercancel", () => {
    const { box, clock, content, store } = make();
    clock.now = 4 * WORD_MS;
    clock.on = true;
    box.show(content);
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointermove", 100, 700 - LINE_PX));
    expect(clock.on).toBe(false);
    box.element.dispatchEvent(pointer("lostpointercapture", 100, 700));
    expect(box.state().scrubbing).toBe(false);
    expect(selectNarrationBox(store.getState()).scrubbing).toBe(false);
    expect(clock.now).toBe(8 * WORD_MS);
    expect(clock.on).toBe(true);
    // A lost capture is no tap: a press without a drag toggles nothing.
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("lostpointercapture", 100, 700));
    expect(clock.on).toBe(true);
    expect(document.querySelector(".nb-tapfx")).toBeNull();
    // The release after a lost capture is no longer this press's.
    box.element.dispatchEvent(pointer("pointerup", 100, 700));
    expect(clock.on).toBe(true);
  });
});

// Why: in travel mode the box is no longer what the visitor sees. It is
// the invisible layout the painted plate copies, so its width must not
// depend on the text (the plate keeps its shape from sign to sign), its
// head row must hold the hint without moving a line, and an invisible
// (ghost) box must keep its layout and still take the gestures. The plate
// forwards a finger with its own line height, so a drag on a small plate
// moves the voice by the lines the visitor sees there.
describe("createNarrationBox in travel mode", () => {
  it("takes a fixed width of 17 em, not the text's", () => {
    const { box, content } = make();
    box.show(content, "travel");
    const col = box.element.querySelector<HTMLElement>(".nb-col");
    const mid = box.element.querySelector<HTMLElement>(".nb-mid");
    // min(17 x 16, 0.8 x 1024, 720) = 272, less 38 of chrome.
    expect(col?.style.width).toBe("234px");
    expect(mid?.style.width).toBe("246px");
    box.show(content, "natural");
    expect(col?.style.width).not.toBe("234px");
  });

  it("has a head row with the hint only in travel mode", () => {
    const { box, clock, content } = make();
    box.show(content);
    const head = box.element.querySelector<HTMLElement>(".nb-head");
    expect(head?.hidden).toBe(true);
    expect(box.state().hint).toBe("");
    box.show(content, "travel");
    expect(head?.hidden).toBe(false);
    expect(head?.textContent).toBe("tap the words to listen");
    clock.on = true;
    box.tick();
    expect(head?.textContent).toBe("");
    clock.now = 5 * WORD_MS;
    clock.on = false;
    box.tick();
    expect(box.state().hint).toBe("paused - tap to play");
    clock.now = clock.dur;
    box.tick();
    expect(head?.textContent).toBe("the end - tap to hear it again");
  });

  it("changes the hint without laying the words out again", () => {
    const { box, clock, content } = make();
    box.show(content, "travel");
    const before = box.paintModel();
    clock.on = true;
    box.tick();
    const after = box.paintModel();
    expect(after?.frame.hint).toBe("");
    expect(before?.frame.hint).toBe("tap the words to listen");
    expect(after?.layout).toBe(before?.layout);
  });

  it("gives the painter the words where the box put them", () => {
    const { box, clock, content } = make();
    expect(box.paintModel()).toBeNull();
    box.show(content);
    expect(box.paintModel()).toBeNull();
    box.show(content, "travel");
    clock.now = 5 * WORD_MS + 1;
    box.tick();
    const model = box.paintModel();
    const runs = model?.layout.runs ?? [];
    expect(runs.filter((r) => r.kind === "who").map((r) => r.text)).toEqual([
      "Narrator",
    ]);
    expect(runs.filter((r) => r.kind === "disc").map((r) => r.text)).toEqual([
      "·",
      "synthetic",
      "voice",
    ]);
    const words = runs.filter((r) => r.kind === "word");
    expect(words).toHaveLength(16);
    expect(words.map((r) => r.line)).toEqual(
      words.map((_, i) => Math.floor(i / 4)),
    );
    expect(words.map((r) => r.word)).toEqual(words.map((_, i) => i));
    expect(model?.layout.lines).toBe(4);
    expect(model?.layout.rows).toBe(3);
    expect(model?.layout.startsMs).toHaveLength(16);
    expect(model?.layout.whoColor).toBe("#f9a8d4");
    expect(model?.frame).toMatchObject({ lit: 5, scrubbing: false });
    expect(model?.frame.voiceMs).toBe(5 * WORD_MS + 1);
    box.hide();
    expect(box.paintModel()).toBeNull();
  });

  it("keeps its layout and its gestures as an invisible ghost", () => {
    const { box, clock, content } = make();
    box.show(content, "travel");
    const before = box.paintModel()?.layout;
    box.setGhost(true);
    expect(box.element.classList.contains("nb-ghost")).toBe(true);
    expect(box.paintModel()?.layout).toBe(before);
    box.element.dispatchEvent(pointer("pointerdown", 100, 700));
    box.element.dispatchEvent(pointer("pointerup", 100, 700));
    expect(clock.on).toBe(true);
    box.setGhost(false);
    expect(box.element.classList.contains("nb-ghost")).toBe(false);
    box.setPointer(false);
    expect(box.element.classList.contains("nb-nopointer")).toBe(true);
    box.setPointer(true);
    expect(box.element.classList.contains("nb-nopointer")).toBe(false);
  });

  it("scrubs a forwarded press by the line height it is given", () => {
    const { box, clock, content } = make();
    box.show(content, "travel");
    expect(box.beginPress({ id: 7, x: 100, y: 700, linePx: 44 })).toBe(true);
    expect(box.state().pressing).toBe(true);
    // A second finger is not a second press.
    expect(box.beginPress({ id: 8, x: 0, y: 0, linePx: 44 })).toBe(false);
    box.movePress(100, 700 - 44);
    expect(box.state().scrubbing).toBe(true);
    box.movePress(100, 700 - 88);
    box.endPress("up", 100, 612);
    // 88 px at 44 px a line is two lines (the box's own 22 px would be four).
    expect(clock.now).toBe(8 * WORD_MS);
    expect(box.state().pressing).toBe(false);
    expect(document.querySelector(".nb-tapfx")).toBeNull();
  });

  it("plays on a forwarded tap, and a cancelled one does nothing", () => {
    const { box, clock, content } = make();
    box.show(content, "travel");
    box.beginPress({ id: 1, x: 50, y: 50, linePx: 30 });
    box.endPress("cancel", 50, 50);
    expect(clock.on).toBe(false);
    box.beginPress({ id: 1, x: 50, y: 50, linePx: 30 });
    box.endPress("up", 52, 51);
    expect(clock.on).toBe(true);
    expect(document.querySelector(".nb-tapfx")).not.toBeNull();
  });
});
