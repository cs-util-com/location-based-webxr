// @ts-check
import { expect, test } from "@playwright/test";

import {
  answerHosts,
  capture,
  keepRejections,
  openSampleIn3d,
  rejections,
  showList,
} from "./editor3d-fixture.js";
import { stationBlocks } from "./tour-fixture.mjs";

/**
 * Why these tests matter: a short text laid on the ground as an arrow gets
 * its style, its floor placement, its caption on the arrow, its colours
 * and its bend from the inspector alone, and the sun check warns of a
 * pale colour the moment it is picked. Only the page shows the panel, the
 * edit store and the 3D view working together. Each control is found by
 * its role and its name, as a creator (and a screen reader) finds it, on
 * a desktop and on a phone on its side, and must write exactly its own
 * field. Where it points is typed in three boxes, picked with a click in
 * the 3D view or dragged by its handle there, and cleared; a value the
 * format refuses is said once, and the point is kept.
 */

// One worker for the file: software-drawn 3D views side by side are
// several times slower than one after another.
test.describe.configure({ mode: "default" });

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 844, height: 390 },
];

/**
 * The tour's blocks, each with its station's id.
 * @param {import("@playwright/test").Page} page
 */
async function blocksNow(page) {
  const tour = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
  return tour.stations.flatMap((/** @type {any} */ station) =>
    stationBlocks(station).map((/** @type {any} */ block) => ({
      block,
      station: station.id,
    })),
  );
}

/**
 * The short text `id` as the tour has it now.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function shortTextNow(page, id) {
  const found = (await blocksNow(page)).find((b) => b.block.id === id);
  return found?.block ?? null;
}

/**
 * Where the 3D view draws gizmo part `part`, on the page, once it shows.
 * @param {import("@playwright/test").Page} page
 * @param {"middle" | "point"} part
 */
async function partOnPage(page, part) {
  /** @type {[number, number] | null} */
  let at = null;
  await expect
    .poll(async () => {
      at = await page.evaluate(
        (p) => /** @type {any} */ (window).__tourEditor.view3dHandle(p),
        part,
      );
      return at;
    })
    .not.toBeNull();
  const canvas = await page.locator("#view3d canvas").boundingBox();
  if (at === null || canvas === null) throw new Error("no gizmo on screen");
  return { x: canvas.x + at[0], y: canvas.y + at[1] };
}

/**
 * A chip of the inspector's group `group`, by its name.
 * @param {import("@playwright/test").Page} page
 * @param {string} group
 * @param {string} name
 */
function chip(page, group, name) {
  return page
    .locator("#shell-inspector")
    .getByRole("group", { name: group })
    .getByRole("button", { name, exact: true });
}

