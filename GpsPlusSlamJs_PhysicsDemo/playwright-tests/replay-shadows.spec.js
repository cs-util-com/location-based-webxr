import { test, expect } from "./e2e-test.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "sample-recording.zip");

/**
 * How many pixels must darken for a resting ball's shadow to count as
 * visible (owner feedback round 2, M1). Measured 2026-09-26 (the demo's
 * 63.4° light, the ball about 27 px in radius at 1.5 m up and 1.2 m away):
 * 424-1076 pixels from the four sides, median about 890; a ball covers
 * about 2,260. The floor is well under that, and well above noise.
 */
const MIN_SHADOW_PX = 200;
/**
 * A pixel "darkens" when its luminance drops by at least this much; the
 * verdict is also reported at half and twice it (owner rule 2026-09-13).
 */
const DARKEN_BY = 6;
const DARKEN_SWEEP = [3, 6, 12];
/** How far the standing viewer is from the ball (m): near, and a thrower's. */
const STAND_BACK_SWEEP_M = [1.2, 2.5, 4];
/**
 * Every skin of the Shader dropdown. Owner phone test on r749 (2026-09-27):
 * shadows showed with the shaded skins but NOT with "Wireframe" and "Off",
 * the normal AR case. The page's default first, then the two that failed,
 * then back to shaded skins.
 */
const SKINS = [
  "depth-shaded-wireframe",
  "wireframe",
  "off",
  "matcap",
  "depth-shaded",
];
/**
 * The canvas is transparent (`alpha: true`, no background), in the replay
 * as in AR, where the browser composites it over the camera image. With the
 * "Off" skin nothing opaque lies under the floor, so the shadow is ONLY
 * alpha: its RGB stays black over black. What a viewer sees is the canvas
 * composited over the picture behind it, so each pixel is composited
 * (premultiplied, as the drawing buffer is) over a flat grey stand-in for
 * the camera image before its luminance is taken. Reported at a dark, a
 * middle and a bright stand-in; the verdict is taken at the middle.
 */
const CAMERA_GREY = 128;
const CAMERA_GREY_SWEEP = [64, 128, 192];

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** A premultiplied RGBA pixel's luminance over an opaque grey `grey`. */
const seenOver = (px, i, grey) =>
  luminance(px[i], px[i + 1], px[i + 2]) + (1 - px[i + 3] / 255) * grey;

/** The lower middle of four sides' counts (whether the ball hides its own
 * shadow depends on where the viewer stands against the light). */
const lowerMiddle = (values) => [...values].sort((a, b) => a - b)[1];

/**
 * Opens the replay with the probe. `before` sets dropdowns BEFORE the
 * recording loads, so the first occluder is built with them and never
 * recreated (the phone's first load); the panel is hidden until then, so
 * the values are set directly, as a restored form would set them.
 */
async function openReplay(page, before = {}) {
  await page.goto("/?shadowProbe=1");
  await page.evaluate((values) => {
    for (const [testId, value] of Object.entries(values)) {
      const select = document.querySelector(`[data-testid="${testId}"]`);
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error(`no select ${testId}`);
      }
      select.value = value;
      if (select.value !== value) throw new Error(`no option ${value}`);
    }
  }, before);
  await page.getByTestId("recording-input").setInputFiles(FIXTURE);
  await expect(page.getByTestId("replay-panel")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("replay-speed").fill("4");
  await expect(page.getByTestId("stats")).toContainText(
    /collider [1-9]\d* tris/,
    { timeout: 90_000 },
  );
  await page.waitForFunction(() => window.__physicsShadowProbe, null, {
    timeout: 10_000,
  });
  // A still camera: the replay's orbit camera follows the recording.
  await page.evaluate(() => window.__physicsShadowProbe.pause());
}

/** Drops a ball onto the room's floor (once it offers one) and lets it rest. */
async function dropAndRest(page) {
  await page.waitForFunction(
    () => window.__physicsShadowProbe.dropOnFloor() !== null,
    null,
    { timeout: 20_000 },
  );
  await page.waitForFunction(() => window.__physicsShadowProbe.atRest(), null, {
    timeout: 30_000,
  });
}

