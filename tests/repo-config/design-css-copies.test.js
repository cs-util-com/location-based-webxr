// Repo-meta test: every vendored copy of the design system's stylesheet is
// byte-identical to the canonical file, and every app that links it holds
// a copy.
//
// WHY THERE ARE COPIES AT ALL (DEC-L2-3, the adoption plan §4). A workspace
// dependency on GpsPlusSlamJs_DesignSystem would make it a node in the apps'
// dependency graph, and `test:changed` runs a changed package PLUS its
// dependents - so every taste tweak to the catalog would run every consuming
// app's gate: minutes of TypeScript checking that cannot see a CSS regression,
// against a catalog whose own gate is seconds-cheap on purpose. A copy keeps
// the taste loop fast and pins each app to the revision it chose to sync. The
// precedent, reasoned the same way, is escape-html-copies.test.js.
//
// WHY BYTES, unlike the escaper guard, which had to settle for an extracted
// contract because two prettier configs disagreed on quotes. CSS has no quote
// style to disagree on, the copy is written by `pnpm run vendor` in the
// design-system package and never by hand, and the apps' format stage globs
// only `**/*.html` (and, for the recorder, `src/**/*.css`) - so nothing
// reformats a vendored root-level `design.css` behind the guard's back. Line
// endings are normalised because autocrlf checkouts may hold either.
//
// WHAT IT CANNOT DO. It proves the SHEET is identical; it cannot see whether
// the app's own unlayered CSS overrides it (by design, under L1 in the plan §5
// app CSS wins), or whether the atoms are used well. Those are the per-app
// migration PRs' job.

import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CANONICAL = "GpsPlusSlamJs_DesignSystem/design.css";
const LAYER_STATEMENT = "@layer reset, tokens, base, atoms, screen;";

const read = (file) => readFileSync(resolve(repoRoot, file), "utf8");
const normalised = (text) => text.replace(/\r\n/g, "\n");

/** Every app directory, whether or not it holds a copy. */
const apps = readdirSync(repoRoot).filter(
  (d) =>
    /^GpsPlusSlamJs_/.test(d) &&
    d !== "GpsPlusSlamJs_DesignSystem" &&
    existsSync(join(repoRoot, d, "index.html")),
);
const holders = apps.filter((d) => existsSync(join(repoRoot, d, "design.css")));
const linkers = apps.filter((d) =>
  /<link[^>]+href="\/?design\.css"/.test(read(join(d, "index.html"))),
);

describe("design.css copies", () => {
  it("the canonical sheet exists and is the real thing (so the guard is not vacuous)", () => {
    // A guard that compares two missing or empty files passes forever.
    const css = normalised(read(CANONICAL));
    expect(css.split("\n").length).toBeGreaterThan(500);
    expect(css).toContain(LAYER_STATEMENT);
    expect(css).toContain("@layer base {");
  });

  it("at least one app holds a copy once adoption has started", () => {
    // Adoption plan M1 PR B vendors the first copy into AnchorStarter; a
    // regression that deleted every copy would otherwise leave the
    // per-copy checks below with nothing to compare.
    expect(holders.length).toBeGreaterThan(0);
  });

  it("every vendored copy is byte-identical to the canonical sheet", () => {
    const canonical = normalised(read(CANONICAL));
    for (const app of holders) {
      expect(
        normalised(read(join(app, "design.css"))),
        `${app}/design.css drifted - run \`pnpm run vendor\` in GpsPlusSlamJs_DesignSystem`,
      ).toBe(canonical);
    }
  });

  it("every app that links design.css holds a copy, and every copy is linked", () => {
    // Linked-but-not-vendored is a 404 in the built site; vendored-but-not-
    // linked is a dead 1300-line file the guard would keep in sync forever.
    expect(linkers.sort()).toEqual(holders.sort());
  });

  it("the copy is linked BEFORE the app's own <style>, so its @layer order is fixed first", () => {
    // Layer precedence is fixed by first appearance. An app's inline
    // <style> that later declares @layer must find the canonical order
    // already established; a link after the style block would invert it.
    for (const app of linkers) {
      // comments stripped: an explanatory comment that mentions "<style>"
      // (the pilot's does) must not stand in for the tag
      const html = read(join(app, "index.html")).replace(
        /<!--[\s\S]*?-->/g,
        "",
      );
      const link = html.search(/<link[^>]+href="\/?design\.css"/);
      const style = html.indexOf("<style");
      expect(
        style === -1 || link < style,
        `${app}: design.css must be linked before <style>`,
      ).toBe(true);
    }
  });
});
