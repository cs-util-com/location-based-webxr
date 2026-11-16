// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why these tests matter: the editor's picture and sound optimizers run in
 * a real Worker with the browser's own decoders and encoders, which no
 * unit test reaches. These tests run the shipped optimizer rows (through
 * the asset optimizer check page, which is linked from nothing in the
 * app) and hold what a tour depends on:
 *
 * - a picture comes back as real WebP bytes at the chosen size, smaller
 *   than the original and above a quality floor, over a sweep of sizes
 *   and qualities, for a real photo and for the generated test picture;
 * - a sound comes back as real Ogg Opus bytes that decode to EXACTLY the
 *   original's number of samples, with no shift, so every caption and
 *   narration timing stays where it was; an <audio> element reports it
 *   longer by exactly the pre-skip (a property of Ogg Opus in Chromium);
 *   real recordings (speech in German and English, piano, orchestra;
 *   `fixtures/asset-optimizer/SOURCES.md`) carry the size and quality
 *   measurements, generated sounds pin the exact lengths over sample
 *   rates and lengths;
 * - a 3D model comes back as a .glb the tour accepts, smaller, with the
 *   same triangles (every triangle kept) and box (within the position
 *   error budget) as three.js loads it, textures at the asked side, and a
 *   drawing close to the original's, over texture sides, qualities and
 *   position bits; at its default level of detail it has fewer triangles,
 *   its box within the deviation budget, and its drawing still close;
 * - a GIF is kept, and a sound that is no sound fails with words;
 * - the times stay under the thresholds set for a phone, measured here on
 *   a desktop (the phone's own measurement is still open).
 */

// The measured runs share one page; one after another keeps the timings
// apart.
test.describe.configure({ mode: "default" });

/** @typedef {{ optimizePicture: Function, optimizeSound: Function, sample: Function, testPicture: Function, testSound: Function, pictureSsim: Function, decode: Function, durationMs: Function, bestLag: Function }} Check */

/** @param {import("@playwright/test").Page} page */
async function openCheck(page) {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/asset-optimizer-check.html");
  await expect(page.locator("#status")).toHaveText("Ready.");
  return errors;
}

/** The SSIM floor per source and WebP quality, against the original
 *  scaled to the result's size. */
const SSIM_FLOOR = {
  // The generated 4000 x 3000 test picture: measured 0.935-0.978 at 0.6,
  // 0.937-0.979 at 0.75, 0.954-0.982 at 0.9 (the larger side the lower:
  // more grain is compared).
  synthetic: { 0.6: 0.92, 0.75: 0.92, 0.9: 0.94 },
  // The real 2400 x 1800 photo (fixtures/asset-optimizer/SOURCES.md):
  // measured 0.975-0.976 at 0.6, 0.980-0.981 at 0.75, 0.992-0.993 at 0.9
  // over the three sides.
  real: { 0.6: 0.96, 0.75: 0.965, 0.9: 0.975 },
};

test("pictures: WebP of the asked size, smaller, above the quality floor, over sides and qualities, real and generated", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = await openCheck(page);
  const rows = await page.evaluate(async () => {
    const check = /** @type {Check} */ (
      /** @type {any} */ (window).assetOptimizerCheck
    );
    const sources = [
      { source: "real", original: await check.sample("photo") },
      { source: "synthetic", original: await check.testPicture(4000, 3000) },
    ];
    const out = [];
    for (const { source, original } of sources) {
      for (const side of [1024, 1600, 2048]) {
        for (const quality of [0.6, 0.75, 0.9]) {
          const result = await check.optimizePicture(original, side, quality);
          const head = new Uint8Array(
            await result.blob.slice(0, 12).arrayBuffer(),
          );
          out.push({
            source,
            side,
            quality,
            originalBytes: original.size,
            bytes: result.blob.size,
            width: result.width,
            height: result.height,
            extension: result.extension,
            riff: String.fromCharCode(...head.subarray(0, 4)),
            webp: String.fromCharCode(...head.subarray(8, 12)),
            ssim: await check.pictureSsim(original, result.blob),
            ms: result.ms,
          });
        }
      }
    }
    return out;
  });
  console.log(JSON.stringify({ pictures: rows }));
  for (const row of rows) {
    expect(row.extension).toBe("webp");
    expect([row.riff, row.webp]).toEqual(["RIFF", "WEBP"]);
    expect([row.width, row.height]).toEqual([row.side, (row.side * 3) / 4]);
    expect(row.bytes).toBeLessThan(row.originalBytes * 0.9);
    expect(row.ssim).toBeGreaterThanOrEqual(
      SSIM_FLOOR[/** @type {"real"|"synthetic"} */ (row.source)][
        /** @type {0.6|0.75|0.9} */ (row.quality)
      ],
    );
  }
  // At the chosen setting under the phone's 10 s, for the 12 MP generated
  // picture too (the real sample is cropped to keep the fixtures small); a
  // desktop is several times faster, so this is a floor, not the proof.
  for (const source of ["real", "synthetic"]) {
    const chosen = rows.find(
      (r) => r.source === source && r.side === 1600 && r.quality === 0.6,
    );
    expect(chosen?.ms).toBeLessThan(10_000);
  }
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: it is the measurement behind the question
 * whether flat-colour pictures (cartoons, drawings, many AI-made figures)
 * need another setting than photos. It sweeps lossy WebP over qualities
 * and lossless WebP (Chromium writes lossless at quality 1) over three
 * sides, on the real photo, the generated grainy test picture and two
 * generated cartoons (flat colours, and the same figure shaded), and holds
 * the facts the answer rests on, with margin below what was measured:
 *
 * - lossless costs several times the bytes of quality 0.9 on every
 *   source, so it is no general setting;
 * - the photo setting alone already makes a cartoon a small file, a
 *   fraction of the photo's, so a flat-colour setting has no bytes to
 *   save;
 * - what a higher quality buys on the flat cartoon is cleaner edges and
 *   text (PSNR up, the near-worst error down), for a few KiB;
 * - the common-colour share tells the flat cartoon from the photos at
 *   any threshold over a wide range, but the shaded cartoon sits with
 *   the photos at full colour depth and moves across with fewer bits:
 *   the measure is sure only of pictures that really are flat.
 */
test("pictures, flat colour against photo: size and error over lossy and lossless, qualities and sides", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = await openCheck(page);
  const { rows, shares } = await page.evaluate(async () => {
    const check = /** @type {any} */ (window).assetOptimizerCheck;
    const sources = {
      photo: await check.sample("photo"),
      synthetic: await check.testPicture(2400, 1800),
      flat: await check.cartoonPicture(2400, 1800, false),
      shaded: await check.cartoonPicture(2400, 1800, true),
    };
    const rows = [];
    const shares = /** @type {Record<string, Record<number, number>>} */ ({});
    for (const [source, original] of Object.entries(sources)) {
      shares[source] = {};
      for (const bits of [4, 5, 8]) {
        shares[source][bits] = await check.colourShare(original, 16, bits);
      }
      for (const side of [1024, 1600, 2048]) {
        for (const quality of [0.4, 0.6, 0.75, 0.9, 1]) {
          const result = await check.optimizePicture(original, side, quality);
          const score = await check.comparePicture(original, result.blob);
          rows.push({
            source,
            side,
            quality,
            originalKiB: Math.round(original.size / 1024),
            kib: Math.round(result.blob.size / 1024),
            bytes: result.blob.size,
            percent: +((100 * result.blob.size) / original.size).toFixed(1),
            psnr: Number.isFinite(score.psnr) ? +score.psnr.toFixed(1) : null,
            nearWorst: score.nearWorst,
            ssim: +score.ssim.toFixed(4),
          });
        }
      }
    }
    return { rows, shares };
  });
  console.log(JSON.stringify({ flatColourSweep: rows, colourShares: shares }));
  /** @param {string} source @param {number} side @param {number} quality */
  const at = (source, side, quality) => {
    const row = rows.find(
      (r) => r.source === source && r.side === side && r.quality === quality,
    );
    if (!row) throw new Error(`no row for ${source} ${side} ${quality}`);
    return row;
  };
  const sources = ["photo", "synthetic", "flat", "shaded"];
  for (const source of sources) {
    for (const side of [1024, 1600, 2048]) {
      // Quality 1 is lossless: the same pixels as the scaled original.
      expect(at(source, side, 1).psnr).toBeNull();
      // Measured 2.9 (shaded) to 8.9 (synthetic) times at 1600 px.
      expect(at(source, side, 1).bytes).toBeGreaterThan(
        2.5 * at(source, side, 0.9).bytes,
      );
    }
  }
  // The photo setting on the cartoons: measured 15 and 17 KiB against the
  // photo's 145 KiB.
  for (const cartoon of ["flat", "shaded"]) {
    expect(at(cartoon, 1600, 0.6).bytes).toBeLessThan(
      0.2 * at("photo", 1600, 0.6).bytes,
    );
  }
  // Quality 0.9 on the flat cartoon: measured PSNR 44.2 against 40.8 dB,
  // near-worst error 28 against 40.
  expect(at("flat", 1600, 0.9).psnr).toBeGreaterThan(
    /** @type {number} */ (at("flat", 1600, 0.6).psnr) + 2,
  );
  expect(at("flat", 1600, 0.9).nearWorst).toBeLessThan(
    at("flat", 1600, 0.6).nearWorst,
  );
  // The common-colour share (16 colours): measured 0.999 for the flat
  // cartoon at every depth; at 8 bits 0.05 (photo), 0.03 (synthetic) and
  // 0.19 (shaded).
  for (const bits of [4, 5, 8]) {
    expect(shares.flat[bits]).toBeGreaterThan(0.95);
  }
  for (const source of ["photo", "synthetic", "shaded"]) {
    expect(shares[source][8]).toBeLessThan(0.3);
  }
  // The threshold sweep, for the record: which sources read as flat at
  // each threshold and depth.
  const sweep = [];
  for (const threshold of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
    for (const bits of [4, 5, 8]) {
      sweep.push({
        threshold,
        bits,
        flat: sources.filter((s) => shares[s][bits] >= threshold),
      });
    }
  }
  console.log(JSON.stringify({ thresholdSweep: sweep }));
  expect(errors).toEqual([]);
});

test("pictures: a small one keeps its size, a GIF is kept", async ({
  page,
}) => {
  const errors = await openCheck(page);
  const result = await page.evaluate(async () => {
    const check = /** @type {Check} */ (
      /** @type {any} */ (window).assetOptimizerCheck
    );
    const small = await check.optimizePicture(
      await check.testPicture(640, 480),
      1600,
      0.75,
    );
    const gif = new Blob([
      Uint8Array.from(
        atob("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="),
        (c) => c.charCodeAt(0),
      ),
    ]);
    let kept = "";
    try {
      await check.optimizePicture(gif, 1600, 0.75);
    } catch (error) {
      kept = /** @type {Error} */ (error).message;
    }
    return { width: small.width, height: small.height, kept };
  });
  expect(result).toMatchObject({ width: 640, height: 480 });
  expect(result.kept).toMatch(/animated picture/);
  expect(errors).toEqual([]);
});

test("sounds: Ogg Opus of exactly the original's length and timing, over bitrates, lengths and rates", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = await openCheck(page);
  const rows = await page.evaluate(async () => {
    const check = /** @type {Check} */ (
      /** @type {any} */ (window).assetOptimizerCheck
    );
    const cases = [];
    for (const rate of [44100, 48000]) {
      for (const seconds of [1, 7.3]) {
        // 6 kbps: the lowest step the check page offers (Opus's floor).
        for (const bps of [6000, 16000, 24000, 32000]) {
          cases.push({ kind: "speech", rate, seconds, bps, channels: 1 });
        }
      }
    }
    for (const bps of [48000, 64000, 96000]) {
      cases.push({
        kind: "music",
        rate: 44100,
        seconds: 7.3,
        bps,
        channels: 2,
      });
    }
    // Music made mono, a step of the check page.
    cases.push({
      kind: "music",
      rate: 44100,
      seconds: 7.3,
      bps: 16000,
      channels: 1,
    });
    const out = [];
    for (const c of cases) {
      const source = check.testSound(c.kind, c.seconds, c.rate);
      const result = await check.optimizeSound(source, c.bps, c.channels);
      const head = new Uint8Array(await result.blob.slice(0, 47).arrayBuffer());
      const before = await check.decode(source);
      const after = await check.decode(result.blob);
      // A sound made mono is compared with the original's own downmix.
      const reference =
        after.length === 1 && before.length === 2
          ? before[0].map(
              (/** @type {number} */ v, /** @type {number} */ i) =>
                (v + before[1][i]) / 2,
            )
          : before[0];
      const span = Math.min(24_000, before[0].length - 2_000);
      const lag = check.bestLag(reference, after[0], 1_000, span, 960);
      out.push({
        ...c,
        askedChannels: c.channels,
        originalBytes: source.size,
        bytes: result.blob.size,
        extension: result.extension,
        ogg: String.fromCharCode(...head.subarray(0, 4)),
        opusHead: String.fromCharCode(...head.subarray(28, 36)),
        preSkip: head[38] | (head[39] << 8),
        channels: after.length,
        framesBefore: before[0].length,
        framesAfter: after[0].length,
        msBefore: await check.durationMs(source),
        msAfter: await check.durationMs(result.blob),
        lag: lag.lag,
        correlation: lag.correlation,
        ms: result.ms,
      });
    }
    return out;
  });
  console.log(JSON.stringify({ sounds: rows }));
  for (const row of rows) {
    expect(row.extension).toBe("opus");
    expect([row.ogg, row.opusHead]).toEqual(["OggS", "OpusHead"]);
    expect(row.channels).toBe(row.askedChannels);
    // Exact to the sample, as the editor decodes it.
    expect(row.framesAfter).toBe(row.framesBefore);
    // An <audio> element (FFmpeg's Ogg demuxer, as ffprobe shows for an
    // FFmpeg-written file too) reports the last granule without taking
    // the pre-skip off: the original's length plus pre-skip / 48 ms
    // (6.5 ms for Chromium's 312), never more.
    expect(
      Math.abs(row.msAfter - row.msBefore - row.preSkip / 48),
    ).toBeLessThanOrEqual(0.5);
    // No shift a caption could show: within 1 ms (48 samples).
    expect(Math.abs(row.lag)).toBeLessThanOrEqual(48);
    expect(row.correlation).toBeGreaterThan(0.8);
    expect(row.bytes).toBeLessThan(row.originalBytes * 0.9);
  }
  expect(errors).toEqual([]);
});