/**
 * One view: standing 1.5 m up, `backM` away at `azimuth`, the window around
 * the ball (8 ball radii), shadow off and on. A ball despawns after 3,600
 * physics steps (about a minute at 60 fps), less than all the views take on
 * a loaded machine, so a view whose ball is gone drops a new one on the same
 * spot and measures again. A view is one synchronous evaluate, so no step
 * can remove the ball inside it.
 */
async function measureView(page, azimuth, backM) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const measured = await page.evaluate(
      ([a, back]) => {
        const probe = window.__physicsShadowProbe;
        probe.standAt(a, back);
        let ball;
        try {
          ball = probe.ballScreen();
        } catch {
          return null; // despawned: no ball to measure
        }
        const side = Math.max(16, Math.round(8 * ball.r));
        const x = Math.round(ball.x - side / 2);
        const y = Math.round(ball.y - side / 2);
        probe.setShadowsEnabled(false);
        const off = probe.readRegion(x, y, side, side);
        probe.setShadowsEnabled(true);
        const on = probe.readRegion(x, y, side, side);
        return { ball, side, off, on };
      },
      [azimuth, backM],
    );
    if (measured) return measured;
    await dropAndRest(page);
  }
  throw new Error(`no ball stayed for the view at ${azimuth}° ${backM} m`);
}

/** Pixels whose composited luminance drops by at least `threshold`. */
function darkenedBy(measured, threshold, grey = CAMERA_GREY) {
  let n = 0;
  for (let i = 0; i < measured.on.length; i += 4) {
    const drop =
      seenOver(measured.off, i, grey) - seenOver(measured.on, i, grey);
    if (drop >= threshold) n += 1;
  }
  return n;
}

/** The four sides at `backM`, logged with the sweep; their lower middle. */
async function measureSides(page, label, backM) {
  const counts = [];
  for (const azimuth of [0, 90, 180, 270]) {
    const measured = await measureView(page, azimuth, backM);
    counts.push(darkenedBy(measured, DARKEN_BY));
    const sweep = CAMERA_GREY_SWEEP.map(
      (grey) =>
        `grey ${grey} [${DARKEN_SWEEP.map((t) => `${t}: ${darkenedBy(measured, t, grey)}`).join(", ")}]`,
    ).join(" ");
    console.log(
      `shadow probe ${label} ${backM} m at ${azimuth}°: ball radius ${measured.ball.r.toFixed(1)} px, window ${measured.side} px, darkened by >= ${sweep}`,
    );
  }
  return lowerMiddle(counts);
}

/** The floor scales with the ball's area on screen (1 / distance²). */
const minShadowPx = (backM) => MIN_SHADOW_PX * (1.2 / backM) ** 2;

/**
 * WHY (owner feedback round 2, plan 2026-09-26-2055 M1): the owner saw no
 * shadow at all on the phone, while the replay e2e passed. That e2e only
 * checked the stats line's "shadows on", which says the rule is active, not
 * that a shadow is VISIBLE; the W4 plan's pixel probe (§11) had been dropped.
 * This is that probe, with the demo's own light, ball size and camera: a ball
 * rests on the reconstructed floor, and the pixels around it that darken
 * when the shadow is switched on are counted. The AR path renders the same
 * wiring (startDemoShadows, the same light and receiver), so a shadow too
 * small to see here is too small on the phone.
 *
 * Round 3 (owner phone test on r749, 2026-09-27): the shadow showed with
 * the shaded skins and vanished with "Wireframe" and "Off". So the probe
 * now measures EVERY skin, each after a re-mesh, as the phone draws it.
 */
