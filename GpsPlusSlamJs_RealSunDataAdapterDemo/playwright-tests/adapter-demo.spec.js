import { test, expect } from "@playwright/test";

// Browser-boundary emulation; the page still uses the real framework GPS wrapper
// and production adapter. This is not outdoor GPS or Task 1 recording evidence.
async function emulateGps(page, mode = "success") {
  await page.addInitScript(
    ({ mode }) => {
      let serial = 0;
      const callbacks = new Map();
      window.demoGps = {
        active: callbacks,
        emit(lat, lon) {
          for (const { success } of callbacks.values())
            success({
              timestamp: Date.now() - 2000,
              coords: {
                latitude: lat,
                longitude: lon,
                accuracy: 7,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
            });
        },
        fail(code) {
          for (const { error } of callbacks.values())
            error({ code, message: "Emulated GPS error" });
        },
      };
      if (mode === "unsupported") {
        Object.defineProperty(navigator, "geolocation", {
          configurable: true,
          value: undefined,
        });
        return;
      }
      navigator.geolocation.watchPosition = (success, error) => {
        const id = ++serial;
        callbacks.set(id, { success, error });
        queueMicrotask(() => {
          if (mode === "success") window.demoGps.emit(51.05, 13.74);
          if (mode === "denied") window.demoGps.fail(1);
        });
        return id;
      };
      navigator.geolocation.clearWatch = (id) => callbacks.delete(id);
    },
    { mode },
  );
}

async function state(page) {
  return JSON.parse(await page.locator("#raw-state").textContent());
}

test("four independent combinations, background GPS and one watch", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await emulateGps(page);
  await page.goto("/");
  await expect(page.locator("#status")).toHaveAttribute("data-status", "ready");
  expect((await state(page)).sample).toMatchObject({
    locationSource: "live",
    timeSource: "real",
    latitudeDeg: 51.05,
  });
  await page.locator("#location-source").selectOption("fixed");
  expect((await state(page)).sample).toMatchObject({
    locationSource: "fixed",
    timeSource: "real",
    latitudeDeg: 52.52,
  });
  await page.evaluate(() => window.demoGps.emit(48.1, 11.5));
  expect((await state(page)).sample.latitudeDeg).toBe(52.52);
  await page.locator("#time-source").selectOption("fixed");
  expect((await state(page)).sample).toMatchObject({
    locationSource: "fixed",
    timeSource: "fixed",
  });
  await page.locator("#location-source").selectOption("live");
  expect((await state(page)).sample).toMatchObject({
    locationSource: "live",
    timeSource: "fixed",
    latitudeDeg: 48.1,
  });
  await page.locator("#time-source").selectOption("real");
  expect((await state(page)).sample).toMatchObject({
    locationSource: "live",
    timeSource: "real",
  });
  expect(await page.evaluate(() => window.demoGps.active.size)).toBe(1);
  await page.locator("#start-gps").click();
  expect(await page.evaluate(() => window.demoGps.active.size)).toBe(1);
  await page.locator("#stop-gps").click();
  await expect(page.locator("#status")).toHaveAttribute(
    "data-status",
    "waiting-for-location",
  );
  expect(await page.evaluate(() => window.demoGps.active.size)).toBe(0);
  expect(errors).toEqual([]);
});

test("UTC edits, slider and repeatable atomic example", async ({ page }) => {
  await emulateGps(page, "waiting");
  await page.goto("/");
  await page.locator("#apply-pair").click();
  const original = await state(page);
  expect(original.sample.sunTimeMs).toBe(Date.parse("2026-06-21T12:00:00Z"));
  await page.locator("#instant").fill("2026-06-21T14:00:00+02:00");
  expect(await state(page)).toEqual(original);
  await page.locator("#time-slider").fill("0");
  expect((await state(page)).sample.sunTimeMs).toBe(
    Date.parse("2026-06-21T00:00:00Z"),
  );
  expect((await state(page)).sample.sun.isAboveHorizon).toBe(false);
  await page.locator("#utc-day").fill("2026-12-21");
  await page.locator("#utc-day").dispatchEvent("change");
  expect((await state(page)).sample.sunTimeMs).toBe(
    Date.parse("2026-12-21T00:00:00Z"),
  );
  await page.locator("#apply-pair").click();
  expect(await state(page)).toEqual(original);
  await page.locator("#refresh").click();
  expect(await state(page)).toEqual(original);
  await page.screenshot({
    path: test.info().outputPath("fixed-pair.png"),
    fullPage: true,
  });
});

