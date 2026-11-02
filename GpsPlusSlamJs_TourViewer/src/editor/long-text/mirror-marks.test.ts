/**
 * Why these tests matter: the mirror lies exactly under the textarea, so
 * its runs must cover the body character for character (or the dimmed
 * marks drift away from the letters they belong to), and the looks must
 * match the marks the buttons write.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { mirrorRuns, type MirrorRun } from "./mirror-marks.js";

/** Each run as `[text, looks]`. */
function looks(body: string, runs: MirrorRun[]): [string, string][] {
  return runs.map((r) => [body.slice(r.from, r.to), r.looks.join(" ")]);
}

describe("mirrorRuns", () => {
  it("dims a heading's and a list's marks", () => {
    const body = "## Top\n- item";
    expect(looks(body, mirrorRuns(body, []))).toEqual([
      ["## ", "mk"],
      ["Top", "hd"],
      ["\n", ""],
      ["-", "mk"],
      [" item", ""],
    ]);
  });

  it("marks bold, italic, links and picture lines", () => {
    const body = "**b** *i* [l](https://x.y)\n![A](asset:p)";
    expect(looks(body, mirrorRuns(body, []))).toEqual([
      ["**", "mk"],
      ["b", "b"],
      ["**", "mk"],
      [" ", ""],
      ["*", "mk"],
      ["i", "i"],
      ["*", "mk"],
      [" ", ""],
      ["[", "mk"],
      ["l", "ln"],
      ["](https://x.y)", "mk"],
      ["\n", ""],
      ["![A](asset:p)", "pic"],
    ]);
  });

  it("leaves a code box's lines unmarked", () => {
    const body = "```\n**not bold**\n```";
    expect(mirrorRuns(body, []).every((r) => r.looks.length === 0)).toBe(true);
  });

  it("underlines the parts shown as typed and marks the current one", () => {
    const body = "a `x` b `y`";
    const runs = mirrorRuns(
      body,
      [
        { from: 2, to: 5, kept: false },
        { from: 8, to: 11, kept: true },
      ],
      0,
    );
    expect(looks(body, runs)).toEqual([
      ["a ", ""],
      ["`x`", "iss cur"],
      [" b ", ""],
      ["`y`", "kept"],
    ]);
    expect(runs.map((r) => r.part)).toEqual([-1, 0, -1, 1]);
  });

  it("covers the body in order without gaps, whatever it holds", () => {
    // Why: a gap or an overlap would shift every later mark off its letters.
    fc.assert(
      fc.property(
        fc
          .array(
            fc.constantFrom(
              "a",
              " ",
              "\n",
              "**",
              "*",
              "## ",
              "- ",
              "[",
              "](u)",
              "![",
              "```",
              "> ",
            ),
            { maxLength: 40 },
          )
          .map((p) => p.join("")),
        (body) => {
          const runs = mirrorRuns(body, []);
          let at = 0;
          for (const r of runs) {
            expect(r.from).toBe(at);
            expect(r.to).toBeGreaterThan(r.from);
            at = r.to;
          }
          expect(at).toBe(body.length);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
