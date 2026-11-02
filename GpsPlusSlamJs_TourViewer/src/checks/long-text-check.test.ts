// @vitest-environment jsdom
/**
 * Why this test matters: the rich text e2e reads the check page's query
 * and leans on its body holding every form the sheet renders, with the
 * pictures far enough down that they are decoded only after a scroll. A
 * query that silently fell back to the plain text, or a body that lost
 * its list or a picture, would leave the e2e testing less than it says.
 */
import { describe, expect, it } from "vitest";

import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import {
  parseTourTiming,
  tourTimingStaleReason,
} from "gps-plus-slam-app-framework/ar/tour-timing";

import { plainSentences } from "../long-text-sentences.js";
import {
  CHECK_RICH_BODY,
  checkDemoMs,
  checkSegments,
  createCheckClock,
  longTextCheckOptions,
} from "./long-text-check.js";
import { CHECK_TEXT } from "./lectern-check-text.js";

describe("longTextCheckOptions", () => {
  it("reads the rich text and the AR switch from the query, off by default", () => {
    const plain = {
      rich: false,
      ar: false,
      voice: null,
      view: "reading",
      open: true,
    };
    expect(longTextCheckOptions("")).toEqual(plain);
    expect(longTextCheckOptions("?text=rich&ar=1")).toEqual({
      ...plain,
      rich: true,
      ar: true,
    });
    expect(longTextCheckOptions("?text=plain&ar=true")).toEqual(plain);
  });

  it("reads the voice, the view and the open switch; unknown values fall back", () => {
    expect(
      longTextCheckOptions("?voice=stale&view=captions&open=0"),
    ).toMatchObject({ voice: "stale", view: "captions", open: false });
    expect(longTextCheckOptions("?voice=timed")).toMatchObject({
      voice: "timed",
      view: "reading",
      open: true,
    });
    expect(longTextCheckOptions("?voice=loud&view=lectern")).toMatchObject({
      voice: null,
      view: "reading",
    });
  });
});

/**
 * Why these tests matter: the read-along e2e and the side-by-side check
 * stand on the page's own timing. A track the framework would refuse, or
 * call stale for the text it was made for, would make the "timed" page
 * show a plain sheet and the e2e test nothing; a demo position that is
 * not the prototype's would make the side-by-side compare two moments.
 */
describe("the check timing", () => {
  const plain = plainTextOf(parseTourMarkdown(CHECK_TEXT.body));

  it("is a word track the framework reads and finds fitting its text", async () => {
    const segments = checkSegments(plain.text);
    expect(segments.length).toBeGreaterThan(100);
    const timing = parseTourTiming({
      granularity: "word",
      source: "file",
      segments,
      textHash: await textHashOf(plain.text),
    });
    expect(
      tourTimingStaleReason(timing, {
        plainLength: plain.text.length,
        textHash: await textHashOf(plain.text),
      }),
    ).toBeNull();
    for (const s of segments)
      expect(plain.text.slice(s.from, s.to)).toBe(s.text);
  });

  it("times words as the prototype does: 600 ms in, length-led, pauses at stops", () => {
    const [a, b, c] = checkSegments("Ab cde. Fg");
    expect(a).toMatchObject({ startMs: 600, endMs: 600 + 105 + 88 });
    // The next word follows after 40 ms.
    expect(b?.startMs).toBe(600 + 193 + 40);
    // A full stop adds 430 ms; a word of 3 lasts 105 + 132.
    expect(c?.startMs).toBe((b?.startMs ?? 0) + 237 + 40 + 430);
    expect(checkSegments("")).toEqual([]);
  });

  it("puts the demo 60 ms into the third sentence's seventh word", () => {
    const segments = checkSegments(plain.text);
    const sentences = plainSentences(plain.text, plain.leaves);
    const ms = checkDemoMs(sentences, segments);
    const k = segments.findIndex((s) => s.startMs === ms - 60);
    const third = sentences[2];
    expect(third).toBeDefined();
    expect(
      segments.slice(0, k).filter((s) => s.from >= (third?.from ?? 0)),
    ).toHaveLength(6);
    expect(checkDemoMs(sentences.slice(0, 2), segments)).toBe(0);
  });
});

describe("createCheckClock", () => {
  // Why: the check page's clock must stand still unless moved, so a
  // screenshot is one moment, and keep inside the voice's length.
  it("stands still, seeks within its length and tells its listeners", () => {
    const clock = createCheckClock(1000);
    let told = 0;
    const stop = clock.onChange(() => {
      told += 1;
    });
    clock.play();
    expect(clock.playing()).toBe(true);
    expect(clock.nowMs()).toBe(0);
    clock.seek(5000);
    expect(clock.nowMs()).toBe(1000);
    clock.seek(-3);
    expect(clock.nowMs()).toBe(0);
    clock.seek(Number.NaN);
    expect(clock.nowMs()).toBe(0);
    clock.pause();
    clock.pause();
    expect(told).toBe(5);
    stop();
    clock.play();
    expect(told).toBe(5);
  });
});

describe("CHECK_RICH_BODY", () => {
  it("holds two headings, a nested list, a link and two pictures, the pictures last", () => {
    const { blocks } = parseTourMarkdown(CHECK_RICH_BODY);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds.filter((k) => k === "heading")).toHaveLength(2);
    const list = blocks.find((b) => b.kind === "list");
    expect(
      list?.kind === "list" &&
        list.items.some((item) => item.some((b) => b.kind === "list")),
    ).toBe(true);
    expect(CHECK_RICH_BODY).toContain("](https://town.example/map)");
    const pictures = blocks.flatMap((b, i) =>
      b.kind === "picture" ? [{ i, asset: b.asset }] : [],
    );
    expect(pictures.map((p) => p.asset)).toEqual(["mill", "bell"]);
    // At least three long paragraphs before the first picture.
    expect(pictures[0]!.i).toBeGreaterThan(kinds.indexOf("list") + 3);
  });
});
