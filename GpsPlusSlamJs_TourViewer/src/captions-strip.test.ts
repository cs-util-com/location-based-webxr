// @vitest-environment jsdom
/**
 * Why this test matters: the captions strip is the view that keeps a
 * visitor's eyes on the place, so what it shows must be the words being
 * spoken: the chunk holding the voice's word, that word marked and the
 * ones to come dimmer, a new chunk when the voice moves past the old one,
 * and the prototype's controls (play, back 10 s, Full text) acting on the
 * shared voice. A track that marks no words must still move through a
 * long sentence's chunks, never mark a word it cannot place, and never
 * stay on the first chunk for the whole sentence.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import type { CaptionLayout } from "./caption-chunks.js";
import {
  captionCredit,
  captionLayout,
  createCaptionsStrip,
  offsetBySharedTime,
  type CaptionsContent,
} from "./captions-strip.js";
import { sentenceSpans } from "./long-text-sentences.js";
import type { NarrationClock } from "./narration-player.js";

const LONG =
  "The old hall burned down in the winter of the great storm, and the square stood empty and quiet for many long years after that. It was built again.";

class FakeClock implements NarrationClock {
  now = 0;
  dur = 30_000;
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

/** One segment per word, 400 ms each; or one per sentence. */
function track(granularity: TourTiming["granularity"]): TourTiming {
  const spans =
    granularity === "word"
      ? [...LONG.matchAll(/\S+/gu)].map((m) => ({
          from: m.index,
          to: m.index + m[0].replace(/[,.]$/u, "").length,
        }))
      : sentenceSpans(LONG);
  return {
    granularity,
    source: "file",
    textHash: "sha256:x",
    segments: spans.map((s, i) => ({
      startMs: i * (granularity === "word" ? 400 : 10_000),
      endMs: (i + 1) * (granularity === "word" ? 400 : 10_000),
      from: s.from,
      to: s.to,
    })),
  };
}

function q(root: ParentNode, id: string): HTMLElement {
  const e = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (e === null) throw new Error(`no ${id}`);
  return e;
}