/** The correlation floor per kind of real recording and bitrate, against
 *  the original decoded at 48 kHz, over 5 s from 1 s in, at the best lag. */
const CORRELATION_FLOOR = {
  // Measured: German 0.959 / 0.967 / 0.974, English 0.975 / 0.982 / 0.985.
  speech: { 16000: 0.94, 24000: 0.95, 32000: 0.955 },
  // Measured: piano 0.993 / 0.995 / 0.998, orchestra 0.994 / 0.995 / 0.998.
  music: { 48000: 0.98, 64000: 0.98, 96000: 0.985 },
};

test("sounds, real recordings: Ogg Opus smaller and close to the original, exact in length, over bitrates", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = await openCheck(page);
  const rows = await page.evaluate(async () => {
    const check = /** @type {Check} */ (
      /** @type {any} */ (window).assetOptimizerCheck
    );
    const recordings = [
      { name: "speech-de", kind: "speech", rates: [16000, 24000, 32000] },
      { name: "speech-en", kind: "speech", rates: [16000, 24000, 32000] },
      { name: "piano", kind: "music", rates: [48000, 64000, 96000] },
      { name: "orchestra", kind: "music", rates: [48000, 64000, 96000] },
    ];
    const out = [];
    for (const recording of recordings) {
      const source = await check.sample(recording.name);
      const before = await check.decode(source);
      for (const bps of recording.rates) {
        const result = await check.optimizeSound(source, bps);
        const head = new Uint8Array(
          await result.blob.slice(0, 40).arrayBuffer(),
        );
        const after = await check.decode(result.blob);
        const lag = check.bestLag(before[0], after[0], 48_000, 240_000, 960);
        out.push({
          name: recording.name,
          kind: recording.kind,
          bps,
          originalBytes: source.size,
          bytes: result.blob.size,
          extension: result.extension,
          preSkip: head[38] | (head[39] << 8),
          channels: after.length,
          framesBefore: before[0].length,
          framesAfter: after[0].length,
          msBefore: await check.durationMs(source),
          msAfter: await check.durationMs(result.blob),
          lag: lag.lag,
          correlation: lag.correlation,
          ms: result.ms,
        });
      }
    }
    return out;
  });
  console.log(JSON.stringify({ realSounds: rows }));
  for (const row of rows) {
    expect(row.extension).toBe("opus");
    expect(row.channels).toBe(row.kind === "speech" ? 1 : 2);
    expect(row.framesAfter).toBe(row.framesBefore);
    // The result's <audio> length: the decoded original's length plus the
    // pre-skip (an MP3 original's own <audio> length can differ from its
    // decoded one, so the decoded length is the reference here).
    expect(
      Math.abs(row.msAfter - (row.framesBefore + row.preSkip) / 48),
    ).toBeLessThanOrEqual(1);
    // No shift a caption could show: within 1 ms (48 samples).
    expect(Math.abs(row.lag)).toBeLessThanOrEqual(48);
    expect(row.correlation).toBeGreaterThan(
      /** @type {Record<string, Record<number, number>>} */ (CORRELATION_FLOOR)[
        row.kind
      ][row.bps],
    );
    expect(row.bytes).toBeLessThan(row.originalBytes * 0.9);
  }
  expect(errors).toEqual([]);
});

