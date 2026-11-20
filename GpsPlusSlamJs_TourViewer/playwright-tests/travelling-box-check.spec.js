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
 * tests pin those) and a plate mirrored inside its own rectangle. The
 * travel to the dock and back has its own pins in part 2 below.
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
  await page.goto("/check.html?view=travelling-box");
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

/*
 * Part 2: the travel. Why these matter: the controller moves one texture
 * between the plate under the sign and the dock at the screen's foot, and
 * what can go wrong there is only visible in a browser with a real camera
 * and real layout: a flight that leaves from the wrong place or lands off
 * the ghost (the visitor's finger then misses the words), a quad flattened
 * to a rectangle (the perspective lost), both meshes drawn at once, a
 * place that flickers at the threshold, or fingers that land on the wrong
 * layer. Every endpoint is independent of the controller: the plate's
 * corners are projected from the mesh's own geometry, the dock is the
 * ghost's getBoundingClientRect and the numbers come from the prototype.
 * The page runs under Playwright's clock, paused, so each step is an
 * exact time.
 */

const HOLD_MS = 300;
const FLY_MS = 600;
const LOCK_MS = 300;
const FRAME_MS = 16;
/** The dock's foot gap: 18 px upright, 10 px on a phone sideways. */
const DOCK_GAP = { phone: 18, "phone sideways": 10, desktop: 18 };

async function openClocked(page, viewport) {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  // Paused before the page loads: time moves only with runFor.
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto("/check.html?view=travelling-box");
  // The check page loads the view's module after the page's load event.
  await page.waitForFunction(() => window.__travellingBoxCheck !== undefined);
  await hook(page, "standAt", 3);
  // The words fade in over 0.3 s.
  await page.clock.runFor(500);
  return errors;
}

/** Calls the hook's `name` with `args`. */
async function hook(page, name, ...args) {
  await page.evaluate(
    ([n, a]) => {
      const h = /** @type {any} */ (window.__travellingBoxCheck);
      if (h === undefined) throw new Error("no hook");
      h[n](...a);
    },
    [name, args],
  );
}

/** The distance from `p` to the segment `a`-`b` (px). */
function toSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2),
        );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** The ghost's rectangle as TL, TR, BR, BL. */
function rectCorners(box) {
  const { left: x, top: y, width: w, height: h } = box;
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** The largest distance between two corner lists' matching corners. */
function maxGap(a, b) {
  return Math.max(
    ...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])),
  );
}

test("the words go to the dock and back, and hide with the sheet (phone)", async ({
  page,
}) => {
  const errors = await openClocked(page, VIEWPORTS[0]);
  let s = await state(page);
  expect(s.travel.place).toBe("plate");
  expect(s.travel.plateVisible).toBe(true);
  expect(s.travel.surface).toBe("words:check");

  await hook(page, "standAt", 16);
  await page.clock.runFor(HOLD_MS + FLY_MS + 100);
  s = await state(page);
  expect([s.travel.place, s.travel.why, s.travel.u]).toEqual([
    "dock",
    "too small",
    1,
  ]);

  // Turned away, the words dock after the hold; turned back, they return.
  await hook(page, "standAt", 3);
  await page.clock.runFor(HOLD_MS + FLY_MS + 100);
  expect((await state(page)).travel.place).toBe("plate");
  await hook(page, "turn", 2.4);
  await page.clock.runFor(HOLD_MS - 50);
  expect((await state(page)).travel.place).toBe("plate");
  await page.clock.runFor(FLY_MS + 150);
  s = await state(page);
  expect([s.travel.place, s.travel.why]).toEqual(["dock", "out of view"]);
  await hook(page, "turn", 0);
  await page.clock.runFor(HOLD_MS + FLY_MS + 100);
  expect((await state(page)).travel.place).toBe("plate");

  // The sheet hides the words at once, and closing it brings them back.
  await hook(page, "openSheet");
  await page.clock.runFor(FRAME_MS);
  s = await state(page);
  expect([s.travel.place, s.travel.why]).toEqual(["hidden", "sheet open"]);
  await page.clock.runFor(400);
  s = await state(page);
  expect(s.travel.plateVisible || s.travel.quadVisible).toBe(false);
  await hook(page, "closeSheet");
  await page.clock.runFor(400);
  s = await state(page);
  expect([s.travel.place, s.travel.plateVisible]).toEqual(["plate", true]);
  expect(errors).toEqual([]);
});

