/**
 * Why these tests matter (second testing session, F2 - and a correction to
 * the first attempt at it).
 *
 * The printed side length has TWO defaults: the `value` attribute in
 * `index.html`, which is what the field holds before any script runs, and
 * `AUTHOR_DEFAULT_SIZE_M`, which `creator-setup.ts` writes into the same
 * field at wiring time. The second one wins on every load, so a `value`
 * attribute that disagrees with it is dead text that reads like a decision.
 * The first attempt at F2 changed only the attribute (to 0.2) and therefore
 * changed nothing at all - and 0.2 m is a size that cannot be printed on A4
 * in the first place.
 *
 * These tests pin both halves: the two defaults agree, and the default is a
 * size a home printer can actually produce. Without the second assertion the
 * page could ship a default that warns "will not scan" on every single load.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTHOR_DEFAULT_SIZE_M } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import {
  homePrintWarning,
  MAX_HOME_PRINTABLE_SIDE_M,
} from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan";
import { MISSING_SIZE_MESSAGE } from "./qr-author-mode.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(packageRoot, "index.html"), "utf8");

/** The `value` attribute of `#author-size`, as authored. */
function authoredDefaultSize(): number {
  const tag = /<input\b[^>]*\bid="author-size"[^>]*>/s.exec(html)?.[0];
  expect(tag, "#author-size input not found in index.html").toBeDefined();
  const value = /\bvalue="([^"]*)"/.exec(tag ?? "")?.[1];
  expect(value, "#author-size has no value attribute").toBeDefined();
  return Number(value);
}

describe("the printed size's default", () => {
  it("is the same number in the markup and in the code that overwrites it", () => {
    // creator-setup.ts assigns AUTHOR_DEFAULT_SIZE_M into this field at
    // wiring time, so a differing attribute is never seen by anyone and
    // silently misleads the next reader of the markup.
    expect(authoredDefaultSize()).toBe(AUTHOR_DEFAULT_SIZE_M);
  });

  it("fits a home printer's page, so the default never warns on load", () => {
    // A default that trips the page-fit warning would tell every creator
    // their code "will not scan" before they have touched anything - and
    // it would be telling the truth, which is worse.
    expect(homePrintWarning(AUTHOR_DEFAULT_SIZE_M)).toBeNull();
    expect(AUTHOR_DEFAULT_SIZE_M).toBeLessThanOrEqual(
      MAX_HOME_PRINTABLE_SIDE_M,
    );
  });

  it("names that same number in the message shown when the field is empty", () => {
    // The message is the only place a creator is told what a plausible
    // size looks like; an example that is not the default sent the owner
    // looking for a number the page would have supplied anyway. It is
    // derived from the constant now, and this pins that it still reads as
    // a number rather than as a template that failed to interpolate.
    const example = /\(e\.g\. ([\d.]+)\)/.exec(MISSING_SIZE_MESSAGE)?.[1];
    expect(example, "the empty-field message names no example").toBe(
      String(AUTHOR_DEFAULT_SIZE_M),
    );
  });
});
