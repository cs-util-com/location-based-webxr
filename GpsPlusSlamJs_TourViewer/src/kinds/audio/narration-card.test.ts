// @vitest-environment jsdom
/**
 * Why these tests matter: the narration card is the only control a visitor
 * has over a narration circle's voice. It must say what the voice is doing
 * (so a tap's effect is visible at once), let them move through it, and
 * show the sentence being spoken for a visitor who cannot hear it. The
 * format has no sentence timings, so which sentence shows is a rule of its
 * own, pinned here.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  narrationCard,
  sentenceAt,
  transcriptSentences,
  type NarrationControls,
} from "./narration-card.js";

function controls(durationMs = 30_000) {
  const c = {
    time: 0,
    isPlaying: false,
    duration: durationMs,
    toggles: 0,
    seeks: [] as number[],
  };
  const api: NarrationControls = {
    toggle() {
      c.toggles += 1;
      c.isPlaying = !c.isPlaying;
    },
    seek(ms) {
      c.seeks.push(ms);
      c.time = ms;
    },
    timeMs: () => c.time,
    durationMs: () => c.duration,
    playing: () => c.isPlaying,
  };
  return { c, api };
}

const TRANSCRIPT =
  "The column was raised in 1638. It thanks the city! Look up?";

describe("transcriptSentences", () => {
  it("splits after a full stop, an exclamation or a question", () => {
    expect(transcriptSentences(TRANSCRIPT)).toEqual([
      "The column was raised in 1638.",
      "It thanks the city!",
      "Look up?",
    ]);
    expect(transcriptSentences("  ")).toEqual([]);
    expect(transcriptSentences(undefined)).toEqual([]);
    expect(transcriptSentences("No stop at the end")).toEqual([
      "No stop at the end",
    ]);
  });
});

describe("sentenceAt", () => {
  const s = ["aaaa", "bb", "cccc"]; // 10 characters

  it("reads each sentence's share of the characters as its share of time", () => {
    expect(sentenceAt(s, 0, 10_000)).toBe(0);
    expect(sentenceAt(s, 3_999, 10_000)).toBe(0);
    expect(sentenceAt(s, 4_000, 10_000)).toBe(1);
    expect(sentenceAt(s, 6_000, 10_000)).toBe(2);
    expect(sentenceAt(s, 10_000, 10_000)).toBe(2);
    expect(sentenceAt(s, 99_000, 10_000)).toBe(2);
  });

  it("shows the first while the length is unknown, none without sentences", () => {
    expect(sentenceAt(s, 5_000, 0)).toBe(0);
    expect(sentenceAt(s, 5_000, Number.NaN)).toBe(0);
    expect(sentenceAt([], 5_000, 10_000)).toBe(-1);
  });

  // Why a property: whatever the clock says, the shown sentence is one of
  // the transcript's and never goes back as time goes on.
  it("is always a sentence, and moves only forward with time", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 8 }),
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (sentences, duration, a, b) => {
          const [early, late] = a <= b ? [a, b] : [b, a];
          const i = sentenceAt(sentences, early * duration, duration);
          const j = sentenceAt(sentences, late * duration, duration);
          expect(i >= 0 && j < sentences.length && i <= j).toBe(true);
        },
      ),
    );
  });
});

describe("narrationCard", () => {
  it("shows its title, the time, the state and the sentence being spoken", () => {
    const host = document.createElement("div");
    const { c, api } = controls();
    const card = narrationCard(
      host,
      { title: "The column's story", transcript: TRANSCRIPT },
      api,
    );
    const q = (sel: string) => host.querySelector<HTMLElement>(sel);
    expect(q("[data-testid=narration-card]")?.getAttribute("aria-label")).toBe(
      "Narration: The column's story",
    );
    expect(q(".narration-card-title")?.textContent).toBe("The column's story");
    expect(q(".narration-card-state")?.textContent).toBe("Tap play to listen");
    expect(q(".narration-card-time")?.textContent).toBe("0:00 / 0:30");
    expect(q(".narration-card-line")?.textContent).toBe(
      "The column was raised in 1638.",
    );
    c.time = 28_000; // 28/30 of 57 characters is past the first two (49)
    card.render();
    expect(q(".narration-card-time")?.textContent).toBe("0:28 / 0:30");
    expect(q(".narration-card-line")?.textContent).toBe("Look up?");
    expect(q(".narration-card-state")?.textContent).toBe("Paused");
  });

  // Why: the button is the visitor's tap on the voice; its new state must
  // show at once, not on the next frame.
  it("plays and pauses from its button, and says so at once", () => {
    const host = document.createElement("div");
    const { c, api } = controls();
    narrationCard(host, { title: "T" }, api);
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Play");
    button.click();
    expect(c.toggles).toBe(1);
    expect(button.getAttribute("aria-label")).toBe("Pause");
    expect(host.querySelector(".narration-card-state")?.textContent).toBe(
      "Playing",
    );
    c.isPlaying = false;
    c.time = 30_000;
    button.click();
    expect(c.toggles).toBe(2);
  });

  it("says a heard narration can play again", () => {
    const host = document.createElement("div");
    const { c, api } = controls();
    const card = narrationCard(host, { title: "T" }, api);
    c.time = 30_000;
    card.render();
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Play again",
    );
  });

  it("seeks where the scrub bar is let go, in seconds", () => {
    const host = document.createElement("div");
    const { c, api } = controls();
    narrationCard(host, { title: "T" }, api);
    const scrub = host.querySelector<HTMLInputElement>("input[type=range]")!;
    expect(scrub.max).toBe("30");
    scrub.value = "12";
    scrub.dispatchEvent(new Event("input"));
    scrub.dispatchEvent(new Event("change"));
    expect(c.seeks).toEqual([12_000]);
    expect(host.querySelector(".narration-card-time")?.textContent).toBe(
      "0:12 / 0:30",
    );
  });

  it("hides the sentence line without a transcript, waits for a length, and goes on dispose", () => {
    const host = document.createElement("div");
    const { api } = controls(0);
    const card = narrationCard(host, {}, api);
    expect(host.querySelector(".narration-card-title")?.textContent).toBe(
      "Narration",
    );
    expect(
      host.querySelector<HTMLElement>(".narration-card-line")?.hidden,
    ).toBe(true);
    expect(host.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
    card.dispose();
    expect(host.children).toHaveLength(0);
  });
});
