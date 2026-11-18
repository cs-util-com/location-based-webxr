import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The prototype gallery (`public/prototypes/index.html`) is found by date:
 * a message saying "look at the calm HUD prototypes" is answered by a link
 * such as `prototypes/#2026-11-15-calm-hud`, and the page reads oldest first
 * with a newest-first list of sections at the top.
 *
 * Why this test matters: the gallery grows every prototype round, by hand.
 * Without it a new section could arrive undated, out of order or missing from
 * the list, and the page would slide back into a long scroll with no way to
 * tell a reader where a section is. Parsed with regular expressions because
 * the page is a static file with one fixed shape, and so the test runs in any
 * vitest environment.
 */

const PAGE = new URL("../public/prototypes/index.html", import.meta.url);
// A link such as `../asset-optimizer-check.html` leaves the public folder for
// one of the package's own Vite pages, which the build serves at the same
// relative place.
const PACKAGE_ROOT = new URL("../", import.meta.url);
const PUBLIC_ROOT = new URL("../public/", import.meta.url);
const ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Section {
  readonly id: string | undefined;
  readonly text: string;
  readonly inner: string;
}

interface TocEntry {
  readonly target: string;
  readonly label: string;
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Decodes the few entities the page uses, so text and attributes compare. */
function decode(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readSections(html: string): Section[] {
  return [...html.matchAll(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g)].map((m) => ({
    id: /\bid="([^"]*)"/.exec(m[1] ?? "")?.[1],
    text: textOf(m[2] ?? ""),
    inner: m[2] ?? "",
  }));
}

function readToc(html: string): TocEntry[] {
  const nav = /<nav class="toc"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [...nav.matchAll(/<a href="#([^"]+)">([\s\S]*?)<\/a>/g)].map((m) => ({
    target: m[1] ?? "",
    label: decode(textOf(m[2] ?? "")),
  }));
}

function dateOf(id: string): string {
  return ID_PATTERN.exec(id)?.[1] ?? "";
}

/** A heading's title: its text without the leading date and the trailing `#`. */
function titleOf(s: Section): string {
  return decode(s.text)
    .replace(/^\d{4}-\d{2}-\d{2}\s+/, "")
    .replace(/\s*#$/, "");
}

/** Whether a relative link from the gallery page reaches a file that exists. */
function linkResolves(href: string): boolean {
  const path = href.split("#")[0] ?? "";
  const url = new URL(path, PAGE);
  const file = path.endsWith("/") ? new URL("index.html", url) : url;
  if (existsSync(fileURLToPath(file))) return true;
  if (!file.href.startsWith(PUBLIC_ROOT.href)) return false;
  const page = new URL(file.href.slice(PUBLIC_ROOT.href.length), PACKAGE_ROOT);
  return page.href.endsWith(".html") && existsSync(fileURLToPath(page));
}

const html = readFileSync(PAGE, "utf8");
const sections = readSections(html);
const ids = sections.map((s) => s.id ?? "");

describe("prototype gallery index", () => {
  it("has sections to check", () => {
    expect(sections.length).toBeGreaterThan(0);
  });

  it("gives every section a unique id that starts with a date", () => {
    for (const s of sections) {
      expect(s.id, `section "${s.text}"`).toMatch(ID_PATTERN);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts every heading with the date of its id", () => {
    for (const s of sections) {
      const date = dateOf(s.id ?? "");
      expect(s.text.startsWith(`${date} `), s.text).toBe(true);
      expect(s.inner, s.text).toContain(`<time datetime="${date}">`);
    }
  });

  // The heading's date is the section's one date: a second copy in the body
  // ("Made 2026-10-12. ...") would be left stale by a corrected heading.
  it("dates a section in its heading only", () => {
    expect(html.match(/\bMade \d{4}-\d{2}-\d{2}/g) ?? []).toEqual([]);
  });

  // A screen reader's list of the page's links shows only their names, so
  // every self-link names its own section instead of sharing one name.
  it("gives every heading a copyable link to itself, named after it", () => {
    for (const s of sections) {
      const anchor = new RegExp(
        `<a class="anchor" href="#${s.id ?? ""}" aria-label="([^"]*)">#</a>`,
      ).exec(s.inner);
      expect(anchor, s.text).not.toBeNull();
      expect(decode(anchor?.[1] ?? ""), s.text).toBe(
        `Link to this section: ${titleOf(s)}`,
      );
    }
  });

  it("orders the sections oldest first", () => {
    const dates = ids.map(dateOf);
    expect(dates).toEqual([...dates].sort());
  });

  it("lists every section in the table of contents, newest first", () => {
    const toc = readToc(html).map((e) => e.target);
    expect([...toc].sort()).toEqual([...ids].sort());
    expect(toc).toEqual([...ids].reverse());
  });

  // Both sides are typed by hand, and a retitled heading keeps its slug (the
  // permalink), so only the label shows that the list went stale.
  it("labels every contents entry with its section's date and title", () => {
    const byId = new Map(sections.map((s) => [s.id ?? "", s]));
    for (const entry of readToc(html)) {
      const s = byId.get(entry.target);
      expect(s, entry.target).toBeDefined();
      if (s === undefined) continue;
      expect(entry.label, entry.target).toBe(
        `${dateOf(s.id ?? "")} ${titleOf(s)}`,
      );
    }
  });

  // An in-text link to another section ("are in the fixed ground views
  // section") goes dead silently when that section's slug is renamed; any id
  // on the page is a valid target, not only a section's.
  it("points every in-page link at an id that exists", () => {
    const known = new Set(
      [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ""),
    );
    for (const m of html.matchAll(/href="#([^"]+)"/g)) {
      expect(known.has(m[1] ?? ""), m[0]).toBe(true);
    }
  });

  // Every card links a prototype folder (or a check page) by hand; a renamed
  // or removed folder leaves a card that opens a 404.
  it("points every other link at a file that exists", () => {
    const links = [...html.matchAll(/\s(?:href|src)="([^"#][^"]*)"/g)]
      .map((m) => m[1] ?? "")
      .filter((href) => !/^[a-z][a-z0-9+.-]*:/i.test(href));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(linkResolves(href), href).toBe(true);
    }
  });
});
