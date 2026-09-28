// @ts-check
/**
 * God rays on the look-dev page (round-3 look-dev programme, stream G):
 * radial screen-space light shafts from the visible sky around the sun
 * (god-rays.js).
 *
 * Why this file matters: the effect is judged by eye, and a check that
 * passes today proves nothing, so every claim is measured AGAINST ITS OWN
 * OFF BASELINE at the same pixels, in the same page load, with the clouds
 * pinned. The look claims are measured on the desktop tier, where "off" is
 * the same composer with the pass disabled, so any difference IS the rays;
 * the phone tier's claims compare against its own no-composer picture.
 * SwiftShader times are relative only.
 */
import { expect, test } from "@playwright/test";

import { boot } from "./smoke-boot.mjs";

/** The "straight at the sun" camera (lookdev.js placeCamera "atsun"). */
const EYE = [-20, 18, 60];

/**
 * Install the page-side helpers once per page: frame statistics computed
 * in the page (a frame is 4 MB; only numbers cross to the test).
 */
async function installHelpers(page) {
  await page.evaluate(() => {
    const d = window.__lookdev;
    /** The sun's pixel (GL rows, bottom first) from the pass's own NDC. */
    const sunPixel = (w, h) => {
      const i = d.godRaysInfo();
      return [((i.x + 1) / 2) * w, ((i.y + 1) / 2) * h];
    };
    window.__gr = {
      /**
       * Gain statistics of `on` over `off` (sum of RGB per pixel), around
       * the sun at `sun` (pixels): the band 0.05-0.25 canvas heights out
       * (mean, and the brightest and dimmest of 16 sectors), beyond 0.6
       * heights (mean), the share of the frame brightened by > 30, the
       * pixels darkened in luminance by more than 1.5 levels (`darker`)
       * and in the sum of RGB by more than 1 (`sumDarker`: Khronos
       * Neutral's hue-preserving compression can lower a saturated
       * pixel's other channels by a level or two when light of another hue
       * is added in HDR; AgX and ACES do not, results record), and the
       * largest single gain.
       */
      stats(off, on, sun) {
        const { width: w, height: h } = on;
        const sectors = new Array(16).fill(0);
        const counts = new Array(16).fill(0);
        let band = 0;
        let bandN = 0;
        let far = 0;
        let farN = 0;
        let veiled = 0;
        let darker = 0;
        let sumDarker = 0;
        let max = 0;
        let changed = 0;
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            const g =
              on.data[i] +
              on.data[i + 1] +
              on.data[i + 2] -
              (off.data[i] + off.data[i + 1] + off.data[i + 2]);
            if (g !== 0) changed += 1;
            if (g > max) max = g;
            if (g > 30) veiled += 1;
            if (g < -1) sumDarker += 1;
            const lum = (px, k) =>
              0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2];
            if (lum(on.data, i) < lum(off.data, i) - 1.5) darker += 1;
            if (!sun) continue;
            const r = Math.hypot(x - sun[0], y - sun[1]) / h;
            if (r >= 0.05 && r <= 0.25) {
              band += g;
              bandN += 1;
              const a = Math.atan2(y - sun[1], x - sun[0]);
              const k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 16) % 16;
              sectors[k] += g;
              counts[k] += 1;
            } else if (r > 0.6) {
              far += g;
              farN += 1;
            }
          }
        }
        const means = sectors
          .map((s, k) => (counts[k] ? s / counts[k] : null))
          .filter((m) => m !== null);
        const total = (w * h) / 4;
        return {
          band: bandN ? band / bandN : 0,
          sectorMax: means.length ? Math.max(...means) : 0,
          sectorMin: means.length ? Math.min(...means) : 0,
          far: farN ? far / farN : 0,
          veil: veiled / total,
          darker,
          sumDarker,
          max,
          changed,
        };
      },
      /**
       * The rays' gain in the current view: a frame with the pass off and
       * one with it on (the desktop tier: the same composer), their stats.
       */
      gain() {
        d.setGodRays(false);
        const off = d.readFrame();
        d.setGodRays(true);
        const on = d.readFrame();
        const info = d.godRaysInfo();
        const sun = info.fade > 0 ? sunPixel(on.width, on.height) : null;
        return { ...window.__gr.stats(off, on, sun), fade: info.fade };
      },
      /**
       * The rays' gain in SCENE-LINEAR luminance (before tone mapping,
       * where equal light is equal gain), mean over 16 points on a ring
       * `near` and `far` canvas heights from the sun (points off the
       * canvas skipped): near must exceed far.
       */
      hdrGain(near = 0.1, far = 0.6) {
        const i = d.godRaysInfo();
        const sun = [(i.x + 1) / 2, (1 - i.y) / 2];
        const aspect = 1280 / 800;
        const ring = (r) => {
          const out = [];
          for (let k = 0; k < 16; k++) {
            const a = (2 * Math.PI * k) / 16;
            const p = [
              sun[0] + (r * Math.cos(a)) / aspect,
              sun[1] + r * Math.sin(a),
            ];
            if (p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1) out.push(p);
          }
          return out;
        };
        const points = [...ring(near), ...ring(far)];
        const nNear = ring(near).length;
        d.setGodRays(false);
        const off = d.sceneLuminance(points);
        d.setGodRays(true);
        const on = d.sceneLuminance(points);
        const mean = (a, b) =>
          a.reduce((t, x, k) => t + x - b[k], 0) / Math.max(1, a.length);
        // The worst point, against half-float rounding (2^-11 relative).
        const worst = Math.min(
          ...on.map((x, k) => x - off[k] + 0.001 * off[k]),
        );
        return {
          near: mean(on.slice(0, nNear), off.slice(0, nNear)),
          far: mean(on.slice(nNear), off.slice(nNear)),
          farPoints: points.length - nNear,
          worst,
        };
      },
      /** Whether two frames are byte-identical, and how many bytes differ. */
      diff(a, b) {
        let n = 0;
        for (let i = 0; i < a.data.length; i++)
          if (a.data[i] !== b.data[i]) n++;
        return n;
      },
    };
  });
}