// Why: at the threshold distance a step back and forth must not make the
// words jump between the sign and the screen; the keep band (95 %) holds
// the plate while the letter wavers around 12 px.
test("a slow walk at the threshold for 10 s keeps the place (phone)", async ({
  page,
}) => {
  await openClocked(page, VIEWPORTS[0]);
  // The distance where the letter is 12 px, by halving between 7 m and
  // 16 m (the letter falls with the distance there; nearer, the sign's
  // growth holds it level). On the plate all the way: no hold elapses.
  let near = 7;
  let far = 16;
  for (let i = 0; i < 14; i++) {
    const d = (near + far) / 2;
    await hook(page, "standAt", d);
    await page.clock.runFor(FRAME_MS);
    const s = await state(page);
    if (s.travel.metrics.letterPx >= 12) near = d;
    else far = d;
  }
  await hook(page, "standAt", near);
  await page.clock.runFor(HOLD_MS + FLY_MS);
  const before = await state(page);
  expect(before.travel.place).toBe("plate");
  for (let ms = 0; ms < 10_000; ms += 100) {
    const d = near - 0.04 + 0.12 * Math.sin((ms / 1000) * Math.PI);
    await hook(page, "standAt", d);
    await page.clock.runFor(100);
  }
  const after = await state(page);
  expect(after.travel.place).toBe("plate");
  expect(after.events.length).toBe(before.events.length);
});

test("reduced motion moves the words without a flight (phone)", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openClocked(page, VIEWPORTS[0]);
  await hook(page, "standAt", 16);
  let u = 0;
  for (let ms = 0; ms <= HOLD_MS + 2 * FRAME_MS; ms += FRAME_MS) {
    await page.clock.runFor(FRAME_MS);
    const s = await state(page);
    expect([0, 1]).toContain(s.travel.u);
    u = s.travel.u;
  }
  expect(u).toBe(1);
});

for (const viewport of VIEWPORTS) {
  test(`the dock sits at the foot and the docked words lie on the ghost (${viewport.name})`, async ({
    page,
  }) => {
    const errors = await openClocked(page, viewport);
    /** Which layer a finger at (x, y) lands on. */
    const layerAt = (x, y) =>
      page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px, py);
          if (el?.closest("#ar-root")) return "ar-root";
          if (el?.closest(".narration-box")) return "ghost";
          return "other";
        },
        [x, y],
      );
    const cx = viewport.width / 2;
    // On the plate the finger goes through the ghost to the world.
    let s = await state(page);
    expect(s.travel.place).toBe("plate");
    expect(s.ghostPointer).toBe(false);
    expect(await layerAt(cx, s.box.top + s.box.height / 2)).toBe("ar-root");

    // Far enough that the letter is under 12 px in every viewport.
    await hook(page, "standAt", 40);
    await page.clock.runFor(HOLD_MS + FLY_MS + 100);
    s = await state(page);
    expect(s.travel.u).toBe(1);
    // The dock: 17 em of 16 px, centred, at the foot, 3 rows high.
    expect(Math.abs(s.box.width - 272)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(s.box.left - (viewport.width - 272) / 2),
    ).toBeLessThanOrEqual(1);
    const gap = viewport.height - (s.box.top + s.box.height);
    expect(Math.abs(gap - DOCK_GAP[viewport.name])).toBeLessThanOrEqual(1);
    expect(Math.abs(s.box.height - BOX.height)).toBeLessThanOrEqual(1);
    expect(s.box.opacity).toBe(0);
    // The docked quad lies on the ghost, and the ghost takes the finger.
    if (s.travel.quad === null) throw new Error("no quad");
    expect(maxGap(s.travel.quad, rectCorners(s.box))).toBeLessThanOrEqual(1);
    expect(s.travel.plateVisible).toBe(false);
    expect(s.ghostPointer).toBe(true);
    expect(await layerAt(cx, s.box.top + s.box.height / 2)).toBe("ghost");
    expect(errors).toEqual([]);
  });
}

