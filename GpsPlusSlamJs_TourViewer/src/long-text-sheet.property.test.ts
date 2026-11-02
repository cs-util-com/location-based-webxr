// @vitest-environment jsdom
/**
 * Why this test matters: whatever a visitor presses, in whatever order,
 * on whatever text, the reading mark must stay on a sentence of the text
 * and the readout must name that sentence - a mark past the end leaves
 * "Sentence 9 of 8" on the screen and no highlight anywhere.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createLongTextSheet } from "./long-text-sheet.js";

const PARAGRAPHS = [
  "One short line.",
  "Two sentences here. And the second!",
  "# A heading",
  "- An item. Another.",
  "> A quote, said once.",
  "Plain words with no stop",
];

type Op = "prev" | "next" | "home" | "end" | number;

describe("the reading sheet (property)", () => {
  it("keeps the mark on a sentence and the readout in step", () => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const sheet = createLongTextSheet({
      host,
      loadAsset: () => Promise.reject(new Error("none")),
      arActive: () => false,
      openLink: () => undefined,
    });
    const press = (id: string): void => {
      host.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.click();
    };
    const key = (k: string): void => {
      host
        .querySelector('[data-testid="long-text-bar"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
    };
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...PARAGRAPHS), { maxLength: 8 }),
        fc.array(
          fc.oneof(
            fc.constantFrom<Op>("prev", "next", "home", "end"),
            fc.integer({ min: -5, max: 40 }),
          ),
          { maxLength: 30 },
        ),
        (paragraphs, ops) => {
          sheet.show({ over: "", title: "T", body: paragraphs.join("\n\n") });
          const broken: string[] = [];
          for (const op of ops) {
            if (op === "prev") press("long-text-prev");
            else if (op === "next") press("long-text-next");
            else if (op === "home") key("Home");
            else if (op === "end") key("End");
            else sheet.goTo(op);
            const s = sheet.state();
            const readout =
              host.querySelector('[data-testid="long-text-position"]')
                ?.textContent ?? "";
            if (s.sentences === 0) {
              if (s.sentence !== -1) broken.push("a mark in an empty text");
              continue;
            }
            if (s.sentence < 0 || s.sentence >= s.sentences) {
              broken.push(
                `mark ${String(s.sentence)} of ${String(s.sentences)}`,
              );
            }
            if (s.paragraph < 0 || s.paragraph >= s.paragraphs) {
              broken.push(`paragraph ${String(s.paragraph)}`);
            }
            const want = `Sentence ${String(s.sentence + 1)} of ${String(s.sentences)}`;
            if (readout !== want) broken.push(`readout "${readout}"`);
          }
          expect(broken).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
    sheet.dispose();
  });
});
