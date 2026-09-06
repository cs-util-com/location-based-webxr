import { test, expect } from "./e2e-test.js";
import { countAccentPixels, countInkPixels } from "./count-accent-pixels.js";

/**
 * Entrance-animation e2e — the diamond BUILDS ITSELF UP on the real render
 * path, under a fake clock.
 *
 * Why this suite matters: the framework's unit tests see the drawing calls,
 * never the pixels; this is the one place the build-up is watched on a real
 * canvas. The house rejects machine-dependent pixel goldens (shoot.mjs), so
 * the assertions are STRUCTURAL (DEC-E4 of the entrance plan): the ink the
 * outline paints grows monotonically across the timeline, the accent dot is
 * absent before it pops and present once settled, and the settled frame is
 * the static SVG sprite within a tolerance. Playwright's `page.clock` is the
 * stepped clock (the simulator's scheduler seam is a unit-test injection, not
 * reachable from a page); it is installed BEFORE `goto`, as is the
 * reduced-motion emulation, because the HUD reads both once at creation; it
 * is PAUSED after boot, because an installed clock otherwise keeps running in
 * real time (measured: one screenshot cost ~180 ms of timeline). Every HUD
 * whose timeline is measured is created AFTER the pause, so no real time
 * leaks into it.
 *
 * Playwright's faked `requestAnimationFrame` fires on a 16 ms grid whatever
 * the size of a `runFor`, so every frame's `dt` is 16 ms and the simulator's
 * 100 ms clamp (`MAX_FRAME_DT_S`) is never reached. The ≤ 100 ms slices in
 * `advance()` are defence in depth against a future non-faked path, not a
 * requirement (M4 milestone review, 2026-09-06).
 */

/** Advance the fake clock `ms`, in ≤ 100 ms slices (see the header). */
async function advance(page, ms) {
  for (let left = ms; left > 0; left -= 100) {
    await page.clock.runFor(Math.min(100, left));
  }
}

/**
 * Count the ink and accent pixels in the circle indicator's clip, with the
 * bottom panel HIDDEN for the shot: `page.screenshot` sees the DOM too, and
 * the panel's status line grows with the entrance readout, wrapped on the
 * CI runner's fonts and rose into the clip (603 "ink" pixels at 600 ms on
 * CI, 128 once the readout went quiet). Hidden only for the shot, so the
 * toggles stay clickable and the status locator readable in between.
 */
async function countMarker(page, clip) {
  const panel = page.locator("#hud-panel");
  await panel.evaluate((el) => {
    el.style.visibility = "hidden";
  });
  const shot = await page.screenshot({ clip });
  await panel.evaluate((el) => {
    el.style.visibility = "";
  });
  return {
    ink: await countInkPixels(page, shot),
    accent: await countAccentPixels(page, shot),
  };
}

/**
 * The clip around the ahead target's circle, at the screen centre. At the
 * simulator's fov 70 and hudDistance 2.5 the 0.3 m sprite is ~8.6 % of the
 * viewport height; its diamond spans about 0.46 H .. 0.54 H. The distance
 * label sits below it (centre at 0.557 H, its text ink from ~0.55 H), so the
 * clip stops at 0.545 H: the WHOLE diamond, none of the label's changing
 * text (M4 milestone review, 2026-09-06).
 */
function markerClip(canvasBox) {
  return {
    x: canvasBox.x + canvasBox.width * 0.4,
    y: canvasBox.y + canvasBox.height * 0.44,
    width: canvasBox.width * 0.2,
    height: canvasBox.height * 0.105,
  };
}

/** Collect page errors AND console errors: a failed texture load is a console error. */
function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(String(error));
  });
  return errors;
}

/** Boot the page under the fake clock, image indicators on, and wait for the
 * HUD to report the sprite path; returns the status locator and the clip.
 * The clock is PAUSED on return; the HUD created here has run under real
 * time and is not the one to measure — re-create it under the paused clock. */
