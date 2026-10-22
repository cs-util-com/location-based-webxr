/**
 * The globe's height conversion with the Osm library's EGM96 geoid (tour
 * editor plan 2026-10-17-1816 §13, G1 step 3).
 *
 * Why this test matters: the Globe package takes the geoid as an argument
 * (it depends on neither the Osm library nor the framework), so nothing in
 * its own tests shows that the model an app actually passes,
 * `egm96Geoid()`, fits and gives the numbers the G0 spikes measured. A GPS
 * altitude of 561.68 m at Marienplatz is ground drawn at about 516 m (N
 * 45.68 m); without the geoid an item floats 46 m up, with the sign wrong
 * it sinks as far.
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// The served packages import their siblings as `./x.js` (the browser gets
// the stripped `.ts` through the dev server's routes); Node needs the `.ts`.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
      const ts = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
    return next(specifier, context);
  },
});

const REPO = new URL("../../../", import.meta.url);
const { egm96Geoid } = await import(
  new URL("GpsPlusSlamJs_Osm/src/elevation/egm96.ts", REPO).href
);
const { drawnHeightM, ellipsoidalHeightM } = await import(
  new URL("GpsPlusSlamJs_Globe/src/globe-heights.ts", REPO).href
);

const MARIENPLATZ = { lat: 48.1374, lng: 11.5755 };
const LUCERNE = { lat: 47.0502, lng: 8.3093 };

describe("the globe's heights with the Osm library's EGM96 geoid", () => {
  it("draws the spikes' Marienplatz GPS altitude at its ground", () => {
    const geoid = egm96Geoid();
    const n = geoid.undulationMetres(MARIENPLATZ);
    // The 1-degree grid is within 0.25 m of the exact model on average and
    // 5 m at worst; in flat central Europe it is close to exact.
    assert.ok(Math.abs(n - 45.68) < 1, `N at Marienplatz ${n}`);
    const drawn = drawnHeightM(561.68, MARIENPLATZ, geoid);
    assert.ok(Math.abs(drawn - 516) < 1, `drawn ${drawn}`);
    assert.ok(
      Math.abs(ellipsoidalHeightM(drawn, MARIENPLATZ, geoid) - 561.68) < 1e-9,
    );
  });

  // Why: N varies by place (Lucerne about 49 m): the conversion must ask
  // the model at the item's own place, not use one number for a country.
  it("asks the model at each place", () => {
    const geoid = egm96Geoid();
    const here = drawnHeightM(500, MARIENPLATZ, geoid);
    const there = drawnHeightM(500, LUCERNE, geoid);
    assert.ok(Math.abs(here - there) > 1, `${here} vs ${there}`);
  });
});