for (const viewport of VIEWPORTS) {
  const size = `${String(viewport.width)}x${String(viewport.height)}`;
  test(`a short text becomes a ground arrow with its own look, at ${size}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await keepRejections(page);
    await answerHosts(page);
    await openSampleIn3d(page);
    const first = (await blocksNow(page)).find(
      (b) => b.block.kind === "shortText",
    );
    if (first === undefined) throw new Error("the sample has no short text");
    const { block, station } = first;
    const row = page.locator(`#tree-body [data-select="${block.id}"]`);
    if (!(await row.isVisible())) {
      await page
        .locator(`#tree-body [data-select="station:${station}"]`)
        .click();
      // A phone shows the station's details in the list's place.
      await showList(page);
    }
    await row.click();
    const inspector = page.locator("#shell-inspector");

    // On the ground: the ribbon by default, with its turn and its bend.
    await chip(page, "Shows as", "Ground arrow").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.view)
      .toBe("ground");
    await expect(chip(page, "Ground style", "Ribbon")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(inspector.getByRole("group", { name: "Turns" })).toHaveCount(
      1,
    );

    // A floor arrow standing upright, its caption on it.
    await chip(page, "Ground style", "Floor arrow").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.style)
      .toBe("floor");
    await chip(page, "Floor arrow", "Upright").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.floorPlacement)
      .toBe("upright");
    await inspector
      .getByRole("checkbox", { name: "Caption on the arrow" })
      .check();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.captionOnArrow)
      .toBe(true);

    // Vanes, its rim pale: the sun check warns at once.
    await chip(page, "Ground style", "Vanes").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.style)
      .toBe("vanes");
    await expect(
      inspector.getByRole("checkbox", { name: "Caption on the arrow" }),
    ).toHaveCount(0);
    await inspector.getByLabel("Rim colour").fill("#eeeeee");
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.darkColor)
      .toBe("#eeeeee");
    await expect(inspector.getByText(/^Sun warning/)).toBeVisible();

    // The role's colours back: both colours gone from the file.
    await inspector.getByRole("button", { name: "Role colours" }).click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.darkColor)
      .toBeUndefined();
    await expect(inspector.getByText(/^Sun check/)).toBeVisible();

    // Bent 25 degrees to the right, typed.
    const bend = inspector.getByLabel("Bend", { exact: true });
    await bend.fill("25");
    await bend.press("Enter");
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.bendDeg)
      .toBe(25);

    // Pointed at a spot 10 m on, typed in its three boxes; a box that is
    // no number is refused in words once (Enter, then leaving the box),
    // and the point is kept.
    const pointTo = (/** @type {string} */ axis) =>
      inspector.getByLabel(`Points to ${axis}`, { exact: true });
    await expect(inspector.getByText("none", { exact: true })).toBeVisible();
    await pointTo("x").fill("2");
    await pointTo("y").fill("0");
    await pointTo("z").fill("-10");
    await pointTo("z").press("Enter");
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.pointsTo)
      .toEqual([2, 0, -10]);
    await expect(pointTo("z")).toHaveValue("-10");
    const pointRefusals = page.locator(".toast", {
      hasText: "three numbers in metres",
    });
    await pointTo("y").fill("abc");
    await pointTo("y").press("Enter");
    await pointTo("y").press("Tab");
    await expect(pointRefusals).toHaveCount(1);
    expect((await shortTextNow(page, block.id))?.pointsTo).toEqual([2, 0, -10]);

    // "Pick in 3D" shows that it waits, and Escape lets it go again with
    // the selection kept.
    const pick = inspector.getByRole("button", { name: "Pick in 3D" });
    await pick.click();
    const picking = inspector.getByRole("button", {
      name: /^Click the ground or an item/,
    });
    await expect(picking).toHaveAttribute("aria-pressed", "true");
    await expect(inspector.getByText("Esc cancels.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pick).toHaveAttribute("aria-pressed", "false");
    expect(
      await page.evaluate(() =>
        /** @type {any} */ (window).__tourEditor.selected(),
      ),
    ).toBe(block.id);

    // Cleared: the file loses the point, and the handle goes.
    await inspector.getByRole("button", { name: "Clear", exact: true }).click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.pointsTo)
      .toBeUndefined();
    await expect(pointTo("x")).toHaveValue("");
    await expect(
      inspector.getByRole("button", { name: "Clear", exact: true }),
    ).toBeDisabled();

    // Picked on the ground just in front of the arrow: the point is set
    // in the station's frame and the pick ends.
    // The point's refusal toast lingers over the 3D view (6 s) and takes a
    // click meant for the ground on a phone on its side: it goes first.
    await expect(pointRefusals).toHaveCount(0, { timeout: 15_000 });
    const middle = await partOnPage(page, "middle");
    await pick.click();
    await expect(picking).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(middle.x, middle.y + 40);
    await expect(pick).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.pointsTo)
      .toHaveLength(3);
    const picked = (await shortTextNow(page, block.id)).pointsTo;

    // Dragged by its handle: it moves on its own level, its height kept.
    const knob = await partOnPage(page, "point");
    await page.mouse.move(knob.x, knob.y);
    await page.mouse.down();
    await page.mouse.move(knob.x + 30, knob.y + 10, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.pointsTo)
      .not.toEqual(picked);
    const dragged = (await shortTextNow(page, block.id)).pointsTo;
    expect(dragged[1]).toBeCloseTo(picked[1], 1);
    await expect(pointTo("x")).toHaveValue(String(dragged[0]));

    // Its language, as a tag; a tag the format refuses is said once.
    const lang = inspector.getByLabel("Language", { exact: true });
    await lang.fill("english!");
    await lang.press("Enter");
    await lang.press("Tab");
    await expect(
      page.locator(".toast", { hasText: "A language is a tag" }),
    ).toHaveCount(1);
    await lang.fill("de");
    await lang.press("Enter");
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.lang)
      .toBe("de");

    const after = await shortTextNow(page, block.id);
    expect(after.caption).toBe(block.caption);
    await capture(page, `test-results/ground-arrow-${size}.png`);
    expect(await rejections(page)).toEqual([]);
  });
}