/** Look straight at the sun from `eye`. */
const lookAtSun = (page, eye = EYE) =>
  page.evaluate((e) => {
    const d = window.__lookdev;
    const s = d.sunDirection();
    d.placeCameraAt(e, [
      e[0] + s[0] * 100,
      e[1] + s[1] * 100,
      e[2] + s[2] * 100,
    ]);
  }, eye);

/**
 * Eyes around the block's tallest building: `edge`, `distanceM` behind it
 * (away from the sun) and to the side so the line toward the sun grazes
 * its silhouette's edge (the building covers half the view around the
 * sun); `wall`, 2 m in front of the face that looks most away from the sun
 * (the building fills the view around the sun). Heights as shares of its
 * height (`edge`) or 1.7 m (`wall`).
 */
const buildingEyes = (page, distanceM = 80, heightShare = 0.4) =>
  page.evaluate(
    ([distanceM, heightShare]) => {
      const d = window.__lookdev;
      const b = d.tallestBuilding();
      const s = d.sunDirection();
      const flat = Math.hypot(s[0], s[2]);
      const a = [-s[0] / flat, -s[2] / flat];
      const q = [-a[1], a[0]];
      const along =
        Math.abs(a[0]) * (b.sx / 2) + Math.abs(a[1]) * (b.sz / 2) + distanceM;
      const side = Math.abs(q[0]) * (b.sx / 2) + Math.abs(q[1]) * (b.sz / 2);
      const edge = [
        b.x + a[0] * along + q[0] * side,
        b.h * heightShare,
        b.z + a[1] * along + q[1] * side,
      ];
      const wall =
        Math.abs(a[0]) >= Math.abs(a[1])
          ? [b.x + Math.sign(a[0]) * (b.sx / 2 + 2), 1.7, b.z]
          : [b.x, 1.7, b.z + Math.sign(a[1]) * (b.sz / 2 + 2)];
      return { edge, wall, building: b };
    },
    [distanceM, heightShare],
  );

