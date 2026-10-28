/**
 * Why these tests matter: the file-access check page is run on an Android
 * phone, and its verdict decides whether the editor may write a
 * tour file in place on Android (an in-place autosave that a killed tab
 * can leave half written would cost a creator the tour). The page writes
 * check files and judges what it reads back after a reload or a closed
 * tab; a verdict that called a cut-short file whole, or a whole one
 * damaged, would decide that question wrongly with nobody able to tell.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  MAX_BODY_BYTES,
  bodyChunk,
  checkFile,
  fileBytes,
  headerOf,
  interruptionOf,
  interruptionWords,
  isCheckFileSpec,
  judge,
  platformWords,
  sizeWords,
  specOf,
  verdictWords,
} from "./file-access-check.js";

const spec = { bodyBytes: 1000, seed: 12345 };

describe("check files", () => {
  it("are a header naming the body's length and seed, then the body", () => {
    const file = checkFile(spec);
    expect(new TextDecoder().decode(headerOf(spec))).toBe(
      "FILE-ACCESS-CHECK-1 1000 12345\n",
    );
    expect(file.length).toBe(fileBytes(spec));
    expect(specOf(file)).toEqual(spec);
  });

  it("write the same body in chunks as in one piece", () => {
    const whole = bodyChunk(spec, 0, spec.bodyBytes);
    const parts = [
      bodyChunk(spec, 0, 333),
      bodyChunk(spec, 333, 334),
      bodyChunk(spec, 667, 1000),
    ];
    expect(parts.map((p) => p.length)).toEqual([333, 334, 333]);
    expect(Uint8Array.from(parts.flatMap((p) => [...p]))).toEqual(whole);
  });

  it("differ by seed, so the rewrite is told from the file before it", () => {
    const a = bodyChunk(spec, 0, 64);
    const b = bodyChunk({ ...spec, seed: 12346 }, 0, 64);
    expect(a).not.toEqual(b);
  });

  it("refuse a size or seed the page may not write", () => {
    for (const bad of [
      { bodyBytes: -1, seed: 1 },
      { bodyBytes: 1.5, seed: 1 },
      { bodyBytes: MAX_BODY_BYTES + 1, seed: 1 },
      { bodyBytes: 10, seed: -1 },
      { bodyBytes: 10, seed: 2 ** 32 },
      { bodyBytes: Number.NaN, seed: 1 },
    ]) {
      expect(isCheckFileSpec(bad)).toBe(false);
      expect(() => headerOf(bad)).toThrow(RangeError);
    }
    expect(() => bodyChunk(spec, -1, 4)).toThrow(RangeError);
  });
});

describe("the verdict on a file read back", () => {
  it("calls a whole check file whole", () => {
    expect(judge(checkFile(spec))).toEqual({ kind: "whole", spec });
  });

  it("calls a file cut anywhere in its body cut short, and says how much it kept", () => {
    const file = checkFile(spec);
    const start = headerOf(spec).length;
    expect(judge(file.subarray(0, start + 400))).toEqual({
      kind: "cut-short",
      spec,
      bodyBytesRead: 400,
    });
    expect(judge(file.subarray(0, start))).toEqual({
      kind: "cut-short",
      spec,
      bodyBytesRead: 0,
    });
  });

  it("calls a file with a wrong byte, or bytes past its length, damaged", () => {
    const file = checkFile(spec);
    const start = headerOf(spec).length;
    const wrong = file.slice();
    wrong[start + 10] = (wrong[start + 10] ?? 0) ^ 0xff;
    expect(judge(wrong)).toEqual({ kind: "damaged", spec, firstWrongAt: 10 });
    const longer = new Uint8Array(file.length + 5);
    longer.set(file);
    expect(judge(longer)).toEqual({
      kind: "damaged",
      spec,
      firstWrongAt: spec.bodyBytes,
    });
  });

  it("calls an empty file empty, and one without the header foreign", () => {
    expect(judge(new Uint8Array(0))).toEqual({ kind: "empty" });
    expect(judge(new TextEncoder().encode("PK\u0003\u0004 a zip"))).toEqual({
      kind: "foreign",
    });
    // A header cut inside its line is no header.
    expect(judge(headerOf(spec).subarray(0, 10))).toEqual({ kind: "foreign" });
  });

  // Why a property: the interrupted write can stop at any byte, and a
  // check file can be any size; every cut must read as what it is.
  it("tells every cut of every check file apart from the whole file (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (bodyBytes, seed, cutAt) => {
          const s = { bodyBytes, seed };
          const file = checkFile(s);
          const start = headerOf(s).length;
          const cut = start + Math.floor(cutAt * bodyBytes);
          const expected =
            cut === file.length
              ? { kind: "whole", spec: s }
              : { kind: "cut-short", spec: s, bodyBytesRead: cut - start };
          expect(judge(file.subarray(0, cut))).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("the log's words", () => {
  it("say a size as a person reads it", () => {
    expect(sizeWords(812)).toBe("812 B");
    expect(sizeWords(1536)).toBe("1.5 KiB");
    expect(sizeWords(50 * 1024 * 1024)).toBe("50.0 MiB");
    expect(sizeWords(-1)).toBe("an unknown size");
  });

  it("name which of the written files a verdict is", () => {
    const before = { bodyBytes: 1024, seed: 1 };
    const after = { bodyBytes: 50 * 1024 * 1024, seed: 2 };
    expect(
      verdictWords({ kind: "whole", spec: before }, { before, after }),
    ).toBe(
      "WHOLE: the file as it was before, every byte as written (1.0 KiB of data).",
    );
    expect(
      verdictWords(
        { kind: "cut-short", spec: after, bodyBytesRead: 3 * 1024 * 1024 },
        { before, after },
      ),
    ).toBe(
      "CUT SHORT: the rewritten file, only 3.0 MiB of its 50.0 MiB of data.",
    );
    expect(verdictWords({ kind: "empty" })).toBe(
      "EMPTY: the file holds nothing.",
    );
  });
});

describe("the rewrite's two ways of being cut", () => {
  // Why: a closed tab and a browser killed from the recent-apps list are
  // different interruptions (a killed browser gets no chance to finish or
  // clean up a write), and the log is read later, by someone who did not
  // run it. It must say which one the file read back went through, and a
  // stored record it cannot read must not be named as either.
  it("name which way step 4 was interrupted", () => {
    expect(interruptionWords("tab")).toBe(
      "the tab was closed during the write",
    );
    expect(interruptionWords("browser")).toBe(
      "the whole browser was closed during the write (swiped away from the recent apps, or force-stopped)",
    );
  });

  it("read the way back from the stored record, and nothing else", () => {
    expect(interruptionOf("tab")).toBe("tab");
    expect(interruptionOf("browser")).toBe("browser");
    for (const other of [undefined, null, "", "Tab", 1, {}, ["tab"]]) {
      expect(interruptionOf(other)).toBeNull();
    }
  });
});

describe("the platform line", () => {
  // Why: whether Chrome's "Desktop site" mode still says Android in its
  // client hints, while its user agent hides it, decides how the editor
  // can tell an Android phone. The log answers that only if it names both.
  it("names the client hints' platform and whether the user agent names Android", () => {
    expect(
      platformWords({
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        userAgentData: { platform: "Android", mobile: false },
      }),
    ).toBe(
      "Platform from the client hints: Android | the user agent names Android: no | mobile: no",
    );
    expect(
      platformWords({
        userAgent:
          "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
      }),
    ).toBe(
      "Platform from the client hints: none given | the user agent names Android: yes | mobile: not said",
    );
    expect(platformWords({})).toBe(
      "Platform from the client hints: none given | the user agent names Android: no | mobile: not said",
    );
  });
});