test("invalid controls do not fall back silently and can recover", async ({
  page,
}) => {
  await emulateGps(page);
  await page.goto("/");
  await page.locator("#latitude").fill("91");
  await expect(page.locator("#status")).toHaveAttribute(
    "data-status",
    "invalid-input",
  );
  await expect(page.locator("#result")).toBeHidden();
  await page.locator("#latitude").fill("0");
  await page.locator("#longitude").fill("0");
  expect((await state(page)).sample.latitudeDeg).toBe(0);
  await page.locator("#instant").fill("2026-02-30T12:00:00Z");
  await expect(page.locator("#time-error")).toBeVisible();
  expect(await state(page)).toEqual({
    status: "invalid-input",
    reason: "time",
  });
  await page.locator("#instant").fill("2026-06-21T12:00");
  await expect(page.locator("#status")).toHaveAttribute(
    "data-status",
    "invalid-input",
  );
  await page.locator("#time-source").selectOption("real");
  await expect(page.locator("#time-error")).toBeHidden();
  await expect(page.locator("#status")).toHaveAttribute("data-status", "ready");
});

for (const mode of ["waiting", "denied", "unsupported"]) {
  test(`${mode} GPS has a working desktop/manual path`, async ({ page }) => {
    await emulateGps(page, mode);
    await page.goto("/");
    await expect(page.locator("#status")).toHaveAttribute(
      "data-status",
      "waiting-for-location",
    );
    await expect(page.locator("#gps-status")).toContainText(
      mode === "denied"
        ? "Permission denied"
        : mode === "unsupported"
          ? "GPS unavailable"
          : "waiting for a location",
    );
    await page.locator("#apply-pair").click();
    await expect(page.locator("#status")).toHaveAttribute(
      "data-status",
      "ready",
    );
    expect((await state(page)).sample).toMatchObject({
      locationSource: "fixed",
      timeSource: "fixed",
    });
  });
}

test("GPS failure clears stale live output; a subsequent fix recovers", async ({
  page,
}) => {
  await emulateGps(page);
  await page.goto("/");
  await expect(page.locator("#status")).toHaveAttribute("data-status", "ready");
  await page.evaluate(() => window.demoGps.fail(3));
  await expect(page.locator("#gps-status")).toContainText("GPS timed out");
  await expect(page.locator("#result")).toBeHidden();
  await page.evaluate(() => window.demoGps.emit(0, 0));
  expect((await state(page)).sample.latitudeDeg).toBe(0);
});

test("host refresh advances only real time; navigation releases GPS", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-16T12:00:00Z") });
  // Freeze before startup so browser actions cannot add wall-clock drift.
  await page.clock.pauseAt(new Date("2026-09-16T12:01:00Z"));
  await emulateGps(page);
  await page.goto("/");
  await expect(page.locator("#status")).toHaveAttribute("data-status", "ready");
  const first = (await state(page)).sample.sunTimeMs;
  await page.clock.fastForward(30000);
  expect((await state(page)).sample.sunTimeMs).toBe(first + 30000);
  await page.locator("#time-source").selectOption("fixed");
  const fixed = await state(page);
  await page.clock.fastForward(60000);
  expect(await state(page)).toEqual(fixed);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(await page.evaluate(() => window.demoGps.active.size)).toBe(0);
});

test("controls and readouts fit a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await emulateGps(page, "denied");
  await page.goto("/");
  await page.locator("#apply-pair").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#sources")).toHaveText(
    "Fixed location + fixed time",
  );
  await page.screenshot({
    path: test.info().outputPath("mobile.png"),
    fullPage: true,
  });
});