test("sounds: a 3-minute voice memo under the phone's 20 s, exact in length; no sound fails with words", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = await openCheck(page);
  const result = await page.evaluate(async () => {
    const check = /** @type {Check} */ (
      /** @type {any} */ (window).assetOptimizerCheck
    );
    const source = check.testSound("speech", 180, 44100);
    const memo = await check.optimizeSound(source, 24000);
    const head = new Uint8Array(await memo.blob.slice(0, 40).arrayBuffer());
    let refused = "";
    try {
      await check.optimizeSound(new Blob(["no sound here"]), 24000);
    } catch (error) {
      refused = /** @type {Error} */ (error).message;
    }
    return {
      ms: memo.ms,
      originalBytes: source.size,
      bytes: memo.blob.size,
      msBefore: await check.durationMs(source),
      msAfter: await check.durationMs(memo.blob),
      preSkip: head[38] | (head[39] << 8),
      refused,
    };
  });
  console.log(JSON.stringify({ memo: result }));
  expect(result.ms).toBeLessThan(20_000);
  expect(
    Math.abs(result.msAfter - result.msBefore - result.preSkip / 48),
  ).toBeLessThanOrEqual(0.5);
  expect(result.refused).toMatch(/could not be read as a sound/);
  expect(errors).toEqual([]);
});

