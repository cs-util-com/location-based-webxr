// @vitest-environment jsdom
/**
 * Why this test matters: a narrated text's sheet has two promises a
 * visitor can see. With a read-along that fits, the voice's sentence (and
 * word, on a word track from a file) is marked as it is spoken, a tap on
 * a sentence plays from it, and the controls are the prototype's. With
 * none that fits - stale, missing, still being checked, or a check that
 * threw - the text is plain, with the voice and nothing said: the visitor
 * has nothing to act on. A sheet that marked a stale track would light
 * the wrong words, and one that said so would worry a visitor for a
 * creator's slip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import {
  createLongTextSheet,
  LONG_TEXT_VOICE,
  LONG_TEXT_WORD,
  narrationMeta,
  type SheetNarration,
} from "./long-text-sheet.js";
import type { NarrationClock } from "./narration-player.js";

const BODY = [
  "# The square",
  "",
  "The old hall burned. It was built again.",
  "",
  "See [the map](https://example.org/map) here.",
].join("\n");
const P = plainTextOf(parseTourMarkdown(BODY)).text;

/** One segment per word of P, 500 ms each. */
function wordTrack(
  granularity: TourTiming["granularity"] = "word",
  source: TourTiming["source"] = "file",
): TourTiming {
  const segments = [...P.matchAll(/\S+/gu)].map((m, i) => ({
    startMs: i * 500,
    endMs: i * 500 + 450,
    from: m.index,
    to: m.index + m[0].length,
  }));
  return { granularity, source, segments, textHash: "sha256:x" };
}

class FakeClock implements NarrationClock {
  now = 0;
  dur = 10_000;
  on = false;
  readonly listeners = new Set<() => void>();
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
    this.emit();
  }
  pause(): void {
    this.on = false;
    this.emit();
  }
  seek(ms: number): void {
    this.now = Math.max(0, Math.min(this.dur, ms));
    this.emit();
  }
  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(): void {
    for (const l of this.listeners) l();
  }
}

const registry = new Map<string, unknown>();
class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}
const marked = (name: string): string[] =>
  ((registry.get(name) as FakeHighlight | undefined)?.ranges ?? []).map((r) =>
    r.toString(),
  );

function q(root: ParentNode, id: string): HTMLElement {
  const e = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (e === null) throw new Error(`no ${id}`);
  return e;
}

function make(caretAt?: () => { node: Node; offset: number } | null) {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const sheet = createLongTextSheet({
    host,
    loadAsset: () => Promise.reject(new Error("none")),
    arActive: () => false,
    openLink: () => undefined,
    ...(caretAt === undefined ? {} : { caretAt }),
  });
  return { host, sheet };
}

