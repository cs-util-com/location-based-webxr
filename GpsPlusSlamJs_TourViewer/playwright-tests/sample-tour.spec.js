// @ts-check
import { expect, test } from "@playwright/test";

import {
  installTourViewerArFakes,
  seedAlignment,
  standAt,
} from "./ar-fakes.js";

/**
 * The committed sample tour (`public/samples/marienplatz-tour.zip`, owner
 * decision S-D9) with the test switch `?relocate=here`: the tour sits at
 * Marienplatz in Munich, and the switch moves its stations to the phone's
 * first GPS fix, so the owner can try stations wherever they are without a
 * private location in the public repository.
 */

const SAMPLE_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/sample-tour.zip";

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

test("the sample tour, moved to the phone, offers its first station about 15 m away and says it was moved", async ({
  page,
}) => {
  // Why this test matters: the owner's first phone test of stations runs
  // through exactly this link. Without the move, a visitor anywhere but
  // Munich sees "The column" hundreds of kilometres away; with a broken
  // move, the note never shows or the stations stay where they were.
  await page.goto(`/?qr=${encodeURIComponent(SAMPLE_ARCHIVE)}&relocate=here`);
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 15000 });
  await button.click();
  // The seeded fixes start at (47.5, 8.7): the phone's first fix.
  await seedAlignment(page);
  // The phone stands at the zero: its fix and its AR pose agree.
  await standAt(page, 0, 0, 0);

  await expect(page.getByTestId("relocate-note")).toBeVisible({
    timeout: 15000,
  });
  const line = page.getByTestId("station-line");
  await expect(line).toHaveText(/^Next: The column, (1[0-9]|2[0-5]) m$/, {
    timeout: 15000,
  });
});

test("without the switch, the sample tour stays at Marienplatz, far from the phone", async ({
  page,
}) => {
  // Why this test matters: the move is test-only and must never happen on
  // its own; a visitor of a real tour gets the stations where they were put.
  await page.goto(`/?qr=${encodeURIComponent(SAMPLE_ARCHIVE)}`);
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 15000 });
  await button.click();
  await seedAlignment(page);
  // The phone stands at the zero: its fix and its AR pose agree.
  await standAt(page, 0, 0, 0);
  const line = page.getByTestId("station-line");
  // The fakes' zero is near Zurich: Marienplatz is about 230 km away.
  await expect(line).toHaveText(/^Next: The column, [\d.]+ km$/, {
    timeout: 15000,
  });
  await expect(page.getByTestId("relocate-note")).toBeHidden();
});
