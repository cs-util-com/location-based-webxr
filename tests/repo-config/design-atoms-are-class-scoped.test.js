// Repo-meta test: the design system's `atoms` layer contains no bare type
// selector.
//
// WHY THIS IS THE INVARIANT THAT MATTERS. `design.css` is not a dependency,
// it is a COPY: `GpsPlusSlamJs_DesignSystem/vendor.mjs` writes it into every
// app that adopted it, and refreshes all of them on every sync. So a rule
// whose leftmost compound is a bare element - `details`, `summary`, `input`,
// `button` - does not restyle the app that wanted it. It restyles every
// adopter, including ones whose matching elements are built at runtime and
// therefore invisible to any snapshot-based check.
//
// The concrete near-miss this was written for: adding a disclosure atom for
// the Tour Viewer in 2026-09. `GpsPlusSlamJs_OsmDemo` styles
// `.panel-feature summary` and `.panel-feature-veto > summary` for elements
// its `src/details-panel.ts` creates after a map click. A bare
// `summary { … }` in the atoms layer would have restyled that panel, and no
// computed-style diff would have caught it: the design system's own
// `leaks.mjs` skips zero-size elements and reads the page before any
// interaction, so those elements are never in a sample.
//
// WHAT THIS DOES NOT SAY. It does not check that class names are unique
// across apps. That was considered and rejected: its success condition
// would be "nobody else adopts these atoms", so the first app to adopt one
// turns it red for doing the right thing. Uniqueness is not the property
// that keeps the copy safe - scoping is.
//
// The `reset` and `base` layers are deliberately exempt: they exist to set
// page-level defaults on bare elements (`body`, `h1`, `[hidden]`), which is
// their whole job. `screen` is exempt too - its compositions are all
// class-led, and a future bare selector there would be an app-layout
// question, not a vendoring hazard.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHEET = "GpsPlusSlamJs_DesignSystem/design.css";

/** The text of one `@layer <name> { … }` block, brace-counted. */
function layerBody(css, name) {
  const header = `@layer ${name} {`;
  const start = css.indexOf(header);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + header.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start + header.length, i);
    }
  }
  return null;
}

/**
 * Selectors in `body` whose leftmost compound is a bare type selector.
 * Comments are stripped first so a selector inside one cannot be reported,
 * and at-rule lines are skipped (`@media (…) {` is not a selector).
 */
function stripKeyframes(css) {
  // `@keyframes` bodies use STOP selectors - `from`, `to`, `50%` - which are
  // bare identifiers but are not type selectors at all. Scanning them
  // reported `to` twice on the first run of this guard. `@media` bodies are
  // deliberately NOT stripped: those hold real selectors that must be
  // checked.
  let out = css;
  for (;;) {
    const start = out.search(/@keyframes\b/);
    if (start === -1) return out;
    const open = out.indexOf("{", start);
    if (open === -1) return out.slice(0, start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return out.slice(0, start);
    out = out.slice(0, start) + out.slice(end + 1);
  }
}

function bareTypeSelectors(body) {
  const withoutComments = stripKeyframes(body).replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [];
  for (const match of withoutComments.matchAll(/(^|\})([^{}]*)\{/g)) {
    const prelude = match[2];
    if (prelude === undefined) continue;
    for (const selector of prelude.split(",")) {
      const trimmed = selector.trim();
      if (trimmed === "" || trimmed.startsWith("@")) continue;
      // The leftmost compound: up to the first combinator or whitespace.
      const leftmost = trimmed.split(/[\s>+~]/)[0] ?? "";
      // Class, id, attribute, pseudo-element on nothing, or a nesting
      // selector are all scoped. A bare element name is not.
      if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(leftmost)) found.push(trimmed);
    }
  }
  return found;
}

describe("design system atoms are class-scoped", () => {
  const css = readFileSync(resolve(repoRoot, SHEET), "utf8");

  it("has an atoms layer this test can actually read", () => {
    // Why this test matters: every assertion below is vacuously true if the
    // layer cannot be found, and a guard that passes by finding nothing is
    // the failure mode this whole file exists to prevent.
    const body = layerBody(css, "atoms");
    expect(body, `no @layer atoms block found in ${SHEET}`).not.toBeNull();
    expect(body.length).toBeGreaterThan(1000);
  });

  it("contains no selector whose leftmost compound is a bare element", () => {
    const offenders = bareTypeSelectors(layerBody(css, "atoms"));
    expect(
      offenders,
      `${SHEET}'s atoms layer must not select bare elements: this sheet is COPIED into every adopting app by vendor.mjs, so such a rule restyles apps that never asked for the atom - including elements they build at runtime, which no snapshot check can see. Scope it with a class instead.`
    ).toEqual([]);
  });

  it("still recognises a bare selector when one is planted", () => {
    // Why this test matters: the assertion above passes today, so without a
    // negative case there is no evidence the detector works at all rather
    // than merely returning an empty array.
    const planted = "  summary { cursor: pointer; }\n  .ok > summary { }\n";
    expect(bareTypeSelectors(planted)).toEqual(["summary"]);
  });

  it("does not mistake a keyframe stop for a type selector", () => {
    // Why this test matters: the first run of this guard reported `to`
    // twice, from the two @keyframes blocks in the atoms layer. `from`/`to`
    // and percentage stops are bare identifiers but select nothing, and a
    // guard that cries wolf on them would have been disabled rather than
    // fixed. A real selector AFTER the block must still be caught, which is
    // what the second line pins.
    const css =
      "@keyframes warn { from { opacity: 0; } to { opacity: 1; } }\n" +
      "  input { color: red; }\n";
    expect(bareTypeSelectors(css)).toEqual(["input"]);
  });
});
