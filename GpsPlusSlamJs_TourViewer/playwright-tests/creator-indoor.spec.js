// @ts-check
import { expect, test } from "@playwright/test";

import {
  downloadedZip,
  finishAndDownload,
  installTourViewerArFakes,
  measureWithGpsFirst,
  openFixtureTour,
} from "./ar-fakes.js";
import { E2E_QR_TEXT } from "./qr-fixture.mjs";

/**
 * A creator indoors, without GPS, at a tour that already stores a code.
 * Why these tests matter: the unit tests prove each piece - which visits
 * vote, the placement gate, the quality counts, the start without location
 * - but only the composed page shows that a creator with no fix can reach a
 * placed pin through the REAL vote path the visitor uses, and that the
 * written pin then sits where the stored code puts it. A creator outdoors
 * - a fix before the code, or within the visit's wait for one - is every
 * other creator spec: there the page's timers fire only on demand, so that
 * wait never runs out.
 */

/** The fakes' control surface on `window` (ar-fakes.js). */
const TEST_KEY = "__tourViewerTest";
/** The fixture tour's stored code position (archive-server.mjs). */
const CODE_GEO = { lat: 47.5001, lon: 8.7001 };
/** A tour without a code (archive-server.mjs). */
const PLAIN_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/plain-tour.zip";
/** The line of a visit the stored code lines up (`qr-author-mode.ts`). */
const CODE_PLACES = /The tour's code places you/;

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/**
 * The location the fakes report: `permission` is what the browser's query
 * answers, `request` what the controller's location request comes back
 * with (`granted: null` is a phone that allowed location and gets no fix).
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ permission: string, request: { supported: boolean, granted: boolean | null } }} location
 */
async function locationIs(page, location) {
  await page.addInitScript(
    ({ location, key }) => {
      const t = /** @type {any} */ (window)[key];
      if (t) {
        t.locationPermission = location.permission;
        t.controllerLocationResult = location.request;
      }
    },
    { location, key: TEST_KEY },
  );
}

/** Feed camera frames with the code in view until the panel's line reads
 *  `line`. */
async function lookUntil(page, line) {
  await expect
    .poll(
      async () => {
        await page.evaluate((key) => {
          /** @type {any} */ (window)[key].emitFrames(1);
        }, TEST_KEY);
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 20000 },
    )
    .toMatch(line);
}

/**
 * A visit started with location and no fix yet: it first waits for one,
 * placing nothing, and the stored code lines it up only when that wait
 * runs out without a fix (the page's timers, fired here by hand).
 *
 * @param {import("@playwright/test").Page} page
 */
async function noFixInTime(page) {
  await lookUntil(page, /waiting for GPS alignment/);
  await expect(page.getByTestId("setup-pin")).toBeDisabled();
  await page.evaluate((key) => {
    /** @type {any} */ (window)[key].fireTimers();
  }, TEST_KEY);
}

/** @param {import("@playwright/test").Page} page */
async function armTheCode(page) {
  await page.evaluate(
    ({ text, key }) => {
      /** @type {any} */ (window)[key].armQrDetection(text);
    },
    { text: E2E_QR_TEXT, key: TEST_KEY },
  );
}

/** What the controller's location side did in this page. */
function locationUse(page) {
  return page.evaluate((key) => {
    const t = /** @type {any} */ (window)[key];
    return {
      permissionRequests: t.geolocationPermissionRequests,
      gpsWatch: t.gpsCallback !== null,
    };
  }, TEST_KEY);
}

/** @param {import("@playwright/test").Page} page */
async function openPlainTour(page) {
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(PLAIN_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  const step = page.getByTestId("step-measure");
  if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
    await page.getByTestId("station-measure").click();
  }
}

