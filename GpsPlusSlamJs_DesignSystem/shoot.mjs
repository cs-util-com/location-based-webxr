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
 * header). This is an eyeball tool, not a gate.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(join(here, "index.html")).href;
const outDir = join(here, "shots");
mkdirSync(outDir, { recursive: true });

const args = new Map(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"];
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
