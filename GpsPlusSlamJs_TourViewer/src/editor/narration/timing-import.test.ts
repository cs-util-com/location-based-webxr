/**
 * Why these tests matter: an import lines a speech tool's file up with
 * the creator's text, and the creator must be told exactly what did not
 * fit - a line of the file that is not in the text, a sentence of the
 * text no line voices - rather than see a read-along that silently skips.
 * The timing it builds is what the visitor's read-along reads, so its
 * offsets must be the plain text's and it must parse as a timing entry.
 */
import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import {
  parseTourTimingText,
  tourTimingStaleReason,
} from "gps-plus-slam-app-framework/ar/tour-timing";
import { describe, expect, it } from "vitest";

import { readTimingFile, TimingFileError } from "./timing-file.js";
import { importTiming, lineUpFile } from "./timing-import.js";

const BODY = "Welcome to the old bridge.\n\nIt was built in six years.";
const plainOf = (body: string) => plainTextOf(parseTourMarkdown(body));

const vtt = (...cues: [string, string, string][]): string =>
  [
    "WEBVTT",
    "",
    ...cues.flatMap(([a, b, text]) => [`${a} --> ${b}`, text, ""]),
  ].join("\n");

describe("lineUpFile, a subtitle file", () => {
  it("gives each matching line its stretch of the text, a sentence track", () => {
    const plain = plainOf(BODY);
    const result = lineUpFile(
      plain,
      readTimingFile(
        vtt(
          ["00:00.400", "00:02.000", "Welcome to the old bridge."],
          ["00:02.500", "00:04.000", "It was built in six years."],
        ),
      ),
    );
    expect(result.granularity).toBe("sentence");
    expect(result.mismatches).toEqual([]);
    expect(result.matchedUnits).toBe(2);
    expect(result.segments).toEqual([
      {
        startMs: 400,
        endMs: 2000,
        from: 0,
        to: 25,
        text: "Welcome to the old bridge",
      },
      {
        startMs: 2500,
        endMs: 4000,
        from: 28,
        to: 53,
        text: "It was built in six years",
      },
    ]);
    expect(plain.text.slice(28, 53)).toBe("It was built in six years");
    expect(result.unvoiced).toEqual([]);
  });

  it("lists a line that is not in the text, even if a word of it is", () => {
    const result = lineUpFile(
      plainOf(BODY),
      readTimingFile(
        vtt(
          ["00:00.400", "00:02.000", "Welcome to the old bridge."],
          ["00:02.100", "00:02.400", "Please mind the gap."],
          ["00:02.500", "00:04.000", "It was built in six years."],
        ),
      ),
    );
    expect(result.matchedUnits).toBe(2);
    expect(result.mismatches).toEqual([
      {
        label: "Line 6",
        startMs: 2100,
        endMs: 2400,
        text: "Please mind the gap.",
      },
    ]);
    expect(result.segments).toHaveLength(2);
  });

  it("names the sentences of the text no line voices", () => {
    const plain = plainOf(BODY);
    const result = lineUpFile(
      plain,
      readTimingFile(
        vtt(["00:00.400", "00:02.000", "Welcome to the old bridge."]),
      ),
    );
    expect(result.unvoiced).toEqual([{ from: 28, to: 54 }]);
    expect(plain.text.slice(28, 54)).toBe("It was built in six years.");
  });
});

describe("lineUpFile, a word list", () => {
  const words = (list: [string, number, number][]) =>
    JSON.stringify(list.map(([word, start, end]) => ({ word, start, end })));

  it("gives each matching word its own segment, a word track", () => {
    const result = lineUpFile(
      plainOf("The old bridge."),
      readTimingFile(
        words([
          ["The", 0.1, 0.3],
          ["old", 0.35, 0.6],
          ["bridge.", 0.65, 1.1],
        ]),
      ),
    );
    expect(result.granularity).toBe("word");
    expect(result.segments).toEqual([
      { startMs: 100, endMs: 300, from: 0, to: 3, text: "The" },
      { startMs: 350, endMs: 600, from: 4, to: 7, text: "old" },
      { startMs: 650, endMs: 1100, from: 8, to: 14, text: "bridge" },
    ]);
  });

  it("lists each run of words not in the text as one stretch", () => {
    const result = lineUpFile(
      plainOf("The old bridge was built in six years."),
      readTimingFile(
        words([
          ["The", 0, 0.2],
          ["old", 0.2, 0.4],
          ["bridge", 0.4, 0.8],
          ["um", 0.8, 0.9],
          ["you", 0.9, 1.0],
          ["know", 1.0, 1.1],
          ["was", 1.1, 1.3],
          ["built", 1.3, 1.6],
          ["in", 1.6, 1.7],
          ["six", 1.7, 1.9],
          ["years", 1.9, 2.3],
        ]),
      ),
    );
    expect(result.segments).toHaveLength(8);
    expect(result.mismatches).toEqual([
      { label: "Words 4-6", startMs: 800, endMs: 1100, text: "um you know" },
    ]);
    expect(result.matchedUnits).toBe(8);
    expect(result.units).toBe(11);
  });

  it("does not take a single word that matches by chance", () => {
    const result = lineUpFile(
      plainOf("The old bridge was built in six years."),
      readTimingFile(words([["six", 0, 0.5]])),
    );
    // One word alone, with no neighbour that matches too, may be anywhere.
    expect(result.segments).toEqual([]);
    expect(result.mismatches).toHaveLength(1);
  });

  it("orders the segments by time even when the file is not", () => {
    const result = lineUpFile(
      plainOf("One two three."),
      readTimingFile(
        words([
          ["One", 0.5, 0.7],
          ["two", 0.2, 0.4],
          ["three", 0.8, 1],
        ]),
      ),
    );
    const starts = result.segments.map((s) => s.startMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe("importTiming", () => {
  it("builds a timing entry the visitor's reader accepts as fitting the text", async () => {
    const outcome = await importTiming(
      BODY,
      vtt(
        ["00:00.400", "00:02.000", "Welcome to the old bridge."],
        ["00:02.500", "00:04.000", "It was built in six years."],
      ),
    );
    expect(outcome.timing).not.toBeNull();
    const timing = parseTourTimingText(JSON.stringify(outcome.timing));
    const plain = plainOf(BODY).text;
    expect(
      tourTimingStaleReason(timing, {
        plainLength: plain.length,
        textHash: await textHashOf(plain),
      }),
    ).toBeNull();
    expect(timing.source).toBe("file");
  });

  it("gives no timing when nothing of the file is in the text", async () => {
    const outcome = await importTiming(
      BODY,
      vtt(["00:00.400", "00:02.000", "Completely different words here."]),
    );
    expect(outcome.timing).toBeNull();
    expect(outcome.mismatches).toHaveLength(1);
  });

  it("passes the file's own faults on, and refuses a file that is no timing", async () => {
    const outcome = await importTiming(
      BODY,
      "WEBVTT\n\n00:03.000 --> 00:01.000\nBackwards.\n\n00:00.400 --> 00:02.000\nWelcome to the old bridge.",
    );
    expect(outcome.problems).toEqual([
      { label: "Line 3", message: "it ends before it starts" },
    ]);
    await expect(importTiming(BODY, "hello")).rejects.toBeInstanceOf(
      TimingFileError,
    );
  });
});
