/**
 * What would design.css change on an app page that does not link it yet?
 *
 * The adoption plan's "vendor it, delete nothing" step is only pixel-zero
 * where the app pins everything the sheet's reset and base layers touch;
 * wherever it leaves a browser default, a layered rule lands (the pilot
 * had three such leaks, the QR demo 29). Guessing which is how the third
 * leak on the pilot was missed - a button-only diff - so this measures ALL
 * of them: snapshot the computed style of every visible element, inject
 * the sheet, snapshot again, print each difference. Unlayered app CSS
 * beats the sheet whatever the order, so injecting last is the same
 * cascade as linking first.
 *
 * Usage (from GpsPlusSlamJs_DesignSystem/, with the app's dev server up):
 *   pnpm run leaks -- http://127.0.0.1:5185/
 *
 * Output: one line per changed property - `tag#id.class  prop: before ->
 * after` - and a count; "no differences" means the copy can land without
 * pins. Reads the app at a 390px phone viewport, before any interaction.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const url = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (!url) {
  console.error("leaks: pass the app page URL, e.g. http://127.0.0.1:5185/");
  process.exit(2);
}
const cssPath = new URL("./design.css", import.meta.url);
const css = readFileSync(cssPath, "utf8");
const PROPS = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-transform",
  "color",
  "background-color",
  "box-sizing",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "border-radius",
  "border-top-width",
  "gap",
  "display",
];
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
await pg.goto(url);
// load + a settle, not networkidle: a map page with live tile fetches never
// goes idle (OsmDemo timed out on it, 2026-09-03)
await pg.waitForLoadState("load");
await pg.waitForTimeout(1500);
const snap = () =>
  pg.evaluate((props) => {
    const out = {};
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      const key =
        el.tagName.toLowerCase() +
        (el.id ? "#" + el.id : "") +
        (el.className && typeof el.className === "string"
          ? "." + el.className.trim().replace(/\s+/g, ".")
          : "");
      const rec = { rect: [Math.round(r.width), Math.round(r.height)] };
      for (const p of props) rec[p] = cs.getPropertyValue(p);
      out[key] = rec;
    }
    return out;
  }, PROPS);
const before = await snap();
await pg.addStyleTag({ content: css });
await pg.waitForTimeout(100);
const after = await snap();
let n = 0;
for (const k of Object.keys(before)) {
  for (const p of Object.keys(before[k])) {
    const a = JSON.stringify(before[k][p]),
      z = JSON.stringify(after[k]?.[p]);
    if (a !== z) {
      console.log(`${k}  ${p}: ${a} -> ${z}`);
      n++;
    }
  }
}
console.log(n ? `${n} differences` : "no differences");
await b.close();
