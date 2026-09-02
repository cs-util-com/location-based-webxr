/**
 * Screenshot harness for the design-system page, so an agent (or a human
 * in a hurry) can actually SEE what an edit rendered without opening a
 * browser. Modeled on GpsPlusSlamJs_Landing/scripts/shoot-chapters.mjs,
 * but simpler: the page is static, so it loads via file:// and needs no
 * dev server. The page's own URL-hash state (#bg=…&screen=…) addresses
 * backgrounds and screens directly.
 *
 * Usage (from GpsPlusSlamJs_DesignSystem/):
 *   pnpm run shoot                          # phone on every screen, foliage
 *   pnpm run shoot -- --bg=sky              # …over the blown-sky background
 *   pnpm run shoot -- --screen=hud          # one screen only
 *   pnpm run shoot -- --sel=".hud-readout"  # close-up of one element (3x)
 *   pnpm run shoot -- --page                # the whole page incl. atoms
 *
 * Output: GpsPlusSlamJs_DesignSystem/shots/<name>.png (gitignored), printed so
 * they can be Read directly. PNGs are deliberately NOT committed and NOT
 * asserted against: headless-GPU output differs per machine, which is the
 * same reason shoot-chapters.mjs rejected golden-image CI (see its
 * header). This is an eyeball tool, not a gate - with ONE exception:
 * console errors and page errors (including the page's own
 * keep-in-sync atom-drift assertion) fail the run, because they are
 * deterministic where pixels are not. The source-drift checks it used to
 * carry are now check-tokens.mjs, a real gate stage, imported here.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(join(here, "index.html")).href;
const outDir = join(here, "shots");
mkdirSync(outDir, { recursive: true });

// The two source-drift checks (colour literals outside the tokens layer,
// brief<->CSS token names) live in check-tokens.mjs, which is ALSO a gate
// stage; importing it here keeps shoot failing fast on the same problems
// with one implementation. It exits 1 on a finding before any browser work.
import "./check-tokens.mjs";

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
// "live" is NOT shootable, and refusing is the honest answer (PR #371
// review). The page deliberately never restores it from the hash (starting a
// camera without a user gesture would be blocked, and rude), and startLive()
// runs only from the LIVE button's click handler, which headless has nobody
// to press. So --bg=live used to render the plain "foliage" default and write
// it to phone-<screen>-live.png: a different background under a filename
// claiming otherwise, which is worse than either honest outcome.
if (bg === "live") {
  console.error(
    "shoot: --bg=live is not shootable headlessly. The camera background " +
      "needs a user gesture, so the page would silently render the default " +
      "and save it under a 'live' filename. Use --bg=foliage|sky|night, or " +
      "press LIVE in a real browser.",
  );
  process.exit(2);
}
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
  // Entrance animations are jumped to their end state before the shot.
  // Without this, a close-up of an atom that ARRIVES (the annotation text
  // fades in after a delay with fill: both, so it does not exist for the
  // first 800 ms) photographs an empty spot and the reader concludes the
  // atom is broken - which happened during the voice change, 2026-09-03.
  // Infinite animations (the radar sweep, the locating pulse) are left
  // running: finish() would throw on them, and their steady state IS the
  // thing to photograph.
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      if (a.effect?.getTiming().iterations !== Infinity) a.finish();
    }
  });

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
