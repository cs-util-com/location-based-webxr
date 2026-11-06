import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The landing page's links, read from the static markup.
 *
 * Why these tests matter: the demo hub is the page's whole purpose, and its
 * cards, the GitHub call to action, the FAQ and the legal link are plain
 * `index.html` markup that no script writes. So a parse of the file proves
 * what a browser run proved one slow round-trip at a time, in milliseconds:
 * every demo stays launchable in a new tab, no card repeats a retired claim
 * (a stale "Desktop only" sat on the OSM card for weeks because only the
 * hrefs were checked), and every external link leaves the landing open.
 */

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "");

interface Anchor {
  href: string;
  classes: string[];
  target: string | undefined;
  rel: string | undefined;
  inner: string;
}

const attribute = (attrs: string, name: string): string | undefined =>
  new RegExp(`(?<![\\w-])${name}="([^"]*)"`).exec(attrs)?.[1];

const anchors: Anchor[] = [
  ...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/g),
].map(([, attrs = "", inner = ""]) => ({
  href: attribute(attrs, "href") ?? "",
  classes: (attribute(attrs, "class") ?? "").split(/\s+/),
  target: attribute(attrs, "target"),
  rel: attribute(attrs, "rel"),
  inner,
}));

/** The trimmed text of the first `<tag>` inside `inner`, "" when absent. */
const textOf = (inner: string, tag: string): string =>
  new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`)
    .exec(inner)?.[1]
    ?.trim() ?? "";

const card = (href: string): Anchor | undefined =>
  anchors.find((a) => a.classes.includes("demo-card") && a.href === href);

describe("the landing page's static links", () => {
  // Keep in sync with requiredDemoLinks in scripts/build-site.mjs, which only
  // checks that each href exists at deploy time.
  it.each([
    "/starter/",
    "/minimal/",
    "/qr-demo/",
    "/recorder/",
    "/physics/",
    "/wayfinding/",
    "/osm/",
    "/tour/",
  ])(
    "the %s card opens in a new tab with a title and a description",
    (href) => {
      const found = card(href);
      expect(found, `no demo card for ${href}`).toBeDefined();
      expect(found?.target).toBe("_blank");
      expect(found?.rel).toMatch(/noopener/);
      expect(textOf(found?.inner ?? "", "strong")).not.toBe("");
      expect(textOf(found?.inner ?? "", "small")).not.toBe("");
      expect(found?.inner).not.toContain("Desktop only");
    },
  );

  it("names the two renamed cards for what they are", () => {
    expect(textOf(card("/osm/")?.inner ?? "", "strong")).toBe(
      "OpenStreetMap Demo",
    );
    expect(textOf(card("/tour/")?.inner ?? "", "strong")).toBe(
      "Tour Viewer Demo",
    );
  });

  it("keeps one GitHub call to action, with the mark, and no separate badge", () => {
    const primary = anchors.filter(
      (a) =>
        a.classes.includes("btn-primary") &&
        a.href === "https://github.com/cs-util-com/location-based-webxr",
    );
    expect(primary).toHaveLength(1);
    expect(primary[0]?.target).toBe("_blank");
    expect(primary[0]?.inner).toContain("<svg");
    expect(anchors.filter((a) => a.classes.includes("github-badge"))).toEqual(
      [],
    );
  });

  it("opens every external link in a new tab, so the landing stays open", () => {
    const external = anchors.filter((a) => a.href.startsWith("https://"));
    expect(external.length).toBeGreaterThan(3);
    for (const link of external) {
      expect(link.target, link.href).toBe("_blank");
      expect(link.rel, link.href).toMatch(/noopener/);
    }
  });

  it("offers four FAQ expanders and the license as a link", () => {
    expect(html.match(/<details>/g)).toHaveLength(4);
    const license = anchors.find((a) => a.classes.includes("faq-link"));
    expect(license?.href).toBe(
      "https://github.com/cs-util-com/location-based-webxr/blob/main/LICENSE",
    );
    expect(license?.target).toBe("_blank");
    expect(license?.rel).toMatch(/noopener/);
  });

  it("links the legal page by its name", () => {
    const legal = anchors.find((a) => a.href === "/legal/");
    expect(legal?.inner.trim()).toBe("Legal notice and privacy");
  });
});
