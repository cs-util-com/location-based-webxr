import { readFileSync } from "node:fs";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { USE_CASES, type UseCase } from "./use-case-data.js";
import { USE_CASE_TREATMENTS } from "./use-case-draw.js";
import {
  renderUseCases,
  SHIPPED_TREATMENT,
  USE_CASES_SHOWN_FIRST,
} from "./use-case-markup.js";

const count = (s: string, needle: RegExp) => [...s.matchAll(needle)].length;

/** The markup before the fold (shown) and inside it (folded). */
function lists(markup: string): { shown: string; folded: string } {
  const [shown = "", folded = ""] = markup.split('<details class="uc-more"');
  return { shown, folded };
}

function entry(text: string): UseCase {
  return {
    id: "probe",
    title: text,
    sentence: text,
    alt: text,
    scene: '<rect width="1" height="1" fill="#eeeeee"/>',
    overlay: () => '<rect width="1" height="1" fill="#cf4428"/>',
  };
}

describe("renderUseCases", () => {
  const markup = renderUseCases(USE_CASES);

  // Why: a picture's drawing holds nested svg elements and text (a card's
  // title, a label), which a screen reader would announce as further
  // images and words after the picture's own description. The label
  // speaks for the picture, so its drawing is hidden.
  it("hides every picture's drawing behind its label", () => {
    for (const t of USE_CASE_TREATMENTS) {
      const html = renderUseCases(USE_CASES, { treatment: t });
      const screens = [
        ...html.matchAll(/<svg class="uc-screen"[^>]*>(.{0,40})/g),
      ];
      expect(screens).toHaveLength(USE_CASES.length);
      for (const [, after] of screens) {
        expect((after ?? "").startsWith('<g aria-hidden="true">')).toBe(true);
      }
    }
  });

  // Why: the swept choice - six fill whole rows at two and three columns,
  // eight leave a ragged last row at three (the sidecar has the sweep).
  it("shows the first six and folds the rest under More ideas", () => {
    expect(USE_CASES_SHOWN_FIRST).toBe(6);
    const { shown, folded } = lists(markup);
    expect(count(shown, /<li class="uc-item"/g)).toBe(6);
    expect(count(folded, /<li class="uc-item"/g)).toBe(USE_CASES.length - 6);
    expect(markup).toMatch(
      new RegExp(
        `<summary class="uc-more-toggle">[\\s\\S]*More ideas \\(${USE_CASES.length - 6}\\)`,
      ),
    );
  });

  // Why: the disclosure is a native details element: keyboard and screen
  // readers need no wiring, and it starts closed.
  it("folds with a native details element that starts closed", () => {
    expect(markup).toMatch(/<details class="uc-more">/);
    expect(markup).not.toMatch(/<details[^>]* open/);
  });

  it("keeps the order of the data", () => {
    const titles = [
      ...markup.matchAll(/<h3 class="uc-title">([^<]*)<\/h3>/g),
    ].map((m) => m[1]);
    expect(titles).toEqual(
      USE_CASES.map((u) => u.title.replace(/'/g, "&#39;")),
    );
  });

  // Why: a landscape phone screen; the CSS ratio and the drawing's
  // viewBox must agree, or the picture is cropped or letterboxed.
  it("draws every picture as a 21:10 screen with its alt text", () => {
    expect(count(markup, /<svg class="uc-screen" viewBox="0 0 210 100"/g)).toBe(
      USE_CASES.length,
    );
    for (const u of USE_CASES) {
      expect(markup).toContain(
        `role="img" aria-label="${u.alt.replace(/'/g, "&#39;")}"`,
      );
    }
    const css = readFileSync(
      new URL("./use-cases.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/\.uc-screen\s*{[^}]*aspect-ratio: 21 \/ 10;/);
  });

  // Why: every SVG id lives in one document; a duplicate would point the
  // glow of every picture at whichever came first.
  it("uses every id once", () => {
    for (const t of USE_CASE_TREATMENTS) {
      const ids = [
        ...renderUseCases(USE_CASES, { treatment: t }).matchAll(
          /\bid="([^"]+)"/g,
        ),
      ].map((m) => m[1]);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  // Why: the page must look the same on every load (no random art), and a
  // screenshot comparison needs byte-identical markup.
  it("is deterministic", () => {
    expect(renderUseCases(USE_CASES)).toBe(markup);
    for (const file of [
      "use-case-draw.ts",
      "use-case-data.ts",
      "use-case-markup.ts",
    ]) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(src, file).not.toMatch(
        /Math\.random|Date\.now|new Date|performance\.now/,
      );
    }
  });

  it("ships the route-light look", () => {
    expect(SHIPPED_TREATMENT).toBe("route-light");
    expect(markup).toContain('data-look="route-light"');
  });

  it("has a heading the page's outline can use", () => {
    expect(markup).toMatch(
      /<section class="uc" aria-labelledby="uc-heading"[^>]*>[\s\S]*<h2 class="uc-heading" id="uc-heading">/,
    );
  });

  it("leaves out the fold when every example is shown", () => {
    const all = renderUseCases(USE_CASES, { shownFirst: USE_CASES.length });
    expect(all).not.toContain("<details");
  });

  // Why: a bad option is a programming error at the module boundary; it
  // must fail loudly rather than render a section with nothing in it.
  it("refuses a bad option", () => {
    expect(() => renderUseCases(USE_CASES, { shownFirst: -1 })).toThrow(
      RangeError,
    );
    expect(() => renderUseCases(USE_CASES, { shownFirst: 1.5 })).toThrow(
      RangeError,
    );
    expect(() =>
      renderUseCases(USE_CASES, { treatment: "neon" as never }),
    ).toThrow(RangeError);
    expect(() => renderUseCases([])).toThrow(RangeError);
  });

  // Why: the text of an entry is written into markup and an attribute; a
  // tag or a quote in it must arrive as text.
  it("escapes the text it writes", () => {
    const out = renderUseCases([entry(`<img src=x onerror="go()"> & 'it'`)]);
    expect(out).not.toContain("<img");
    expect(out).toContain(
      "&lt;img src=x onerror=&quot;go()&quot;&gt; &amp; &#39;it&#39;",
    );
  });
});

describe("renderUseCases, properties", () => {
  /** The markup's tags with their attribute values blanked. */
  const shape = (markup: string) =>
    [...markup.matchAll(/<[^>]*>/g)].map((m) => m[0].replace(/"[^"]*"/g, '""'));

  // Why: whatever the text, it can only ever fill the slots it was given:
  // the tag structure stays that of a harmless text.
  it("keeps the markup's shape for any text", () => {
    const harmless = shape(renderUseCases([entry("plain")]));
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(shape(renderUseCases([entry(text)]))).toEqual(harmless);
      }),
    );
  });

  // Why: the split never loses or repeats an example, whatever the cut.
  it("splits into shown and folded without losing one", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: USE_CASES.length }),
        fc.integer({ min: 0, max: USE_CASES.length + 3 }),
        (n, shownFirst) => {
          const cases = USE_CASES.slice(0, n);
          const out = renderUseCases(cases, { shownFirst });
          const { shown, folded } = lists(out);
          const s = count(shown, /<li class="uc-item"/g);
          const f = count(folded, /<li class="uc-item"/g);
          expect(s).toBe(Math.min(shownFirst, n));
          expect(s + f).toBe(n);
          expect(out.includes("<details")).toBe(f > 0);
        },
      ),
    );
  });
});
