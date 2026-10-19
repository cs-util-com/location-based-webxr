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
 * gate" at the printed code, "The well" 30 m north, "The tower" 300 m east.
 */

const STATIONS_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/stations-tour.zip";

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/** Open the stations tour as a visitor and start AR on an aligned store. */
async function startTheTour(page) {
  await page.goto(`/?qr=${encodeURIComponent(STATIONS_ARCHIVE)}`);
  // The tour is open (follow-up F14: a visitor's hidden gallery is not
  // filled any more, so its one image is no readiness signal).
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    {
      timeout: 15000,
    },
  );
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
        return page.getByTestId("ar-status").getAttribute("data-gate");
      },
      { timeout: 20000 },
    )
    // The CODE passed the gate (U1 milestone review #9: the visitor's state
    // alone also reads "placing" after a GPS-only pass).
    .toBe("passed-code");
}

test("a station tour: the visitor at the code finds the first station, its knight speaks and asks, a walk finds the next, the last is skipped", async ({
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

  // The lock passed the gate; the visitor stands inside "The gate"'s
  // radius, so it is found (D16: by the radius, never by the lock): its
  // story plays.
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
  // A station is a pin (tour editor plan D9): the knight stands at the
  // station's own spot and altitude (400 m), no longer on a ground guessed
  // below a code (the code-only station is gone).
  const feet = await page.evaluate(
    () =>
      /** @type {any} */ (window).__tourViewerTest.fakeScene.children.find(
        (c) => c.name === "station-stage:gate",
      ).position.y,
  );
  expect(feet).toBeCloseTo(400, 1);
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

/**
 * Put the camera at a GPS-world spot (north, east m of the session zero)
 * with NO device fix: the AR pose is that spot taken back through the
 * store's current alignment, as `standAt` does, but nothing reaches the GPS
 * watch - the codes-only visitor's phone, which moves by odometry alone.
 */
async function walkWithoutGps(page, north, east) {
  await page.evaluate(
    ({ north, east }) => {
      const test = /** @type {any} */ (window).__tourViewerTest;
      const a = Array.from(
        test.alignmentStore.getState().gpsData.gpsEvents.alignmentMatrix,
      );
      const d = [north - a[12], 1.4 - a[13], east - a[14]];
      const n = a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
      const u = a[4] * d[0] + a[5] * d[1] + a[6] * d[2];
      const e = a[8] * d[0] + a[9] * d[1] + a[10] * d[2];
      test.arPose = {
        position: { x: e, y: u, z: -n },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
      // A camera frame re-judges the stations, as on a phone.
      test.emitFrames(1);
    },
    { north, east },
  );
}

test("without location, a station is reached by its radius on the code-placed position (tour editor plan D16)", async ({
  page,
}) => {
  // Why this test matters: a visitor who declined location has no fix; the
  // code scan places them, and from then on the code-placed position is
  // the phone's best position. A station is reached by its radius on it,
  // like with GPS - no "I'm here" tap (removed with D16), no code of the
  // station's own.
  await page.addInitScript(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    if (t) t.locationPermission = "denied";
  });
  await page.goto(`/?qr=${encodeURIComponent(STATIONS_ARCHIVE)}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  const button = page.getByTestId("enter-ar");
  await expect(button).toHaveText("Start the tour", { timeout: 10000 });
  await button.click();
  await expect(button).toHaveText("Exit AR");
  // The phone stands at the poster; the code places the tour, and the
  // gate 2 m away is found (no device fix at any point).
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.arPose = {
      position: { x: 0, y: 1.4, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
  });
  await lockTheCode(page);
  await expect(page.getByTestId("scene-title")).toHaveText("The gate");
  await page.getByTestId("scene-continue").click();
  await page.getByTestId("scene-choices").getByText("Yes").click();
  await page.getByTestId("scene-continue").click();
  await expect(page.getByTestId("scene-panel")).toBeHidden();

  const line = page.getByTestId("station-line");
  const skip = page.getByTestId("station-skip");
  await expect(line).toHaveText(/^Next: The well, \d+ m$/);
  await expect(skip).toHaveText("Can't get there?");
  // Walk to the well on odometry alone: where the HUD points.
  const well = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest.hud
      .getTargets()
      .find((x) => x.id === "well");
    return { north: t.position.x, east: t.position.z };
  });
  await walkWithoutGps(page, well.north - 20, well.east);
  await expect(line).toHaveText(/^Next: The well, (19|20|21) m$/);
  await expect(page.getByTestId("scene-panel")).toBeHidden();
  // Inside the well's 5 m radius: found on its own, no tap.
  await walkWithoutGps(page, well.north - 2, well.east);
  await expect(page.getByTestId("scene-title")).toHaveText("The well");
  expect(
    await page.evaluate(
      () => /** @type {any} */ (window).__tourViewerTest.gpsCallback,
    ),
  ).toBeNull();
});

/** The names of the station-content groups in the fake scene. */
function contentGroups(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourViewerTest.fakeScene.children
      .map((c) => c.name)
      .filter((n) => n.startsWith("station-content:")),
  );
}

test("only the present station's content stands in the scene: walking from the gate to the well fades the one out, then the other in", async ({
  page,
}) => {
  // Why this test matters (visitor plan 2026-10-18-2349 §3, M2): a long
  // tour draws only the station the visitor stands at. The walk crosses
  // from the gate's radius into the well's; a sampler in the page records
  // every station group in the scene and its opacity, so a switch that
  // mounts both at once, pops without a fade, or leaves the gate behind
  // fails here through the real page.
  await startTheTour(page);
  await standAt(page, 0, 0, 0);
  await lockTheCode(page);
  await expect
    .poll(() => contentGroups(page))
    .toEqual(["station-content:gate"]);

  // From here the walk is by GPS: the code is out of sight.
  await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.nextDetection = null;
    t.contentSamples = [];
    // No XR frames run under the fakes: camera frames advance the fades.
    t.contentSampler = setInterval(() => {
      t.emitFrames(1);
      t.contentSamples.push(
        t.fakeScene.children
          .filter((c) => c.name.startsWith("station-content:"))
          .map((g) => {
            let opacity = null;
            g.traverse((o) => {
              if (opacity === null && o.material) opacity = o.material.opacity;
            });
            return [g.name, opacity];
          }),
      );
    }, 16);
  });
  for (let m = 5, s = 1; m <= 30; m += 5, s += 1) await standAt(page, m, 0, s);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const t = /** @type {any} */ (window).__tourViewerTest;
        return t.contentSamples.at(-1);
      }),
    )
    .toEqual([["station-content:well", 1]]);
  const samples = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    clearInterval(t.contentSampler);
    return t.contentSamples;
  });
  // One station's group at a time, every sample.
  expect(samples.every((s) => s.length <= 1)).toBe(true);
  const fading = (name) =>
    samples.findIndex(
      (s) =>
        s[0]?.[0] === name && s[0][1] !== null && s[0][1] > 0 && s[0][1] < 1,
    );
  // The gate faded out, the well faded in, and in that order.
  expect(fading("station-content:gate")).toBeGreaterThanOrEqual(0);
  expect(fading("station-content:well")).toBeGreaterThan(
    fading("station-content:gate"),
  );
  const lastGate = samples.findLastIndex(
    (s) => s[0]?.[0] === "station-content:gate",
  );
  const firstWell = samples.findIndex(
    (s) => s[0]?.[0] === "station-content:well",
  );
  expect(firstWell).toBeGreaterThan(lastGate);
});

test("?allstations=1 shows every station's content at once", async ({
  page,
}) => {
  // Why this test matters: the test switch is how a creator checks a whole
  // tour on site; without it only the present station's content shows.
  await page.goto(`/?qr=${encodeURIComponent(STATIONS_ARCHIVE)}&allstations=1`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await seedAlignment(page);
  await standAt(page, 0, 0, 0);
  await lockTheCode(page);
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
      });
      return (await contentGroups(page)).sort();
    })
    .toEqual(["station-content:gate", "station-content:well"]);
});
