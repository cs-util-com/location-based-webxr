// @ts-check
import { expect, test } from "@playwright/test";

import { answerHosts, capture, openZip } from "./editor3d-fixture.js";
import { stationBlocks } from "./tour-fixture.mjs";

/**
 * Why these tests matter: a picture's views are picked in the item
 * inspector, and the views seen from a viewpoint (then and now, sharpen,
 * viewer, finder, window) only work with a viewpoint: switching to one
 * must stand a viewpoint in front of the picture, its typed values must
 * reach the tour as one step each, it must survive a switch between those
 * views, and "Stand in front of it again" must give a fresh one. Only the
 * page shows the chips, the shell's typed fields, the session and the
 * tour document working together, at a desktop and on a phone's side.
 * With PLAYWRIGHT_CAPTURE=1 it also shoots the prototype and the build at
 * each size, for the side-by-side check.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

const PHOTO = "gate-photo";
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "sideways", width: 844, height: 390 },
];
/** The chips of the viewpoint views and the format's names for them. */
const VIEWPOINT_CHIPS = [
  ["Then and now", "thenNow"],
  ["Sharpen", "sharpen"],
  ["Viewer", "viewer"],
  ["Finder", "finder"],
  ["Window", "window"],
];
/** The prototype's names for the same views. */
const PROTOTYPE_VIEWS = {
  thenNow: "then-now",
  sharpen: "viewpoint-sharpen",
  viewer: "viewer",
  finder: "viewpoint-finder",
  window: "viewpoint-window",
};
const SHOTS = process.env.PICTURE_SHOTS_DIR ?? "test-results/picture-shots";

/**
 * The photo as the tour has it.
 * @param {import("@playwright/test").Page} page
 */
async function photoNow(page) {
  const tour = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
  for (const station of tour.stations) {
    const block = stationBlocks(station).find(
      (/** @type {any} */ b) => b.id === PHOTO,
    );
    if (block !== undefined) return block;
  }
  return null;
}

/** @param {import("@playwright/test").Page} page */
function selected(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.selected(),
  );
}

/**
 * The blocks tour open in the 3D view at `size`, its photo selected.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function openWithPhoto(page, size) {
  const zip = Buffer.from(
    await (
      await fetch("http://127.0.0.1:5197/ranges-ok/blocks-tour.zip")
    ).arrayBuffer(),
  );
  await page.context().addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await page.setViewportSize(size);
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, zip, "blocks-tour.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  const card = page.locator('#tree-body .card[data-station="gate"]');
  await card.locator(".pick").click();
  await expect.poll(() => selected(page)).toBe("station:gate");
  await card.locator(`[data-select="${PHOTO}"]`).click();
  await expect.poll(() => selected(page)).toBe(PHOTO);
}

for (const size of SIZES) {
  test(`every picture view is picked in the inspector, and a viewpoint view gets a viewpoint that is typed and kept (${size.name})`, async ({
    page,
  }) => {
    test.slow();
    await openWithPhoto(page, size);
    const inspector = page.locator("#shell-inspector");
    const chip = (/** @type {string} */ name) =>
      inspector.getByRole("button", { name, exact: true });

    // The standing views write their view and carry no viewpoint fields.
    for (const [name, view] of [
      ["Framed", "framed"],
      ["Cut-out", "cutout"],
      ["Plane", "plane"],
    ]) {
      await chip(name).click();
      await expect.poll(async () => (await photoNow(page))?.view).toBe(view);
      await expect(chip(name)).toHaveAttribute("aria-pressed", "true");
      await expect(inspector.getByLabel("Lens", { exact: true })).toHaveCount(
        0,
      );
    }

    // The first viewpoint view stands a viewpoint in front of the picture.
    await chip("Then and now").click();
    await expect
      .poll(async () => (await photoNow(page))?.viewpoint?.hfovDeg)
      .toBe(56);
    expect((await photoNow(page))?.view).toBe("thenNow");
    const lens = inspector.getByLabel("Lens", { exact: true });
    await expect(lens).toHaveValue("56.0");
    // A typed value reaches the tour as one step.
    const before = await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.editor().revision(),
    );
    await lens.fill("40");
    await lens.press("Enter");
    await expect
      .poll(async () => (await photoNow(page))?.viewpoint?.hfovDeg)
      .toBe(40);
    expect(
      await page.evaluate(() =>
        /** @type {any} */ (window).__tourEditor.editor().revision(),
      ),
    ).toBe(before + 1);
    const north = inspector.getByLabel("North", { exact: true });
    await north.fill("12");
    await north.press("Enter");
    await expect
      .poll(async () => (await photoNow(page))?.viewpoint?.position[0])
      .toBe(12);

    // Every other viewpoint view keeps it.
    for (const [name, view] of VIEWPOINT_CHIPS.slice(1)) {
      await chip(name).click();
      await expect.poll(async () => (await photoNow(page))?.view).toBe(view);
      expect((await photoNow(page))?.viewpoint?.hfovDeg).toBe(40);
      await expect(inspector.getByLabel("Lens", { exact: true })).toHaveValue(
        "40.0",
      );
    }

    // A fresh one stands in front of the picture again.
    await inspector
      .getByRole("button", { name: "Stand in front of it again" })
      .click();
    await expect
      .poll(async () => (await photoNow(page))?.viewpoint?.hfovDeg)
      .toBe(56);
  });
}

test("the prototype and the build, side by side, per viewpoint view and size", async ({
  page,
}) => {
  // Only for the check by eye: the shots are what is read.
  test.skip(process.env.PLAYWRIGHT_CAPTURE !== "1", "capture only");
  test.setTimeout(600_000);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const [, view] of VIEWPOINT_CHIPS) {
      await page.goto(
        `/prototypes/station-blocks-3-pictures/index.html#mode=editor&view=${/** @type {Record<string, string>} */ (PROTOTYPE_VIEWS)[view]}`,
      );
      await page.waitForLoadState("load");
      await capture(page, `${SHOTS}/${size.name}-${view}-prototype.png`);
    }
  }
  for (const size of SIZES) {
    await openWithPhoto(page, size);
    const inspector = page.locator("#shell-inspector");
    for (const [name, view] of VIEWPOINT_CHIPS) {
      await inspector.getByRole("button", { name, exact: true }).click();
      await expect.poll(async () => (await photoNow(page))?.view).toBe(view);
      await capture(page, `${SHOTS}/${size.name}-${view}-build.png`);
    }
  }
});