/**
 * An eye `distanceM` behind the block (away from the sun, from the block's
 * centre), `heightM` up: at golden hour the block's buildings stand across
 * the low sun with gaps between them, the case light shafts are for.
 */
const blockEye = (page, distanceM = 330, heightM = 8) =>
  page.evaluate(
    ([distanceM, heightM]) => {
      const s = window.__lookdev.sunDirection();
      const flat = Math.hypot(s[0], s[2]);
      return [(-s[0] / flat) * distanceM, heightM, (-s[2] / flat) * distanceM];
    },
    [distanceM, heightM],
  );

/** Boot a plain scene at `preset`, loop paused, clouds pinned. */
async function bootPlain(page, preset, extra = "") {
  const errors = await boot(
    page,
    `preset=${preset}&tone=neutral&cloudMode=dome${extra}`,
  );
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setFloatingVisible(false);
    d.setCloudOffset(0.13, 0.41);
  });
  await installHelpers(page);
  return errors;
}

/**
 * The declared bounds (first measurement 2026-09-28, SwiftShader,
 * 1280x800, desktop tier, the shipped GOD_RAYS; the full sweep is in the
 * results record, 2026-09-28 lookdev god rays). Each with what would
 * reverse it:
 *
 * BAND: behind the block (golden hour, buildings across the sun) the mean
 * gain 0.05-0.25 canvas heights around the sun measured +30 levels (sum of
 * RGB); bandMin 15 is half of it, so it reverses only if the rays lose
 * half their light (strength 0.1 measured +17).
 * SHAFTS: there the brightest of 16 sectors around the sun gained +115 and
 * the dimmest 0 (gaps against buildings); shaftSpread 50 fails a glow
 * without structure (the open sun's spread is 63, so this is the block's
 * claim only).
 * VEIL: the open golden sun (street view, clouds 0.3) brightened 53 % of
 * the frame by > 30 levels at the shipped look (the bloom's own bound is
 * 15 %, for a far gentler effect); veilMax 0.65 guards a whiteout, it does
 * not judge the look (airM 0 measured 66 %, strength 0.4 more).
 * HDR: before tone mapping the pass only adds (the worst point within
 * half-float rounding), and the ring 0.1 heights from the sun gains more
 * than the ring 0.6 out (measured 0.76 vs 0.05 behind the block, 0.22 vs
 * 0.02 at noon).
 */
const BOUNDS = { bandMin: 15, shaftSpread: 50, veilMax: 0.65 };