// Why: a flight from the wrong corners, a late or early departure, a
// second texture or both meshes at once would each show as a jump or a
// swap on the phone.
test("the flight leaves from the plate's corners and lands on the ghost, on time (phone)", async ({
  page,
}) => {
  await openClocked(page, VIEWPORTS[0]);
  const start = await page.evaluate(() => performance.now());
  await hook(page, "standAt", 16);
  /** @type {number | null} */
  let departMs = null;
  /** @type {number | null} */
  let arriveMs = null;
  /** @type {any} */
  let first = null;
  /** @type {any} */
  let last = null;
  /** @type {any[]} */
  const mids = [];
  for (let i = 0; i < 80 && arriveMs === null; i++) {
    await page.clock.runFor(FRAME_MS);
    const s = await state(page);
    const now = (await page.evaluate(() => performance.now())) - start;
    // Exactly one of the two meshes, on every frame.
    expect(Number(s.travel.plateVisible) + Number(s.travel.quadVisible)).toBe(
      1,
    );
    expect(s.box.opacity).toBe(0);
    // The ghost takes the finger only once the words have landed.
    expect(s.ghostPointer).toBe(s.travel.u === 1);
    // One texture: the plate's own map, the controller's and the quad's.
    expect(s.travel.quadTextureId).toBe(s.travel.textureId);
    expect(s.plateMapId).toBe(s.travel.textureId);
    if (s.travel.quadVisible) {
      if (departMs === null) {
        departMs = now;
        first = s;
      } else if (s.travel.u < 1) mids.push(s);
    }
    if (s.travel.u === 1) {
      arriveMs = now;
      last = s;
    }
  }
  if (departMs === null || arriveMs === null) throw new Error("no flight");
  // On time: the hold, then the flight, each within a frame.
  expect(Math.abs(departMs - HOLD_MS)).toBeLessThanOrEqual(FRAME_MS);
  expect(Math.abs(arriveMs - HOLD_MS - FLY_MS)).toBeLessThanOrEqual(FRAME_MS);
  // From the plate's own projected corners (eased, so the first frame has
  // barely moved) to the ghost's rectangle.
  const plate = first.plate;
  expect(maxGap(first.travel.quad, plate)).toBeLessThanOrEqual(1);
  const dock = rectCorners(last.box);
  expect(maxGap(last.travel.quad, dock)).toBeLessThanOrEqual(1);
  // In between, every corner on the line from its plate corner to its
  // dock corner.
  expect(mids.length).toBeGreaterThan(20);
  for (const s of mids) {
    s.travel.quad.forEach(
      (/** @type {number[]} */ p, /** @type {number} */ i) => {
        expect(toSegment(p, plate[i], dock[i])).toBeLessThanOrEqual(1);
      },
    );
  }
});

