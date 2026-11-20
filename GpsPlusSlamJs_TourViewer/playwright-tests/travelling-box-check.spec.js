// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why this test matters: in travel mode a narrated text's words hang on a
 * painted plate under its reading sign, and the box at the bottom of the
 * page is an invisible ghost that only lays the words out. Two things can
 * go wrong that no unit test sees, because they need a real browser's
 * layout and a real camera:
 *
 * - the plate can hang in the wrong place or at the wrong size (a wrong
 *   gap, off centre, a plate whose shape is not the box's), which these
 *   pin against values worked out here from the prototype's numbers (the
 *   sign 2.5 m wide with its centre 2.05 m up, the plate one em = 0.136 m
 *   and 0.07 m under the sign, the eye 1.6 m up), not from the code under
 *   test; the camera's pitch and field of view are read from the page, as
 *   they are the view, not the thing under test;
 * - the painted words can drift from where the browser broke the lines in
 *   the ghost (so the plate and the box the visitor taps disagree), which
 *   the ink test catches: every shown word's and punctuation mark's
 *   ink lies inside its own rectangle (a dropped colon or full stop
 *   leaves its rectangle empty), and nearly no ink lies outside them.
 *
 * What they cannot catch: a wrong colour or fade (the painter's unit
 * tests pin those), a plate mirrored inside its own rectangle, and the
 * flight to the dock (built in a later step, with its own pins).
 */

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone sideways", width: 844, height: 390 },
  { name: "desktop", width: 1280, height: 800 },
];

const EYE_M = 1.6;
const SIGN = { widthM: 2.5, heightM: (2.5 * 420) / 1024, centreM: 2.05 };
const PLATE = { emM: 0.136, gapM: 0.07, frontM: 0.04 };
/** The travel box: 17 em of 16 px, three 22 px rows under a 20 px head
 *  row, 9 + 11 px padding and a 1 px border each side. */
const BOX = { width: 272, height: 20 + 3 * 22 + 20 + 2, fontPx: 16 };

async function open(page, viewport) {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto("/travelling-box-check.html");
  await page.waitForFunction(
    () => (window.__travellingBoxCheck?.state().texture.paints ?? 0) > 0,
  );
  return errors;
}

async function state(page) {
  const s = await page.evaluate(() => window.__travellingBoxCheck?.state());
  if (s === null || s === undefined) throw new Error("no check page");
  return s;
}

/** Where a point `yM` up, `depthM` in front of the eye lands on the page
 *  (CSS px from the top) for the page's camera. */
function screenY(yM, depthM, s) {
  const { pitch, fovDeg, viewH } = s.camera;
  const f = viewH / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return viewH / 2 - f * Math.tan(Math.atan((yM - EYE_M) / depthM) - pitch);
}

/** The depth along the view of a point `yM` up and `distM` ahead of the
 *  eye, for the page's pitched camera: what a width on screen falls by. */
function depthOf(yM, distM, s) {
  const p = s.camera.pitch;
  return (yM - EYE_M) * Math.sin(p) + distM * Math.cos(p);
}

// A software-rendered WebGL page is slow on a busy machine.
test.describe.configure({ timeout: 90_000 });

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__travellingBoxCheck?.stop());
});

