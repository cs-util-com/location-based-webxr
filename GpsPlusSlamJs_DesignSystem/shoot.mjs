/**
 * Screenshot harness for the design-system page, so an agent (or a human
 * in a hurry) can actually SEE what an edit rendered without opening a
 * browser. Modeled on GpsPlusSlamJs_Landing/scripts/shoot-chapters.mjs,
 * but simpler: the page is static, so it loads via file:// and needs no
 * dev server. The page's own URL-hash state (#bg=…&screen=…) addresses
 * backgrounds and screens directly.
 *
 * Usage (from GpsPlusSlamJs_Docs/):
 *   pnpm run shoot                          # phone on every screen, foliage
 *   pnpm run shoot -- --bg=sky              # …over the blown-sky background
 *   pnpm run shoot -- --screen=hud          # one screen only
 *   pnpm run shoot -- --sel=".hud-readout"  # close-up of one element (3x)
 *   pnpm run shoot -- --page                # the whole page incl. atoms
 *
 * Output: design-system/shots/<name>.png (gitignored), paths printed so
 * they can be Read directly. PNGs are deliberately NOT committed and NOT
 * asserted against: headless-GPU output differs per machine, which is the
 * same reason shoot-chapters.mjs rejected golden-image CI (see its
 * header). This is an eyeball tool, not a gate - with ONE exception:
 * console errors and page errors (including the page's own
 * keep-in-sync atom-drift assertion) fail the run, because they are
 * deterministic where pixels are not.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(join(here, "index.html")).href;
const outDir = join(here, "shots");
mkdirSync(outDir, { recursive: true });

// ---- source drift checks (fail fast, before any browser work) ----
// 1. No color literals outside the tokens layer: atoms + screen rules
//    must speak in var(--token). Comments are stripped; mask lines are
//    exempt (a #000 in a mask is an alpha stencil, not a color choice);
//    the demo layer is exempt (camera stand-ins are hex by nature).
// 2. Every --token name the brief mentions must exist in styles.css -
//    the brief is the extraction contract and silent drift is the
//    failure mode both checks exist to close.
{
  const css = readFileSync(join(here, "styles.css"), "utf8");
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
    if (name !== "atoms" && name !== "screen") continue;
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
  const brief = readFileSync(join(here, "hud-design-brief.md"), "utf8");
  // --token is the brief's generic placeholder in prose, not a name
  const prose = new Set(["--token", "--orange-500"]); // --orange-500 is the brief's forbidden EXAMPLE
  for (const name of new Set(brief.match(/--[a-z][a-z0-9-]+/g) ?? [])) {
    if (prose.has(name)) continue;
    if (!css.includes(`${name}:`) && !css.includes(`var(${name})`)) {
      problems.push(`brief mentions ${name}, styles.css does not define it`);
    }
  }
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
}

const args = new Map(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      // split on the FIRST = only: attribute selectors like
      // --sel='[data-state=located]' carry = inside the value
      const body = a.replace(/^--/, "");
      const eq = body.indexOf("=");
      return eq < 0 ? [body, "true"] : [body.slice(0, eq), body.slice(eq + 1)];
    }),
);

const SCREENS = ["hud", "experiments", "placement"];
const screens = args.has("screen") ? [args.get("screen")] : SCREENS;
const bg = args.get("bg") ?? "foliage";
const selector = args.get("sel");
const wholePage = args.has("page");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1400, height: 1000 },
  // close-ups are the point: render at 2x (3x for --sel) so 1px details
  // and hairlines are actually visible in the PNG
  deviceScaleFactor: selector ? 3 : 2,
});

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
});

const shots = [];
for (const screen of screens) {
  await page.goto(`${pageUrl}#bg=${bg}&screen=${screen}`);
  // the hash is read at load; fonts settle with the load event
  await page.waitForLoadState("load");

  if (selector) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: "visible" });
    const name = `${screen}-${bg}-${selector.replace(/[^a-z0-9-]+/gi, "_")}.png`;
    const path = join(outDir, name);
    await el.screenshot({ path });
    shots.push(path);
    continue;
  }
  if (wholePage) {
    const path = join(outDir, `page-${screen}-${bg}.png`);
    await page.screenshot({ path, fullPage: true });
    shots.push(path);
    continue;
  }
  const path = join(outDir, `phone-${screen}-${bg}.png`);
  await page.locator("#phone").screenshot({ path });
  shots.push(path);
}

await browser.close();
for (const s of shots) console.log(resolve(s));
if (errors.length) {
  for (const e of [...new Set(errors)]) console.error(e);
  process.exit(1);
}
