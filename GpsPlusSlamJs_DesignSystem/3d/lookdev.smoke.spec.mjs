// @ts-check
/**
 * Smoke test for the 3D look-dev page (plan 2026-09-23-0048 §4.3).
 *
 * Why this file matters: it is the ONLY place the atmosphere's shaders are
 * compiled, drawn and checked. A three.js shader compile error throws nothing
 * and only logs, and the material silently stops drawing (lessons-learned). So
 * the claims are about what three.js cannot hide: console errors, a canvas
 * that is not blank, pixels that behave like a sky, and LUT texels that match
 * the framework's tested CPU model.
 *
 * Colour claims are relative (bluer than, warmer than), never absolute
 * values: headless GPU output differs per machine, which is why golden images
 * were rejected for this package (shoot.mjs.md).
 */
import { expect, test } from "@playwright/test";

/** Wait for the page to report ready (or an error), then two frames. */
async function boot(page, hash = "preset=golden&tone=agx") {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/3d/#${hash}`);
  await page.waitForFunction(
    () => window.__lookdev?.ready || window.__lookdev?.error,
    null,
    {
      timeout: 90_000,
    },
  );
  expect(await page.evaluate(() => window.__lookdev.error)).toBeNull();
  return errors;
}

/** A grid of points on the right of the canvas (the control plate is on the left). */
const GRID = [];
for (let i = 0; i < 6; i++) {
  for (let j = 0; j < 6; j++) GRID.push([0.35 + i * 0.12, 0.05 + j * 0.17]);
}

const sum = (px) => px[0] + px[1] + px[2];

/** 8-bit levels per channel; set from the first measurement (see the test). */
const SKY_PIXEL_TOLERANCE = 4;
/**
 * Relative LUT parity bounds, from the measured worst cases over all five
 * presets (2026-09-23): transmittance 2.1 %, multi-scattering 0.15 %, sky
 * view 3.7 % (blue hour). The sky view was 5.2 % at golden hour and 12.4 %
 * in the hazy preset until M3: that was the multi-scattering LUT's LINEAR
 * altitude rows, 3.2 km apart where haze lives in the lowest ~1.2 km (a CPU
 * replica reproduced the GPU to 0.1 %). Quadratic rows fixed it. The sweep
 * over five presets, not three, is what found it. A shader bug is far larger
 * (the one caught so far was 176 %).
 */
const PARITY_BOUNDS = { t: 0.03, m: 0.01, s: 0.05 };

// Every preset must compile and draw a real image. "Real" means not blank and
// not one colour: the silent-failure mode of a broken shader is a canvas of
// the clear colour, which a single "is it non-black" check can miss.
// ...and with sun shadows on, which recompiles every lit material with
// shadow sampling (the lake's patched water included): a compile failure only
// logs (shadow plan M2 review, finding 6).
for (const shadows of [false, true])
  test(`every preset draws a non-uniform image without console errors${shadows ? " (shadows on)" : ""}`, async ({
    page,
  }) => {
    const errors = await boot(
      page,
      `preset=golden&tone=agx${shadows ? "&shadows=1" : ""}`,
    );
    for (const preset of ["dawn", "noon", "golden", "blueHour", "hazy"]) {
      const pixels = await page.evaluate(
        ([p, grid]) => {
          window.__lookdev.setPreset(p);
          window.__lookdev.setView("city");
          return window.__lookdev.readPixels(grid);
        },
        [preset, GRID],
      );
      // Lit geometry, not just a lit sky: a black city over a bright sky is the
      // silent failure a PMREM overflow produces (OsmDemo's old Preetham sky
      // did exactly that above ~20° of sun, until M3 replaced it).
      const geometry = await page.evaluate(() =>
        window.__lookdev.readPixels([
          [0.6, 0.6],
          [0.5, 0.85],
        ]),
      );
      for (const px of geometry) {
        expect(sum(px), `${preset}: lit geometry`).toBeGreaterThan(15);
      }
      const distinct = new Set(pixels.map((px) => px.slice(0, 3).join(",")));
      expect(
        distinct.size,
        `${preset}: distinct colours on the grid`,
      ).toBeGreaterThan(8);
      expect(
        Math.max(...pixels.map(sum)),
        `${preset}: brightest pixel`,
      ).toBeGreaterThan(60);
    }
    expect(errors).toEqual([]);
  });

// Why the sky is blue: at noon the top of the frame (high sky) is bluer,
// relative to red, than the sky just above the ridges.
test("the noon sky is bluer overhead than at the horizon", async ({ page }) => {
  await boot(page, "preset=noon&tone=agx");
  const [top, horizon] = await page.evaluate(() => {
    // The sky itself, not the clouds in front of it.
    window.__lookdev.setCloudCover(0);
    window.__lookdev.setView("city");
    return window.__lookdev.readPixels([
      [0.8, 0.02],
      [0.8, 0.34],
    ]);
  });
  expect(top[2] - top[0]).toBeGreaterThan(horizon[2] - horizon[0]);
});

// The Mie glow and the sunset colour: at golden hour, the horizon toward the
// sun is brighter and warmer than the horizon opposite it. The azimuth is
// named because the anti-sun horizon is NOT warm (plan review finding 9).
test("at golden hour the horizon toward the sun is warmer and brighter", async ({
  page,
}) => {
  await boot(page, "preset=golden&tone=agx");
  await page.evaluate(() => window.__lookdev.setCloudCover(0));
  const read = (view) =>
    page.evaluate((v) => {
      window.__lookdev.setView(v);
      return window.__lookdev.readPixels([[0.75, 0.45]])[0];
    }, view);
  const toward = await read("sun");
  const away = await read("antisun");
  expect(sum(toward)).toBeGreaterThan(sum(away));
  expect(toward[0] / Math.max(1, toward[2])).toBeGreaterThan(
    away[0] / Math.max(1, away[2]),
  );
});

// The GPU LUTs must compute what the framework's CPU model computes. Measured
// on first run (2026-09-23, golden hour): transmittance 2.1 %, multi-
// scattering 0.1 %, sky view 2.0 % worst case. Checked at three suns because
// blue hour is where half-float precision was the concern (review finding
// 10); the bounds leave room for per-GPU rounding, not for a wrong shader,
// which is off by far more than 5 %.
for (const preset of ["noon", "golden", "blueHour", "dawn", "hazy"]) {
  test(`LUT texels match the CPU model (${preset})`, async ({ page }) => {
    await boot(page, `preset=${preset}&tone=agx`);
    const parity = await page.evaluate(() => {
      const p = window.__lookdev.parity();
      return { t: p.transmittance, m: p.multiScattering, s: p.skyView };
    });
    // Per-LUT bounds (review finding 11): one 5 % bound let a multi-
    // scattering defect 50× its measured error through.
    console.log(`parity ${JSON.stringify(parity)}`);
    expect(parity.t, "transmittance").toBeLessThan(PARITY_BOUNDS.t);
    expect(parity.m, "multi-scattering").toBeLessThan(PARITY_BOUNDS.m);
    expect(parity.s, "sky view").toBeLessThan(PARITY_BOUNDS.s);
  });
}

// The sky pass's LOOKUP path, scale and colour space: one on-screen sky pixel,
// tone mapping off, against the CPU model along the same view direction
// (M1 milestone review, finding 6). Differences come from bilinear sky-view
// lookups across the screen, half floats and 8-bit output.
for (const preset of ["noon", "golden"]) {
  test(`on-screen sky pixels match the CPU model (${preset})`, async ({
    page,
  }) => {
    await boot(page, `preset=${preset}&tone=neutral`);
    const results = await page.evaluate(() => {
      window.__lookdev.setView("city");
      return [
        window.__lookdev.skyPixelParity([0.8, 0.02]),
        window.__lookdev.skyPixelParity([0.8, 0.2]),
      ];
    });
    for (const { gpu, cpu } of results) {
      console.log(
        `sky pixel ${preset}: gpu ${gpu} cpu ${cpu.map((c) => c.toFixed(1))}`,
      );
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(gpu[c] - cpu[c]), `channel ${c}`).toBeLessThanOrEqual(
          SKY_PIXEL_TOLERANCE,
        );
      }
    }
  });
}