test("the flying quad keeps the plate's perspective (phone, looking down)", async ({
  page,
}) => {
  await openClocked(page, VIEWPORTS[0]);
  // Close and looking down: the plate's sides lean toward each other.
  await hook(page, "standAt", 2);
  await hook(page, "pitch", -0.3);
  await page.clock.runFor(HOLD_MS + FLY_MS + 100);
  expect((await state(page)).travel.place).toBe("plate");
  await hook(page, "turn", 2.4);
  await page.clock.runFor(HOLD_MS + FLY_MS / 2);
  const s = await state(page);
  expect(s.travel.u).toBeGreaterThan(0.3);
  expect(s.travel.u).toBeLessThan(0.7);
  const q = s.travel.quad;
  if (q === null) throw new Error("no quad");
  const angle = (/** @type {number[]} */ a, /** @type {number[]} */ b) =>
    (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  // The left edge (TL to BL) against the right edge (TR to BR).
  expect(Math.abs(angle(q[0], q[3]) - angle(q[1], q[2]))).toBeGreaterThan(0.5);
});

/** Presses at (x, y) and moves `dy` down in `steps`; the finger stays down. */
async function dragDown(page, x, y, dy, steps = 6) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + (dy * i) / steps);
  }
}

// Why: the plate is where the visitor's finger meets the words most of
// the time; a tap that does not pause, a drag that moves the voice by the
// wrong amount (the plate's line is not the box's), or words flying away
// under the finger would each make the plate feel broken.
test("a tap on the plate pauses, and a drag of two lines moves the voice two lines (phone)", async ({
  page,
}) => {
  await openClocked(page, VIEWPORTS[0]);
  let s = await state(page);
  const p = s.plate;
  if (p === null) throw new Error("no plate");
  const cx = (p[0][0] + p[2][0]) / 2;
  const cy = (p[0][1] + p[2][1]) / 2;
  // One line as the finger sees it: the plate's height times a row's
  // share of the box (22 px of the box's height).
  const linePx =
    ((p[3][1] - p[0][1] + (p[2][1] - p[1][1])) / 2) * (22 / BOX.height);

  await hook(page, "play");
  await page.mouse.click(cx, cy);
  await page.clock.runFor(FRAME_MS);
  s = await state(page);
  expect(s.voice.playing).toBe(false);
  await expect(page.locator(".nb-tapfx")).toHaveCount(1);
  // The ring answers where the finger is, not where the ghost rests.
  const ring = await page.getByTestId("narration-box-tap").boundingBox();
  if (ring === null) throw new Error("no tap ring");
  expect(Math.abs(ring.x + ring.width / 2 - cx)).toBeLessThanOrEqual(2);
  expect(Math.abs(ring.y + ring.height / 2 - cy)).toBeLessThanOrEqual(2);

  // Into the text, then two lines down on the plate: two lines back.
  await hook(page, "at", s.voice.totalMs / 2);
  await page.clock.runFor(FRAME_MS);
  const from = (await state(page)).voice.line;
  await dragDown(page, cx, cy, 2 * linePx);
  await page.clock.runFor(FRAME_MS);
  s = await state(page);
  expect(Math.abs(s.voice.line - from + 2)).toBeLessThanOrEqual(0.05);

  // Walking away under the finger keeps the plate until the release and
  // the lock; then the words fly.
  await hook(page, "standAt", 16);
  await page.clock.runFor(HOLD_MS + FLY_MS);
  s = await state(page);
  expect([s.travel.place, s.travel.u]).toEqual(["plate", 0]);
  await page.mouse.up();
  await page.clock.runFor(LOCK_MS - 2 * FRAME_MS);
  expect((await state(page)).travel.place).toBe("plate");
  await page.clock.runFor(FLY_MS + 100);
  s = await state(page);
  expect([s.travel.place, s.travel.u]).toEqual(["dock", 1]);

  // The same drag at the dock moves the same number of lines.
  await hook(page, "at", s.voice.totalMs / 2);
  await page.clock.runFor(FRAME_MS);
  const dockFrom = (await state(page)).voice.line;
  await dragDown(page, cx, s.box.top + s.box.height / 2, 2 * 22);
  await page.clock.runFor(FRAME_MS);
  s = await state(page);
  expect(Math.abs(s.voice.line - dockFrom + 2)).toBeLessThanOrEqual(0.05);
  await page.mouse.up();
});