function make(layout: CaptionLayout = "portrait") {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const openFullText = vi.fn();
  const strip = createCaptionsStrip({
    host,
    openFullText,
    layout: () => layout,
  });
  const clock = new FakeClock();
  const content = (timing: TourTiming): CaptionsContent => ({
    key: "hall",
    title: "The hall",
    plain: LONG,
    sentences: sentenceSpans(LONG),
    timing,
    player: clock,
    synthetic: true,
    voiceCredit: "Read by the archive",
  });
  return { host, strip, clock, content, openFullText };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the captions strip", () => {
  // Why this test matters: the prototype sets "Synthetic voice" apart in
  // italics in the strip's line, as in the sheet's credit; a plain text
  // line lost that (found side by side with the prototype).
  it("sets the synthetic voice apart in its credit line", () => {
    const { host, strip, content } = make();
    strip.show(content(track("word")));
    const sub = q(host, "captions-sub");
    expect(sub.querySelector("i")?.textContent).toBe("Synthetic voice");
    expect(getComputedStyle(sub.querySelector("i") as Element).fontStyle).toBe(
      "italic",
    );
  });

  it("is hidden until shown, then shows the title, the clock and the credit", () => {
    const { host, strip, clock, content } = make();
    expect(q(host, "captions-strip").classList.contains("cs-hide")).toBe(true);
    clock.now = 2_000;
    strip.show(content(track("word")));
    expect(q(host, "captions-strip").classList.contains("cs-hide")).toBe(false);
    expect(q(host, "captions-title").textContent).toBe("The hall");
    expect(q(host, "captions-sub").textContent).toBe(
      "0:02 / 0:30 · Synthetic voice · Read by the archive",
    );
    expect(q(host, "captions-full").textContent).toBe("Full text");
    expect(
      q(host, "captions-bar").firstElementChild?.getAttribute("style"),
    ).toMatch(/width: 6\.6/u);
  });

  it("marks the spoken word and dims the words to come", () => {
    const { strip, clock, content } = make();
    clock.now = 3 * 400 + 10; // the 4th word, "burned"
    strip.show(content(track("word")));
    expect(strip.state().word).toBe("burned");
    const words = [...document.querySelectorAll(".cs-w")];
    const at = words.findIndex((w) => w.classList.contains("cs-on"));
    expect(words[at]?.textContent).toBe("burned");
    expect(
      words.slice(0, at).some((w) => w.classList.contains("cs-todo")),
    ).toBe(false);
    expect(
      words.slice(at + 1).every((w) => w.classList.contains("cs-todo")),
    ).toBe(true);
  });

  it("moves to the chunk holding the voice, each within the layout's length", () => {
    const { strip, clock, content } = make("portrait");
    strip.show(content(track("word")));
    const first = strip.state().chunk;
    expect(first.startsWith("The old hall")).toBe(true);
    expect(first.length).toBeLessThanOrEqual(96);
    // "years" is past the first chunk's end.
    const years = LONG.slice(0, LONG.indexOf("years")).split(/\s+/u).length - 1;
    clock.now = years * 400 + 10;
    strip.tick();
    expect(strip.state().chunk).not.toBe(first);
    expect(strip.state().chunk).toContain("years");
    expect(strip.state().word).toBe("years");
    // The next sentence is a chunk of its own.
    clock.now = 99_000;
    clock.dur = 120_000;
    strip.tick();
    expect(strip.state().chunk).toBe("It was built again.");
  });

  it("cuts by the layout: a desktop's longer chunk holds more", () => {
    const portrait = make("portrait");
    portrait.strip.show(portrait.content(track("word")));
    const desktop = make("desktop");
    desktop.strip.show(desktop.content(track("word")));
    expect(desktop.strip.state().chunk.length).toBeGreaterThan(
      portrait.strip.state().chunk.length,
    );
  });

  it("on a sentence track, marks no word but moves through the chunks by time", () => {
    const { strip, clock, content } = make("portrait");
    clock.now = 500;
    strip.show(content(track("sentence")));
    expect(strip.state().word).toBeNull();
    expect(document.querySelector(".cs-on, .cs-todo")).toBeNull();
    const first = strip.state().chunk;
    clock.now = 9_500;
    strip.tick();
    expect(strip.state().chunk).not.toBe(first);
    expect(strip.state().word).toBeNull();
  });

  it("plays and pauses, goes back 10 s, and opens the full text", () => {
    const { host, strip, clock, content, openFullText } = make();
    strip.show(content(track("word")));
    const play = q(host, "captions-play");
    play.click();
    expect(clock.on).toBe(true);
    expect(play.getAttribute("aria-pressed")).toBe("true");
    expect(play.querySelectorAll("rect")).toHaveLength(2);
    play.click();
    expect(clock.on).toBe(false);
    clock.now = 14_000;
    q(host, "captions-back").click();
    expect(clock.now).toBe(4_000);
    q(host, "captions-full").click();
    expect(openFullText).toHaveBeenCalledTimes(1);
  });

  it("hides again and leaves the page on dispose", () => {
    const { host, strip, content } = make();
    strip.show(content(track("word")));
    strip.hide();
    expect(strip.state().shown).toBe(false);
    expect(q(host, "captions-strip").classList.contains("cs-hide")).toBe(true);
    strip.dispose();
    expect(host.querySelector('[data-testid="captions-strip"]')).toBeNull();
  });
});

describe("the strip's small rules", () => {
  it("names the voice: synthetic first, then the creator's credit", () => {
    expect(captionCredit({ synthetic: true, voiceCredit: "Anna" })).toBe(
      "Synthetic voice · Anna",
    );
    expect(captionCredit({ synthetic: false, voiceCredit: " " })).toBe("");
    expect(captionCredit({ synthetic: false })).toBe("");
  });

  it("lays itself out by the reading sheet's media queries", () => {
    const win = (portrait: boolean, low: boolean) => ({
      matchMedia: (q: string) =>
        ({
          matches: q.startsWith("(max-aspect") ? portrait : low,
        }) as MediaQueryList,
    });
    expect(captionLayout(win(true, false))).toBe("portrait");
    expect(captionLayout(win(false, true))).toBe("landscape");
    expect(captionLayout(win(false, false))).toBe("desktop");
    expect(captionLayout(null)).toBe("portrait");
  });

  it("places the voice by the share of its segment's time, inside the segment", () => {
    const seg = { startMs: 1000, endMs: 2000, from: 10, to: 30 };
    expect(offsetBySharedTime(seg, 500)).toBe(10);
    expect(offsetBySharedTime(seg, 1500)).toBe(20);
    expect(offsetBySharedTime(seg, 9000)).toBe(29);
    expect(offsetBySharedTime({ ...seg, endMs: 1000 }, 1500)).toBe(10);
  });
});