// The haze (plan M2, DEC-SKY-5) must fade the DISTANT ridges toward the sky
// much more than the NEAR city: in the hazy preset (12 km visibility) the
// physical transmittance is ~0.89 at the city's ~350 m and far lower at the
// ridges' 2.5–9 km. So the claim is RELATIVE (ridges change several times
// more), not "the city is untouched", which would be false physics. The
// ridge row (y 0.41) was located on a screenshot: a first draft sampled
// y 0.37, just above the ridges, i.e. sky, and saw no change.
test("the haze fades the distant ridges far more than the near city", async ({
  page,
}) => {
  await boot(page, "preset=hazy&tone=neutral");
  const ridges = [];
  for (let i = 0; i < 12; i++) ridges.push([0.4 + i * 0.05, 0.41]);
  const city = [
    [0.6, 0.6],
    [0.5, 0.75],
  ];
  const read = (on) =>
    page.evaluate(
      ([hazeOn, points]) => {
        window.__lookdev.setHaze(hazeOn);
        window.__lookdev.setView("city");
        return window.__lookdev.readPixels(points);
      },
      [on, [...ridges, ...city]],
    );
  const withHaze = await read(true);
  const without = await read(false);
  const delta = (a, b) => Math.abs(sum(a) - sum(b));
  const ridgeDeltas = ridges.map((_, i) => delta(withHaze[i], without[i]));
  const cityDeltas = city.map((_, j) =>
    delta(withHaze[ridges.length + j], without[ridges.length + j]),
  );
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`haze: ridge deltas ${ridgeDeltas}; city deltas ${cityDeltas}`);
  expect(ridgeDeltas.filter((d) => d > 12).length).toBeGreaterThanOrEqual(6);
  expect(mean(ridgeDeltas)).toBeGreaterThan(3 * mean(cityDeltas));
});

// The cloud layer (plan M2, DEC-SKY-6) must actually draw: raising the cover
// changes the upper sky (a difference count, not colours), and the drawing
// raises no console error.
test("cloud cover changes the sky", async ({ page }) => {
  const errors = await boot(page, "preset=noon&tone=neutral");
  const sky = [];
  for (let i = 0; i < 8; i++) sky.push([0.4 + i * 0.07, 0.08]);
  for (let i = 0; i < 8; i++) sky.push([0.4 + i * 0.07, 0.2]);
  const read = (cover) =>
    page.evaluate(
      ([c, points]) => {
        window.__lookdev.setCloudCover(c);
        window.__lookdev.setView("city");
        return window.__lookdev.readPixels(points);
      },
      [cover, sky],
    );
  const clear = await read(0);
  const cloudy = await read(0.7);
  const changed = sky.filter(
    (_, i) => Math.abs(sum(clear[i]) - sum(cloudy[i])) > 15,
  ).length;
  console.log(`clouds: ${changed}/${sky.length} sky points changed`);
  expect(changed).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});

// DIRECTION, not just change (M2 review, finding 2): the hazed ridge must be
// CLOSER to the sky just above it than the unhazed ridge is. A haze fading
// toward black (an unsynced scale), toward the neutral AR texture, or toward
// any wrong colour changes the ridges just as much and passed the difference
// count; it fails this. The view-direction lookup itself is the one the sky
// pass uses (atmHorizonClampedDir + atmSkyViewUv), which the sky-pixel parity
// test checks numerically.
test("the haze fades the ridges TOWARD the sky colour", async ({ page }) => {
  await boot(page, "preset=hazy&tone=neutral");
  const points = [];
  for (let i = 0; i < 12; i++)
    points.push([0.4 + i * 0.05, 0.41], [0.4 + i * 0.05, 0.33]);
  const read = (on) =>
    page.evaluate(
      ([hazeOn, pts]) => {
        window.__lookdev.setCloudCover(0);
        window.__lookdev.setHaze(hazeOn);
        window.__lookdev.setView("city");
        return window.__lookdev.readPixels(pts);
      },
      [on, points],
    );
  const hazed = await read(true);
  const plain = await read(false);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let closer = 0;
  let ridges = 0;
  for (let i = 0; i < 12; i++) {
    const ridgeOn = hazed[2 * i];
    const ridgeOff = plain[2 * i];
    const skyAbove = hazed[2 * i + 1];
    if (distance(ridgeOn, ridgeOff) < 12) continue; // not a ridge pixel
    ridges += 1;
    if (distance(ridgeOn, skyAbove) < distance(ridgeOff, skyAbove)) closer += 1;
  }
  console.log(
    `haze direction: ${closer}/${ridges} ridge points moved toward the sky`,
  );
  expect(ridges).toBeGreaterThanOrEqual(6);
  expect(closer).toBe(ridges);
});

// VIEW-DIRECTION dependence, the point of a sky-matched haze (DEC-SKY-5,
// M2 review finding 2): at golden hour the air toward the low sun scatters
// it forward (Mie) and glows; the air away from it does not. Only pixels the
// haze actually changed are compared, so near geometry does not dilute it.
// The claim is BRIGHTNESS, and it discriminates: the geometry toward the sun
// is back-lit (darker), so a fixed-colour fog would make the AWAY side the
// brighter one. It is asserted across the pixel-selection floor, because a
// warmth (R/B) version held at floor 30 and REVERSED at floor 15
// (2026-09-23 sweep: 1.62 vs 1.67), and was dropped as a one-value verdict.
test("at golden hour the hazed distance is brighter toward the sun", async ({
  page,
}) => {
  await boot(page, "preset=golden&tone=neutral");
  const points = [];
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 8; j++)
      points.push([0.05 + i * 0.039, 0.54 + j * 0.02]);
  }
  const floors = [10, 20, 40];
  const brightness = async (view) => {
    const read = (on) =>
      page.evaluate(
        ([hazeOn, v, pts]) => {
          window.__lookdev.setCloudCover(0);
          window.__lookdev.setHaze(hazeOn);
          window.__lookdev.setView(v);
          return window.__lookdev.readPixels(pts);
        },
        [on, view, points],
      );
    const hazed = await read(true);
    const plain = await read(false);
    return floors.map((floor) => {
      let sum = 0;
      let count = 0;
      hazed.forEach((px, k) => {
        const q = plain[k];
        const changed =
          Math.abs(px[0] - q[0]) +
          Math.abs(px[1] - q[1]) +
          Math.abs(px[2] - q[2]);
        if (changed < floor) return;
        sum += px[0] + px[1] + px[2];
        count += 1;
      });
      return { mean: sum / Math.max(count, 1), count };
    });
  };
  const toward = await brightness("sun");
  const away = await brightness("antisun");
  floors.forEach((floor, k) => {
    console.log(
      `haze brightness @${floor}: toward ${toward[k].mean.toFixed(0)} (${toward[k].count} px), away ${away[k].mean.toFixed(0)} (${away[k].count} px)`,
    );
    expect(toward[k].count).toBeGreaterThanOrEqual(6);
    expect(away[k].count).toBeGreaterThanOrEqual(6);
    expect(toward[k].mean).toBeGreaterThan(away[k].mean);
  });
});

/**
 * Fallback vs GPU, measured 2026-09-23 over the five presets: exposure within
 * 6.3 %, horizon within 13.2 % per channel. Building this check found two
 * defects: the GPU's fog colour was read at the geometric horizon while the
 * sky is drawn clamped 1.15° above it (up to 2.8× off at blue hour), and the
 * fallback's Ψ grid was too coarse across the terminator (dawn blue 1.6×).
 */
const FALLBACK_BOUNDS = { exposure: 0.1, horizon: 0.2 };

// THE FALLBACK'S ONLY GPU ORACLE (plan M3). Devices without float render
// targets get `fallbackSky` (CPU) instead of `SkyAtmosphere`; nothing else
// can compare the two, because the fallback runs exactly where there is no
// GPU path. Exposure and the exposure-free horizon colour must agree with
// the GPU sky, per preset.
test("the CPU fallback sky agrees with the GPU sky", async ({ page }) => {
  await boot(page, "preset=noon&tone=neutral");
  for (const preset of ["noon", "golden", "hazy", "dawn", "blueHour"]) {
    const p = await page.evaluate((name) => {
      window.__lookdev.setPreset(name);
      return window.__lookdev.fallbackParity();
    }, preset);
    const ratio = p.cpuExposure / p.gpuExposure;
    const horizon = p.cpuHorizon.map((c, k) => c / p.gpuHorizon[k]);
    console.log(
      `fallback ${preset}: exposure cpu/gpu ${ratio.toFixed(3)} (gpu ${p.gpuExposure.toFixed(2)}), horizon cpu/gpu ${horizon.map((h) => h.toFixed(3)).join(",")}`,
    );
    expect(Math.abs(ratio - 1), `${preset} exposure`).toBeLessThan(
      FALLBACK_BOUNDS.exposure,
    );
    for (const h of horizon) {
      expect(Math.abs(h - 1), `${preset} horizon`).toBeLessThan(
        FALLBACK_BOUNDS.horizon,
      );
    }
  }
});

