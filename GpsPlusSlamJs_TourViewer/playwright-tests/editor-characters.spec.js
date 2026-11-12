// @ts-check
import { expect, test } from "@playwright/test";

import { makeCharacter } from "./character-sheet.js";
import { fileCommand } from "./editor-menus.js";
import { editorTour, openThroughChooser } from "./editor-tours.js";

/**
 * Why these tests matter: the editor's Characters list is where a creator
 * takes a character from this device into the tour, and gets rid of one
 * again. What the unit tests replace - the maker's library in the
 * origin-private file system, the native modal dialog, a real file input,
 * the list's own toasts over the editor - only meets in the page. These
 * make a character on the maker's own page, open a tour in the editor and
 * take him in from the list: the in-progress label and the final words,
 * a remove with its Undo, a refused import. A layout pin per viewport
 * keeps the arrangement chosen in the prototype
 * (`public/prototypes/character-library-1/index.html`): a sheet at the
 * right on a desktop, the whole screen with a centred column on a phone.
 *
 * They run with no 3D view (WebGL refused before the page loads), as the
 * File menu and the list do not depend on it; the add menu's walk, which
 * needs the tree, is in `editor3d-characters.spec.js`.
 */

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone sideways", width: 844, height: 390 },
  { name: "desktop", width: 1440, height: 900 },
];

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // @ts-expect-error - the e2e takes the picker away on purpose.
    delete window.showOpenFilePicker;
    const real = HTMLCanvasElement.prototype.getContext;
    /** @type {any} */ (HTMLCanvasElement.prototype).getContext = function (
      /** @type {string} */ kind,
      /** @type {unknown[]} */ ...rest
    ) {
      return kind.startsWith("webgl") ? null : real.call(this, kind, ...rest);
    };
  });
});

/** Records every label a button shows, so a short in-progress label that
 *  is gone before an assertion could look is still seen.
 *  @param {import("@playwright/test").Page} page @param {string} selector */
async function recordLabels(page, selector) {
  await page.evaluate((sel) => {
    const el = /** @type {HTMLElement} */ (document.querySelector(sel));
    const seen = [el.textContent?.trim() ?? ""];
    new MutationObserver(() => seen.push(el.textContent?.trim() ?? "")).observe(
      el,
      { childList: true, characterData: true, subtree: true },
    );
    /** @type {any} */ (window).__labels = seen;
  }, selector);
}

/** A tour open in the editor, with the Characters list shown.
 *  @param {import("@playwright/test").Page} page */
async function openList(page) {
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#view3d-failed")).toBeVisible();
  await fileCommand(page, "characters");
  await expect(page.locator("#characters-panel")).toBeVisible();
  await expect(page.locator("#characters-lib-status")).toContainText(
    "looked when this list opened",
  );
}

test("the list takes a character from this device into the tour, removes him with an Undo, and refuses a JPEG", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/characters.html");
  await page.locator("#makeBtn").click();
  await makeCharacter(page, page, "Ranger Rita");

  await openList(page);
  await expect(page.locator("#characters-tour li.empty-line")).toBeVisible();
  const row = page.locator("#characters-lib li", { hasText: "Ranger Rita" });
  await expect(row.locator("img.thumb")).toHaveAttribute(
    "src",
    /^(data|blob):/,
  );

  // Add to tour: "Adding..." while his pictures are copied in, then said.
  await recordLabels(page, "#characters-lib li [data-add]");
  await row.locator("[data-add]").click();
  await expect(page.locator("#characters-toasts")).toContainText(
    "Ranger Rita is in this tour now",
  );
  expect(
    await page.evaluate(() => /** @type {any} */ (window).__labels),
  ).toContain("Adding...");
  await expect(page.locator("#characters-tour li")).toHaveCount(1);
  await expect(page.locator("#characters-tour li")).toContainText(
    "Ranger Rita",
  );
  await expect(row).toContainText("In this tour");
  const declared = () =>
    page.evaluate(() =>
      /** @type {any} */ (window.__tourEditor.manifest().characters ?? []).map(
        (/** @type {any} */ c) => c.name,
      ),
    );
  expect(await declared()).toEqual(["Ranger Rita"]);

  // Remove, then Undo: he is back as he was.
  await page.locator("#characters-tour [data-remove]").click();
  await expect(page.locator("#characters-undo")).toContainText(
    "Ranger Rita is no longer in this tour. It stays on this device.",
  );
  expect(await declared()).toEqual([]);
  await page.locator("#characters-undo button", { hasText: "Undo" }).click();
  await expect(page.locator("#characters-tour li")).toContainText(
    "Ranger Rita",
  );
  expect(await declared()).toEqual(["Ranger Rita"]);

  // A JPEG is refused in words, and nothing changes.
  await page.locator("#characters-import-file").setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]),
  });
  await expect(page.locator("#characters-import-error")).toBeVisible();
  await expect(page.locator("#characters-import-error")).toContainText(
    "Nothing was added.",
  );
  await expect(page.locator("#characters-import")).toBeEnabled();
  expect(await declared()).toEqual(["Ranger Rita"]);

  // Closed by its button: the editor's own controls come back.
  await page.locator("#characters-close").click();
  await expect(page.locator("#characters-panel")).toBeHidden();
  expect(errors).toEqual([]);
});

