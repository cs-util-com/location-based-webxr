/**
 * Why these tests matter: captions are text from a tour file, typed by a
 * creator or pasted from a subtitle tool, and reach every visitor's
 * player. The reader must take a real WebVTT file's cues (ids, hours,
 * settings, markup), leave out what it cannot read and say how much, and
 * never pass markup through to the page.
 */
import { describe, expect, it } from "vitest";

import {
  CAPTION_MAX_CUE_CHARS,
  captionAt,
  captionsStatus,
  captionTime,
  readCaptions,
} from "./video-captions.js";

const FILE = [
  "WEBVTT - a walk by the gate",
  "",
  "NOTE written by hand",
  "",
  "1",
  "00:00.000 --> 00:02.500 line:90%",
  "<v Anna>The gate</v> was built",
  "in <i>1870</i>.",
  "",
  "01:00:01.000 --> 01:00:03.000",
  "An hour in.",
].join("\r\n");

describe("captionTime", () => {
  it("reads minutes and hours, and nothing else", () => {
    expect(captionTime("00:02.500")).toBe(2.5);
    expect(captionTime("01:00:01.000")).toBe(3601);
    for (const bad of ["2.5", "00:60.000", "0:02.500", "00:02,500", ""]) {
      expect(captionTime(bad), bad).toBeNull();
    }
  });
});

describe("readCaptions", () => {
  it("reads a file's cues with ids, settings, markup and CRLF", () => {
    expect(readCaptions(FILE)).toEqual({
      cues: [
        { startS: 0, endS: 2.5, text: "The gate was built\nin 1870." },
        { startS: 3601, endS: 3603, text: "An hour in." },
      ],
      skipped: 0,
      problem: null,
    });
    const bom = String.fromCharCode(0xfeff);
    expect(readCaptions(bom + FILE).cues).toHaveLength(2);
  });

  it("refuses a text with no WEBVTT header, and reads nothing from a non-text", () => {
    expect(readCaptions("00:00.000 --> 00:01.000\nHi").problem).toMatch(
      /WEBVTT/,
    );
    expect(readCaptions("WEBVTTX\n\n00:00.000 --> 00:01.000\nHi").cues).toEqual(
      [],
    );
    for (const odd of [undefined, null, 7, {}, "", "   "]) {
      expect(readCaptions(odd)).toEqual({
        cues: [],
        skipped: 0,
        problem: null,
      });
    }
  });

  it("leaves out and counts a bad time, a backwards cue and a wordless one", () => {
    const text = [
      "WEBVTT",
      "",
      "00:00.000 --> 00:01.000",
      "Kept",
      "",
      "00:0x.000 --> 00:01.000",
      "Bad time",
      "",
      "00:05.000 --> 00:04.000",
      "Backwards",
      "",
      "00:06.000 --> 00:07.000",
      "<b></b>",
      "",
      "just some words",
    ].join("\n");
    const read = readCaptions(text);
    expect(read.cues.map((c) => c.text)).toEqual(["Kept"]);
    expect(read.skipped).toBe(4);
  });

  it("takes markup out of a cue so none reaches the page, and caps a cue's length", () => {
    const text = `WEBVTT\n\n00:00.000 --> 00:01.000\n<img src=x onerror=alert(1)>${"a".repeat(1000)}`;
    const [cue] = readCaptions(text).cues;
    expect(cue?.text).not.toContain("<");
    expect(cue?.text.length).toBe(CAPTION_MAX_CUE_CHARS);
  });
});

describe("captionAt", () => {
  const { cues } = readCaptions(FILE);
  it("shows a cue from its start to before its end", () => {
    expect(captionAt(cues, 0)).toBe("The gate was built\nin 1870.");
    expect(captionAt(cues, 2.4999)).not.toBe("");
    expect(captionAt(cues, 2.5)).toBe("");
    expect(captionAt(cues, 3602)).toBe("An hour in.");
    expect(captionAt(cues, Number.NaN)).toBe("");
  });
});

describe("captionsStatus", () => {
  it("counts the cues and their characters, and says what it left out", () => {
    expect(captionsStatus(FILE)).toBe("2 cues · 38 characters");
    expect(
      captionsStatus("WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n\nwords"),
    ).toBe("1 cue · 2 characters · 1 left out (a bad time or no words)");
    expect(captionsStatus("hello")).toMatch(/^Not read: .*WEBVTT/);
    expect(captionsStatus("")).toBeNull();
  });
});
