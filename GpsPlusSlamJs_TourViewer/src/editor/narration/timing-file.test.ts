/**
 * Why these tests matter: a timing file comes from a speech tool the tour
 * does not control, so it may be malformed in any way. Each fault must be
 * LISTED to the creator (with where it is in the file), never silently
 * dropped, and a file that is not a timing at all must be refused with a
 * reason the import card can show - the import never touches the text.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  parseVtt,
  parseWordList,
  readTimingFile,
  TimingFileError,
  TIMING_FILE_MAX_CHARS,
} from "./timing-file.js";

describe("parseVtt", () => {
  it("reads cues with ids, settings, tags and entities, in milliseconds", () => {
    const file = parseVtt(
      [
        "﻿WEBVTT - a voice",
        "",
        "NOTE made by a speech tool",
        "",
        "1",
        "00:00:00.400 --> 00:00:02.150 align:start",
        "<v Guide>Welcome to the</v>",
        "<b>old bridge</b> &amp; its tower.",
        "",
        "01:02.5 --> 01:04,25",
        "It was built in six years.",
      ].join("\r\n"),
    );
    expect(file.kind).toBe("subtitles");
    expect(file.problems).toEqual([]);
    expect(file.units).toEqual([
      {
        label: "Line 6",
        startMs: 400,
        endMs: 2150,
        text: "Welcome to the old bridge & its tower.",
      },
      {
        label: "Line 10",
        startMs: 62_500,
        endMs: 64_250,
        text: "It was built in six years.",
      },
    ]);
  });

  it("lists every malformed cue with its line, and keeps the good ones", () => {
    const file = parseVtt(
      [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:00.500",
        "Ends before it starts.",
        "",
        "00:00:xx.000 --> 00:00:03.000",
        "Unreadable time.",
        "",
        "00:00:04.000 --> 00:00:05.000",
        "",
        "just some words without a time",
        "",
        "00:00:06.000 --> 00:00:07.000",
        "Good.",
      ].join("\n"),
    );
    expect(file.units.map((u) => u.text)).toEqual(["Good."]);
    expect(file.problems).toEqual([
      { label: "Line 3", message: "it ends before it starts" },
      { label: "Line 6", message: "its times cannot be read" },
      { label: "Line 9", message: "it has no words" },
      { label: "Line 11", message: "it is not a timed line" },
    ]);
  });

  it("refuses a file that does not start with WEBVTT", () => {
    expect(() => parseVtt("1\n00:00:01,000 --> 00:00:02,000\nHi")).toThrow(
      TimingFileError,
    );
  });

  it("refuses a subtitle file without one usable line", () => {
    expect(() => parseVtt("WEBVTT\n\nNOTE nothing")).toThrow(/no timed lines/);
  });
});

describe("parseWordList", () => {
  it("reads a list, a {words} object and {segments[].words}, in seconds", () => {
    const words = [
      { word: "Hello", start: 0.5, end: 0.9 },
      { text: "world", start: 1, end: 1.25 },
    ];
    const expected = [
      { label: "Word 1", startMs: 500, endMs: 900, text: "Hello" },
      { label: "Word 2", startMs: 1000, endMs: 1250, text: "world" },
    ];
    expect(parseWordList(JSON.stringify(words)).units).toEqual(expected);
    expect(parseWordList(JSON.stringify({ words })).units).toEqual(expected);
    expect(
      parseWordList(
        JSON.stringify({
          segments: [{ words: [words[0]] }, { words: [words[1]] }],
        }),
      ).units,
    ).toEqual(expected);
  });

  it("lists every malformed entry with its number, and keeps the good ones", () => {
    const file = parseWordList(
      JSON.stringify([
        { word: "ok", start: 0, end: 0.2 },
        { start: 1, end: 2 },
        { word: "late", start: 3, end: 2 },
        { word: "neg", start: -1, end: 2 },
        "nonsense",
        { word: "nan", start: "x", end: 2 },
      ]),
    );
    expect(file.kind).toBe("words");
    expect(file.units.map((u) => u.text)).toEqual(["ok"]);
    expect(file.problems).toEqual([
      { label: "Word 2", message: "it has no word" },
      { label: "Word 3", message: "it ends before it starts" },
      { label: "Word 4", message: "its times cannot be read" },
      { label: "Word 5", message: "it is not a word with times" },
      { label: "Word 6", message: "its times cannot be read" },
    ]);
  });

  it("refuses text that is no JSON, or JSON with no word list", () => {
    expect(() => parseWordList("{oops")).toThrow(/not a readable word list/);
    expect(() => parseWordList('{"a":1}')).toThrow(/no list of words/);
    expect(() => parseWordList("[]")).toThrow(/none of its entries/);
  });
});

describe("readTimingFile", () => {
  it("tells a subtitle file from a word list by its content", () => {
    expect(readTimingFile("WEBVTT\n\n00:01.000 --> 00:02.000\nHi").kind).toBe(
      "subtitles",
    );
    expect(readTimingFile('[{"word":"Hi","start":0,"end":1}]').kind).toBe(
      "words",
    );
  });

  it("refuses anything else, and a file too large to be a timing", () => {
    expect(() => readTimingFile("1\n00:00:01,000 --> 00:00:02,000")).toThrow(
      /neither a subtitle file/,
    );
    expect(() =>
      readTimingFile(`WEBVTT\n${"x".repeat(TIMING_FILE_MAX_CHARS)}`),
    ).toThrow(/too large/);
  });

  it("never throws anything but a TimingFileError, whatever the text", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.string().map((s) => `WEBVTT\n${s}`),
          fc.json(),
          fc
            .string()
            .map((s) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${s}`),
        ),
        (text) => {
          let units: readonly { startMs: number; endMs: number }[] = [];
          let thrown: unknown = null;
          try {
            units = readTimingFile(text).units;
          } catch (err) {
            thrown = err;
          }
          expect(thrown === null || thrown instanceof TimingFileError).toBe(
            true,
          );
          for (const u of units) {
            expect(u.endMs).toBeGreaterThanOrEqual(u.startMs);
            expect(u.startMs).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});
