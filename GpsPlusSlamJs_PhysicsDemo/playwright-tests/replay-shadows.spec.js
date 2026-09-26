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

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

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
 */
test.describe("Physics Demo - shadows you can see", () => {
  test("a resting ball's shadow darkens the floor around it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/?shadowProbe=1");
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

    // Drop a ball onto the room's floor (once the re-meshed room offers
    // one), then let it come to rest.
    await page.waitForFunction(
      () => window.__physicsShadowProbe.dropOnFloor() !== null,
      null,
      { timeout: 20_000 },
    );
    await page.waitForFunction(
      () => window.__physicsShadowProbe.atRest(),
      null,
      {
        timeout: 30_000,
      },
    );

    // Standing 1.5 m up, from four sides (whether the ball hides its own
    // shadow depends on where the viewer stands against the light), at a
    // near view (1.2 m) and at a thrower's 2.5 m and 4 m (M1 review): the
    // window around the ball (8 ball radii), shadow off and on.
    const lowerMiddle = (values) => [...values].sort((a, b) => a - b)[1];
    const byDistance = {};
    for (const backM of STAND_BACK_SWEEP_M) {
      const counts = [];
      for (const azimuth of [0, 90, 180, 270]) {
        const measured = await page.evaluate(
          ([a, back]) => {
            const probe = window.__physicsShadowProbe;
            probe.standAt(a, back);
            const ball = probe.ballScreen();
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
        const darkenedBy = (threshold) => {
          let n = 0;
          for (let i = 0; i < measured.on.length; i += 4) {
            const before = luminance(
              measured.off[i],
              measured.off[i + 1],
              measured.off[i + 2],
            );
            const after = luminance(
              measured.on[i],
              measured.on[i + 1],
              measured.on[i + 2],
            );
            if (before - after >= threshold) n += 1;
          }
          return n;
        };
        counts.push(darkenedBy(DARKEN_BY));
        console.log(
          `shadow probe ${backM} m at ${azimuth}°: ball radius ${measured.ball.r.toFixed(1)} px, window ${measured.side} px, darkened by >= ${DARKEN_SWEEP.map((t) => `${t}: ${darkenedBy(t)}`).join(", ")}`,
        );
      }
      byDistance[backM] = lowerMiddle(counts);
    }
    console.log(
      `shadow probe, lower middle of four sides: ${JSON.stringify(byDistance)}`,
    );
    // The floor scales with the ball's area on screen (1 / distance²).
    for (const backM of STAND_BACK_SWEEP_M) {
      expect(byDistance[backM]).toBeGreaterThanOrEqual(
        MIN_SHADOW_PX * (1.2 / backM) ** 2,
      );
    }
    expect(pageErrors).toEqual([]);
  });
});