function narrated(
  clock: FakeClock,
  timing: Promise<TourTiming | null>,
  extra: Partial<SheetNarration> = {},
): SheetNarration {
  return {
    player: clock,
    timing,
    synthetic: true,
    voiceCredit: "Read by the archive",
    ...extra,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  registry.clear();
  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal("Highlight", FakeHighlight);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("the narrated sheet's words", () => {
  it("says the words, the minutes of narration and the language", () => {
    expect(narrationMeta(1928, 61_000, "en")).toBe(
      "1,928 words · 1 min narration · EN",
    );
    expect(narrationMeta(10, 0)).toBe("10 words · 1 min narration");
  });

  it("shows the prototype's plain controls and credit until the read-along settles", () => {
    const clock = new FakeClock();
    const { host, sheet } = make();
    sheet.show({
      over: "",
      title: "T",
      body: BODY,
      narration: narrated(clock, new Promise(() => undefined)),
    });
    expect(sheet.state().mode).toBe("plain");
    expect(q(host, "long-text-play").hidden).toBe(false);
    expect(q(host, "long-text-back").hidden).toBe(false);
    expect(q(host, "long-text-prev").hidden).toBe(true);
    expect(q(host, "long-text-next").hidden).toBe(true);
    expect(q(host, "long-text-position").hidden).toBe(true);
    expect(q(host, "long-text-credit").innerHTML).toBe(
      "<i>Synthetic voice</i> · Read by the archive",
    );
    expect(q(host, "long-text-meta").textContent).toBe(
      "14 words · 1 min narration",
    );
    expect(q(host, "long-text-paragraph").textContent).toBe("0:00");
    expect(q(host, "long-text-percent").textContent).toBe("-0:10");
    expect(sheet.state().sentence).toBe(-1);
    expect(registry.size).toBe(0);
  });
});

describe("a read-along that fits", () => {
  it("marks the voice's sentence and word as it is spoken", async () => {
    const clock = new FakeClock();
    const { host, sheet } = make();
    sheet.show({
      over: "",
      title: "T",
      body: BODY,
      narration: narrated(clock, Promise.resolve(wordTrack())),
    });
    await flush();
    expect(sheet.state().mode).toBe("live");
    expect(q(host, "long-text-prev").hidden).toBe(false);
    // The 6th word ("burned.") is spoken from 2500 ms.
    clock.now = 2600;
    sheet.tick();
    expect(marked(LONG_TEXT_VOICE)).toEqual(["The old hall burned."]);
    expect(marked(LONG_TEXT_WORD)).toEqual(["burned."]);
    expect(sheet.state()).toMatchObject({ sentence: 1, paragraph: 1 });
    // A word after the link: its host is not counted, so the mark is on
    // the spoken word, not one stretch off.
    clock.now = 13 * 500 + 10;
    clock.dur = 20_000;
    sheet.tick();
    expect(marked(LONG_TEXT_WORD)).toEqual(["here."]);
    expect(marked(LONG_TEXT_VOICE)).toEqual([
      "See the map (example.org) here.",
    ]);
  });

  it("marks sentences only on a marked track or a sentence track", async () => {
    for (const t of [wordTrack("word", "marked"), wordTrack("sentence")]) {
      const clock = new FakeClock();
      const { sheet } = make();
      registry.clear();
      sheet.show({
        over: "",
        title: "T",
        body: BODY,
        narration: narrated(clock, Promise.resolve(t)),
      });
      await flush();
      clock.now = 2600;
      sheet.tick();
      expect(marked(LONG_TEXT_VOICE)).toEqual(["The old hall burned."]);
      expect(registry.has(LONG_TEXT_WORD)).toBe(false);
      expect(sheet.state().word).toBeNull();
    }
  });

  it("plays from a tapped sentence, a little before its first word", async () => {
    const clock = new FakeClock();
    let caret: { node: Node; offset: number } | null = null;
    const { host, sheet } = make(() => caret);
    sheet.show({
      over: "",
      title: "T",
      body: BODY,
      narration: narrated(clock, Promise.resolve(wordTrack())),
    });
    await flush();
    const second = host.querySelectorAll("p")[0]?.firstChild;
    if (!(second instanceof Text)) throw new Error("no text");
    caret = { node: second, offset: second.data.indexOf("It") + 1 };
    q(host, "long-text-text").click();
    // "It" is the 7th word: 3000 ms, less the 30 ms lead.
    expect(clock.now).toBe(2970);
    expect(clock.on).toBe(true);
  });

  it("goes back 10 s, and to the sentence's start or the one before", async () => {
    const clock = new FakeClock();
    const { host, sheet } = make();
    sheet.show({
      over: "",
      title: "T",
      body: BODY,
      narration: narrated(clock, Promise.resolve(wordTrack())),
    });
    await flush();
    clock.now = 4800; // past "built", 1.8 s into a sentence from 3000
    q(host, "long-text-prev").click();
    expect(clock.now).toBe(2970);
    q(host, "long-text-prev").click(); // within 1.6 s: the one before
    expect(clock.now).toBe(970);
    clock.now = 8000;
    q(host, "long-text-back").click();
    expect(clock.now).toBe(0);
  });

  it("toggles play and pause, its icon following", () => {
    const clock = new FakeClock();
    const { host, sheet } = make();
    sheet.show({
      over: "",
      title: "T",
      body: BODY,
      narration: narrated(clock, Promise.resolve(wordTrack())),
    });
    const play = q(host, "long-text-play");
    expect(play.getAttribute("aria-pressed")).toBe("false");
    play.click();
    expect(clock.on).toBe(true);
    expect(play.getAttribute("aria-pressed")).toBe("true");
    expect(play.querySelectorAll("rect")).toHaveLength(2);
    play.click();
    expect(clock.on).toBe(false);
  });

  it("stops following when the visitor scrolls, until Back to the voice", async () => {
    const clock = new FakeClock();
    const { host, sheet } = make();
    sheet.show({
      over: "",
      title: "T",
      body: BODY,
      narration: narrated(clock, Promise.resolve(wordTrack())),
    });
    await flush();
    q(host, "long-text-wrap").dispatchEvent(new Event("wheel"));
    expect(sheet.state().following).toBe(false);
    const pill = q(host, "long-text-follow");
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toBe("Back to the voice");
    pill.click();
    expect(sheet.state().following).toBe(true);
    expect(pill.hidden).toBe(true);
  });

  it("pauses the voice and lets every mark go on close", async () => {
    const clock = new FakeClock();
    const { sheet } = make();
    sheet.show({
      over: "",
      title: "T",
      body: BODY,
      narration: narrated(clock, Promise.resolve(wordTrack())),
    });
    await flush();
    clock.play();
    clock.now = 2600;
    sheet.tick();
    sheet.close();
    expect(clock.on).toBe(false);
    expect(registry.size).toBe(0);
    expect(clock.listeners.size).toBe(0);
  });
});

describe("a read-along that does not fit", () => {
  it.each([
    ["stale or missing (null)", () => Promise.resolve(null)],
    ["a check that threw", () => Promise.reject(new Error("boom"))],
  ])(
    "leaves the text plain, with the voice and nothing said, when %s",
    async (_l, timing) => {
      const clock = new FakeClock();
      const { host, sheet } = make();
      sheet.show({
        over: "",
        title: "T",
        body: BODY,
        narration: narrated(clock, timing()),
      });
      await flush();
      clock.now = 2600;
      sheet.tick();
      expect(sheet.state()).toMatchObject({
        mode: "plain",
        sentence: -1,
        marked: false,
        word: null,
      });
      expect(registry.size).toBe(0);
      // Nothing tells the visitor: the sheet's words are the plain ones.
      expect(host.textContent).not.toMatch(/timing|stale|read-along/iu);
      expect(q(host, "long-text-play").hidden).toBe(false);
    },
  );

  it("ignores a read-along that settles after another text was shown", async () => {
    const clock = new FakeClock();
    const { sheet } = make();
    let settle: (t: TourTiming) => void = () => undefined;
    sheet.show({
      over: "",
      title: "First",
      body: BODY,
      narration: narrated(
        clock,
        new Promise((r) => {
          settle = r;
        }),
      ),
    });
    sheet.show({ over: "", title: "Second", body: "Other words here." });
    settle(wordTrack());
    await flush();
    expect(sheet.state()).toMatchObject({ title: "Second", mode: "silent" });
  });
});