test("rays add light around a partly covered sun, fall off with distance, and darken nothing", async ({
  page,
}) => {
  const errors = await bootPlain(page, "golden", "&tier=desktop");
  const results = [];
  const measure = async (label) => {
    const r = await page.evaluate(() => ({
      ...window.__gr.gain(),
      hdr: window.__gr.hdrGain(),
    }));
    results.push([label, r]);
  };
  // Golden hour behind the block: buildings across the sun, gaps between.
  await page.evaluate(() => window.__lookdev.setCloudCover(0));
  const block = await blockEye(page);
  await lookAtSun(page, block);
  await measure("golden, behind the block");
  // Golden hour from the street, its own clouds (0.3): the sun open.
  await page.evaluate(() => window.__lookdev.setCloudCover(0.3));
  await lookAtSun(page);
  await measure("golden, street, clouds 0.3");
  // Noon with clouds crossing the sun (0.5), dome and slab.
  for (const mode of ["dome", "slab"]) {
    await page.evaluate((m) => {
      const d = window.__lookdev;
      d.setPreset("noon");
      d.setCloudMode(m);
      d.setCloudCover(0.5);
      d.setCloudOffset(0.13, 0.41);
    }, mode);
    await lookAtSun(page);
    await measure(`noon, at the sun, ${mode} 0.5`);
  }
  // AgX maps more light to more light per channel: there even the sum of
  // RGB never drops (the additive pass's strict check).
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.setPreset("golden");
    d.setCloudMode("dome");
    d.setCloudCover(0);
    d.setCloudOffset(0.13, 0.41);
    d.setToneMapping("agx");
  });
  await lookAtSun(page, block);
  await measure("golden, behind the block, AgX");
  console.log(
    `god rays:\n  ${results
      .map(
        ([label, r]) =>
          `${label}: band +${r.band.toFixed(1)} (sectors ${r.sectorMin.toFixed(1)}..${r.sectorMax.toFixed(1)}), far +${r.far.toFixed(1)}, veil ${(r.veil * 100).toFixed(1)} %, max +${r.max}, darker ${r.darker} (sum ${r.sumDarker}); HDR +${r.hdr.near.toFixed(3)} at 0.1 / +${r.hdr.far.toFixed(3)} at 0.6 (${r.hdr.farPoints} pts); fade ${r.fade.toFixed(2)}`,
      )
      .join("\n  ")}`,
  );
  for (const [label, r] of results) {
    expect(r.fade, label).toBe(1);
    // In scene-linear light the pass only adds: no point is darker, the
    // ring near the sun gains, the ring far out gains less.
    expect(r.hdr.worst, label).toBeGreaterThanOrEqual(0);
    expect(r.hdr.near, label).toBeGreaterThan(0);
    expect(r.hdr.far, label).toBeLessThan(r.hdr.near);
  }
  // On the screen: under AgX no pixel's sum of RGB drops. (Under the
  // page's Neutral a few hundred saturated pixels lose a level or two of
  // their other channels as light of another hue is added: the tone
  // mapper's hue-preserving compression, logged above; results record.)
  expect(results.at(-1)[1].sumDarker).toBe(0);
  // The shafts: behind the block the rays are brighter in some directions
  // than in others (the gaps against the buildings), and add light.
  const [, atBlock] = results[0];
  expect(atBlock.band).toBeGreaterThanOrEqual(BOUNDS.bandMin);
  expect(atBlock.sectorMax - atBlock.sectorMin).toBeGreaterThanOrEqual(
    BOUNDS.shaftSpread,
  );
  // The open golden sun: a glow, bounded.
  expect(results[1][1].veil).toBeLessThanOrEqual(BOUNDS.veilMax);
  expect(errors).toEqual([]);
});

// The mask reads only the SKY (pixels at the cleared depth). With the
// threshold at 0 every sky pixel near the sun feeds the rays, so only the
// depth test keeps a wall out: a wall filling the view around the sun adds
// nothing, and the same sun seen past the building adds light (the
// control, so a pass that draws nothing cannot pass). The depth test was
// removed by hand once and this test failed (results record).
test("the rays come from the sky only: a wall in front of the sun adds nothing", async ({
  page,
}) => {
  const errors = await bootPlain(page, "golden", "&tier=desktop");
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.setCloudCover(0);
    d.setGodRaysParams({ threshold: 0 });
  });
  const { wall, edge } = await buildingEyes(page);
  await lookAtSun(page, wall);
  const atWall = await page.evaluate(() => window.__gr.gain());
  await lookAtSun(page, edge);
  const pastEdge = await page.evaluate(() => window.__gr.gain());
  console.log(
    `sky only (threshold 0): wall max +${atWall.max}, ${atWall.changed} pixels changed (fade ${atWall.fade}); past the edge band +${pastEdge.band.toFixed(1)}`,
  );
  expect(atWall.fade).toBe(1);
  expect(atWall.changed).toBe(0);
  expect(pastEdge.band).toBeGreaterThan(BOUNDS.bandMin);
  expect(errors).toEqual([]);
});

