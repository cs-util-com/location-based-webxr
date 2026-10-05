// @ts-check
import { expect, test } from "@playwright/test";

import {
  installTourViewerArFakes,
  seedAlignment,
  standAt,
} from "./ar-fakes.js";
import { E2E_QR_TEXT } from "./qr-fixture.mjs";

/**
 * The visitor's stations (tour kit plan K4) end to end, through the AR
 * fakes: the station guide, the HUD's targets, the story panel with its
 * character, voice, choice and 3D model, the walk that finds a station by
 * GPS, and the labelled skip. The fixture tour (`archive-server.mjs`,
 * `/ranges-ok/stations-tour.zip`) has three stations in fixed order: "The
 * gate" on the printed code, "The well" 30 m north, "The tower" 300 m east.
 */

const STATIONS_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/stations-tour.zip";

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/** Open the stations tour as a visitor and start AR on an aligned store. */
async function startTheTour(page) {
  await page.goto(`/?qr=${encodeURIComponent(STATIONS_ARCHIVE)}`);
  // One image entry (the knight's figure) streams into the gallery.
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(1, {
    timeout: 15000,
  });
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await seedAlignment(page);
}

/** Lock the fixture's printed code until the gate reports it. */
async function lockTheCode(page) {
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("ar-status").textContent();
      },
      { timeout: 20000 },
    )
    .toMatch(/Code recognised/);
}