// Why: a font wider than the one the layout was checked with (another
// system's sans) must wrap the list's words, never widen its column past
// the window and push the buttons and the time of the last look off the
// screen. Spaced-out letters stand in for the wider font on every system.
test("the list's column keeps inside a phone's window in a wider font", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openList(page);
  await page.addStyleTag({
    content: "#characters-panel * { letter-spacing: 0.12em !important; }",
  });
  const out = await page.evaluate(() => {
    const panel = /** @type {HTMLElement} */ (
      document.querySelector("#characters-panel")
    );
    const style = getComputedStyle(panel);
    const left = parseFloat(style.paddingLeft);
    const right = panel.clientWidth - parseFloat(style.paddingRight);
    return [...panel.children]
      .filter((child) => child.getBoundingClientRect().width > 0)
      .map((child) => {
        const b = child.getBoundingClientRect();
        return {
          what: `${child.tagName}#${child.id}.${String(child.className)}`,
          x: b.x,
          end: b.x + b.width,
        };
      })
      .filter((b) => b.x < left - 0.5 || b.end > right + 0.5)
      .map(
        (b) =>
          `${b.what} ${String(Math.round(b.x))}-${String(Math.round(b.end))} outside ${String(left)}-${String(right)}`,
      );
  });
  expect(out).toEqual([]);
});

for (const vp of VIEWPORTS) {
  test(`the list keeps the prototype's arrangement on a ${vp.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openList(page);
    /** @param {string} selector */
    const box = async (selector) => {
      const b = await page.locator(selector).boundingBox();
      if (b === null) throw new Error(`${selector} is not laid out`);
      return b;
    };
    const panel = await box("#characters-panel");
    const close = await box("#characters-close");
    const title = await box("#characters-title");
    const tour = await box("#characters-tour");
    const lib = await box("#characters-lib");
    const make = await box("#characters-make");
    const imp = await box("#characters-import");

    // The whole height of the window, never wider than it.
    expect(panel.y).toBeLessThan(1);
    expect(panel.height).toBeGreaterThan(vp.height - 2);
    expect(panel.x + panel.width).toBeLessThan(vp.width + 1);
    if (vp.name === "desktop") {
      // A sheet at the right edge, the editor visible beside it.
      expect(panel.x + panel.width).toBeGreaterThan(vp.width - 1);
      expect(panel.width).toBeLessThan(vp.width / 2);
    } else {
      // The whole screen, its column at most 640 px and centred.
      expect(panel.x).toBeLessThan(1);
      expect(panel.width).toBeGreaterThan(vp.width - 2);
      expect(title.width).toBeLessThan(641);
      const left = title.x;
      const right = vp.width - (title.x + title.width);
      expect(Math.abs(left - right)).toBeLessThan(2);
    }
    // The close button in the top right corner of the column, above the
    // title; the tour's list above the device's; the two buttons on one
    // line under the device's list, "Make a character" first.
    expect(close.y + close.height).toBeLessThanOrEqual(title.y + 1);
    expect(close.x + close.width).toBeGreaterThan(
      title.x + title.width - close.width,
    );
    expect(tour.y + tour.height).toBeLessThan(lib.y);
    expect(make.y).toBeGreaterThan(lib.y + lib.height - 1);
    expect(Math.abs(make.y - imp.y)).toBeLessThan(2);
    expect(imp.x).toBeGreaterThan(make.x + make.width);
    // The gap between them: the prototype's 10 px row gap.
    expect(Math.round(imp.x - (make.x + make.width))).toBe(10);
    // "Make a character" starts at the column's left edge, as the title.
    expect(Math.abs(make.x - title.x)).toBeLessThan(2);
    // The section heads in the panel's own type, as the prototype's.
    const fonts = await page.evaluate(() => {
      const head = document.querySelector("#characters-panel h3");
      const panel = document.querySelector("#characters-panel");
      if (!head || !panel) return null;
      return [
        getComputedStyle(head).fontFamily,
        getComputedStyle(panel).fontFamily,
      ];
    });
    expect(fonts?.[0]).toBe(fonts?.[1]);
  });
}

// Why: the list's two buttons are one line in the prototype, and a wider
// system font (Linux's, measured in CI) put "Import character..." under
// "Make a character", on a phone and in the desktop's sheet alike.
// Widened letters stand in for any wider font.
for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
  if (vp === undefined) throw new Error("no viewport");
  test(`the list keeps its two buttons on one line with a wider font on a ${vp.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openList(page);
    await page.addStyleTag({
      content: "#characters-make, #characters-import { letter-spacing: 6px; }",
    });
    const make = await page.locator("#characters-make").boundingBox();
    const imp = await page.locator("#characters-import").boundingBox();
    const title = await page.locator("#characters-title").boundingBox();
    if (make === null || imp === null || title === null) {
      throw new Error("not laid out");
    }
    expect(Math.abs(make.y - imp.y)).toBeLessThan(2);
    expect(Math.abs(make.height - imp.height)).toBeLessThan(2);
    expect(Math.round(imp.x - (make.x + make.width))).toBe(10);
    expect(imp.x + imp.width).toBeLessThan(title.x + title.width + 1);
  });
}
