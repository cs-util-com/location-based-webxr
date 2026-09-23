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
test("every preset draws a non-uniform image without console errors", async ({
  page,
}) => {
  const errors = await boot(page);
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
