import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TESTDATA_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * WHY THIS TEST MATTERS.
 *
 * Every capture script in this package writes minified JSON on purpose —
 * indentation is ~25 % of an OSM geometry payload's bytes and these are
 * committed files. That intent was silently undone for months: the `format`
 * stage runs `prettier --write` over `src`, and this package was the only one
 * in the workspace with no `.prettierignore` of its own. Prettier resolves that
 * file relative to its cwd and never walks up to the workspace root, so the
 * root's copy was invisible here and every fixture was re-expanded on every
 * gate run.
 *
 * The bill: `sites/cologne-cathedral.non-areal.json` was written at 24.9 MB on
 * one line and committed at 41.4 MB across 1 128 493 lines, which alone was
 * 66.6 % of PR #249's diff. See
 * `GpsPlusSlamJs_Docs/docs/2026-08-04-0709-pr-249-diff-weight-audit.md`.
 *
 * This asserts the OUTCOME rather than the config, so it catches any cause —
 * a deleted ignore entry, a new format stage, a hand-edited fixture, or a
 * capture script that forgets to minify. It runs after `format` in the
 * `test:core` chain, which is what makes it a real gate: the format stage
 * rewrites first, and this test then reads what the rewrite left behind.
 *
 * It enumerates the directory rather than a curated list, and that is
 * deliberate. The 2 MB per-file ceiling in `sites/site-extracts.test.ts`
 * iterates `CORPUS_SITES`, so it never measured the 39.5 MiB file sitting in
 * its own directory — a list-driven gate only ever guards the things someone
 * remembered to list.
 */

/** Every `.json` under `src/testdata`, at any depth, package-relative. */
function fixtureFiles(dir: string = TESTDATA_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return fixtureFiles(full);
    return entry.isFile() && entry.name.endsWith(".json") ? [full] : [];
  });
}

describe("the committed fixtures stay minified", () => {
  const files = fixtureFiles();

  it("finds every fixture (the check is actually running)", () => {
    // Guards the failure mode where the walk returns nothing — a moved
    // directory, a wrong cwd — and every assertion below passes vacuously over
    // an empty list. 11 is the corpus as of 2026-08-04: four legacy fixtures,
    // six site extracts, one non-areal companion.
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  it.each(fixtureFiles().map((f) => [relative(TESTDATA_DIR, f), f] as const))(
    "%s is a single line",
    (_name, path) => {
      const raw = readFileSync(path, "utf8");
      // A trailing newline is fine and conventional; anything before it means
      // the file has been pretty-printed. `trimEnd` also absorbs the CRLF that
      // `core.autocrlf` produces on Windows checkouts.
      expect(raw.trimEnd()).not.toContain("\n");
    },
  );

  it.each(fixtureFiles().map((f) => [relative(TESTDATA_DIR, f), f] as const))(
    "%s still parses as JSON",
    (_name, path) => {
      // The companion to the assertion above. Minifying is a re-serialisation,
      // and a re-serialisation that produced valid-looking one-line garbage
      // would satisfy "single line" perfectly. Parsing is what proves the
      // bytes still mean what they meant.
      expect(() => {
        JSON.parse(readFileSync(path, "utf8"));
      }).not.toThrow();
    },
  );
});