// THE WATER RUNS ON THE GPU AND MIRRORS THE SKY (plan M4). The lake is the
// framework's WaterSurface: a patched MeshPhysicalMaterial. The patch is
// proven by the lake's pixels moving when the waves advance (a compile
// failure logs, which the console check catches, and draws nothing). The
// mirror is shown by the lake's colour following the sky's: red over blue
// rises from noon to golden hour (measured 0.56 -> 0.96). This second claim
// is the weaker one: a warm sun on the dark tint would push the same way a
// little. A first version asserted "blue-leaning at noon", which the tint
// alone satisfies (M4 review, finding 5).
test("the water's waves move on the GPU, and the lake warms with the sky", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral");
  const lake = (preset, advance) =>
    page.evaluate(
      ([p, dt]) => {
        const api = window.__lookdev;
        api.setPreset(p);
        api.setCloudCover(0);
        api.setView("lake");
        const points = [];
        for (let i = 0; i < 12; i++) {
          points.push(
            api.project([
              215 + (i % 4) * 25,
              0.1,
              -40 - Math.floor(i / 4) * 25,
            ]),
          );
        }
        const before = api.readPixels(points);
        api.advanceWater(dt);
        const after = api.readPixels(points);
        return { before, after };
      },
      [preset, advance],
    );
  const noon = await lake("noon", 3.7);
  const golden = await lake("golden", 0);
  const moved = noon.before.filter(
    (px, k) =>
      Math.abs(px[0] - noon.after[k][0]) +
        Math.abs(px[1] - noon.after[k][1]) +
        Math.abs(px[2] - noon.after[k][2]) >
      6,
  ).length;
  const redOverBlue = (pixels) =>
    pixels.reduce((s, px) => s + px[0], 0) /
    pixels.reduce((s, px) => s + px[2], 0);
  const warmth = redOverBlue(golden.before) / redOverBlue(noon.before);
  console.log(
    `water: ${moved}/12 points moved; R/B golden/noon x${warmth.toFixed(2)}`,
  );
  expect(moved).toBeGreaterThanOrEqual(6);
  expect(warmth).toBeGreaterThan(1.3);
  expect(errors).toEqual([]);
});

/** Canvas points spread over the frame, for whole-picture comparisons. */
const FRAME_GRID = Array.from({ length: 40 }, (_, k) => [
  0.3 + (k % 10) * 0.07,
  0.1 + Math.floor(k / 10) * 0.2,
]);

// THE DESKTOP PIPELINE, MINUS BLOOM, IS THE PHONE PICTURE AWAY FROM EDGES
// (DEC-SKY-9). A new composer read through 1x1 targets until the next frame
// (hundreds of levels off everywhere); this grid catches that. It cannot see
// edges, and on edges the tiers can never agree exactly: the composer's MSAA
// resolves in HDR before tone mapping, the canvas after (M4 review, finding
// 2). The edge claim is the next test.
test("the desktop pipeline without bloom draws the phone picture away from edges", async ({
  page,
}) => {
  const errors = await boot(page, "preset=golden&tone=neutral");
  for (const preset of ["noon", "golden", "hazy"]) {
    const worst = await page.evaluate(
      ([p, grid]) => {
        const api = window.__lookdev;
        api.setPreset(p);
        api.setCloudCover(0);
        api.setView("sun");
        api.setTier("phone");
        const phone = api.readPixels(grid);
        api.setTier("desktop");
        api.setBloom(false);
        const desktop = api.readPixels(grid);
        api.setTier("phone");
        return Math.max(
          ...phone.map(
            (px, k) =>
              Math.abs(px[0] - desktop[k][0]) +
              Math.abs(px[1] - desktop[k][1]) +
              Math.abs(px[2] - desktop[k][2]),
          ),
        );
      },
      [preset, FRAME_GRID],
    );
    console.log(`tiers ${preset}: worst difference without bloom ${worst}`);
    expect(worst, preset).toBeLessThanOrEqual(3);
  }
  expect(errors).toEqual([]);
});

// MSAA ON THE DESKTOP TIER DOES ITS JOB AT EDGES. Counted over every 3rd
// pixel: points more than 30 levels off the (multisampled) canvas, with the
// composer's MSAA on vs off. Measured: golden 902 vs 1 572, noon 223 vs
// 1 301, hazy 771 vs 1 326 (ratio 0.17...0.58). Asserted at <= 0.75, so a
// composer whose scene target lost its samples (or whose buffers stopped
// swapping back to it) fails.
test("the desktop tier's MSAA brings its edges closer to the canvas", async ({
  page,
}) => {
  const errors = await boot(page, "preset=golden&tone=neutral");
  for (const preset of ["noon", "golden", "hazy"]) {
    const counts = await page.evaluate((p) => {
      const api = window.__lookdev;
      api.setPreset(p);
      api.setCloudCover(0);
      api.setView("sun");
      api.setTier("phone");
      const phone = api.readFrame();
      api.setTier("desktop");
      api.setBloom(false);
      const offBy30 = (frame) => {
        let n = 0;
        for (let i = 0; i < frame.data.length; i += 12) {
          const d =
            Math.abs(frame.data[i] - phone.data[i]) +
            Math.abs(frame.data[i + 1] - phone.data[i + 1]) +
            Math.abs(frame.data[i + 2] - phone.data[i + 2]);
          if (d > 30) n += 1;
        }
        return n;
      };
      const withMsaa = offBy30(api.readFrame());
      api.setSceneMsaa(false);
      const without = offBy30(api.readFrame());
      api.setSceneMsaa(true);
      api.setTier("phone");
      return { withMsaa, without };
    }, preset);
    console.log(
      `edges ${preset}: ${counts.withMsaa} with MSAA, ${counts.without} without`,
    );
    expect(counts.without, preset).toBeGreaterThan(100);
    expect(counts.withMsaa / counts.without, preset).toBeLessThan(0.75);
  }
  expect(errors).toEqual([]);
});

// BLOOM: A GLOW AROUND THE SUN, A BOUNDED VEIL, AND NOTHING DARKER. Measured
// at the TRUE sun position (a first version projected with stale camera
// matrices and measured the frame's edge; M4 review, finding 1). On a
// physically exposed golden-hour sky the glow and the veil come together
// (glow ~0.45 x the veiled share; see lookdev.js BLOOM): the shipped setting
// gives +4.7 on a ring 0.10 of the canvas from the sun, with 9.7 % of the
// frame brightened by more than 30 levels. Bounds: glow > 2, veil < 15 %.
test("the desktop tier's bloom glows around the sun, veils little, and darkens nothing", async ({
  page,
}) => {
  const errors = await boot(page, "preset=golden&tone=neutral");
  const r = await page.evaluate((grid) => {
    const api = window.__lookdev;
    api.setCloudCover(0);
    api.setView("sun");
    const st = api.stats().state;
    const e = (st.elevation * Math.PI) / 180;
    const a = (st.azimuth * Math.PI) / 180;
    const [cu, cv] = api.project([
      -20 + Math.cos(e) * Math.sin(a) * 5000,
      18 + Math.sin(e) * 5000,
      60 - Math.cos(e) * Math.cos(a) * 5000,
    ]);
    const ring = [];
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      ring.push([cu + 0.1 * Math.cos(t), cv + 0.1 * Math.sin(t)]);
    }
    api.setTier("phone");
    const phoneRing = api.readPixels(ring);
    const phoneGrid = api.readPixels(grid);
    const phoneFrame = api.readFrame();
    api.setTier("desktop");
    const desktopRing = api.readPixels(ring);
    const desktopGrid = api.readPixels(grid);
    const desktopFrame = api.readFrame();
    api.setTier("phone");
    let veiled = 0;
    let sampled = 0;
    for (let i = 0; i < desktopFrame.data.length; i += 12) {
      sampled += 1;
      const d =
        desktopFrame.data[i] +
        desktopFrame.data[i + 1] +
        desktopFrame.data[i + 2] -
        (phoneFrame.data[i] + phoneFrame.data[i + 1] + phoneFrame.data[i + 2]);
      if (d > 30) veiled += 1;
    }
    return {
      centre: [cu, cv],
      phoneRing,
      phoneGrid,
      desktopRing,
      desktopGrid,
      veil: veiled / sampled,
    };
  }, FRAME_GRID);
  const lum = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
  const gain =
    r.desktopRing.reduce((s, px, k) => s + lum(px) - lum(r.phoneRing[k]), 0) /
    12;
  const darker = r.desktopGrid.filter(
    (px, k) => lum(px) < lum(r.phoneGrid[k]) - 1.5,
  ).length;
  console.log(
    `bloom: sun at ${r.centre.map((c) => c.toFixed(2))}; glow +${gain.toFixed(1)}; veil ${(100 * r.veil).toFixed(1)} %; ${darker}/40 darker`,
  );
  expect(r.centre[0]).toBeGreaterThan(0.2);
  expect(r.centre[0]).toBeLessThan(0.8);
  expect(gain).toBeGreaterThan(2);
  expect(r.veil).toBeLessThan(0.15);
  expect(darker).toBe(0);
  expect(errors).toEqual([]);
});

// A LINK IS A VIEW, also after load (summary follow-up F5). The state lives
// in the URL hash so a screenshot or a phone link reproduces a view; a hash
// change on an open page (a pasted link, the back button) must re-apply it,
// or the page shows one look under another look's address.
test("a hash change re-applies the view", async ({ page }) => {
  const errors = await boot(page, "preset=noon&tone=neutral");
  await page.evaluate(() => {
    location.hash = "#preset=golden&tone=aces&tier=phone";
  });
  await expect
    .poll(() => page.evaluate(() => window.__lookdev.stats().state))
    .toMatchObject({ preset: "golden", tone: "aces" });
  expect(errors).toEqual([]);
});