/** The SSIM floor of a model's drawing against the original's, from the
 *  same camera. Measured on the repo's three scanned models in headless
 *  Chromium: 0.9786 to 0.9999 over every variant, the lowest with 8-bit
 *  positions; textures re-encoded at 0.75 stay at 0.9988 or above. The
 *  floor leaves room for another GPU and still fails a model whose
 *  geometry or textures were damaged. */
const MODEL_SSIM_FLOOR = 0.95;

test("models: a smaller .glb the tour accepts, drawn as before, over texture sizes, qualities and position bits", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors = await openCheck(page);
  const rows = await page.evaluate(async () => {
    const check = /** @type {any} */ (window).assetOptimizerCheck;
    // Every triangle kept, so the texture and position steps are measured
    // on their own; the level of detail has its own test below.
    const variants = [
      { textureMaxSidePx: 512 },
      { textureMaxSidePx: 1024 },
      { textureMaxSidePx: 2048 },
      { textureMaxSidePx: 1024, colourQuality: 0.75, dataQuality: 0.85 },
      { textureMaxSidePx: 1024, colourQuality: 0.95, dataQuality: 0.95 },
      { positionBits: 8, maxPositionError: 0.01 },
    ].map((v) => ({ ...v, detailShare: 1 }));
    const out = [];
    for (const name of ["rock", "coast-rock", "boulder"]) {
      const source = await check.testModel(name);
      for (const model of variants) {
        const result = await check.compareModel(source, model);
        out.push({
          name,
          model,
          originalBytes: source.size,
          bytes: result.blob.size,
          extension: result.extension,
          before: result.before,
          after: result.after,
          ssim: result.ssim,
          ms: result.ms,
        });
      }
    }
    return out;
  });
  console.log(JSON.stringify({ models: rows }));
  for (const row of rows) {
    const { before, after, model } = row;
    expect(row.extension).toBe("glb");
    expect(after.inert).toBe(true);
    expect(after.triangles).toBe(before.triangles);
    // The box as three.js sees it, within the position error budget (0.01 %
    // by default, 1 % in the 8-bit variant) of the diagonal.
    const diagonal = Math.hypot(
      ...before.max.map(
        (/** @type {number} */ v, /** @type {number} */ i) => v - before.min[i],
      ),
    );
    const budget = model.maxPositionError ?? 0.0001;
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(after.min[i] - before.min[i])).toBeLessThanOrEqual(
        budget * diagonal,
      );
      expect(Math.abs(after.max[i] - before.max[i])).toBeLessThanOrEqual(
        budget * diagonal,
      );
    }
    const limit = model.textureMaxSidePx ?? 1024;
    expect(after.textureSide).toBe(Math.min(before.textureSide, limit));
    // Every triangle kept still saves coarser levels for far views, but
    // never so many that the whole file, their index lists included,
    // crosses the shelf's line: the coarsest go first when it would.
    expect(before.chainBytes).toBe(0);
    expect(row.bytes).toBeLessThan(row.originalBytes * 0.9);
    expect(row.ssim).toBeGreaterThanOrEqual(MODEL_SSIM_FLOOR);
  }
  // The chosen setting under the phone's 10 s per model (a desktop is
  // several times faster, so this is a floor, not the proof).
  for (const row of rows.filter((r) => Object.keys(r.model).length === 2)) {
    if (row.model.textureMaxSidePx === 1024)
      expect(row.ms).toBeLessThan(10_000);
  }
  expect(errors).toEqual([]);
});

