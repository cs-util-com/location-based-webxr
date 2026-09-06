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
 * real time (measured: one screenshot cost ~180 ms of timeline).
 *
 * The simulator clamps a frame's `dt` to 100 ms (a background-tab resume must
 * not teleport the walker), so the clock is advanced in ≤ 100 ms slices — one
 * `runFor(100)` per 100 ms of timeline — never in one jump.
 */

/** Advance the fake clock `ms` in ≤ 100 ms slices, so no frame's dt clamps. */
async function advance(page, ms) {
  for (let left = ms; left > 0; left -= 100) {
    await page.clock.runFor(Math.min(100, left));
  }
}

/** Count the ink and accent pixels in the circle indicator's clip. */
async function countMarker(page, clip) {
  const shot = await page.screenshot({ clip });
  return {
    ink: await countInkPixels(page, shot),
    accent: await countAccentPixels(page, shot),
  };
}

/** The clip around the ahead target's circle at the screen centre — sized
 * to EXCLUDE the distance label below it, whose changing text would
 * otherwise leak into the ink count. */
function markerClip(canvasBox) {
  return {
    x: canvasBox.x + canvasBox.width * 0.4,
    y: canvasBox.y + canvasBox.height * 0.3,
    width: canvasBox.width * 0.2,
    height: canvasBox.height * 0.22,
  };
}

/** Boot the page under the fake clock, image indicators on, and wait for the
 * HUD to report the sprite path; returns the canvas box and the clip. */
async function bootWithImageIndicators(page, { entrance }) {
  await page.clock.install();
  await page.goto("/");
  // Frames only run while the clock runs: give the boot a second of it.
  await advance(page, 1000);
  const status = page.getByTestId("hud-status");
  await expect(status).toContainText("procedural indicators");
  await page.keyboard.press("q"); // dismiss the mode screen without moving
  await expect(page.getByTestId("mode-screen")).toBeHidden();
  const entranceToggle = page.getByTestId("entrance-animation");
  if (entrance) await entranceToggle.check();
  else await entranceToggle.uncheck();
  await page.getByTestId("image-indicators").check();
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

test.describe("Wayfinding HUD demo — the diamond's entrance animation", () => {
  test("the outline grows monotonically, the dot pops last, and the settled frame is the static sprite", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(String(error));
    });

    // Baseline FIRST: the static SVG sprite with the entrance off.
    const off = await bootWithImageIndicators(page, { entrance: false });
    await advance(page, 1000);
    const baseline = await countMarker(page, off.clip);
    expect(baseline.accent).toBeGreaterThan(20);

    // Now the entrance: re-check the toggle (re-creates the HUD, t = 0).
    await page.getByTestId("entrance-animation").check();
    await advance(page, 20); // one or two frames: the t≈0 marker is drawn
    await expect(off.status).toContainText("entrance 1 animating");

    const samples = [];
    let elapsed = 20;
    for (const t of [0, 200, 400, 600, 850]) {
      await advance(page, Math.max(0, t - elapsed));
      elapsed = Math.max(elapsed, t);
      samples.push({ t, ...(await countMarker(page, off.clip)) });
    }

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
    await advance(page, 200);
    await expect(off.status).not.toContainText("entrance");
    expect(errors).toEqual([]);
  });

  test("reduced motion shows the complete marker on the first frame", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const on = await bootWithImageIndicators(page, { entrance: true });
    // Only the re-creation's first frames have run: under reduced motion the
    // accent dot is already there.
    const first = await countMarker(page, on.clip);
    expect(first.accent).toBeGreaterThan(20);
    await expect(on.status).not.toContainText("animating");
  });
});