// --- The fly-through cloud sheet (plan 2026-09-24-1010) -----------------------
// Every threshold below is declared here, logged with its measurement, and
// set from the measured values with a stated margin (the owner's sweep rule);
// where a mutation run showed what a broken sheet reads, that is noted too.
// Each test compares the sheet SHOWN against HIDDEN at the same cover: a
// cover change also re-bakes the environment, which relights the scene, so
// comparing two covers measured relighting (the first run did exactly that).

/** Cloud covers every sheet test sweeps. */
const SHEET_COVERS = [0.3, 0.5, 0.7, 0.9];
/** Two pinned drift offsets (tiles): the pattern under the city differs. */
const SHEET_OFFSETS = [
  [0.1, 0.2],
  [0.55, 0.8],
];
/** A pixel "changed" when its RGB sum moves by more than this. */
const CHANGED_LEVELS = 15;

/** Boot in sheet mode with the drift pinned. */
async function bootSheet(page, [u, v] = SHEET_OFFSETS[0]) {
  const errors = await boot(page, "preset=noon&tone=neutral&cloudMode=sheet");
  await page.evaluate(
    ([a, b]) => window.__lookdev.setCloudOffset(a, b),
    [u, v],
  );
  return errors;
}

/** Read `points` with the sheet shown and hidden, in one page task. */
const shownHidden = (page, points) =>
  page.evaluate((p) => {
    const d = window.__lookdev;
    d.setCloudSheetVisible(true);
    const shown = d.readPixels(p);
    d.setCloudSheetVisible(false);
    const hidden = d.readPixels(p);
    d.setCloudSheetVisible(true);
    return { shown, hidden };
  }, points);

/** Cover and view, then shown/hidden. */
async function readShownHidden(page, cover, view, points) {
  await page.evaluate(
    ([c, w]) => {
      window.__lookdev.setCloudCover(c);
      window.__lookdev.setView(w);
    },
    [cover, view],
  );
  return shownHidden(page, points);
}

const changedShare = (a, b) =>
  a.filter((px, i) => Math.abs(sum(px) - sum(b[i])) > CHANGED_LEVELS).length /
  a.length;

/** Mean over points of the per-channel absolute difference. */
const meanAbsDiff = (a, b) =>
  a.reduce(
    (t, px, i) =>
      t +
      Math.abs(px[0] - b[i][0]) +
      Math.abs(px[1] - b[i][1]) +
      Math.abs(px[2] - b[i][2]),
    0,
  ) / a.length;

// The sheet is REAL geometry at 2 km: from above it covers the city, more of
// it the higher the cover, and its tops are sunlit WHITE (the plan's §9 top
// term; the dome's underside model alone drew them grey, ~359 RGB sum).
test("the cloud sheet covers the city from above, with sunlit white tops", async ({
  page,
}) => {
  const errors = await bootSheet(page);
  /**
   * Declared floor at cover 0.7. Measured 2026-09-24 (SwiftShader, two
   * offsets): 1.00 and 1.00 at 0.7 (0.25-0.31 at 0.3, 0.58-0.89 at 0.5). 0.5
   * leaves a 2x margin and still fails a sheet that draws half the time.
   */
  const floorAt07 = 0.5;
  /**
   * Declared floor for the covered pixels' mean RGB sum at noon, cover 0.9.
   * Measured: ~690 with the top term, ~359 without it (the first probe). 520
   * sits between, so dropping or swapping the top/underside branch fails.
   */
  const topBrightnessFloor = 520;
  for (const offset of SHEET_OFFSETS) {
    await page.evaluate(
      ([a, b]) => window.__lookdev.setCloudOffset(a, b),
      offset,
    );
    const shares = [];
    let topBrightness = 0;
    for (const cover of SHEET_COVERS) {
      const { shown, hidden } = await readShownHidden(
        page,
        cover,
        "above",
        GRID,
      );
      shares.push(changedShare(shown, hidden));
      if (cover === 0.9) {
        const covered = shown.filter(
          (px, i) => Math.abs(sum(px) - sum(hidden[i])) > CHANGED_LEVELS,
        );
        topBrightness =
          covered.reduce((t, px) => t + sum(px), 0) /
          Math.max(1, covered.length);
      }
    }
    console.log(
      `sheet from above, offset ${offset}: covered ${shares.map((s) => s.toFixed(2)).join(" / ")} at covers ${SHEET_COVERS.join(" / ")}; tops ${topBrightness.toFixed(0)}`,
    );
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]).toBeGreaterThanOrEqual(shares[i - 1] - 0.05);
    }
    expect(shares[2]).toBeGreaterThan(floorAt07);
    expect(topBrightness).toBeGreaterThan(topBrightnessFloor);
  }
  expect(errors).toEqual([]);
});

// The depth test does the occlusion (M1 review, finding 2: ground pixels
// below 5° never see the sheet at all, so they could not fail). From the
// street, 21 m from the central block, its facade fills 7-15° of elevation,
// where the sheet does draw: the facade must be identical with the sheet
// shown and hidden, and the SAME facade must change once the sheet's depth
// test is switched off, which proves the test can fail.
test("a building in front hides the sheet, the sky above shows it", async ({
  page,
}) => {
  const errors = await bootSheet(page);
  const eye = [-21, 1.5, 0];
  await page.evaluate((e) => window.__lookdev.placeCameraAt(e, [0, 6, 0]), eye);
  const facade = await page.evaluate(() => {
    const d = window.__lookdev;
    const f = [];
    for (let z = -6; z <= 6; z += 3) {
      for (const y of [4.5, 5.5, 6.5, 7.5]) f.push(d.project([0, y, z]));
    }
    return f;
  });
  let withoutDepthTest = 0;
  for (const cover of SHEET_COVERS) {
    await page.evaluate((c) => window.__lookdev.setCloudCover(c), cover);
    const f = await shownHidden(page, facade);
    const worst = Math.max(
      ...f.shown.map((px, i) => Math.abs(sum(px) - sum(f.hidden[i]))),
    );
    await page.evaluate(() => window.__lookdev.setCloudSheetDepthTest(false));
    const m = await shownHidden(page, facade);
    await page.evaluate(() => window.__lookdev.setCloudSheetDepthTest(true));
    const leaked = changedShare(m.shown, m.hidden);
    withoutDepthTest = Math.max(withoutDepthTest, leaked);
    console.log(
      `occlusion at cover ${cover}: facade max diff ${worst}; without the depth test ${leaked.toFixed(2)} of it changes`,
    );
    expect(worst).toBe(0);
  }
  expect(withoutDepthTest).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});

// The sheet's occlusion assumes the scene stays below it: measured, not a
// constant (M1 review, finding 7).
test("the look-dev scene stays below the cloud sheet", async ({ page }) => {
  const errors = await bootSheet(page);
  const top = await page.evaluate(() => window.__lookdev.sceneTopM());
  console.log(`scene top ${top.toFixed(0)} m, sheet at 2000 m`);
  expect(top).toBeGreaterThan(100);
  expect(top).toBeLessThan(2000);
  expect(errors).toEqual([]);
});

// One layer, not two: in sheet mode the visible sky draws no clouds of its
// own. With the sheet hidden, the sky equals the clear sky; the dome at the
// same cover does differ, so this test can fail.
test("in sheet mode the sky itself draws no clouds", async ({ page }) => {
  const errors = await bootSheet(page);
  const sky = [];
  for (let i = 0; i < 8; i++) sky.push([0.4 + i * 0.07, 0.08]);
  for (let i = 0; i < 8; i++) sky.push([0.4 + i * 0.07, 0.2]);
  const readAt = (cover, points) =>
    page.evaluate(
      ([c, p]) => {
        window.__lookdev.setCloudCover(c);
        window.__lookdev.setView("city");
        return window.__lookdev.readPixels(p);
      },
      [cover, points],
    );
  const clear = await readAt(0, sky);
  await page.evaluate(() => window.__lookdev.setCloudSheetVisible(false));
  const hidden = await readAt(0.7, sky);
  const worst = Math.max(
    ...clear.map((px, i) => Math.abs(sum(px) - sum(hidden[i]))),
  );
  await page.evaluate(() => window.__lookdev.setCloudMode("dome"));
  await page.evaluate(() => window.__lookdev.setCloudOffset(0.1, 0.2));
  const dome = await readAt(0.7, sky);
  const domeChanged = changedShare(dome, clear);
  console.log(
    `sheet hidden vs clear: max diff ${worst}; dome at 0.7 changed ${domeChanged.toFixed(2)}`,
  );
  // Measured 0 (the sky's own threshold is cleared); 3 levels absorbs a
  // rasteriser's dither without letting a dome layer through (0.69 changed).
  expect(worst).toBeLessThanOrEqual(3);
  expect(domeChanged).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});