test("a station tour: the code finds the first station, its knight speaks and asks, a walk finds the next, the last is skipped", async ({
  page,
}) => {
  // Why this test matters (tour kit plan K4): it is the castle example in
  // miniature, through the real page - the scan gate, the station run, the
  // HUD's targets, the story panel, the AR stage, the audio channel and the
  // GLTF loader - so a wiring gap between any two of them fails here even
  // when each module's own tests pass.
  await startTheTour(page);
  await standAt(page, 0, 0, 0);
  await lockTheCode(page);

  // The lock that passed the gate found "The gate": its story plays.
  const panel = page.getByTestId("scene-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("scene-title")).toHaveText("The gate");
  await expect(page.getByTestId("scene-speaker")).toHaveText("Sir Kay");
  await expect(page.getByTestId("scene-text")).toHaveText("Halt, traveller!");
  // The knight stands in the scene, and its voice went through the ONE
  // audio element the start tap unlocked.
  await expect
    .poll(() =>
      page.evaluate(() =>
        /** @type {any} */ (window).__tourViewerTest.fakeScene.children.map(
          (c) => c.name,
        ),
      ),
    )
    .toContain("station-stage:gate");
  // "The gate" is anchored by its code alone: the knight stands on the
  // estimated ground below the code - the phone's height in the GPS world
  // less 1.5 m - not at the poster's centre (K4 review R6; the code is
  // saved at 400 m, where the K4 build stood it).
  const heights = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    const m = t.alignmentStore.getState().gpsData.gpsEvents.alignmentMatrix;
    const { x, y, z } = t.arPose.position;
    // Raw WebXR (x East, y Up, z South) to odometry NUE, then up through
    // the alignment (column-major).
    const [n, u, e] = [-z, y, x];
    return {
      feet: t.fakeScene.children.find((c) => c.name === "station-stage:gate")
        .position.y,
      camera: m[1] * n + m[5] * u + m[9] * e + m[13],
    };
  });
  expect(heights.feet).toBeCloseTo(heights.camera - 1.5, 0);
  expect(Math.abs(heights.feet - 400)).toBeGreaterThan(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const t = /** @type {any} */ (window).__tourViewerTest;
        return { elements: t.audioElements, plays: t.audioPlays.length };
      }),
    )
    .toEqual({ elements: 1, plays: 2 }); // the unlock, then the voice

  // While the story plays, the skip button can end it (K4 review R9).
  await expect(page.getByTestId("station-skip")).toHaveText("End this story?");

  // A scene choice.
  await page.getByTestId("scene-continue").click();
  await expect(page.getByTestId("scene-text")).toHaveText("Enter the castle?");
  await expect(page.getByTestId("scene-continue")).toBeHidden();
  await page.getByTestId("scene-choices").getByText("Yes").click();
  await expect(page.getByTestId("scene-text")).toHaveText("Welcome inside.");
  await page.getByTestId("scene-continue").click();
  await expect(panel).toBeHidden();

  // The next station is offered, and the HUD points at it alone.
  const line = page.getByTestId("station-line");
  await expect(line).toHaveText(/^Next: The well, \d+ m$/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        /** @type {any} */ (window).__tourViewerTest.hud
          .getTargets()
          .map((t) => t.id),
      ),
    )
    .toEqual(["well"]);
  // ... and the breadcrumbs lead there on the ground.
  await expect
    .poll(() =>
      page.evaluate(() =>
        /** @type {any} */ (window).__tourViewerTest.fakeScene.children.map(
          (c) => c.name,
        ),
      ),
    )
    .toContain("station-breadcrumbs");

  // Walk north to the well: found by GPS, its 3D model stands there.
  for (let m = 5, s = 1; m <= 30; m += 5, s += 1) await standAt(page, m, 0, s);
  await expect(page.getByTestId("scene-title")).toHaveText("The well");
  await expect(page.getByTestId("scene-text")).toHaveText("The old arch.");
  await expect
    .poll(() =>
      page.evaluate(() =>
        /** @type {any} */ (window).__tourViewerTest.fakeScene.children.map(
          (c) => c.name,
        ),
      ),
    )
    .toContain("station-stage:well");
  await expect(page.getByTestId("scene-status")).toHaveText("");
  await page.getByTestId("scene-continue").click();

  // The tower is far: skipped on demand, in two taps (§8 D5).
  await expect(line).toHaveText(/^Next: The tower, \d+ m$/);
  const skip = page.getByTestId("station-skip");
  await expect(skip).toHaveText("Can't get there?");
  await skip.click();
  await expect(skip).toHaveText("Skip The tower - I can't get there");
  await skip.click();
  await expect(line).toHaveText("Tour complete - 1 skipped.");
  // The skip can be undone for a moment (K4 review R14): the tower comes
  // back; skipped again, the button goes once the moment has passed (the
  // next camera frames re-render it).
  await expect(skip).toHaveText("Undo: bring back The tower");
  await skip.click();
  await expect(line).toHaveText(
    /^Brought back The tower\. Next: The tower, \d+ m$/,
  );
  await expect(skip).toHaveText("Can't get there?");
  await skip.click();
  await skip.click();
  await expect(line).toHaveText("Tour complete - 1 skipped.");
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return skip.isHidden();
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => /** @type {any} */ (window).__tourViewerTest.hud.disposed,
      ),
    )
    .toBe(true);
});

test("leaving AR stops the story but keeps the progress, and the cut-short story plays again on return", async ({
  page,
}) => {
  // Why this test matters (K-D9): a visitor whose phone ends the session
  // (the back gesture) must not keep a story talking with no screen, must
  // not lose the station already found, and must get its story back - else
  // a fixed-order tour could never get past that station.
  await startTheTour(page);
  await standAt(page, 0, 0, 0);
  await lockTheCode(page);
  await expect(page.getByTestId("scene-title")).toHaveText("The gate");

  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.endXrSession();
  });
  await expect(page.getByTestId("scene-panel")).toBeHidden();
  await expect(page.getByTestId("station-line")).toBeHidden();

  // Back in AR, behind this session's own scan gate (K4 review R8): the
  // story waits for the lock that passes it, and for a position and the
  // GPS zero, then the gate's story starts again - the station stays found.
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await standAt(page, 0, 0, 10);
  await expect(page.getByTestId("station-line")).toBeHidden();
  await expect(page.getByTestId("scene-panel")).toBeHidden();
  await lockTheCode(page);
  // The next GPS fix (on a phone, the next camera frame) re-judges.
  await standAt(page, 0, 0, 11);
  await expect(page.getByTestId("scene-panel")).toBeVisible();
  await expect(page.getByTestId("scene-text")).toHaveText("Halt, traveller!");
});
