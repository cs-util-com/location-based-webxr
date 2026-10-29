// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why this test matters: the reading stand was built from the narrated-text
 * prototype (`public/prototypes/station-blocks-1-narrated-text/`, the
 * lectern), whose numbers the owner chose: a 1.2 x 0.9 m page leaning back
 * 16 degrees, its centre 1.32 m up, seen from a 1.6 m eye 2.6 m away. A
 * port can draw a stand of the wrong size, at the wrong height or facing
 * away and still pass a test that asks only whether something is drawn.
 * These pin where the page lands on a phone, a phone held sideways and a
 * desktop, through the check page `lectern-check.html`, against values
 * worked out here from the prototype's numbers (not from the code under
 * test), and that a tap on the page - and only on the page - turns it.
 *
 * Not pinned here: how the page looks (the side-by-side check against the
 * prototype, by eye).
 */

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone sideways", width: 844, height: 390 },
  { name: "desktop", width: 1440, height: 900 },
];

const EYE = { heightM: 1.6, distanceM: 2.6, pitch: 0.02 };
const PAGE = { widthM: 1.2, heightM: 0.9, tiltDeg: 16, centreM: 1.32 };

/** The prototype's camera: 42 degrees across the short side in portrait,
 *  50 degrees of height in landscape; the focal length in CSS px. */
function focalPx(width, height) {
  const rad = (d) => (d * Math.PI) / 180;
  return width < height
    ? width / 2 / Math.tan(rad(21))
    : height / 2 / Math.tan(rad(25));
}

/** Where the page's box should land: its near edge is its lower edge,
 *  tilted towards the eye, so the box's width is the page's width at that
 *  depth; its top and bottom are its upper and lower edges' heights at the
 *  nearest depth of the box. */
function expected(width, height) {
  const f = focalPx(width, height);
  const tilt = (PAGE.tiltDeg * Math.PI) / 180;
  const nearZ = EYE.distanceM - Math.sin(tilt) * (PAGE.heightM / 2);
  const halfUp = Math.cos(tilt) * (PAGE.heightM / 2);
  const screenY = (yM) =>
    height / 2 -
    f * Math.tan(Math.atan((yM - EYE.heightM) / nearZ) - EYE.pitch);
  return {
    width: (PAGE.widthM / nearZ) * f,
    top: screenY(PAGE.centreM + halfUp),
    bottom: screenY(PAGE.centreM - halfUp),
  };
}

async function open(page, viewport) {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto("/lectern-check.html");
  await page.waitForFunction(() => window.__lecternCheck?.state() != null);
  return errors;
}

async function state(page) {
  const s = await page.evaluate(() => window.__lecternCheck?.state());
  if (s === null || s === undefined) throw new Error("no stand");
  return s;
}

// A software-rendered WebGL page is slow on a busy machine.
test.describe.configure({ timeout: 90_000 });

// The page draws every frame; stop it so the closing browser is not busy.
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__lecternCheck?.stop());
});

for (const viewport of VIEWPORTS) {
  test(`the page stands where the prototype put it, and a tap on it turns it (${viewport.name})`, async ({
    page,
  }) => {
    const errors = await open(page, viewport);
    const s = await state(page);
    const rect = s.parts.page;
    const stand = s.parts.stand;
    if (rect === null || stand === null) throw new Error("not drawn");
    const want = expected(viewport.width, viewport.height);

    // Centred across, as wide as the page at its distance.
    const centreX = (rect.left + rect.right) / 2;
    expect(Math.abs(centreX - viewport.width / 2)).toBeLessThan(2);
    const width = rect.right - rect.left;
    expect(Math.abs(width - want.width) / want.width).toBeLessThan(0.03);
    // Its top and bottom at the prototype's heights (a few px of slack
    // for the box's off-axis corners).
    const slack = 0.02 * viewport.height;
    expect(Math.abs(rect.top - want.top)).toBeLessThan(slack);
    expect(Math.abs(rect.bottom - want.bottom)).toBeLessThan(slack);
    // The whole page is on screen, with the sky above it.
    expect(rect.top).toBeGreaterThan(0);
    expect(rect.left).toBeGreaterThan(0);
    expect(rect.right).toBeLessThan(viewport.width);
    expect(rect.bottom).toBeLessThan(viewport.height);
    // The stand reaches below the page, to the ground, and is the board's
    // width across (its frame 4 cm wider each side).
    expect(stand.bottom - rect.bottom).toBeGreaterThan(0.1 * width);
    expect(stand.right - stand.left).toBeGreaterThan(width);
    expect(stand.right - stand.left).toBeLessThan(width * 1.1);

    expect(s.sentence).toBe(0);
    // A tap on the sky leaves the page; a tap on the page turns it.
    await page.mouse.click(viewport.width / 2, Math.max(4, rect.top / 2));
    expect((await state(page)).sentence).toBe(0);
    await page.mouse.click(centreX, (rect.top + rect.bottom) / 2);
    expect((await state(page)).sentence).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

test("turning goes through every paragraph and back to the first sentence", async ({
  page,
}) => {
  await open(page, VIEWPORTS[2]);
  const seen = [0];
  for (let i = 0; i < 40; i += 1) {
    await page.evaluate(() => window.__lecternCheck?.turn());
    const at = (await state(page)).sentence;
    if (at === 0) break;
    expect(at).toBeGreaterThan(seen[seen.length - 1]);
    seen.push(at);
  }
  expect((await state(page)).sentence).toBe(0);
  // The demo text's two paragraphs need more than one turn.
  expect(seen.length).toBeGreaterThan(2);
});