// Flying through is a dissolve (DEC-SUN-16): at the sheet's altitude the
// sheet is edge-on AND faded near the camera, so the frame converges on the
// sheet-free frame as the camera approaches it, from ABOVE and from BELOW
// (the top and the underside branch). A missing near fade or a wrong sign
// leaves a difference that does not shrink.
test("crossing the sheet is continuous from both sides", async ({ page }) => {
  const errors = await bootSheet(page);
  await page.evaluate(() => window.__lookdev.setCloudCover(0.9));
  const altitude = 2000;
  /** Declared: at 0.5 m the frame is the sheet-free one (measured 0.00). */
  const atSheetMax = 2;
  /** Declared: a step toward the sheet may not grow the difference by more. */
  const monotoneSlack = 2;
  for (const sign of [1, -1]) {
    const diffs = [];
    const epsilons = [0.5, 2, 10, 50, 200];
    for (const e of epsilons) {
      const y = altitude + sign * e;
      await page.evaluate(
        (h) => window.__lookdev.placeCameraAt([-300, h, 600], [-300, h, -400]),
        y,
      );
      const { shown, hidden } = await shownHidden(page, GRID);
      diffs.push(meanAbsDiff(shown, hidden));
    }
    console.log(
      `crossing ${sign > 0 ? "above" : "below"}: mean diff ${diffs.map((d) => d.toFixed(2)).join(" / ")} at ${epsilons.join(" / ")} m`,
    );
    expect(diffs[0]).toBeLessThan(atSheetMax);
    for (let i = 1; i < diffs.length; i++) {
      expect(diffs[i]).toBeGreaterThanOrEqual(diffs[i - 1] - monotoneSlack);
    }
  }
  expect(errors).toEqual([]);
});

// The sheet is a finite disc; its far fade must hide the edge. From the
// street at 18 m, the fade spans atan(1982/21000) = 5.4° to 8.1° of
// elevation, above every ridge (≤ 3.3°), and the disc's edge is at 4.7°.
// Below the fade's end the sheet must contribute nothing: a missing or
// shortened fade shows the disc there, cut at its edge. (A row-to-row step
// bound was tried first and could not fail: the cloud pattern higher up
// makes steps as large as the cut; the steps are still logged.)
test("the sheet's far edge fades out, with no cut", async ({ page }) => {
  const errors = await bootSheet(page);
  /**
   * Declared bound on the sheet's mean absolute contribution (per-channel
   * levels, summed, over 16 columns) in rows below the fade's end. Measured
   * 2026-09-24: 0 at all four covers; a mutation cutting the disc hard at its
   * edge read 8 (cover 0.5), 12 (0.7) and 13 (0.9) there, 1 at cover 0.3.
   */
  const belowFadeMax = 2;
  const fadeEndDeg = (Math.atan((2000 - 18) / 21_000) * 180) / Math.PI;
  const rowsDeg = [];
  for (let e = 3; e <= 14; e += 0.5) rowsDeg.push(e);
  for (const cover of SHEET_COVERS) {
    const profile = await page.evaluate(
      ([c, rows]) => {
        const d = window.__lookdev;
        d.setCloudCover(c);
        const eye = [-20, 18, 60];
        d.placeCameraAt(eye, [
          -20 + 1000,
          18 + 1000 * Math.tan((8 * Math.PI) / 180),
          60,
        ]);
        const out = [];
        for (const e of rows) {
          const t = Math.tan((e * Math.PI) / 180);
          const points = [];
          for (let k = 0; k < 16; k++) {
            const side = (k - 7.5) * 25;
            points.push(
              d.project([eye[0] + 1000, eye[1] + 1000 * t, eye[2] + side]),
            );
          }
          d.setCloudSheetVisible(true);
          const shown = d.readPixels(points);
          d.setCloudSheetVisible(false);
          const hidden = d.readPixels(points);
          d.setCloudSheetVisible(true);
          let total = 0;
          for (let i = 0; i < points.length; i++) {
            for (let ch = 0; ch < 3; ch++) {
              total += Math.abs(shown[i][ch] - hidden[i][ch]);
            }
          }
          out.push(total / points.length);
        }
        return out;
      },
      [cover, rowsDeg],
    );
    let worst = 0;
    for (let i = 1; i < profile.length; i++) {
      worst = Math.max(worst, Math.abs(profile[i] - profile[i - 1]));
    }
    const below = Math.max(
      ...profile.filter((_, i) => rowsDeg[i] < fadeEndDeg),
    );
    console.log(
      `far edge, cover ${cover}: |sheet| ${profile.map((p) => p.toFixed(0)).join(" ")} (3°..14°), below the fade's end ${below.toFixed(1)}, worst step ${worst.toFixed(1)}`,
    );
    expect(below).toBeLessThan(belowFadeMax);
  }
  expect(errors).toEqual([]);
});

// The owner reviews from the panel, not the test API (M1 review, finding 1:
// the View select once shared the canvas's id and did nothing).
test("the View and Cloud mode selects drive the page", async ({ page }) => {
  const errors = await boot(page, "preset=noon&tone=neutral");
  const before = await page.evaluate(() => window.__lookdev.project([0, 0, 0]));
  await page.selectOption("#camera-view", "above");
  const after = await page.evaluate(() => window.__lookdev.project([0, 0, 0]));
  expect(
    Math.hypot(after[0] - before[0], after[1] - before[1]),
  ).toBeGreaterThan(0.01);
  await page.selectOption("#cloud-mode", "sheet");
  const mode = await page.evaluate(
    () => window.__lookdev.stats().state.cloudMode,
  );
  expect(mode).toBe("sheet");
  expect(errors).toEqual([]);
});

// --- Sun shadows, the AR prototype's S1 (plan 2026-09-23-2343, M2) ------------
// A DIRECTION, not "something changed" (plan review finding 6: the shadow
// factor multiplies direct light only, so an anti-sun face cannot show it).
// The ground just past the tallest building's footprint, away from the sun,
// must get darker with shadows on; a DIFFUSE sunlit control on the sun side,
// past every building, must not (the M2 review: the first control, the
// tallest roof, was the glass tower, blind to shadows). A broken shadow that
// darkens every receiver (a large positive bias, measured below) moves the
// control a lot, so the control's bound can fail.
/** Probe with shadows on or off; the camera looks down on each point. */
async function probeShadows(page, shadows) {
  return page.evaluate((on) => {
    const d = window.__lookdev;
    d.setCloudCover(0);
    d.setShadows(on);
    const probe = d.shadowProbe();
    const look = (p) => {
      d.placeCameraAt([p[0] + 1, 140, p[2] + 1], [p[0], 0, p[2]]);
      return d.readPixels([d.project(p)])[0];
    };
    return {
      ground: look(probe.shadowed),
      lit: look(probe.lit),
      roof: look(probe.roof),
      renders: d.shadowRenders(),
    };
  }, shadows);
}

/**
 * Declared per preset: the shadowed ground must fall by at least this much.
 * Measured 2026-09-24 (SwiftShader): noon 109, hazy 74, golden 22 (at a 5°
 * sun the direct light on the ground is weak): half or less of each.
 */
const MIN_DARKENING = { noon: 30, hazy: 30, golden: 10 };

for (const preset of ["noon", "hazy", "golden"]) {
  test(`sun shadows darken the ground behind a building, and nothing sunlit (${preset})`, async ({
    page,
  }) => {
    const errors = await boot(page, `preset=${preset}&tone=neutral`);
    /**
     * Declared: the shadowed ground's RGB sum must fall by at least
     * `minDarkening`; the sunlit control may move by at most `litMax`.
     * Measured 2026-09-24 (SwiftShader) in the log; the broken-bias run
     * below shows what the control does when every receiver is shadowed.
     */
    const minDarkening = MIN_DARKENING[preset];
    const litMax = 6;
    const off = await probeShadows(page, false);
    const on = await probeShadows(page, true);
    const darkening = sum(off.ground) - sum(on.ground);
    const litMove = Math.abs(sum(off.lit) - sum(on.lit));
    const roofMove = Math.abs(sum(off.roof) - sum(on.roof));
    await page.evaluate(() => window.__lookdev.setShadowParams({ bias: 0.1 }));
    const broken = await probeShadows(page, true);
    await page.evaluate(() => window.__lookdev.setShadowParams({ bias: 0 }));
    const brokenRoofMove = Math.abs(sum(off.roof) - sum(broken.roof));
    console.log(
      `shadows (${preset}): ground ${sum(off.ground)} -> ${sum(on.ground)} (darker by ${darkening}), sunlit ground moved ${litMove}, sunlit roof ${roofMove}; with a broken bias the roof moves ${brokenRoofMove}`,
    );
    expect(off.renders).toBeNull();
    expect(on.renders).toBe(1);
    expect(darkening).toBeGreaterThan(minDarkening);
    expect(litMove).toBeLessThanOrEqual(litMax);
    expect(roofMove).toBeLessThanOrEqual(litMax);
    // The roof control can fail: a bias that makes casters shadow
    // themselves (acne) darkens it. Probed 2026-09-24 at noon: bias 0,
    // 0.001 and 0.01 leave the roof at 197/185/170 (the one-texel normal
    // bias absorbs them); 0.1 drops it to 49/57/72.
    expect(brokenRoofMove).toBeGreaterThan(litMax);
    expect(errors).toEqual([]);
  });
}