// Behind the camera and below the horizon the pass draws nothing: the
// frame is byte-identical to the pass off, with the threshold at 0 (so the
// fade, not a dark sky, is what stops it). THE MUTATION, in the same run:
// the horizon fade moved below the blue-hour sun lets rays through.
test("nothing is added with the sun behind the camera or below the horizon", async ({
  page,
}) => {
  const errors = await bootPlain(page, "golden", "&tier=desktop");
  await page.evaluate(() =>
    window.__lookdev.setGodRaysParams({ threshold: 0 }),
  );
  const cases = [];
  for (const preset of ["golden", "noon"]) {
    const r = await page.evaluate((p) => {
      const d = window.__lookdev;
      d.setPreset(p);
      d.setCloudCover(0.3);
      d.setCloudOffset(0.13, 0.41);
      d.setView("antisun");
      return window.__gr.gain();
    }, preset);
    cases.push([`${preset}, sun behind`, r]);
  }
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.setPreset("blueHour");
    d.setCloudOffset(0.13, 0.41);
  });
  await lookAtSun(page);
  cases.push([
    "blue hour, at the sun (-4°)",
    await page.evaluate(() => window.__gr.gain()),
  ]);
  const mutated = await page.evaluate(() => {
    const d = window.__lookdev;
    d.setGodRaysParams({ horizonFadeDeg: [-10, -9] });
    const r = window.__gr.gain();
    d.setGodRaysParams({ horizonFadeDeg: [-1, 1] });
    return r;
  });
  console.log(
    `nothing added: ${cases.map(([l, r]) => `${l} ${r.changed} px (fade ${r.fade})`).join("; ")}; mutation (fade below -4°): ${mutated.changed} px, band +${mutated.band.toFixed(1)}`,
  );
  for (const [label, r] of cases) {
    expect(r.fade, label).toBe(0);
    expect(r.changed, label).toBe(0);
  }
  expect(mutated.changed).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

