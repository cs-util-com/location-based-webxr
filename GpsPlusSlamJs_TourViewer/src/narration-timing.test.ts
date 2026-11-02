/**
 * Why this test matters: a narrated text reads along only while its timing
 * fits the words the visitor sees; every way it can fail to (a missing
 * entry, a broken file, an edited text, a duration it overruns, a read
 * that throws) must end in the plain text with nothing said to the
 * visitor, and the file must not be fetched before the text opens - a
 * tour of many narrated stations would otherwise read every timing up
 * front.
 */
import { describe, expect, it, vi } from "vitest";

import type { TourLongTextBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import { TOUR_TIMING_MAX_BYTES } from "gps-plus-slam-app-framework/ar/tour-timing";

import { createNarrationTimings } from "./narration-timing.js";

const BODY = "The guild house burned. It was built again.";

function block(extra: Partial<TourLongTextBlock> = {}): TourLongTextBlock {
  return {
    id: "text",
    kind: "longText",
    view: "reading",
    title: "Guild house",
    body: BODY,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    narration: {
      audio: "voice",
      timing: "timing/text.json",
      synthetic: true,
      durationMs: 10_000,
    },
    ...extra,
  };
}

async function timingFor(body: string, endMs = 4000): Promise<string> {
  const plain = plainTextOf(parseTourMarkdown(body)).text;
  return JSON.stringify({
    granularity: "word",
    source: "file",
    textHash: await textHashOf(plain),
    segments: [
      { startMs: 0, endMs: 500, from: 0, to: 3 },
      { startMs: 500, endMs, from: 4, to: 9 },
    ],
  });
}

function judge(read: (name: string, cap: number) => Promise<string>) {
  const warn = vi.fn();
  const onSettled = vi.fn();
  const readEntry = vi.fn(read);
  const timings = createNarrationTimings({ readEntry, warn, onSettled });
  return { timings, readEntry, warn, onSettled };
}

describe("createNarrationTimings", () => {
  it("reads nothing until a text opens, then reads its entry under the timing cap", async () => {
    const text = await timingFor(BODY);
    const { timings, readEntry, warn, onSettled } = judge(() =>
      Promise.resolve(text),
    );
    expect(timings.verdict(block())).toBe("unread");
    expect(readEntry).not.toHaveBeenCalled();
    const pending = timings.load(block());
    expect(timings.verdict(block())).toBe("pending");
    const timing = await pending;
    expect(timing?.segments).toHaveLength(2);
    expect(timings.verdict(block())).toBe("live");
    expect(readEntry).toHaveBeenCalledWith(
      "timing/text.json",
      TOUR_TIMING_MAX_BYTES,
    );
    expect(warn).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("reads each timing once, however often its text opens", async () => {
    const text = await timingFor(BODY);
    const { timings, readEntry } = judge(() => Promise.resolve(text));
    await Promise.all([timings.load(block()), timings.load(block())]);
    await timings.load(block());
    expect(readEntry).toHaveBeenCalledTimes(1);
  });

  it("is none for a text without a timing, and reads nothing for it", async () => {
    const { timings, readEntry } = judge(() => Promise.resolve(""));
    const voiceOnly = block({
      narration: { audio: "voice", synthetic: false },
    });
    expect(timings.verdict(voiceOnly)).toBe("none");
    // The same text, its narration left out (as a tour without a voice).
    const copy: Record<string, unknown> = { ...block() };
    delete copy["narration"];
    const silent = copy as unknown as TourLongTextBlock;
    expect(timings.verdict(silent)).toBe("none");
    expect(await timings.load(voiceOnly)).toBeNull();
    expect(readEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing entry", () => Promise.reject(new Error("no entry"))],
    ["a file that is not JSON", () => Promise.resolve("{")],
    [
      "a structural fault",
      () => Promise.resolve(JSON.stringify({ granularity: "word" })),
    ],
    ["the text edited since", () => timingFor("Another text entirely, now.")],
    ["a time past the voice's end", () => timingFor(BODY, 12_000)],
    [
      "a read that throws at once",
      () => {
        throw new Error("boom");
      },
    ],
  ])("is stale, plain and quiet, for %s", async (_label, read) => {
    const { timings, warn, onSettled } = judge(read);
    expect(await timings.load(block())).toBeNull();
    expect(timings.verdict(block())).toBe("stale");
    // The reason reaches the console (the creator), once.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("checks an edited body again: the verdict belongs to one text", async () => {
    const text = await timingFor(BODY);
    const { timings, readEntry } = judge(() => Promise.resolve(text));
    expect(await timings.load(block())).not.toBeNull();
    const edited = block({ body: "Something else was written here." });
    expect(timings.verdict(edited)).toBe("unread");
    expect(await timings.load(edited)).toBeNull();
    expect(readEntry).toHaveBeenCalledTimes(2);
  });

  it("keeps its verdict when the page's redraw throws", async () => {
    const text = await timingFor(BODY);
    const timings = createNarrationTimings({
      readEntry: () => Promise.resolve(text),
      onSettled: () => {
        throw new Error("redraw");
      },
    });
    expect(await timings.load(block())).not.toBeNull();
    expect(timings.verdict(block())).toBe("live");
  });
});