// The cost rule, as three sees it (M2 review, finding 5): after a map render
// the manual flags are back (autoUpdate off, needsUpdate cleared), a change
// that leaves the sun alone renders no map and adds no draws, and a sun move
// renders one; switching off and on again gives the lit ground back and one
// fresh map.
test("sun shadows re-render only when the sun moves, and switch off cleanly", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&shadows=1");
  const result = await page.evaluate(() => {
    const d = window.__lookdev;
    d.setView("city");
    d.readPixels([[0.5, 0.5]]);
    const flags = d.shadowFlags();
    d.readPixels([[0.5, 0.5]]);
    const steadyDraws = d.stats().drawCalls;
    d.setHaze(false);
    d.setHaze(true);
    d.readPixels([[0.5, 0.5]]);
    const afterHaze = {
      renders: d.shadowRenders(),
      draws: d.stats().drawCalls,
    };
    d.setPreset("golden");
    d.readPixels([[0.5, 0.5]]);
    const updateDraws = d.stats().drawCalls;
    const afterSun = d.shadowRenders();
    return { flags, steadyDraws, afterHaze, updateDraws, afterSun };
  });
  console.log(
    `shadow cost: steady ${result.steadyDraws} draws, after a haze toggle ${result.afterHaze.draws}, on the sun-move frame ${result.updateDraws}`,
  );
  expect(result.flags).toEqual({ autoUpdate: false, needsUpdate: false });
  expect(result.afterHaze.renders).toBe(1);
  expect(result.afterHaze.draws).toBe(result.steadyDraws);
  expect(result.afterSun).toBe(2);
  expect(result.updateDraws).toBeGreaterThan(result.steadyDraws);

  // Off and on again: the ground is lit while off, dark again when on, and
  // the new shadow renders its first map.
  const offGround = await probeShadows(page, false);
  const onAgain = await probeShadows(page, true);
  expect(offGround.renders).toBeNull();
  expect(onAgain.renders).toBe(1);
  // At the golden preset the test switched to above.
  expect(sum(offGround.ground) - sum(onAgain.ground)).toBeGreaterThan(
    MIN_DARKENING.golden,
  );
  expect(errors).toEqual([]);
});

// M2 review, finding 1: a pending map render must use the rig's light
// position. A sun move and a sun-less change in ONE task (the page re-aims
// the light at 1 km in every applyLook) once rendered an empty map from 1 km.
test("a pending shadow map survives another change in the same task", async ({
  page,
}) => {
  const errors = await boot(page, "preset=golden&tone=neutral&shadows=1");
  const on = await page.evaluate(() => {
    const d = window.__lookdev;
    d.setCloudCover(0);
    d.setPreset("noon");
    d.setHaze(false);
    d.setHaze(true);
    d.setCloudCover(0);
    const probe = d.shadowProbe();
    const p = probe.shadowed;
    d.placeCameraAt([p[0] + 1, 140, p[2] + 1], [p[0], 0, p[2]]);
    return d.readPixels([d.project(p)])[0];
  });
  const off = await probeShadows(page, false);
  console.log(`pending map: ground ${sum(off.ground)} off, ${sum(on)} on`);
  expect(sum(off.ground) - sum(on)).toBeGreaterThan(30);
  expect(errors).toEqual([]);
});

// --- The ray-marched cloud slab (plan 2026-09-24-1010 §11-§12) ----------------
// A first, minimal block (triage §12 item 9: the GLSL must compile the commit
// it lands in). The full E1-E10 block follows in its own commit.

/** Boot in slab mode with the drift pinned. */
async function bootSlab(page, [u, v] = SHEET_OFFSETS[0], steps = 16) {
  const errors = await boot(
    page,
    `preset=noon&tone=neutral&cloudMode=slab&slabSteps=${steps}`,
  );
  await page.evaluate(
    ([a, b]) => window.__lookdev.setCloudOffset(a, b),
    [u, v],
  );
  return errors;
}

// WHY: a shader that fails to compile logs a console error and draws
// nothing, and the framework gate has no GL. From above at cover 0.9 a
// working slab covers most of the city; a broken one changes nothing.
test("the cloud slab compiles and covers the city from above", async ({
  page,
}) => {
  const errors = await bootSlab(page);
  expect(
    await page.evaluate(() => window.__lookdev.stats().state.cloudMode),
  ).toBe("slab");
  const { shown, hidden } = await readShownHidden(page, 0.9, "above", GRID);
  const covered = changedShare(shown, hidden);
  // The cost of one slab frame on this renderer (SwiftShader in CI): it
  // sizes the E1-E10 block (§11.8: above 0.3 s it runs smaller and at 8
  // steps). Logged, never asserted: the timer is the owner's GPU.
  const frameS = await page.evaluate(() => {
    const d = window.__lookdev;
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) d.readPixels([[0.5, 0.5]]);
    return (performance.now() - t0) / 3000;
  });
  console.log(
    `slab from above, cover 0.9: ${covered.toFixed(2)} covered; ${frameS.toFixed(3)} s per frame`,
  );
  // Declared: the sheet's floor at 0.7 cover (0.5), used at 0.9 until the
  // E1 block measures the slab's own.
  expect(covered).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

// --- The slab's E1-E11 block (plan §11.7 as amended by §12) -------------------
// Every bound is declared beside its measurement and margin, with the value
// that would reverse it (the owner's sweep rule). The loop is paused (a slab
// frame costs ~0.7 s on SwiftShader), so a frame renders only when read.

/**
 * The slab block's declared bounds. Measured 2026-09-24 on SwiftShader at
 * 1280×800 and 16 steps; each with its margin and what would reverse it.
 */
/** E1: covered 1.00 / 1.00 at cover 0.7 (two offsets); tops 655 / 658. The
 * sheet's floors: 0.5 fails a slab that covers half the time; 520 sits
 * between the tops (655) and a grey underside model (~359, the M1 probe). */
const SLAB_E1 = { floorAt07: 0.5, topsFloor: 520 };
/** E2: tops 662 against undersides 471 away from the sun: ratio 1.41 (1.2
 * keeps a 0.2 margin; the verdict reverses at 1.0). Toward the sun the
 * underside reads 669, above the tops, as the CPU twin predicted. The
 * offline mutant that measures the sun from the column BASE reads 0.99. */
const SLAB_E2 = { ratioFloor: 1.2 };
/** E6: 1.00 changed inside at both offsets; the sheet reads 0.00 there. */
const SLAB_E6 = { floor: 0.8 };
/** E7: base crossing 74.6 → 74.8 (a 0.2 jump), top 158.1 → 158.1; the slab
 * reads 69.2 at 50 m below the base. 5 levels of jump, 30 of floor. */
const SLAB_E7 = { jumpMax: 5, floorAt50: 30 };
/** E8(a): the worst row step level through the layer is 0.9; the offline
 * mutant that branches the light on the view direction (the sheet's form)
 * reads 340.9. E8(b) is logged only: see the test. */
const SLAB_E8 = { levelMax: 10 };
/** E9 from above: the row at 3.0° of depression (just inside the far cut at
 * 2.7°) reads 6 at cover 0.9; the offline mutant without the far weight
 * reads 95. 30 sits between. */
const SLAB_E9 = { edgeRowMax: 30 };
/** E10: 8 against 32 steps differ by 5.6 levels on the grid; 20 is a 3.5x
 * margin (the CPU twin bounds the alpha difference at 0.05). */
const SLAB_E10 = { diffMax: 20 };

/** Boot the slab with the drift pinned and the loop paused. */
async function bootSlabPaused(page, offset = SHEET_OFFSETS[0], steps = 16) {
  const errors = await bootSlab(page, offset, steps);
  await page.evaluate(() => window.__lookdev.pauseLoop(true));
  return errors;
}

/** Mean RGB sum of the points that the slab changes (shown vs hidden). */
const coveredBrightness = ({ shown, hidden }) => {
  const covered = shown.filter(
    (px, i) => Math.abs(sum(px) - sum(hidden[i])) > CHANGED_LEVELS,
  );
  return {
    share: covered.length / shown.length,
    mean:
      covered.reduce((t, px) => t + sum(px), 0) / Math.max(1, covered.length),
  };
};

// E1: from above the slab covers the city, more of it the higher the cover.
test("E1: the cloud slab covers the city from above, more with more cover", async ({
  page,
}) => {
  const errors = await bootSlabPaused(page);
  for (const offset of SHEET_OFFSETS) {
    await page.evaluate(
      ([a, b]) => window.__lookdev.setCloudOffset(a, b),
      offset,
    );
    const shares = [];
    let tops = 0;
    for (const cover of SHEET_COVERS) {
      const r = await readShownHidden(page, cover, "above", GRID);
      shares.push(changedShare(r.shown, r.hidden));
      if (cover === 0.9) tops = coveredBrightness(r).mean;
    }
    console.log(
      `E1 slab from above, offset ${offset}: covered ${shares.map((s) => s.toFixed(2)).join(" / ")} at ${SHEET_COVERS.join(" / ")}; tops ${tops.toFixed(0)}`,
    );
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]).toBeGreaterThanOrEqual(shares[i - 1] - 0.05);
    }
    expect(shares[2]).toBeGreaterThan(SLAB_E1.floorAt07);
    expect(tops).toBeGreaterThan(SLAB_E1.topsFloor);
  }
  expect(errors).toEqual([]);
});