async function bootWithImageIndicators(page, { entrance }) {
  await page.clock.install();
  await page.goto("/");
  // Frames only run while the clock runs: give the boot a second of it.
  await advance(page, 1000);
  const status = page.getByTestId("hud-status");
  await expect(status).toContainText("procedural indicators");
  await page.keyboard.press("q"); // dismiss the mode screen without moving
  await expect(page.getByTestId("mode-screen")).toBeHidden();
  // Image indicators first: the entrance switch is DISABLED without them
  // (the procedural ring has no build-up), so it can only be set afterwards.
  await page.getByTestId("image-indicators").check();
  const entranceToggle = page.getByTestId("entrance-animation");
  if (entrance) await entranceToggle.check();
  else await entranceToggle.uncheck();
  await advance(page, 100); // the re-created HUD's first frames
  await expect(status).toContainText("image indicators");
  // PAUSE the clock: installed, it still runs in real time (measured: a
  // screenshot cost ~180 ms of timeline); from here only the explicit
  // steps advance it. The +500 ms is a margin: the fake clock keeps moving
  // between the evaluate and the pause, and a moment already passed throws.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);
  const canvasBox = await page.locator("#app canvas").boundingBox();
  expect(canvasBox).not.toBeNull();
  return { status, clip: markerClip(canvasBox) };
}

/** Re-create the HUD under the paused clock by cycling the entrance switch
 * to `entrance`; the HUD's first frame then runs on the next `advance`.
 */
async function recreateHud(page, { entrance }) {
  const toggle = page.getByTestId("entrance-animation");
  if (entrance) {
    await toggle.uncheck();
    await toggle.check();
  } else {
    await toggle.check();
    await toggle.uncheck();
  }
}

test.describe("Wayfinding HUD demo — the diamond's entrance animation", () => {
  test("the outline grows monotonically, the dot pops last, and the settled frame is the static sprite", async ({
    page,
  }) => {
    const errors = collectErrors(page);

    // Baseline FIRST: the static SVG sprite with the entrance off.
    const off = await bootWithImageIndicators(page, { entrance: false });
    await advance(page, 1000);
    const baseline = await countMarker(page, off.clip);
    expect(baseline.accent).toBeGreaterThan(20);

    // Now the entrance, on a HUD created under the PAUSED clock (t = 0).
    await recreateHud(page, { entrance: true });
    await advance(page, 20); // one frame: the t = 0 marker is drawn
    await expect(off.status).toContainText("entrance 1 animating");

    const samples = [];
    let elapsed = 20;
    for (const t of [0, 200, 400, 600, 1000]) {
      await advance(page, Math.max(0, t - elapsed));
      elapsed = Math.max(elapsed, t);
      samples.push({ t, ...(await countMarker(page, off.clip)) });
    }
    // The last sample is taken SETTLED, asserted rather than assumed: the
    // first frame starts the entrance without advancing it, so 850 ms of
    // clock is ~834 ms of timeline; 1000 ms leaves no doubt.
    await expect(off.status).not.toContainText("animating");

    // Structure, not pixels: ink never shrinks along the timeline …
    for (let i = 1; i < samples.length; i += 1) {
      expect(
        samples[i].ink,
        `ink at ${samples[i].t} ms vs ${samples[i - 1].t} ms`,
      ).toBeGreaterThanOrEqual(samples[i - 1].ink - 2);
    }
    // … the accent dot is absent before it pops and present once settled …
    for (const sample of samples.filter((s) => s.t <= 400)) {
      expect(sample.accent, `accent at ${sample.t} ms`).toBeLessThanOrEqual(2);
    }
    expect(samples.at(-1).accent).toBeGreaterThan(20);
    // … and the settled frame matches the static sprite within ±15 %.
    const settled = samples.at(-1);
    expect(settled.ink).toBeGreaterThan(baseline.ink * 0.85);
    expect(settled.ink).toBeLessThan(baseline.ink * 1.15);
    expect(settled.accent).toBeGreaterThan(baseline.accent * 0.85);
    expect(settled.accent).toBeLessThan(baseline.accent * 1.15);

    // The readout goes quiet once nothing animates.
    await expect(off.status).not.toContainText("entrance");
    expect(errors).toEqual([]);
  });

  test("reduced motion shows the complete marker on the first frame", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const on = await bootWithImageIndicators(page, { entrance: true });
    // A HUD created under the PAUSED clock, given exactly one frame: with
    // reduced motion the accent dot is already there and nothing animates.
    // (Measured before the pause, real time could have finished the
    // entrance on its own and passed this vacuously — M4 milestone review.)
    await recreateHud(page, { entrance: true });
    await advance(page, 16);
    const first = await countMarker(page, on.clip);
    expect(first.accent).toBeGreaterThan(20);
    // The one frame drew the SETTLED marker: one redraw, nothing animating.
    await expect(on.status).toContainText("entrance 0 animating · 1 redraws");
    expect(errors).toEqual([]);
  });
});
