// @ts-check
/**
 * Style B's lowland in the browser (globe round-5 plan 2026-10-01-0945
 * §3.3; the owner's feedback 2026-10-01-0936 §4: "the lowest levels read as
 * plain green"; like the pastel atlas, lighter, mixed greens).
 *
 * Why this file matters: the unit tests prove the lowland function, but the
 * shader reads the relief spread from an 8-bit texture channel and the
 * small relief from another, so only the GPU shows that the drawn lowland
 * is the reference's. And "lighter, mixed" is a claim about the real
 * lowlands (northern Germany, the Alps' foreland), so it is measured on
 * their fields, against style B as it was, with the wood mix's parameters
 * swept (the owner rule 2026-09-13).
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  boot,
  fixtureTile,
  readPixels,
  routeAll,
  state,
  sweepLine,
} from "./terrain-smoke-helpers.mjs";
import {
  NATURAL,
  naturalBaseColour,
  naturalColour,
  treeLineM,
} from "./terrain-styles.js";
import { deltaE76, linearLuminance } from "./terrain-globe-colour.js";
import { linearToSrgb, srgbToLinear } from "./terrain-far-field.js";

const LOOK = { shade: 1.6, shadow: 0.8 };
const VIEW =
  `style=natural&alt=300000&tilt=0&head=0&svf=0&tau=0&exag=1&light=0` +
  `&shade=${LOOK.shade}&shadow=${LOOK.shadow}`;
/** Style B as it was: one plain lowland green. */
const BEFORE = {
  ...NATURAL,
  lowland: "#7F9860",
  lowlandLight: "#7F9860",
  lowlandWood: "#7F9860",
};

/** The field on a grid over the region (ENU metres), land posts only. */
const fieldGrid = (page, n, halfM) =>
  page.evaluate(
    ([n, halfM]) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const x = -halfM + ((i + 0.5) * 2 * halfM) / n;
          const y = -halfM + ((j + 0.5) * 2 * halfM) / n;
          const f = window.__terrainLab.fieldAt(x, y);
          if (f && f.heightM > 0) out.push({ x, y, ...f });
        }
      }
      return out;
    },
    [n, halfM],
  );

/** Mean linear luminance and colour variety (mean ΔE to the mean colour). */
function lowlandStats(colours) {
  const meanLin = [0, 1, 2].map(
    (c) => colours.reduce((s, v) => s + srgbToLinear(v[c]), 0) / colours.length,
  );
  const mean = meanLin.map(linearToSrgb);
  return {
    luminance:
      colours.reduce((s, v) => s + linearLuminance(v), 0) / colours.length,
    variety:
      colours.reduce((s, v) => s + deltaE76(v, mean), 0) / colours.length,
  };
}

/**
 * The worst-tolerated mean channel error (8-bit) of the drawn style B
 * against `naturalColour`: the relief spread's 8-bit channel (3.9 m a step)
 * and the half-float field. Swept 2-8.
 *
 * The margin is thin on the Alps: measured 3.54 there on 2026-10-01
 * (Germany 0.67), so the Alps row is the likeliest first red. A red here
 * is first a question of whether the reference or the shader moved (the
 * logged sweep line shows how close it was), never a reason to widen this.
 */
const LOWLAND_MEAN_TOLERANCE = 4;

test("style B's lowland: drawn as the reference, lighter and mixed on the real lowlands", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const record = await routeAll(page, fixtureTile);
  const errors = await boot(page, `place=germany&${VIEW}`);
  expect(record.missing).toEqual([]);
  for (const place of ["germany", "alps"]) {
    if (place !== "germany") await applyHash(page, `place=${place}&${VIEW}`);
    await page.waitForFunction(
      (want) => {
        const s = window.__terrainLab.state();
        return s.place === want && s.hasData === true;
      },
      place,
      { timeout: 120_000 },
    );
    const s = await state(page);
    const lat = s.centre.lat;
    // The drawn pixels against the reference, on open lowland.
    const top = 0.5 * Math.max(treeLineM(lat) - NATURAL.edgeM, 1);
    const ground = (await fieldGrid(page, 25, 96_000)).filter(
      (p) => p.heightM < top,
    );
    expect(ground.length).toBeGreaterThan(50);
    const at = await page.evaluate(
      (ps) => window.__terrainLab.projectAll(ps),
      ground.map((p) => [p.x, p.heightM - s.datum, -p.y]),
    );
    const px = await readPixels(page, at);
    const gain = LOOK.shade * s.slopeBoost;
    const errs = ground.flatMap((p, i) =>
      naturalColour(
        { ...p, latDeg: lat, svf: 1 },
        { gain, shadow: LOOK.shadow },
      ).map((v, c) => Math.abs(Math.round(v * 255) - px[i][c])),
    );
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    console.log(
      `${place}: style B's lowland against its reference: mean channel error ${mean.toFixed(2)} ` +
        `(${sweepLine(mean, [2, 3, 4, 6, 8])}), worst ${Math.max(...errs)}, ${ground.length} posts`,
    );
    expect(mean).toBeLessThanOrEqual(LOWLAND_MEAN_TOLERANCE);

    // Lighter and mixed: the cover colour of the region's lowland posts,
    // now and as it was, with the wood mix's parameters swept.
    const lowland = (await fieldGrid(page, 120, 128_000)).filter(
      (p) => p.heightM < top,
    );
    const colours = (style) =>
      lowland.map((p) => naturalBaseColour({ ...p, latDeg: lat }, {}, style));
    const before = lowlandStats(colours(BEFORE));
    const now = lowlandStats(colours(NATURAL));
    console.log(
      `${place}: ${lowland.length} lowland posts; luminance ${before.luminance.toFixed(3)} -> ${now.luminance.toFixed(3)}, ` +
        `variety (mean ΔE to their mean) ${before.variety.toFixed(2)} -> ${now.variety.toFixed(2)}`,
    );
    for (const woodSpreadM of [
      [20, 120],
      [40, 220],
      [80, 400],
    ]) {
      for (const woodAmount of [0.3, 0.6, 0.9]) {
        const st = lowlandStats(
          colours({ ...NATURAL, woodSpreadM, woodAmount }),
        );
        console.log(
          `${place}: wood by spread ${woodSpreadM.join("-")} m, amount ${woodAmount}: ` +
            `luminance ${st.luminance.toFixed(3)}, variety ${st.variety.toFixed(2)}`,
        );
      }
    }
    // The gully term is the one driver that can act on flat land (the
    // relief spread there stays under the wood's lower bound): swept.
    for (const gullyM of [8, 15, 30, 60]) {
      const st = lowlandStats(colours({ ...NATURAL, gullyM }));
      console.log(
        `${place}: gully depth ${gullyM} m: luminance ${st.luminance.toFixed(3)}, variety ${st.variety.toFixed(2)}`,
      );
    }
    expect(now.luminance).toBeGreaterThan(before.luminance);
    expect(now.variety).toBeGreaterThan(before.variety);
  }
  expect(errors).toEqual([]);
});