// E2: away from the sun, sunlit tops seen from above are brighter than
// undersides seen from below (toward the sun the forward lobe reverses it,
// so the geometry is named, and the toward-sun value is logged).
test("E2: slab tops from above outshine undersides from below, away from the sun", async ({
  page,
}) => {
  const errors = await bootSlabPaused(page);
  const read = (eye, elDeg, toward) =>
    page.evaluate(
      ([e, el, t]) => {
        const d = window.__lookdev;
        d.setCloudCover(0.9);
        const s = d.sunDirection();
        const flat = Math.hypot(s[0], s[2]) || 1;
        const sign = t ? 1 : -1;
        const h = [(sign * s[0]) / flat, (sign * s[2]) / flat];
        const r = (el * Math.PI) / 180;
        d.placeCameraAt(e, [
          e[0] + 1000 * Math.cos(r) * h[0],
          e[1] + 1000 * Math.sin(r),
          e[2] + 1000 * Math.cos(r) * h[1],
        ]);
        const points = [];
        for (let i = 0; i < 6; i++)
          for (let j = 0; j < 6; j++)
            points.push([0.4 + i * 0.1, 0.25 + j * 0.1]);
        d.setCloudSheetVisible(true);
        const shown = d.readPixels(points);
        d.setCloudSheetVisible(false);
        const hidden = d.readPixels(points);
        d.setCloudSheetVisible(true);
        return { shown, hidden };
      },
      [eye, elDeg, toward],
    );
  const above = coveredBrightness(await read([-300, 3200, 600], -60, false));
  const below = coveredBrightness(await read([-20, 18, 60], 60, false));
  const towardBelow = coveredBrightness(await read([-20, 18, 60], 60, true));
  const ratio = above.mean / below.mean;
  console.log(
    `E2 slab tops ${above.mean.toFixed(0)} (share ${above.share.toFixed(2)}), undersides away ${below.mean.toFixed(0)} (share ${below.share.toFixed(2)}), toward the sun ${towardBelow.mean.toFixed(0)}; ratio ${ratio.toFixed(2)}`,
  );
  expect(above.share).toBeGreaterThan(0.5);
  expect(below.share).toBeGreaterThan(0.5);
  expect(ratio).toBeGreaterThanOrEqual(SLAB_E2.ratioFloor);
  expect(errors).toEqual([]);
});

// E3: occlusion. From the street a facade in front hides the slab (and the
// same facade changes without the depth test, so the test can fail); from
// above the slab covers the city's ground (a slab drawn at far depth, the
// sky's trick, would read 0 there).
test("E3: the slab is hidden behind a facade and covers the city from above", async ({
  page,
}) => {
  const errors = await bootSlabPaused(page);
  const eye = [-21, 1.5, 0];
  await page.evaluate((e) => window.__lookdev.placeCameraAt(e, [0, 6, 0]), eye);
  const facade = await page.evaluate(() => {
    const d = window.__lookdev;
    const f = [];
    for (let z = -6; z <= 6; z += 3) {
      for (const y of [4.5, 5.5, 6.5, 7.5]) f.push(d.project([0, y, z]));
    }
    return f;
  });
  await page.evaluate(() => window.__lookdev.setCloudCover(0.9));
  const f = await shownHidden(page, facade);
  const worst = Math.max(
    ...f.shown.map((px, i) => Math.abs(sum(px) - sum(f.hidden[i]))),
  );
  await page.evaluate(() => window.__lookdev.setCloudSheetDepthTest(false));
  const m = await shownHidden(page, facade);
  await page.evaluate(() => window.__lookdev.setCloudSheetDepthTest(true));
  const leaked = changedShare(m.shown, m.hidden);
  const ground = await page.evaluate(() => {
    const d = window.__lookdev;
    d.setView("above");
    const g = [];
    for (let x = -150; x <= 150; x += 50)
      for (let z = -150; z <= 150; z += 50) g.push(d.project([x, 0, z]));
    return g;
  });
  const roofs = await shownHidden(page, ground);
  const covered = changedShare(roofs.shown, roofs.hidden);
  console.log(
    `E3 slab facade max diff ${worst}, without the depth test ${leaked.toFixed(2)} changes; city ground covered from above ${covered.toFixed(2)}`,
  );
  expect(worst).toBe(0);
  expect(leaked).toBeGreaterThan(0.2);
  // Declared 0.8 at cover 0.9 (reverses at 0: a far-depth slab).
  expect(covered).toBeGreaterThan(0.8);
  expect(errors).toEqual([]);
});

