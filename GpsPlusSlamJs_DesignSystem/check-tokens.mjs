/**
 * The design system's two source-drift checks, as a gate stage.
 *
 * They started life inside shoot.mjs, which made them run only when a
 * human asked for screenshots - i.e. never in a gate (adoption-plan
 * review, 2026-08-27). Now they are a stage of the package's `pnpm test`
 * and shoot.mjs imports this module for its side effect, so the two entry
 * points share ONE implementation.
 *
 * 1. No colour literal outside the tokens layer. The `base`, `atoms` and
 *    `screen` layers must speak in var(--token): a hex or rgb() there is a
 *    value the token contract does not know about. Comments are stripped;
 *    `mask` lines are exempt (a #000 in a mask is an alpha stencil, not a
 *    colour choice); the `demo` layer is exempt (camera stand-ins are hex
 *    by nature) and so is `reset`.
 * 2. Every --token the brief names must exist in the CSS. The brief is
 *    the extraction contract an outside LLM works from; a token it names
 *    that the CSS no longer defines is exactly the drift that makes the
 *    contract lie.
 *
 * Both checks read design.css AND catalog.css: the layer split (M1 of the
 * adoption plan) put the shipped layers in one file and the catalog-only
 * layers in the other, and a check that read one of them would either pass
 * vacuously or false-positive on every token.
 *
 * Exit 1 with one line per problem. Negative-tested by planting a literal
 * and a phantom token (see check-tokens.mjs.md).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");

// layers that must be literal-free; everything else is exempt
const TOKENED_LAYERS = new Set(["base", "atoms", "screen"]);
// --token is the brief's generic placeholder in prose; --orange-500 is
// its forbidden EXAMPLE of a value-named primitive
const PROSE_NAMES = new Set(["--token", "--orange-500"]);

function findProblems({ css, brief }) {
  const problems = [];
  const layerRe = /@layer (\w+) \{/g;
  let m;
  while ((m = layerRe.exec(css))) {
    const name = m[1];
    let depth = 1;
    let i = layerRe.lastIndex;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth++;
      if (css[i] === "}") depth--;
      i++;
    }
    if (!TOKENED_LAYERS.has(name)) continue;
    const body = css
      .slice(layerRe.lastIndex, i)
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const line of body.split("\n")) {
      if (/\bmask\b/.test(line)) continue;
      if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(|oklch\(/.test(line)) {
        problems.push(`color literal in @layer ${name}: ${line.trim()}`);
      }
    }
  }
  for (const name of new Set(brief.match(/--[a-z][a-z0-9-]+/g) ?? [])) {
    if (PROSE_NAMES.has(name)) continue;
    // A DEFINITION (`--name:`), never a use: `var(--name)` surviving a deleted
    // declaration is exactly the case this check exists for (PR #411 review).
    // No brief-named token is reference-only today; if one ever must be,
    // list it beside PROSE_NAMES rather than widening this rule.
    if (!css.includes(`${name}:`)) {
      problems.push(`brief mentions ${name}, the CSS does not define it`);
    }
  }
  return problems;
}

const css = read("design.css") + "\n" + read("catalog.css");
const problems = findProblems({ css, brief: read("hud-design-brief.md") });
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
