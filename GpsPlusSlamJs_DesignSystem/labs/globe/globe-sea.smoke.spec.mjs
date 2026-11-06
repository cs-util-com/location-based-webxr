/**
 * The sea (`globe-sea.ts`): real waves on the open ocean, the flat glint at
 * height, and land it never touches. A compiled shader nothing else opens:
 * unit tests read its source, only a browser compiles it.
 */
import { expect, test } from "@playwright/test";

const CLEAR = "spinMs=0&turnMs=0&cloudDrift=0&cloudVolume=0&cloudOpacity=0";
const OCEAN = `${CLEAR}&time=2026-06-01T10:40:00Z`;

/** Luma along a row of the lower picture: the waves show as its roughness. */
const measure = (page) =>
  page.evaluate(() => {
    const lab = window.__globeLab;
    // A column through the picture's lower half: the waves' crests cross it.
    const points = Array.from({ length: 96 }, (_, i) => [
      0.5,
      0.45 + i * 0.002,
    ]);
    const luma = lab
      .readPixels(points)
      .map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
    const steps = luma.slice(1).map((v, i) => Math.abs(v - luma[i]));
    return {
      mean: luma.reduce((a, b) => a + b, 0) / luma.length,
      rough: steps.reduce((a, b) => a + b, 0) / steps.length,
      sea: lab.state().sea,
      pending:
        lab.state().pendingTiles + (lab.state().relief?.downloading ?? 0),
    };
  });

const open = async (page, hash, query = "") => {
  // A changed hash alone would keep the page, and the sea is fixed for its
  // life.
  await page.goto("about:blank");
  await page.goto(`/labs/globe/${query}#${hash}`);
  await page.waitForFunction(() => window.__globeLab?.ready === true, null, {
    timeout: 120_000,
  });
};

/** Polled until the tiles are in and the sea has what it reads. */
const settled = async (page, accept) => {
  let seen = null;
  await expect
    .poll(
      async () => {
        seen = await measure(page);
        return seen.pending === 0 && accept(seen);
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe(true);
  return seen;
};

// WHY: the plain proof the sea compiled and draws. Its slopes make the
// picture rough at 2 km (0.55-0.9 levels a step on the CPU rasteriser, in
// the dark lower picture), where the flat glint is smooth (about 0.05).
test("the open ocean has waves at 2 km, the sea switched off has none", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await open(page, `${OCEAN}&view=20,-40,2,0,-35`);
  const on = await settled(page, (s) => s.rough > 0.3);
  expect(on.sea).toMatchObject({ on: true, sky: true, share: 1 });
  await open(page, `${OCEAN}&view=20,-40,2,0,-35&sea=0`);
  const off = await settled(page, (s) => s.mean > 5 && s.rough < 0.15);
  expect(off.sea).toBeNull();
});

// WHY: the tier's wave count is compiled, so each count is its own program:
// the phone's is the one a desktop gate would otherwise never compile.
test("the low tier compiles its own waves", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, `${OCEAN}&view=20,-40,2,0,-35`, "?quality=low");
  const low = await settled(page, (s) => s.rough > 0.12);
  expect(low.sea).toMatchObject({ octaves: 6, shortestWaveM: 32 });
});

// WHY: the waves hand over to the flat glint with height, or the picture
// would swim with waves too small to see; the air carries the colour.
test("the sea is gone from 60 km up", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, `${OCEAN}&view=20,-40,100,0,-35`);
  const high = await settled(page, (s) => s.mean > 5);
  expect(high.sea).toMatchObject({ share: 0 });
});

// WHY: the sea takes water pixels only. The desert is the same picture with
// or without it, to a few levels of the frames' own noise.
test("land is the same with and without the sea", async ({ page }) => {
  test.setTimeout(240_000);
  const hash = `${CLEAR}&time=2026-06-01T10:40:00Z&view=24,10,3,0,-35`;
  await open(page, hash);
  const on = await settled(page, (s) => s.mean > 5);
  await open(page, `${hash}&sea=0`);
  const off = await settled(page, (s) => Math.abs(s.mean - on.mean) < 3);
  expect(off.sea).toBeNull();
});