// E4 and E5: the occlusion rests on the scene staying below the base, and in
// slab mode the visible sky draws no clouds of its own.
test("E4/E5: the scene stays below the slab, and the slab mode's sky draws no clouds", async ({
  page,
}) => {
  const errors = await bootSlabPaused(page);
  const top = await page.evaluate(() => window.__lookdev.sceneTopM());
  expect(top).toBeGreaterThan(100);
  expect(top).toBeLessThan(1800);
  const sky = [];
  for (let i = 0; i < 8; i++) sky.push([0.4 + i * 0.07, 0.08]);
  const readAt = (cover) =>
    page.evaluate(
      ([c, p]) => {
        window.__lookdev.setCloudCover(c);
        window.__lookdev.setView("city");
        return window.__lookdev.readPixels(p);
      },
      [cover, sky],
    );
  await page.evaluate(() => window.__lookdev.setCloudSheetVisible(false));
  const clear = await readAt(0);
  const hidden = await readAt(0.7);
  const worst = Math.max(
    ...clear.map((px, i) => Math.abs(sum(px) - sum(hidden[i]))),
  );
  console.log(
    `E4 scene top ${top.toFixed(0)} m; E5 slab hidden vs clear sky ${worst}`,
  );
  expect(worst).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

// E6: inside the layer is a whiteout (the sheet reads 0.00 there, by its
// near fade: the point of the A/B).
test("E6: inside the slab is a whiteout", async ({ page }) => {
  const errors = await bootSlabPaused(page);
  for (const offset of SHEET_OFFSETS) {
    await page.evaluate(
      ([a, b]) => window.__lookdev.setCloudOffset(a, b),
      offset,
    );
    const r = await readShownHidden(page, 0.9, "inside", GRID);
    const share = changedShare(r.shown, r.hidden);
    console.log(`E6 inside, offset ${offset}: ${share.toFixed(2)} changed`);
    expect(share).toBeGreaterThan(SLAB_E6.floor);
  }
  expect(errors).toEqual([]);
});

// E7: crossing the base and the top in time is continuous (the interval
// must not jump at a plane), and the slab is there at ±50 m.
test("E7: crossing the slab's base and top is continuous", async ({ page }) => {
  const errors = await bootSlabPaused(page);
  await page.evaluate(() => window.__lookdev.setCloudCover(0.9));
  for (const plane of [1800, 2200]) {
    const diffs = {};
    for (const e of [-50, -10, -2, -0.5, 0.5, 2, 10, 50]) {
      const y = plane + e;
      await page.evaluate(
        (h) => window.__lookdev.placeCameraAt([-300, h, 600], [-300, h, -400]),
        y,
      );
      const { shown, hidden } = await shownHidden(page, GRID);
      diffs[e] = meanAbsDiff(shown, hidden);
    }
    console.log(
      `E7 plane ${plane}: ${Object.entries(diffs)
        .map(([e, d]) => `${e}:${d.toFixed(1)}`)
        .join(" ")}`,
    );
    expect(Math.abs(diffs[-0.5] - diffs[0.5])).toBeLessThanOrEqual(
      SLAB_E7.jumpMax,
    );
    expect(Math.min(diffs[-50], diffs[50])).toBeGreaterThan(SLAB_E7.floorAt50);
  }
  expect(errors).toEqual([]);
});

/**
 * The max row-to-row step of a profile: rows at `rowsDeg` (elevation from
 * the horizontal, looking toward -z), each the mean RGB sum of 16 columns,
 * read in ONE render (triage §12 item 6).
 */
const rowProfile = (page, eye, pitchDeg, rowsDeg) =>
  page.evaluate(
    ([e, pitch, rows]) => {
      const d = window.__lookdev;
      const p = (pitch * Math.PI) / 180;
      d.placeCameraAt(e, [e[0], e[1] + 1000 * Math.tan(p), e[2] - 1000]);
      const points = [];
      for (const r of rows) {
        const t = Math.tan((r * Math.PI) / 180);
        for (let k = 0; k < 16; k++) {
          points.push(
            d.project([e[0] + (k - 7.5) * 25, e[1] + 1000 * t, e[2] - 1000]),
          );
        }
      }
      const px = d.readPixels(points);
      const means = [];
      for (let i = 0; i < rows.length; i++) {
        let s = 0;
        for (let k = 0; k < 16; k++) {
          const q = px[i * 16 + k];
          s += q[0] + q[1] + q[2];
        }
        means.push(s / 16);
      }
      let worst = 0;
      for (let i = 1; i < means.length; i++)
        worst = Math.max(worst, Math.abs(means[i] - means[i - 1]));
      return { worst, means };
    },
    [eye, pitchDeg, rowsDeg],
  );

// E8: no hard line where there is no physical edge, at cover 1.0 so the
// pattern cannot hide one (§10 item 5). (a) Level through the middle of the
// layer: asserted, its mutant reads 380x the measurement. (b) Just inside
// the base and the top, pitched, rows 5°-45°: LOGGED ONLY. Its design
// mutant (midpoint sampling instead of the exact vertical integral) read
// 2.9 against 2.5 at 16 steps and 5.1 at 8, never twice a bound, because the
// jitter and the level of detail hide the slicing; the design's own rule
// replaces such a test, and the CPU twin's vertical-opacity test catches
// that mutant exactly.
test("E8: the slab draws no hard line inside the layer", async ({ page }) => {
  const errors = await bootSlabPaused(page);
  await page.evaluate(() => window.__lookdev.setCloudCover(1));
  const level = [];
  for (let r = -10; r <= 10; r += 0.5) level.push(r);
  const a = await rowProfile(page, [-300, 1900, 600], 0, level);
  const up = [];
  for (let r = 5; r <= 45; r += 1) up.push(r);
  const down = up.map((r) => -r);
  const b1 = await rowProfile(page, [-300, 1800.5, 600], 25, up);
  const b2 = await rowProfile(page, [-300, 2199.5, 600], -25, down);
  console.log(
    `E8 worst row step: level ${a.worst.toFixed(1)}, above the base ${b1.worst.toFixed(1)}, below the top ${b2.worst.toFixed(1)}`,
  );
  expect(a.worst).toBeLessThan(SLAB_E8.levelMax);
  expect(errors).toEqual([]);
});

// E9: the far edge. From the street the slab contributes nothing below the
// fade's end (atan(1782/21000) = 4.85°). From `above` the march's far cut
// ends the deck at about 2.7° of depression, so rows above it are 0 with or
// without the far weight (measured: a check there could not fail); the
// weight shows in the row just inside the cut, which must have faded.
test("E9: the slab's far edge fades out, from the street and from above", async ({
  page,
}) => {
  const errors = await bootSlabPaused(page);
  const fadeEndDeg = (Math.atan((1800 - 18) / 21_000) * 180) / Math.PI;
  const rows = [];
  for (let e = 3; e <= 10; e += 0.5) rows.push(e);
  const horizon = [];
  for (let e = -5; e <= 5; e += 0.5) horizon.push(e);
  const contribution = (eye, rowsDeg) =>
    page.evaluate(
      ([e, rs]) => {
        const d = window.__lookdev;
        d.placeCameraAt(e, [e[0] + 1000, e[1], e[2]]);
        const points = [];
        for (const r of rs) {
          const t = Math.tan((r * Math.PI) / 180);
          for (let k = 0; k < 16; k++)
            points.push(
              d.project([e[0] + 1000, e[1] + 1000 * t, e[2] + (k - 7.5) * 25]),
            );
        }
        d.setCloudSheetVisible(true);
        const shown = d.readPixels(points);
        d.setCloudSheetVisible(false);
        const hidden = d.readPixels(points);
        d.setCloudSheetVisible(true);
        const out = [];
        for (let i = 0; i < rs.length; i++) {
          let total = 0;
          for (let k = 0; k < 16; k++)
            for (let c = 0; c < 3; c++)
              total += Math.abs(shown[i * 16 + k][c] - hidden[i * 16 + k][c]);
          out.push(total / 16);
        }
        return out;
      },
      [eye, rowsDeg],
    );
  const edgeRows = [];
  for (const cover of [0.5, 0.9]) {
    await page.evaluate((c) => window.__lookdev.setCloudCover(c), cover);
    const street = await contribution([-20, 18, 60], rows);
    const below = Math.max(...street.filter((_, i) => rows[i] < fadeEndDeg));
    const high = await contribution([-300, 3200, 600], horizon);
    const edgeRow = high[horizon.indexOf(-3)];
    console.log(
      `E9 cover ${cover}: street below the fade's end ${below.toFixed(1)}; from above, the row at -3° ${edgeRow.toFixed(1)} (profile -5°..5°: ${high.map((p) => p.toFixed(0)).join(" ")})`,
    );
    expect(below).toBeLessThan(2);
    edgeRows.push(edgeRow);
  }
  // At cover 0.9, where the deck reaches the cut (at 0.5 it reads 0 either way).
  expect(edgeRows[1]).toBeLessThan(SLAB_E9.edgeRowMax);
  expect(errors).toEqual([]);
});

// E10: the step count changes the cost (direction only: SwiftShader has no
// GPU timer) and the picture only a little, but not by nothing (a define
// that never reached the program would read 0).
test("E10: more slab steps cost more and change the picture a little", async ({
  page,
}) => {
  const errors = await bootSlabPaused(page);
  const measure = (steps) =>
    page.evaluate(
      ([n, grid]) => {
        const d = window.__lookdev;
        d.setCloudSlabSteps(n);
        d.setCloudCover(0.5);
        d.setView("above");
        d.readPixels([[0.5, 0.5]]); // compiles the program
        const times = [];
        for (let i = 0; i < 3; i++) {
          const t0 = performance.now();
          d.readPixels([[0.5, 0.5]]);
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        return { ms: times[1], grid: d.readPixels(grid) };
      },
      [steps, GRID],
    );
  const s8 = await measure(8);
  const s32 = await measure(32);
  const diff = meanAbsDiff(s8.grid, s32.grid);
  console.log(
    `E10 slab frame ${s8.ms.toFixed(0)} ms at 8 steps, ${s32.ms.toFixed(0)} ms at 32 (x${(s32.ms / s8.ms).toFixed(2)}); picture diff ${diff.toFixed(1)}`,
  );
  expect(s32.ms / s8.ms).toBeGreaterThanOrEqual(1.2);
  expect(diff).toBeGreaterThan(0);
  expect(diff).toBeLessThan(SLAB_E10.diffMax);
  expect(errors).toEqual([]);
});

// E11: the owner drives it from the panel.
test("E11: the Cloud mode and Slab steps selects drive the page", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral");
  await expect(page.locator("#slab-steps")).toBeDisabled();
  await page.selectOption("#cloud-mode", "slab");
  await expect(page.locator("#slab-steps")).toBeEnabled();
  await page.selectOption("#slab-steps", "8");
  const state = await page.evaluate(() => window.__lookdev.stats().state);
  expect(state.cloudMode).toBe("slab");
  expect(state.slabSteps).toBe(8);
  await expect(page.locator("[data-stats]")).toContainText("clouds slab ×8");
  expect(errors).toEqual([]);
});

// The owner's A/B question behind triage §12 item 4: from the street, how
// much of each elevation band the sheet and the slab cover at one cover.
// Logged for the owner, not asserted (the slab reads cloudier low down, by
// its 1/sin(e) path, which is physically right).
test("the covered share per elevation band, sheet against slab (logged)", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&cloudMode=sheet");
  const bands = [10, 20, 45, 80];
  const read = () =>
    page.evaluate(
      ([bs, levels]) => {
        const d = window.__lookdev;
        d.pauseLoop(true);
        d.setCloudOffset(0.1, 0.2);
        d.setCloudCover(0.5);
        const eye = [-20, 18, 60];
        const out = [];
        for (const b of bs) {
          const r = (b * Math.PI) / 180;
          d.placeCameraAt(eye, [
            eye[0] + 1000 * Math.cos(r),
            eye[1] + 1000 * Math.sin(r),
            eye[2],
          ]);
          const points = [];
          for (let i = 0; i < 5; i++)
            for (let j = 0; j < 5; j++)
              points.push([0.4 + i * 0.12, 0.3 + j * 0.1]);
          d.setCloudSheetVisible(true);
          const shown = d.readPixels(points);
          d.setCloudSheetVisible(false);
          const hidden = d.readPixels(points);
          d.setCloudSheetVisible(true);
          let changed = 0;
          for (let i = 0; i < points.length; i++) {
            const a = shown[i][0] + shown[i][1] + shown[i][2];
            const c = hidden[i][0] + hidden[i][1] + hidden[i][2];
            if (Math.abs(a - c) > levels) changed++;
          }
          out.push(changed / points.length);
        }
        return out;
      },
      [bands, CHANGED_LEVELS],
    );
  const sheet = await read();
  await page.evaluate(() => window.__lookdev.setCloudMode("slab"));
  const slab = await read();
  console.log(
    `covered at cover 0.5 by band ${bands.join("/")}°: sheet ${sheet.map((s) => s.toFixed(2)).join(" / ")}, slab ${slab.map((s) => s.toFixed(2)).join(" / ")}`,
  );
  expect(sheet.length).toBe(bands.length);
  expect(errors).toEqual([]);
});
