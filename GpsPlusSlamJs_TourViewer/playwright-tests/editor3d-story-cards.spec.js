// @ts-check
import { expect, test } from "@playwright/test";

import { answerHosts, openSampleIn3d } from "./editor3d-fixture.js";

/**
 * Why these tests matter: a story's steps are cards in its inspector, and
 * the way a creator builds a branching story is the cards, the add menu,
 * a choice's jump pickers and the preview working together on the real
 * page: a choice whose answer goes back must read "goes back to step 1"
 * on its card, one that ends "ends the story", and the preview must play
 * the story through the visitor's own panel, the jump back and the end
 * included. A desktop opens a card in place; a phone drills into the
 * step. Both sizes are pinned, as the cards and the preview differ there.
 */

// One after another: software-drawn 3D views share the CPU badly.
test.describe.configure({ mode: "default" });

/** @param {import("@playwright/test").Page} page */
function tourNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/** @param {import("@playwright/test").Page} page */
function selected(page) {
  return page.evaluate(
    () => /** @type {any} */ (window).__tourEditor.selected?.() ?? null,
  );
}

const SIZES = [
  { name: "a desktop", width: 1280, height: 800, phone: false },
  { name: "a phone", width: 390, height: 844, phone: true },
];

for (const size of SIZES) {
  test(`on ${size.name} a two-step story with a jump back and an end is built in its cards and previewed`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: size.width, height: size.height });
    await answerHosts(page);
    await openSampleIn3d(page);
    const inspector = page.locator("#shell-inspector");
    const menu = page.locator("#tree-add-menu");
    const back = page.locator('#shell-inspector [data-act="back"]');

    // A story in the old gate, named in its inspector.
    await page
      .locator("#shell-tree .card", { hasText: "The old gate" })
      .locator(".pick")
      .click();
    await inspector.locator('[data-act="add-content"]').click();
    await menu.locator('[data-kind="story"]').click();
    const name = inspector.locator('[data-field="story-title"]');
    await expect(name).toBeFocused();
    await name.fill("The legend");
    await name.press("Enter");
    await expect(inspector.locator(".scards > .note")).toContainText(
      "This story has no steps yet.",
    );

    // Step 1, a long text; Back comes up to the story again.
    await inspector.locator('[data-act="add-entry"]').click();
    await menu.locator('[data-kind="longText"]').click();
    await expect(inspector.locator(".sub")).toHaveText("Long text, entry 1");
    // The way up shows on every size: Back, and the crumb's levels.
    await expect(back).toBeVisible();
    await expect(
      inspector.locator(".crumbs button", { hasText: "The legend" }),
    ).toBeVisible();
    await back.click();
    await expect(inspector.locator(".scard")).toHaveCount(1);

    // Step 2, a choice: its first answer goes back to step 1, its second
    // ends the story.
    await inspector.locator('[data-act="add-entry"]').click();
    await menu.locator('[data-kind="choice"]').click();
    const pickers = inspector.locator('select[data-act^="step-goto:"]');
    await expect(pickers).toHaveCount(2);
    const toStep1 = await pickers
      .nth(0)
      .locator("option", { hasText: "Go back to step 1" })
      .getAttribute("value");
    expect(toStep1).not.toBeNull();
    await pickers.nth(0).selectOption(toStep1 ?? "");
    await pickers.nth(1).selectOption({ label: "End the story" });
    await expect
      .poll(async () => {
        const gate = (await tourNow(page)).stations.find(
          (/** @type {any} */ s) => s.id === "gate",
        );
        const story = gate.children.find(
          (/** @type {any} */ c) => c.title === "The legend",
        );
        return story?.children[1]?.options.map(
          (/** @type {any} */ o) => o.goto ?? (o.end === true ? "end" : null),
        );
      })
      .toEqual([toStep1, "end"]);
    await back.click();

    // The story's cards say where each answer leads.
    const cards = inspector.locator(".scard");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(1).locator(".kindtag")).toHaveText("Asks");
    await expect(cards.nth(1).locator(".jump")).toHaveText([
      "goes back to step 1",
      "ends the story",
    ]);
    await expect(inspector.locator(".scard.bad")).toHaveCount(0);
    // The cards sit inside the details with a margin on both sides.
    const panel = await inspector.boundingBox();
    const first = await cards.nth(0).boundingBox();
    expect(panel).not.toBeNull();
    expect(first).not.toBeNull();
    if (panel !== null && first !== null) {
      expect(first.x - panel.x).toBeGreaterThanOrEqual(8);
      expect(
        panel.x + panel.width - (first.x + first.width),
      ).toBeGreaterThanOrEqual(8);
    }

    // A card opens in place on a desktop; on a phone it is the step.
    const storyId = await selected(page);
    await cards.nth(1).locator(".chead").click();
    if (size.phone) {
      await expect(inspector.locator(".sub")).toContainText("Choice");
      await back.click();
      expect(await selected(page)).toBe(storyId);
    } else {
      await expect(inspector.locator(".scard.open")).toHaveCount(1);
      await expect(
        inspector.locator(".scard.open select[data-act^='step-goto:']"),
      ).toHaveCount(2);
      expect(await selected(page)).toBe(storyId);
      await cards.nth(1).locator(".chead").click();
      await expect(inspector.locator(".scard.open")).toHaveCount(0);
    }

    // The preview plays it through the visitor's panel: step 1, the
    // choice, the jump back to step 1, the choice again, the end.
    await inspector.locator('[data-act="preview-story"]').click();
    const preview = page.getByRole("dialog", { name: "Preview: The legend" });
    await expect(preview).toBeVisible();
    const goOn = preview.getByRole("button", { name: "Continue" });
    const answers = preview.locator(".choices button");
    const step1 = preview.locator(".text");
    const body = await step1.textContent();
    expect(body?.trim()).not.toBe("");
    await goOn.click();
    await expect(answers).toHaveCount(2);
    await answers.nth(0).click();
    await expect(step1).toHaveText(body ?? "");
    await goOn.click();
    await answers.nth(1).click();
    await expect(preview.getByText("The story has ended.")).toBeVisible();
    // The dialog stays inside the window, whole on a phone.
    const box = await preview.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
      if (size.phone) expect(box.width).toBeCloseTo(size.width, 0);
    }
    // Nothing of the editor covers it: its Close is what a tap there hits.
    const close = preview.getByRole("button", { name: "Close" });
    expect(
      await close.evaluate((b) => {
        const r = b.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b
        );
      }),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
    await expect(inspector.locator('[data-act="preview-story"]')).toBeFocused();
    expect(await selected(page)).toBe(storyId);
  });
}
