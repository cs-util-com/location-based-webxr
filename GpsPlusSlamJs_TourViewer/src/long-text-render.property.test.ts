// @vitest-environment jsdom
/**
 * Why this test matters: the body is any text a tour's maker typed, and
 * the renderer's promise is that whatever it is, the page gets only the
 * allowlisted elements and attributes - never markup from the text
 * itself. Hand-written cases cover the forms we thought of; this throws
 * generated bodies built from the characters Markdown and HTML care about
 * at it, so a form nobody thought of cannot slip a tag or an attribute
 * through.
 *
 * Loose characters alone almost never form a whole link or picture line
 * (none in 30 000 sampled bodies), so the generator also emits whole
 * links and picture lines with good and bad targets; the last test keeps
 * that share from silently falling back to zero.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseTourMarkdown } from "gps-plus-slam-app-framework/ar/tour-markdown";

import { createLongTextPictures } from "./long-text-pictures.js";
import { LONG_TEXT_ALLOWED, renderLongText } from "./long-text-render.js";

const PIECES = [
  "# ",
  "## ",
  "- ",
  "1. ",
  "> ",
  "*",
  "**",
  "_",
  "[",
  "](",
  ")",
  "![",
  "asset:mill",
  "https://town.example/a",
  "javascript:alert(1)",
  "<b>",
  "<script>",
  '" onclick="x',
  "&amp;",
  "\\",
  "  \n",
  "\n",
  "\n\n",
  "   ",
  "word",
  "Mühle",
];

/** Link targets: the one kind a link may have, and the ones it may not. */
const LINK_TARGETS = [
  "https://town.example/a",
  "https://town.example/path?q=1#f",
  "javascript:alert(1)",
  "data:text/html,x",
  "blob:x",
  "http://x",
  "https://u:p@h/",
  "//town.example/a",
  "/local",
];

/** The tour's own picture assets (the only ones a picture may show). */
const TOUR_ASSETS = ["mill", "bell"];

/** Picture targets: the tour's assets, an asset it lacks, and bad ones. */
const PICTURE_TARGETS = [
  ...TOUR_ASSETS.map((id) => `asset:${id}`),
  "asset:gone",
  "asset:",
  "https://town.example/p.jpg",
  "javascript:alert(1)",
  "data:image/png,x",
  "blob:x",
  "content/mill.jpg",
];

const linkArbitrary = fc
  .tuple(
    fc.constantFrom("map", "the **town**", "*see*", "x", ""),
    fc.constantFrom(...LINK_TARGETS),
  )
  .map(([text, target]) => `[${text}](${target})`);

const pictureArbitrary = fc
  .tuple(
    fc.constantFrom("the mill", "", "a [b]", "**bold**"),
    fc.constantFrom(...PICTURE_TARGETS),
  )
  .map(([alt, target]) => `\n\n![${alt}](${target})\n\n`);

const body = fc
  .array(
    fc.oneof(
      fc.constantFrom(...PIECES),
      fc.string({ maxLength: 4 }),
      { arbitrary: linkArbitrary, weight: 3 },
      { arbitrary: pictureArbitrary, weight: 3 },
    ),
    { maxLength: 40 },
  )
  .map((parts) => parts.join(""));

const LINK_ATTRIBUTES = ["href", "target", "rel", "referrerpolicy"];

function render(text: string) {
  const host = document.createElement("div");
  const out = renderLongText(parseTourMarkdown(text), {
    document,
    onLinkTap: () => undefined,
  });
  host.append(out.fragment);
  return { host, pictures: out.pictures };
}

/** Fills the body's pictures as the sheet would, every one in view, with
 *  files only for the tour's assets; returns the URLs it made. */
async function showPictures(
  pictures: ReturnType<typeof render>["pictures"],
): Promise<Set<string>> {
  const made = new Set<string>();
  const controller = createLongTextPictures({
    pictures,
    document,
    load: (asset) =>
      TOUR_ASSETS.includes(asset)
        ? Promise.resolve(new Blob([asset]))
        : Promise.reject(new Error("not in the tour")),
    fit: () => Promise.resolve({ ok: true, pixels: 1 }),
    screensAway: () => 0,
    createUrl: () => {
      const url = `blob:tour/${String(made.size)}`;
      made.add(url);
      return url;
    },
    revokeUrl: () => undefined,
  });
  controller.update();
  // The controller works on promises only: a few microtask turns settle
  // every load and fit.
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  return made;
}

describe("renderLongText (property)", () => {
  it("emits only allowlisted elements and attributes, whatever the body", async () => {
    await fc.assert(
      fc.asyncProperty(body, async (text) => {
        const { host, pictures } = render(text);
        const made = await showPictures(pictures);
        for (const el of host.querySelectorAll("*")) {
          const allowed = LONG_TEXT_ALLOWED[el.localName];
          expect(allowed, el.localName).toBeDefined();
          for (const attr of el.getAttributeNames()) {
            expect(allowed).toContain(attr);
          }
        }
        for (const a of host.querySelectorAll("a")) {
          expect(a.getAttributeNames().sort()).toEqual(
            [...LINK_ATTRIBUTES].sort(),
          );
          const href = new URL(a.getAttribute("href") ?? "");
          expect(href.protocol).toBe("https:");
          expect(href.username).toBe("");
          expect(href.password).toBe("");
        }
        const imgs = [...host.querySelectorAll("img")];
        for (const img of imgs) {
          expect(made).toContain(img.getAttribute("src"));
        }
        // Every picture of the tour's own assets shows; no other does.
        expect(imgs).toHaveLength(
          pictures.filter((p) => TOUR_ASSETS.includes(p.asset)).length,
        );
        for (const slot of pictures) {
          expect(host.contains(slot.holder)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  }, 30_000);

  // Why this test matters: the property above proves nothing about links
  // and pictures if the generator stops making them - which is what the
  // loose characters alone did. This pins a floor under the share of
  // bodies that render at least one link and at least one tour picture.
  it("generates bodies that render links and pictures", () => {
    const sample = fc.sample(body, { numRuns: 2000, seed: 42 });
    let links = 0;
    let shown = 0;
    for (const text of sample) {
      const { host, pictures } = render(text);
      if (host.querySelector("a") !== null) links += 1;
      if (pictures.some((p) => TOUR_ASSETS.includes(p.asset))) shown += 1;
    }

    expect(links / sample.length).toBeGreaterThan(0.2);
    expect(shown / sample.length).toBeGreaterThan(0.2);
  });
});