test("a creator with location allowed but no fix is lined up by the tour's stored code, and the pin placed then keeps its place relative to the code", async ({
  page,
}) => {
  await locationIs(page, {
    permission: "prompt",
    request: { supported: true, granted: null },
  });
  await openFixtureTour(page);
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await expect(button).toHaveText("Done");
  // Started WITH location: the GPS watch runs, it only never reports.
  expect((await locationUse(page)).gpsWatch).toBe(true);

  await armTheCode(page);
  await noFixInTime(page);
  await lookUntil(page, CODE_PLACES);
  // Placing is open on the code's votes alone - and the line still says
  // that a NEW code needs GPS.
  await expect(page.getByTestId("setup-status")).toContainText(/0 of 3 fixes/);
  await expect(page.getByTestId("setup-pin")).toBeEnabled();
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Placed indoors");
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );

  await finishAndDownload(page, 0);
  const zip = await downloadedZip(page, 0);
  const pin = zip.manifest.objects.find(
    (o) => o.kind === "pin" && o.label === "Placed indoors",
  );
  expect(pin).toBeDefined();
  // The code's votes set the session zero at the code's stored spot and
  // line the visit up on its stored pose, so the reticle (3 m north, 2 m
  // west in the session's GPS world) puts the pin that far from the STORED
  // code: north of it and west of it, hypot(3, 2) m away.
  const metresPerDegLat = 111_195.08;
  const metresPerDegLon =
    metresPerDegLat * Math.cos((CODE_GEO.lat * Math.PI) / 180);
  const north = ((pin?.geo.lat ?? 0) - CODE_GEO.lat) * metresPerDegLat;
  const east = ((pin?.geo.lon ?? 0) - CODE_GEO.lon) * metresPerDegLon;
  expect(Math.hypot(north, east)).toBeCloseTo(Math.hypot(3, 2), 1);
  expect(north).toBeGreaterThan(0);
  expect(east).toBeLessThan(0);
});

test("a creator whose location is refused starts on the tour's stored code: no location request, no GPS watch, and the code opens placing", async ({
  page,
}) => {
  await locationIs(page, {
    permission: "denied",
    request: { supported: true, granted: false },
  });
  await openFixtureTour(page);
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await expect(button).toHaveText("Done");
  expect(await locationUse(page)).toEqual({
    permissionRequests: 0,
    gpsWatch: false,
  });
  await armTheCode(page);
  await lookUntil(page, CODE_PLACES);
  await expect(page.getByTestId("setup-pin")).toBeEnabled();
});

test("a creator who blocks the location prompt at a tour with a stored code is told to try again on the code, and the next try starts without location", async ({
  page,
}) => {
  await locationIs(page, {
    permission: "prompt",
    request: { supported: true, granted: false },
  });
  await openFixtureTour(page);
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await expect(button).toHaveText("Try again");
  await expect(page.getByTestId("ar-status")).toContainText(
    "Tap Try again to start on the tour's printed code instead.",
  );
  await button.click();
  await expect(button).toHaveText("Done");
  // The one request was the refused prompt; the second start asked nothing.
  expect(await locationUse(page)).toEqual({
    permissionRequests: 1,
    gpsWatch: false,
  });
});

test("a creator whose location is refused at a tour with no measured code is told to step outside for a first fix", async ({
  page,
}) => {
  await locationIs(page, {
    permission: "denied",
    request: { supported: true, granted: false },
  });
  await openPlainTour(page);
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await expect(button).toHaveText("Try again");
  await expect(page.getByTestId("ar-status")).toContainText(
    "This tour has no measured code to start from without GPS: allow location for this page, then step outside for a first GPS fix.",
  );
  // No start without location: the request was made and refused.
  expect(await locationUse(page)).toEqual({
    permissionRequests: 1,
    gpsWatch: false,
  });
});

test("a code measured in an earlier visit and not yet saved lines up the next visit without GPS", async ({
  page,
}) => {
  // The code exists only in this device's code book: the plain tour
  // stores none, and no Finish ran between the visits.
  await openPlainTour(page);
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await measureWithGpsFirst(page);
  // The visit ends without a Finish (the back gesture).
  await page.evaluate((key) => {
    /** @type {any} */ (window)[key].endXrSession();
  }, TEST_KEY);
  await expect(button).toHaveText("Start creating", { timeout: 10000 });

  // The next visit has no fix: the stored history ended with the last one.
  await button.click();
  await expect(button).toHaveText("Done");
  await armTheCode(page);
  await noFixInTime(page);
  await lookUntil(page, CODE_PLACES);
  await expect(page.getByTestId("setup-pin")).toBeEnabled();
});
