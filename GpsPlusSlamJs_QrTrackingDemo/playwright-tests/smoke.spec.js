import { test, expect } from "./e2e-test.js";

/**
 * Tier 0 smoke: the page loads without console errors and the desktop
 * capability gate fires honestly (Playwright Chromium has no `navigator.xr`),
 * blocking with a message instead of crashing. No fakes installed here — this
 * exercises the REAL capability path.
 */
test.describe("QR-tracking demo — capability gate", () => {
  test("loads and gates WebXR-less desktop without crashing", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    // The intro renders.
    await expect(page.getByTestId("start-screen")).toBeVisible();

    // No WebXR on desktop → the gate disables Start and surfaces a message.
    await expect(page.getByTestId("start-button")).toBeDisabled();
    const message = page.getByTestId("capability-message");
    await expect(message).toBeVisible();
    await expect(message).toContainText("WebXR");

    expect(errors, `page errors: ${errors.join(", ")}`).toHaveLength(0);
  });
});