/** The default level's largest deviation, as a share of the box diagonal
 *  (`OPTIMIZER_SETTINGS.model.lodBudget`). */
const LOD_BUDGET = 0.0025;

test("models: the default level of detail keeps fewer triangles, its box within the deviation budget, drawn as before", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors = await openCheck(page);
  const rows = await page.evaluate(async () => {
    const check = /** @type {any} */ (window).assetOptimizerCheck;
    const out = [];
    for (const name of ["rock", "coast-rock", "boulder"]) {
      const source = await check.testModel(name);
      const result = await check.compareModel(source, {});
      out.push({
        name,
        originalBytes: source.size,
        bytes: result.blob.size,
        before: result.before,
        after: result.after,
        ssim: result.ssim,
        ms: result.ms,
      });
    }
    return out;
  });
  console.log(JSON.stringify({ modelsAtDefaultDetail: rows }));
  for (const row of rows) {
    const { before, after } = row;
    expect(after.inert).toBe(true);
    expect(after.triangles).toBeLessThan(before.triangles);
    expect(after.triangles).toBeGreaterThan(0);
    // A level keeps original vertices, so its box can only shrink, by at
    // most the deviation; quantizing adds its own 0.01 %. The 1.25 is the
    // sampling slack the deviation check is measured with.
    const diagonal = Math.hypot(
      ...before.max.map(
        (/** @type {number} */ v, /** @type {number} */ i) => v - before.min[i],
      ),
    );
    const bound = (LOD_BUDGET * 1.25 + 0.0001) * diagonal;
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(after.min[i] - before.min[i])).toBeLessThanOrEqual(bound);
      expect(Math.abs(after.max[i] - before.max[i])).toBeLessThanOrEqual(bound);
    }
    // The coarser levels are saved at the default level too (a chain the
    // size line dropped whole would pass every other check here).
    expect(after.chainBytes).toBeGreaterThan(0);
    // The whole file, its saved coarser levels included: the level of
    // detail must never cost the file the gain the other steps made.
    expect(row.bytes).toBeLessThan(row.originalBytes * 0.9);
    expect(row.ssim).toBeGreaterThanOrEqual(MODEL_SSIM_FLOOR);
    // The default setting, simplifying included, under the phone's 10 s per
    // model (a desktop is several times faster, so a floor, not the proof).
    expect(row.ms).toBeLessThan(10_000);
  }
  expect(errors).toEqual([]);
});

