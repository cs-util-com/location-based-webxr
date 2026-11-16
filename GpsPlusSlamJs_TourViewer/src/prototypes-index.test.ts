import { readFileSync } from "node:fs";

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
const ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Section {
  readonly id: string | undefined;
  readonly text: string;
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readSections(html: string): Section[] {
  return [...html.matchAll(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g)].map((m) => ({
    id: /\bid="([^"]*)"/.exec(m[1] ?? "")?.[1],
    text: textOf(m[2] ?? ""),
  }));
}

function readTocTargets(html: string): string[] {
  const nav = /<nav class="toc"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1] ?? "");
}

function dateOf(id: string): string {
  return ID_PATTERN.exec(id)?.[1] ?? "";
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
      expect(s.text.startsWith(`${dateOf(s.id ?? "")} `), s.text).toBe(true);
    }
  });

  it("gives every heading a copyable link to itself", () => {
    for (const id of ids) {
      expect(html).toContain(`<a class="anchor" href="#${id}"`);
    }
  });

  it("orders the sections oldest first", () => {
    const dates = ids.map(dateOf);
    expect(dates).toEqual([...dates].sort());
  });

  it("lists every section in the table of contents, newest first", () => {
    const toc = readTocTargets(html);
    expect([...toc].sort()).toEqual([...ids].sort());
    expect(toc).toEqual([...ids].reverse());
  });
});
