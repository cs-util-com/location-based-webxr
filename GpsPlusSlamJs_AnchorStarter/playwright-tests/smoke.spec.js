import { test, expect } from "./e2e-test.js";

/**
 * Tier 0 smoke + capability-gate e2e for the persistent-anchor starter.
 *
 * Why this suite matters (see
 * GpsPlusSlamJs_Docs/docs/2026-06-01-0447-anchor-starter-e2e-test-plan.md §6 Tier 0):
 * The only honest contract that e2e — and nothing else — can prove for a
 * desktop visitor is the E1 capability gate: a browser without WebXR
 * (Playwright Chromium has no `navigator.xr`) must show a clear, non-empty
 * message and a disabled Start button instead of crashing. It also locks the
 * static start/guidance/placement panel visibility on boot and that the page
 * loads with no unexpected console errors. No mocking/seam is required because
 * real Chromium genuinely lacks WebXR — exactly the state we want to verify.
 *
 * WebXR/GPS-related diagnostics are expected here and are filtered out; any
 * other console error or page error fails the load test, mirroring the
 * recorder's smoke gate.
 */

/** WebXR/GPS diagnostics are expected on desktop and must not fail the test. */
const isExpectedCapabilityNoise = (text) => {
  const lower = text.toLowerCase();
  return (
    lower.includes("webxr") ||
    lower.includes("xr") ||
    lower.includes("geolocation") ||
    lower.includes("immersive-ar")
  );
};

test.describe("Anchor starter — Tier 0 smoke & capability gate", () => {
  test("loads without unexpected console errors", async ({ page }) => {
    const consoleIssues = [];
    const pageErrors = [];

    page.on("console", (message) => {
      const type = message.type();
      const text = message.text();
      if (type === "error" && !isExpectedCapabilityNoise(text)) {
        consoleIssues.push({ type, text });
      }
    });
    page.on("pageerror", (error) => {
      if (!isExpectedCapabilityNoise(error.message)) {
        pageErrors.push(error.message);
      }
    });

    const response = await page.goto("/");
    expect(response, "Expected a valid response").not.toBeNull();
    if (response) {
      expect
        .soft(response.status(), "Expected a successful status code")
        .toBeLessThan(400);
    }

    // The start screen is the first thing the app reveals once booted.
    await page.getByTestId("start-screen").waitFor({ state: "visible" });

    expect(consoleIssues, "Unexpected console errors detected").toEqual([]);
    expect(pageErrors, "Unexpected page errors detected").toEqual([]);
  });

  test("renders the start screen and intro copy", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("start-screen")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Persistent GPS anchor" }),
    ).toBeVisible();
    await expect(page.getByTestId("start-button")).toBeVisible();
  });

  test("keeps the live guidance and placement panels hidden on boot", async ({
    page,
  }) => {
    await page.goto("/");

    // Until the user taps Start (and AR boots), the live HUD stays hidden.
    await expect(page.getByTestId("guidance")).toBeHidden();
    await expect(page.getByTestId("placement")).toBeHidden();
  });

  test("fires the E1 capability gate when WebXR is unavailable", async ({
    page,
  }) => {
    await page.goto("/");

    // Playwright Chromium has no WebXR, so `isFullySupported` is false and the
    // start button must be disabled rather than letting the user start a
    // session that would crash.
    const startButton = page.getByTestId("start-button");
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeDisabled();

    // The capability message must be revealed and name the missing WebXR
    // capability so the user understands *why* the demo cannot run.
    const message = page.getByTestId("capability-message");
    await expect(message).toBeVisible();
    await expect(message).toContainText("WebXR");
    await expect(message).toContainText(/AR-capable phone/i);
  });
});