// Why this test matters: on a phone every variant looked the same in small
// fixed tiles, so the models are compared in one large view with two
// sliders (geometry, then texture) that change only the model. If a slider
// moved the camera, or dropped the wireframe look, the jump at the same
// spot that shows a removed triangle would be gone; the size must be in
// view with the sliders, since it is what the sliders are traded against.
// The phone layouts are pinned, and screenshots of both are kept with the
// run for a person to look at.
test("models, the large view: the sliders keep the camera, the wireframe stays on, phone layouts", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openCheck(page);
  await page.getByRole("button", { name: "Utility box" }).click();
  await expect(page.locator("#status")).toHaveText("Model ready.", {
    timeout: 540_000,
  });
  const read = () =>
    page.evaluate(() =>
      /** @type {any} */ (window).assetOptimizerCheck.modelView(),
    );
  /** Waits until the variant the sliders name is the one drawn. */
  const settled = async () => {
    await expect
      .poll(async () => (await read()).busy, { timeout: 300_000 })
      .toBe(false);
    return read();
  };
  const geometry = page.getByLabel("Geometry: triangles kept up close");
  const texture = page.getByLabel("Texture: largest side");
  // The caption names the original's texture size; the sliders start on
  // the default level and the shelf's 1024 px.
  await expect(page.locator("#model-caption")).toContainText(
    "textures up to 2048 px",
  );
  const first = await read();
  const defaultStop = first.stops.findIndex(
    (/** @type {any} */ s) => s.share === null,
  );
  expect(first.state.geometry).toBe(defaultStop);
  await expect(page.locator("#model-geometry-out")).toContainText("(default)");
  await expect(page.locator("#model-texture-out")).toHaveText(
    "1024 px (default)",
  );
  await expect(page.locator("#model-size-share")).toContainText(
    "% of the original",
  );

  // The view at full width (the body's 16 px padding either side); under
  // it the size, then the geometry slider above the texture slider.
  const canvas = page.locator("#model-canvas");
  // In view, so the drag below lands on it.
  await canvas.scrollIntoViewIfNeeded();
  const view = /** @type {NonNullable<any>} */ (await canvas.boundingBox());
  expect(view.width).toBeGreaterThanOrEqual(390 - 32 - 1);
  expect(view.height).toBeGreaterThanOrEqual(300);
  const box = async (/** @type {import("@playwright/test").Locator} */ l) =>
    /** @type {NonNullable<any>} */ (await l.boundingBox());
  const size = await box(page.locator("#model-size-bytes"));
  const geometryBox = await box(geometry);
  const textureBox = await box(texture);
  expect(size.y).toBeGreaterThanOrEqual(view.y + view.height);
  expect(geometryBox.y).toBeGreaterThan(size.y);
  expect(textureBox.y).toBeGreaterThan(geometryBox.y);
  expect(geometryBox.width).toBeGreaterThanOrEqual(390 - 32 - 1);
  expect(geometryBox.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("models-phone.png") });

  // Orbit by a drag, then move the geometry slider to every triangle: the
  // camera stays exactly where it is, and the file grows.
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    view.x + view.width / 2 + 90,
    view.y + view.height / 2 + 40,
    { steps: 6 },
  );
  await page.mouse.up();
  const orbited = await read();
  expect(orbited.position).not.toEqual(first.position);

  // Texture steps down and back up: the GPU holds only the drawn variant,
  // so its texture count is back where it started, and the fixed SSIM
  // drawings leave nothing behind. A variant swapped out and shown again
  // (the first one, here) is uploaded anew and drawn textured. The one
  // texture a renderer keeps is three's own lookup table for its
  // physically based materials (DFG), uploaded once per renderer.
  const drawBase = first.gpu.draw.textures;
  expect(drawBase).toBeLessThanOrEqual(1);
  expect(first.gpu.draw.geometries).toBe(0);
  expect(first.gpu.view.textures).toBeGreaterThan(0);
  await texture.focus();
  for (const key of ["ArrowLeft", "ArrowLeft", "ArrowRight", "ArrowRight"]) {
    await page.keyboard.press(key);
    await settled();
  }
  const back = await read();
  expect(back.shownKey).toBe(first.shownKey);
  expect(back.textured).toBeGreaterThan(0);
  expect(back.gpu.view.textures).toBe(first.gpu.view.textures);
  expect(back.gpu.draw).toMatchObject({ textures: drawBase, geometries: 0 });
  expect(back.position).toEqual(orbited.position);
  await geometry.focus();
  await page.keyboard.press("End");
  const full = await settled();
  expect(full.triangles).toBe(full.stops.at(-1).triangles);
  expect(full.triangles).toBeGreaterThan(first.triangles);
  expect(full.bytes).toBeGreaterThan(first.bytes);
  expect(full.position).toEqual(orbited.position);
  expect(full.target).toEqual(orbited.target);
  expect(full.gpu.view.textures).toBe(first.gpu.view.textures);

  // The wireframe look: wire lines on, textures off, and it stays on
  // through the texture slider and the original.
  expect(full.wires).toBe(0);
  await page.getByLabel("Wireframe and flat light").check();
  const wired = await read();
  expect(wired.wires).toBeGreaterThan(0);
  expect(wired.textured).toBe(0);
  await texture.focus();
  await page.keyboard.press("Home");
  const small = await settled();
  await expect(page.locator("#model-texture-out")).toHaveText("128 px");
  expect(small.textureSide).toBe(128);
  expect(small.bytes).toBeLessThan(full.bytes);
  await page.getByLabel("Show the original").check();
  const original = await read();
  expect(original.shownKey).toBe("original");
  await expect(page.locator("#model-size-share")).toHaveText("the original");
  for (const now of [small, original]) {
    expect(now.state.wireframe).toBe(true);
    expect(now.wires).toBeGreaterThan(0);
    expect(now.textured).toBe(0);
    expect(now.position).toEqual(orbited.position);
  }
  await expect(page.getByLabel("Wireframe and flat light")).toBeChecked();

  // The 8-bit option is said to be about the vertex positions, not the
  // textures, so nobody reads it as a texture setting.
  await expect(
    page.locator("label", { has: page.locator("#model-positions8") }),
  ).toContainText("vertex positions");

  // Landscape: the view still fits the screen's height.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect
    .poll(async () => (await canvas.boundingBox())?.height ?? 0)
    .toBeLessThanOrEqual(390 * 0.7 + 1);
  expect((await canvas.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(
    844 - 32 - 1,
  );
  await canvas.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("models-landscape.png") });

  // A variant still being made when another model is loaded: it is
  // dropped without a word, never compared with the new model, and the
  // new model's controls come back enabled.
  await page.evaluate(() => {
    const status = /** @type {HTMLElement} */ (
      document.getElementById("status")
    );
    const said = /** @type {string[]} */ ([]);
    /** @type {any} */ (window).said = said;
    new MutationObserver(() => said.push(status.textContent ?? "")).observe(
      status,
      { childList: true, characterData: true, subtree: true },
    );
    const slider = /** @type {HTMLInputElement} */ (
      document.getElementById("model-texture")
    );
    slider.value = "1";
    slider.dispatchEvent(new Event("change"));
    /** @type {HTMLElement} */ (document.getElementById("model-rock")).click();
  });
  await expect(page.locator("#status")).toHaveText("Model ready.", {
    timeout: 540_000,
  });
  const rock = await settled();
  expect(rock.shownKey).toBe(rock.askedKey);
  await expect(geometry).toBeEnabled();
  await expect(page.getByLabel("Show the original")).toBeEnabled();
  const said = await page.evaluate(() => /** @type {any} */ (window).said);
  expect(
    said.filter((/** @type {string} */ t) => t.startsWith("Failed")),
  ).toEqual([]);
  expect(rock.gpu.draw).toMatchObject({ textures: drawBase, geometries: 0 });
  expect(errors).toEqual([]);
});