test.describe("Physics Demo - shadows you can see", () => {
  test("a resting ball's shadow darkens the floor around it, in every skin", async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await openReplay(page);
    // "Cubes": on this fixture's very sparse room a ball falls through the
    // smooth floors' gaps (measured 2026-09-26); the blocky floor holds it.
    // The mesh mode IS the receiver's geometry (a skin on the occluder), so
    // this measures the shadow on the blocky floor; the page's default is
    // Surface nets. Wait for the collider to follow the new mesh (it
    // rebuilds on a throttle), or the ball meets the old one.
    const stats = page.getByTestId("stats");
    const colliderOf = async () =>
      /collider (\d+) tris/.exec((await stats.textContent()) ?? "")?.[1];
    const before = await colliderOf();
    await page.getByTestId("mesh-style").selectOption("greedy");
    await expect.poll(colliderOf, { timeout: 20_000 }).not.toBe(before);
    await dropAndRest(page);

    // A TIME BUDGET, not a weaker check: every skin is measured at 1.2 m
    // from four sides, and the page's default skin also at 2.5 m and 4 m
    // (the M1 sweep): 28 views. Dropped: the 2.5 m and 4 m views of the four
    // other skins (32 of the full 60). A skin decides WHETHER the receiver
    // draws, not how the shadow falls off with distance: with the fix, Off
    // matched the default within 2 % at all three distances (full 60-view
    // sweep, 2026-09-27, findings doc 2026-09-27-0651), and 60 views overran
    // the test budget on a loaded machine where the original 12 had fitted.
    const distancesFor = (skin) =>
      skin === SKINS[0] ? STAND_BACK_SWEEP_M : STAND_BACK_SWEEP_M.slice(0, 1);

    // Every skin, in the order a user flips through the dropdown. A skin
    // switch reaches the receiver's geometry through the next re-mesh,
    // which a phone does on every depth refresh and the paused replay only
    // when asked.
    const bySkin = {};
    for (const skin of SKINS) {
      await page.getByTestId("mesh-shader").selectOption(skin);
      await page.evaluate(() => window.__physicsShadowProbe.remesh());
      bySkin[skin] = {};
      for (const backM of distancesFor(skin)) {
        bySkin[skin][backM] = await measureSides(page, skin, backM);
      }
    }
    console.log(
      `shadow probe, lower middle of four sides: ${JSON.stringify(bySkin)}`,
    );
    for (const skin of SKINS) {
      for (const backM of distancesFor(skin)) {
        expect
          .soft(bySkin[skin][backM], `${skin} at ${backM} m`)
          .toBeGreaterThanOrEqual(minShadowPx(backM));
      }
    }
    expect(pageErrors).toEqual([]);
  });

  /*
   * WHY (owner field report on r752, 2026-09-27): "the shadows first didn't
   * show, but when I switched the mesh shader they started working; the
   * second time I loaded the page they worked instantly". The test above
   * changes the mesh mode first, which RECREATES the occluder and its
   * receiver, so no test ever measured the first occluder of a page load.
   * Here the dropdowns are set before the recording loads and never touched
   * again: the page's default skin (the owner's first load) and Off (the
   * normal AR case), each on the first occluder, whose receiver is attached
   * before the room has any geometry. Only "Cubes" is preset, as above,
   * because this fixture's smooth floor does not hold a ball.
   */
  //
  // Round 4 (owner on r753: first visit to a new preview origin only, so
  // with Chrome's camera/AR permission prompt): each case also reads the
  // receiver's program flags from the status line ("rx S1N?D1": compiled
  // with the shadow map and one directional shadow), the state a phone
  // screenshot now shows. (A third case froze the page for 3 s mid-start
  // through CDP to mimic the prompt; the ball then never came to rest,
  // likely because headless Chromium did not resume the page's
  // requestAnimationFrame, which both the replay and waitForFunction poll
  // on. It measured nothing and was dropped; see the first-visit findings.)
  for (const skin of ["depth-shaded-wireframe", "off"]) {
    const label = skin;
    test(`on first load (${label}), with no change, the shadow shows`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const pageErrors = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await openReplay(page, { "mesh-style": "greedy", "mesh-shader": skin });
      await dropAndRest(page);
      const px = await measureSides(page, `first load ${label}`, 1.2);
      const stats = await page.getByTestId("stats").textContent();
      console.log(`first load ${label}: ${stats}`);
      expect(stats).toMatch(/ · rx S1N[01]D1 /);
      expect(px).toBeGreaterThanOrEqual(minShadowPx(1.2));
      expect(pageErrors).toEqual([]);
    });
  }
});