// The switch off is the page without the pass: on the phone tier there is
// no composer at all again (byte-identical to never switching it on), on
// the desktop tier the composer is the same and the pass disabled. On the
// phone tier ON, the page renders through a composer: away from edges it
// draws the phone picture (the tier test's bound), plus the rays.
test("the switch off is byte-identical to the page without the pass, on both tiers", async ({
  page,
}) => {
  const errors = await bootPlain(page, "golden");
  await page.evaluate(() => window.__lookdev.setCloudCover(0.3));
  await lookAtSun(page);
  const r = await page.evaluate(() => {
    const d = window.__lookdev;
    const out = {};
    for (const tier of ["phone", "desktop"]) {
      d.setTier(tier);
      const before = d.readFrame();
      d.setGodRays(true);
      const on = d.readFrame();
      const composerOn = d.godRaysInfo().composer;
      d.setGodRays(false);
      const after = d.readFrame();
      out[tier] = {
        offDiff: window.__gr.diff(before, after),
        onDiff: window.__gr.diff(before, on),
        composerOn,
        composerOff: d.godRaysInfo().composer,
      };
    }
    d.setTier("phone");
    return out;
  });
  console.log(`switch off: ${JSON.stringify(r)}`);
  expect(r.phone).toMatchObject({
    offDiff: 0,
    composerOn: "rays",
    composerOff: null,
  });
  expect(r.desktop).toMatchObject({
    offDiff: 0,
    composerOn: "bloom",
    composerOff: "bloom",
  });
  expect(r.phone.onDiff).toBeGreaterThan(0);
  expect(r.desktop.onDiff).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// Away from edges the phone tier's composer draws the phone picture: with
// the rays' strength at 0 the pass adds nothing, so what is left is the
// composer itself (the tier test's bound: 3 levels on the frame grid).
test("on the phone tier the god-rays composer draws the phone picture away from edges", async ({
  page,
}) => {
  const errors = await bootPlain(page, "golden");
  await page.evaluate(() => window.__lookdev.setCloudCover(0.3));
  await lookAtSun(page);
  const grid = Array.from({ length: 40 }, (_, k) => [
    0.3 + (k % 10) * 0.07,
    0.1 + Math.floor(k / 10) * 0.2,
  ]);
  const worst = await page.evaluate((g) => {
    const d = window.__lookdev;
    const direct = d.readPixels(g);
    d.setGodRaysParams({ strength: 0 });
    d.setGodRays(true);
    const composed = d.readPixels(g);
    return Math.max(
      ...direct.map(
        (px, k) =>
          Math.abs(px[0] - composed[k][0]) +
          Math.abs(px[1] - composed[k][1]) +
          Math.abs(px[2] - composed[k][2]),
      ),
    );
  }, grid);
  console.log(`phone composer at strength 0: worst ${worst} on the grid`);
  expect(worst).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

// The owner's rule for these effects: one switch and one hash key each.
// The page opens with the rays off; the switch turns exactly its own
// effect on and writes exactly its own key; a link names it on or off.
test("the god rays have one switch and one hash key, off by default", async ({
  page,
}) => {
  // The page's own default for the key (no pin), on a light scene.
  const errors = await boot(
    page,
    "preset=golden&tone=neutral&city=0&catalog=0&cloudMode=dome&shadows=0",
    { pageDefaults: true },
  );
  await page.evaluate(() => window.__lookdev.pauseLoop(true));
  const now = () =>
    page.evaluate(() => {
      const s = window.__lookdev.stats();
      return {
        godRays: s.state.godRays,
        others: {
          sunDisc: s.state.sunDisc,
          sunAureole: s.state.sunAureole,
          sunSilver: s.state.sunSilver,
          cloudShadows: s.state.cloudShadows,
          sunLightDim: s.state.sunLightDim,
          ao: s.state.ao,
        },
        composer: window.__lookdev.godRaysInfo().composer,
      };
    });
  const before = await now();
  expect(before.godRays).toBe(false);
  expect(before.composer).toBeNull();
  await expect(page.locator("#god-rays")).not.toBeChecked();
  expect(await page.evaluate(() => location.hash)).toContain("godRays=0");
  await page.locator("#god-rays").check({ force: true });
  const after = await now();
  expect(after.godRays).toBe(true);
  expect(after.composer).toBe("rays");
  expect(after.others).toEqual(before.others);
  expect(await page.evaluate(() => location.hash)).toContain("godRays=1");
  // A link without the key keeps it; a link naming it off turns it off.
  await page.evaluate(() => {
    location.hash = "preset=noon&tone=neutral";
  });
  await expect(page.locator("#god-rays")).toBeChecked();
  await page.evaluate(() => {
    location.hash = "preset=noon&tone=neutral&godRays=0";
  });
  await expect(page.locator("#god-rays")).not.toBeChecked();
  expect((await now()).composer).toBeNull();
  expect(errors).toEqual([]);
});

/**
 * The on/off frame-time ratio of `set`, interleaved off/on/off rounds, the
 * median round (the machine is shared).
 */
const ratioFn = () => {
  window.__ratio = (set, frames = 3, rounds = 3) => {
    const d = window.__lookdev;
    const out = [];
    for (let k = 0; k < rounds; k++) {
      set(false);
      const off1 = d.timeFrames(frames).medianMs;
      set(true);
      const on = d.timeFrames(frames).medianMs;
      set(false);
      const off2 = d.timeFrames(frames).medianMs;
      out.push({ on, off: (off1 + off2) / 2 });
    }
    out.sort((a, b) => a.on / a.off - b.on / b.off);
    const m = out[Math.floor(out.length / 2)];
    return { ...m, ratio: m.on / m.off };
  };
};

// The cost in the plain scene, looking at the sun (the pass skips its
// draws when the sun is out of view, so this is its worst case), both
// tiers. A disaster bound only; the values are in the record.
test("the god rays' cost, both tiers, plain scene (on/off ratios, logged)", async ({
  page,
}) => {
  const errors = await bootPlain(page, "golden");
  await page.evaluate(() => window.__lookdev.setCloudCover(0.3));
  await lookAtSun(page);
  await page.evaluate(ratioFn);
  const r = await page.evaluate(() => {
    const d = window.__lookdev;
    const set = (on) => d.setGodRays(on);
    d.setTier("phone");
    const phone = window.__ratio(set, 5);
    // The sun behind the camera: the pass draws nothing, so on the phone
    // tier this is the composer's own cost.
    d.setView("antisun");
    const composerOnly = window.__ratio(set, 5);
    const fadeBehind = d.godRaysInfo().fade;
    d.setTier("desktop");
    const s = d.sunDirection();
    const e = [-20, 18, 60];
    d.placeCameraAt(e, [
      e[0] + s[0] * 100,
      e[1] + s[1] * 100,
      e[2] + s[2] * 100,
    ]);
    const desktop = window.__ratio(set, 5);
    d.setTier("phone");
    return { phone, composerOnly, fadeBehind, desktop };
  });
  const f = (x) =>
    `${x.on.toFixed(0)}/${x.off.toFixed(0)} ms = x${x.ratio.toFixed(3)}`;
  console.log(
    `god rays cost (plain): phone at the sun ${f(r.phone)}; phone, sun behind (the composer alone, fade ${r.fadeBehind}) ${f(r.composerOnly)}; desktop at the sun ${f(r.desktop)}`,
  );
  expect(r.phone.ratio).toBeLessThan(3);
  expect(r.desktop.ratio).toBeLessThan(1.5);
  expect(errors).toEqual([]);
});

// ON DEMAND (GOD_RAYS_COST=1): the cost in the page's OPENING state (the
// dense city, shadows, the catalog, the slab), both tiers, from the
// opening camera and looking at the sun. Slow: a frame there is seconds.
test("the god rays' cost in the page's opening state (on demand)", async ({
  page,
}) => {
  test.skip(!process.env.GOD_RAYS_COST, "on demand: GOD_RAYS_COST=1");
  test.setTimeout(1_200_000);
  const errors = await boot(page, "preset=golden&tone=neutral", {
    pageDefaults: true,
  });
  await page.evaluate(() => window.__lookdev.pauseLoop(true));
  await page.evaluate(ratioFn);
  const out = {};
  for (const tier of ["phone", "desktop"]) {
    for (const view of ["city", "atsun"]) {
      out[`${tier} ${view}`] = await page.evaluate(
        ([t, v]) => {
          const d = window.__lookdev;
          d.setTier(t);
          d.setView(v);
          const r = window.__ratio((on) => d.setGodRays(on), 1, 3);
          d.setGodRays(true);
          d.drawCalls();
          const fade = d.godRaysInfo().fade;
          d.setGodRays(false);
          return { ...r, fade };
        },
        [tier, view],
      );
    }
  }
  const state = await page.evaluate(() => window.__lookdev.stats().state);
  expect([state.city, state.cloudMode]).toEqual([100000, "slab"]);
  console.log(
    `god rays cost (opening state): ${Object.entries(out)
      .map(
        ([k, r]) =>
          `${k} (fade ${r.fade.toFixed(2)}) ${r.on.toFixed(0)}/${r.off.toFixed(0)} ms = x${r.ratio.toFixed(3)}`,
      )
      .join("; ")}`,
  );
  expect(errors).toEqual([]);
});

// ON DEMAND (GOD_RAYS_SWEEP=1): the look parameters, one at a time around
// the shipped values, behind the block and on the open sun at golden hour
// and on the noon slab clouds; each
// row logs the band gain, the sector spread (shafts), the far gain, the
// veil, and a grain measure (the mean gain difference between neighbouring
// pixels in the band). The record reads the verdicts.
test("the god rays' look sweep (on demand)", async ({ page }) => {
  test.skip(!process.env.GOD_RAYS_SWEEP, "on demand: GOD_RAYS_SWEEP=1");
  test.setTimeout(1_800_000);
  const errors = await bootPlain(page, "golden", "&tier=desktop");
  await page.evaluate(() => {
    const d = window.__lookdev;
    window.__grain = (off, on, sun) => {
      const { width: w, height: h } = on;
      let total = 0;
      let n = 0;
      for (let y = 0; y < h; y += 3) {
        for (let x = 0; x < w - 1; x += 3) {
          const r = Math.hypot(x - sun[0], y - sun[1]) / h;
          if (r < 0.05 || r > 0.25) continue;
          const i = (y * w + x) * 4;
          const g = (k) =>
            on.data[k] +
            on.data[k + 1] +
            on.data[k + 2] -
            (off.data[k] + off.data[k + 1] + off.data[k + 2]);
          total += Math.abs(g(i) - g(i + 4));
          n += 1;
        }
      }
      return n ? total / n : 0;
    };
    window.__row = () => {
      d.setGodRays(false);
      const off = d.readFrame();
      d.setGodRays(true);
      const on = d.readFrame();
      const i = d.godRaysInfo();
      const sun = [((i.x + 1) / 2) * on.width, ((i.y + 1) / 2) * on.height];
      return {
        ...window.__gr.stats(off, on, sun),
        grain: window.__grain(off, on, sun),
      };
    };
  });
  const views = [
    ["golden block", "golden", 0, "dome", await blockEye(page)],
    ["golden open 0.3", "golden", 0.3, "dome", EYE],
    ["noon slab 0.5", "noon", 0.5, "slab", EYE],
  ];
  const SWEEPS = {
    samples: [16, 32, 64, 128],
    endWeight: [0.03, 0.1, 0.3, 1],
    reach: [0.5, 0.75, 1],
    strength: [0.1, 0.15, 0.25, 0.4],
    threshold: [0, 1, 2, 4, 8],
    maxExcess: [4, 16, 64],
    radius: [0.2, 0.35, 0.5],
    scale: [0.125, 0.25, 0.5],
    jitter: [0, 1],
    airM: [0, 100, 300, 1000],
  };
  const shipped = await page.evaluate(
    () => window.__lookdev.godRaysInfo().params,
  );
  const lines = [];
  for (const [label, preset, cover, mode, eye] of views) {
    await page.evaluate(
      ([p, c, cloudMode]) => {
        const d = window.__lookdev;
        d.setPreset(p);
        d.setCloudMode(cloudMode);
        d.setCloudCover(c);
        d.setCloudOffset(0.13, 0.41);
      },
      [preset, cover, mode],
    );
    await lookAtSun(page, eye);
    for (const [key, values] of Object.entries(SWEEPS)) {
      for (const value of values) {
        const r = await page.evaluate(
          ([k, v, base]) => {
            const d = window.__lookdev;
            d.setGodRaysParams({ ...base, [k]: v });
            const row = window.__row();
            d.setGodRaysParams(base);
            return row;
          },
          [key, value, shipped],
        );
        lines.push(
          `${label} ${key}=${value}: band +${r.band.toFixed(1)} sectors ${r.sectorMin.toFixed(1)}..${r.sectorMax.toFixed(1)} far +${r.far.toFixed(1)} veil ${(r.veil * 100).toFixed(1)} % max +${r.max} grain ${r.grain.toFixed(2)}`,
        );
      }
    }
  }
  console.log(`god rays sweep:\n  ${lines.join("\n  ")}`);
  expect(errors).toEqual([]);
});
