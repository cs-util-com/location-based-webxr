/**
 * Why these properties matter: captions come from a file anyone can
 * write. Whatever the text, the reader must not throw, must hand the
 * player only finite, forward, markup-free cues in start order, and must
 * read back exactly the cues a well-formed file was written with.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { captionAt, readCaptions } from "./video-captions.js";

/** Seconds as WebVTT writes them, `hh:mm:ss.ttt`. */
function stamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

const cueArb = fc.record({
  startMs: fc.integer({ min: 0, max: 10_000_000 }),
  lengthMs: fc.integer({ min: 1, max: 60_000 }),
  text: fc
    .string({ minLength: 1, maxLength: 60 })
    .map((t) => t.replace(/[<>\r\n]|-->/g, "").trim())
    .filter((t) => t !== ""),
});

describe("readCaptions, whatever the text", () => {
  it("never throws and yields only finite, forward cues without markup, in order", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.string().map((s) => `WEBVTT\n\n${s}`),
          fc
            .array(
              fc.constantFrom(
                "WEBVTT",
                "",
                "00:01.000 --> 00:02.000",
                "<b>x</b>",
                "-->",
                "NOTE",
                "a",
              ),
            )
            .map((ls) => ls.join("\n")),
        ),
        (text) => {
          const { cues } = readCaptions(text);
          for (const c of cues) {
            expect(Number.isFinite(c.startS) && Number.isFinite(c.endS)).toBe(
              true,
            );
            expect(c.endS).toBeGreaterThan(c.startS);
            expect(c.text).not.toMatch(/[<>]/);
            expect(c.text.trim()).not.toBe("");
          }
          const starts = cues.map((c) => c.startS);
          expect(starts).toEqual([...starts].sort((a, b) => a - b));
          expect(typeof captionAt(cues, 1)).toBe("string");
        },
      ),
    );
  });

  it("reads back the cues a well-formed file was written with", () => {
    fc.assert(
      fc.property(fc.array(cueArb, { maxLength: 20 }), (written) => {
        const text = [
          "WEBVTT",
          ...written.flatMap((c) => [
            "",
            `${stamp(c.startMs)} --> ${stamp(c.startMs + c.lengthMs)}`,
            c.text,
          ]),
        ].join("\n");
        const read = readCaptions(text);
        expect(read.skipped).toBe(0);
        const sorted = [...written].sort((a, b) => a.startMs - b.startMs);
        expect(read.cues.map((c) => [c.startS, c.endS, c.text])).toEqual(
          sorted.map((c) => [
            c.startMs / 1000,
            (c.startMs + c.lengthMs) / 1000,
            c.text,
          ]),
        );
      }),
    );
  });
});