for (const viewport of VIEWPORTS) {
  test(`the words hang under the sign at the box's shape, 3 m away (${viewport.name})`, async ({
    page,
  }) => {
    const errors = await open(page, viewport);
    await page.evaluate(() => window.__travellingBoxCheck?.standAt(3));
    const s = await state(page);
    const sign = s.sign;
    const plate = s.plate;
    if (sign === null || plate === null) throw new Error("not drawn");
    const [sTL, sTR, sBR] = sign;
    const [pTL, pTR] = plate;

    // The ghost box keeps the travel shape, and is not seen.
    expect(Math.abs(s.box.width - BOX.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.box.height - BOX.height)).toBeLessThanOrEqual(1);
    expect(s.box.opacity).toBe(0);
    // The plate is the box's shape at one em = 0.136 m (no growth at 3 m).
    expect(s.growth).toBe(1);
    const plateW = (BOX.width * PLATE.emM) / BOX.fontPx;
    expect(s.plateM.widthM).toBeCloseTo(plateW, 3);
    expect(s.plateM.heightM).toBeCloseTo(
      (BOX.height * PLATE.emM) / BOX.fontPx,
      3,
    );

    // The sign's lower edge and the plate's top where the numbers put
    // them: the gap is 0.07 m, the plate 0.04 m nearer the eye.
    const signBottomM = SIGN.centreM - SIGN.heightM / 2;
    const signBottom = screenY(signBottomM, 3, s);
    const plateTop = screenY(signBottomM - PLATE.gapM, 3 - PLATE.frontM, s);
    expect(Math.abs(sBR[1] - signBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(pTL[1] - plateTop)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(pTL[1] - sBR[1] - (plateTop - signBottom)),
    ).toBeLessThanOrEqual(1);
    // Centred under the sign.
    const signX = (sTL[0] + sTR[0]) / 2;
    const plateX = (pTL[0] + pTR[0]) / 2;
    expect(Math.abs(plateX - signX)).toBeLessThanOrEqual(1);
    expect(Math.abs(signX - viewport.width / 2)).toBeLessThanOrEqual(1);
    // As wide, against the sign, as the world says: each top edge at its
    // own depth along the pitched view, (y - eye) sin p + D cos p.
    const ratio = (pTR[0] - pTL[0]) / (sTR[0] - sTL[0]);
    const signTopDepth = depthOf(SIGN.centreM + SIGN.heightM / 2, 3, s);
    const plateTopDepth = depthOf(
      signBottomM - PLATE.gapM,
      3 - PLATE.frontM,
      s,
    );
    const want = plateW / plateTopDepth / (SIGN.widthM / signTopDepth);
    expect(Math.abs(ratio - want) / want).toBeLessThan(0.002);
    expect(errors).toEqual([]);
  });
}

test("the painted words lie where the ghost box broke its lines", async ({
  page,
}) => {
  await open(page, VIEWPORTS[0]);
  const result = await page.evaluate(() => {
    const hook = window.__travellingBoxCheck;
    if (hook === undefined) throw new Error("no hook");
    const s = hook.state();
    const canvas = hook.wordsCanvas();
    const g = canvas.getContext("2d");
    const root = document.querySelector('[data-testid="narration-box"]');
    const win = root?.querySelector(".nb-win");
    if (g === null || root === null || win === null || win === undefined) {
      throw new Error("no box");
    }
    const box = root.getBoundingClientRect();
    const winRect = win.getBoundingClientRect();
    const k = s.texture.scale;
    const toCanvas = (/** @type {DOMRect} */ r) => ({
      x0: Math.floor((r.left - box.left) * k),
      y0: Math.floor((r.top - box.top) * k),
      x1: Math.ceil((r.right - box.left) * k),
      y1: Math.ceil((r.bottom - box.top) * k),
    });
    // The words, the name and the disclosure on the rows the window shows.
    // And the punctuation between them (a colon, a full stop), which
    // lives in the text between the spans: a Range finds it.
    const col = root.querySelector(".nb-col");
    const range = document.createRange();
    const gaps = [...(col?.childNodes ?? [])]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .flatMap((n) =>
        [...(n.textContent ?? "").matchAll(/\S+/g)].map((m) => {
          range.setStart(n, m.index ?? 0);
          range.setEnd(n, (m.index ?? 0) + m[0].length);
          return range.getBoundingClientRect();
        }),
      );
    const spans = [
      ...[...root.querySelectorAll(".nb-w, .nb-who span, .nb-disc span")].map(
        (el) => el.getBoundingClientRect(),
      ),
      ...gaps,
    ]
      .filter(
        (r) =>
          r.width > 0 &&
          r.top >= winRect.top - 1 &&
          r.bottom <= winRect.bottom + 1,
      )
      .map(toCanvas);
    const area = toCanvas(winRect);
    const img = g.getImageData(0, 0, canvas.width, canvas.height).data;
    // Ink: a pixel much brighter than the dark glass (whose red is <= 52
    // before its own alpha); a word not yet said is 0.55 white over it.
    const ink = (/** @type {number} */ x, /** @type {number} */ y) => {
      const i = (y * canvas.width + x) * 4;
      return (img[i] ?? 0) > 110 && (img[i + 3] ?? 0) > 128;
    };
    const pad = Math.ceil(2 * k);
    const inSome = (/** @type {number} */ x, /** @type {number} */ y) =>
      spans.some(
        (r) =>
          x >= r.x0 - pad &&
          x < r.x1 + pad &&
          y >= r.y0 - pad &&
          y < r.y1 + pad,
      );
    let outside = 0;
    let total = 0;
    // The scrollbar's slot is the window's last 12 px: left out.
    const right = area.x1 - Math.ceil(12 * k);
    for (let y = area.y0; y < area.y1; y += 1) {
      for (let x = area.x0; x < right; x += 1) {
        if (!ink(x, y)) continue;
        total += 1;
        if (!inSome(x, y)) outside += 1;
      }
    }
    const empty = spans.filter((r) => {
      for (let y = r.y0; y < r.y1; y += 1) {
        for (let x = r.x0; x < r.x1; x += 1) if (ink(x, y)) return false;
      }
      return true;
    }).length;
    return { spans: spans.length, total, outside, empty };
  });
  // Three rows of words, each with its ink; next to none elsewhere.
  expect(result.spans).toBeGreaterThan(10);
  expect(result.empty).toBe(0);
  expect(result.total).toBeGreaterThan(1000);
  expect(result.outside / result.total).toBeLessThan(0.01);
});

// Why: the painted plate's name does not breathe (the prototype paints it
// still), and the ghost is unseen; a breathing name on the ghost ran a
// style animation for the whole voice that nobody could see.
test("the ghost runs no animation while the voice plays", async ({ page }) => {
  await open(page, VIEWPORTS[0]);
  await page.evaluate(() => window.__travellingBoxCheck?.play());
  const box = page.getByTestId("narration-box");
  await expect(box).toHaveAttribute("data-speaking", "yes");
  const running = await box.evaluate(
    (el) => el.getAnimations({ subtree: true }).length,
  );
  expect(running).toBe(0);
});