// Why this test matters: the WebP option writes the textures through
// EXT_texture_webp; a file the tour's check refused, or one drawn wrong, or
// no smaller than the JPEG default, would make the option a trap rather
// than a saving. The box carries 2048 px textures, so the 1024 px limit
// applies to both.
test("models: WebP textures on the box: the tour accepts it, 1024 px, drawn as before, fewer bytes than JPEG", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors = await openCheck(page);
  const { jpeg, webp } = await page.evaluate(async () => {
    const check = /** @type {any} */ (window).assetOptimizerCheck;
    const source = await check.sampleModel("box");
    const row = async (/** @type {object} */ model) => {
      const result = await check.compareModel(source, model);
      return {
        bytes: result.blob.size,
        after: result.after,
        ssim: result.ssim,
      };
    };
    return {
      jpeg: await row({}),
      webp: await row({ textureType: "image/webp" }),
    };
  });
  console.log(JSON.stringify({ webpBox: { jpeg, webp } }));
  expect(webp.after.inert).toBe(true);
  expect(webp.after.textureSide).toBe(1024);
  expect(webp.ssim).toBeGreaterThanOrEqual(MODEL_SSIM_FLOOR);
  expect(webp.bytes).toBeLessThan(jpeg.bytes);
  expect(errors).toEqual([]);
});
