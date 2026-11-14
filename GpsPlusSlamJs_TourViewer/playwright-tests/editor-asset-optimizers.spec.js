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
 *   same triangles and box (within the position error budget) as three.js
 *   loads it, textures at the asked side, and a drawing close to the
 *   original's, over texture sides, qualities and position bits;
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
      (r) => r.source === source && r.side === 1600 && r.quality === 0.75,
    );
    expect(chosen?.ms).toBeLessThan(10_000);
  }
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
        for (const bps of [16000, 24000, 32000]) {
          cases.push({ kind: "speech", rate, seconds, bps });
        }
      }
    }
    for (const bps of [48000, 64000, 96000]) {
      cases.push({ kind: "music", rate: 44100, seconds: 7.3, bps });
    }
    const out = [];
    for (const c of cases) {
      const source = check.testSound(c.kind, c.seconds, c.rate);
      const result = await check.optimizeSound(source, c.bps);
      const head = new Uint8Array(await result.blob.slice(0, 47).arrayBuffer());
      const before = await check.decode(source);
      const after = await check.decode(result.blob);
      const span = Math.min(24_000, before[0].length - 2_000);
      const lag = check.bestLag(before[0], after[0], 1_000, span, 960);
      out.push({
        ...c,
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
    expect(row.channels).toBe(row.kind === "speech" ? 1 : 2);
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
    const variants = [
      { textureMaxSidePx: 512 },
      { textureMaxSidePx: 1024 },
      { textureMaxSidePx: 2048 },
      { textureMaxSidePx: 1024, colourQuality: 0.75, dataQuality: 0.85 },
      { textureMaxSidePx: 1024, colourQuality: 0.95, dataQuality: 0.95 },
      { positionBits: 8, maxPositionError: 0.01 },
    ];
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
    expect(row.bytes).toBeLessThan(row.originalBytes * 0.9);
    expect(row.ssim).toBeGreaterThanOrEqual(MODEL_SSIM_FLOOR);
  }
  // The chosen setting under the phone's 10 s per model (a desktop is
  // several times faster, so this is a floor, not the proof).
  for (const row of rows.filter((r) => Object.keys(r.model).length === 1)) {
    if (row.model.textureMaxSidePx === 1024)
      expect(row.ms).toBeLessThan(10_000);
  }
  expect(errors).toEqual([]);
});
