// @ts-check
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";

import { answerHosts, openZip } from "./editor3d-fixture.js";

/**
 * Why these tests matter: a long text is written in the 3D view's
 * inspector, as the owner chose from the "in the inspector" prototype
 * (`public/prototypes/longtext-editor-1-in-the-inspector/`): a view
 * picker, a toolbar over a plain text area, the parts a visitor sees as
 * typed underlined and counted, and a phone over the 3D view showing the
 * visitor's own reading sheet as the creator types. Only a browser shows
 * the writer, the shell, the session and the sheet in its frame working
 * together, and only a browser lays them out: the app's design system
 * zeroes paragraph and list margins, so a port can lose every gap and
 * still pass a test that asks whether things are visible. The layout test
 * pins positions and gaps from the prototype's CSS numbers (not from the
 * code under test) at three desktop sizes, and leaves screenshots of the
 * prototype and the build side by side for the check by eye.
 */

test.describe.configure({ mode: "default" });

const TOUR = "http://127.0.0.1:5197/ranges-ok/long-text-tour.zip";
const PROTOTYPE = "/prototypes/longtext-editor-1-in-the-inspector/index.html";

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
];

/** @param {import("@playwright/test").Page} page */
function tourNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/** @param {import("@playwright/test").Page} page */
async function essayNow(page) {
  const tour = await tourNow(page);
  const gate = tour.stations.find((/** @type {any} */ s) => s.id === "gate");
  return gate.blocks.find((/** @type {any} */ b) => b.id === "gate-essay");
}

/**
 * The editor with the long text tour open in the 3D view and its essay
 * selected.
 * @param {import("@playwright/test").Page} page
 */
async function openEssay(page) {
  await page.context().addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  const zip = Buffer.from(await (await fetch(TOUR)).arrayBuffer());
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, zip, "long-text-tour.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  // Selecting the station opens its items in the tree.
  await page.locator('#tree-body .card[data-station="gate"] .pick').click();
  await page
    .locator('#tree-body .card[data-station="gate"] [data-select="gate-essay"]')
    .click();
  await expect(page.getByTestId("long-text-writer")).toBeVisible();
}

/**
 * The preview's frame: the visitor's sheet inside it.
 * @param {import("@playwright/test").Page} page
 */
function sheet(page) {
  return page.frameLocator('[data-testid="long-text-preview"] iframe');
}

test("a long text is written in the inspector: one save per pause, the preview follows, the view is picked, and a part shown as typed is made plain", async ({
  page,
}) => {
  test.slow();
  await openEssay(page);
  const area = page.getByTestId("long-text-writer");
  await expect(area).toHaveValue(
    "The gate was built in 1400.\n\nIt was rebuilt later.",
  );
  // The visitor's sheet in the phone shows the text.
  await expect(sheet(page).getByTestId("long-text-text")).toContainText(
    "The gate was built in 1400.",
  );

  // Typing is saved after a pause, as one change of the tour.
  await area.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\n- one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await expect(area).toHaveValue(
    "The gate was built in 1400.\n\nIt was rebuilt later.\n\n- one\n- two",
  );
  await expect(page.locator(".lw-save")).toHaveText("Saved");
  await expect
    .poll(async () => (await essayNow(page))?.body)
    .toBe(
      "The gate was built in 1400.\n\nIt was rebuilt later.\n\n- one\n- two",
    );
  await expect(
    sheet(page).locator('[data-testid="long-text-text"] li'),
  ).toHaveCount(2);

  // Bold by its shortcut, through the browser's editing (Ctrl+Z undoes it).
  await area.evaluate((/** @type {HTMLTextAreaElement} */ t) => {
    t.setSelectionRange(4, 8);
  });
  await page.keyboard.press("Control+b");
  await expect(area).toHaveValue(/^The \*\*gate\*\* was/);
  await page.keyboard.press("Control+z");
  await expect(area).toHaveValue(/^The gate was/);

  // A part shown as typed: a code mark, counted and made plain.
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\nUse `code` here.");
  const chip = page.locator('[data-lw="parts"]');
  await expect(chip).toContainText("1");
  await chip.click();
  await page.locator('[data-lw="part:0"]').click();
  const callout = page.locator(".lw-callout");
  await expect(callout).toBeVisible();
  await page.locator('[data-lw="part-fix"]').click();
  await expect(area).toHaveValue(/Use code here\.$/);
  await expect(chip).not.toHaveClass(/has/);

  // Esc stays in the writer (the page's Esc would deselect the text), and
  // Esc then Tab, or Shift+Tab, leaves it without touching the text. The
  // caret stands on a list line, where Tab and Shift+Tab would otherwise
  // indent or outdent it, so the steps fail if Esc stops counting.
  const typed = await area.inputValue();
  const onListLine = () =>
    area.evaluate((/** @type {HTMLTextAreaElement} */ t) => {
      const at = t.value.indexOf("- two") + 3;
      t.setSelectionRange(at, at);
    });
  await area.focus();
  await onListLine();
  await page.keyboard.press("Escape");
  await expect(area).toBeVisible();
  await expect(area).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(area).not.toBeFocused();
  await area.focus();
  await onListLine();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Tab");
  await expect(area).not.toBeFocused();
  await expect(area).toHaveValue(typed);

  // The view picker: Screen only is the visitor's choice, explained and
  // never written; Captions offers a narration.
  const view = (/** @type {string} */ id) =>
    page.locator(`[data-lw="view:${id}"]`);
  await expect(view("reading")).toHaveAttribute("aria-checked", "true");
  // Dimmed choices stay focusable and explain themselves (aria-disabled,
  // which Playwright reads as not enabled: clicked regardless).
  await view("silent").click({ force: true });
  await expect(page.locator(".lw-vdesc")).not.toBeEmpty();
  await view("captions").click({ force: true });
  await page.locator('[data-lw="add-narration"]').click();
  await expect(page.locator('[data-lw="narration"]')).toBeFocused();
  expect((await essayNow(page))?.view).toBe("reading");

  // Wider, and the preview shut and opened again from the head.
  const inspector = page.locator("#shell-inspector");
  const narrow = (await inspector.boundingBox())?.width ?? 0;
  await page.locator('#inspector-head [data-act="lt-wide"]').click();
  await expect
    .poll(async () => (await inspector.boundingBox())?.width ?? 0)
    .toBeGreaterThan(narrow + 100);
  await page.locator('#inspector-head [data-act="lt-preview"]').click();
  await expect(page.getByTestId("long-text-preview")).toBeHidden();
  await page.getByTestId("long-text-preview-open").click();
  await expect(page.getByTestId("long-text-preview")).toBeVisible();
});

/**
 * The writer's boxes at one window size, by the prototype's measures.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function expectWriterLayout(page, size) {
  const at = `at ${String(size.width)}x${String(size.height)}`;
  const box = async (/** @type {import("@playwright/test").Locator} */ l) => {
    const b = await l.boundingBox();
    if (b === null) throw new Error(`not shown ${at}`);
    return b;
  };
  const dock = await box(page.locator("#shell-inspector"));
  // 360 px wide, 340 px at a window of 1100 px or less.
  expect(dock.width, at).toBe(size.width <= 1100 ? 340 : 360);
  expect(dock.x + dock.width, at).toBeLessThanOrEqual(size.width);
  // The view picker: three equal segments, 26 px high, 2 px inside the
  // group's padding and its 1 px border.
  const group = await box(page.locator(".lw-seg3"));
  const segs = await page.locator(".lw-seg3 button").all();
  expect(segs.length, at).toBe(3);
  const s0 = await box(segs[0]);
  const s2 = await box(segs[2]);
  expect(s0.height, at).toBe(26);
  expect(s0.x - group.x, at).toBe(3);
  expect(Math.abs(s0.width - s2.width), at).toBeLessThanOrEqual(1);
  // The toolbar: 24 px buttons, 1 px apart, under the "Text" line.
  const tools = await page.locator(".lw-tools .lw-wb").all();
  expect(tools.length, at).toBe(11);
  const b0 = await box(tools[0]);
  const b1 = await box(tools[1]);
  expect([b0.width, b0.height], at).toEqual([24, 24]);
  expect(b1.x - (b0.x + b0.width), at).toBe(1);
  const slab = await box(page.locator(".lw-wsec > .lw-slab"));
  expect(b0.y - (slab.y + slab.height), at).toBe(3);
  // The writer 5 px under the toolbar, as wide as its section, the mirror
  // exactly under the text area (the caret stays on its letter).
  const writer = await box(page.locator(".lw-writer"));
  expect(writer.y - (b0.y + b0.height), at).toBe(5);
  const area = await box(page.getByTestId("long-text-writer"));
  const mirror = await box(page.locator(".lw-mirror"));
  expect([mirror.x, mirror.y, mirror.width], at).toEqual([
    area.x,
    area.y,
    area.width,
  ]);
  // The inspector takes its full height (from the accent line under the
  // top bar down to the bottom bar) and the writer fills it: nothing in
  // the inspector's body is left over under its last part (the item's
  // actions and Position). In a window too short for that, the writer
  // section keeps its least height (280 px) and the body scrolls to the
  // rest. The docks hang from the line (`--s-dock-top` in
  // `editor-shell.css`), which comes off the height, so it is read from
  // the page rather than assumed.
  const allowed = await page
    .locator("#shell-inspector")
    .evaluate(
      (e) =>
        (e.parentElement?.clientHeight ?? 0) -
        (Number.parseFloat(getComputedStyle(e).top) || 0),
    );
  expect(Math.abs(dock.height - allowed), at).toBeLessThanOrEqual(1);
  const fit = await page.locator("#shell-inspector .dbody").evaluate((b) => {
    const last = b.lastElementChild;
    const pad = Number.parseFloat(getComputedStyle(b).paddingBottom) || 0;
    return {
      overflow: b.scrollHeight - b.clientHeight,
      slack:
        b.getBoundingClientRect().bottom -
        pad -
        (last?.getBoundingClientRect().bottom ?? 0),
    };
  });
  if (size.height >= 900) expect(fit.overflow, at).toBeLessThanOrEqual(1);
  if (fit.overflow > 1) {
    const wsec = await box(page.locator(".lw-wsec"));
    expect(Math.round(wsec.height), at).toBe(280);
  } else {
    expect(Math.abs(fit.slack), at).toBeLessThanOrEqual(1);
  }
  expect(writer.height, at).toBeGreaterThanOrEqual(150);
  // The stat line under the writer, inside the dock.
  const stat = await box(page.locator(".lw-stat"));
  expect(stat.y, at).toBeGreaterThanOrEqual(writer.y + writer.height);
  expect(stat.y + stat.height, at).toBeLessThanOrEqual(dock.y + dock.height);
  // The preview: 14 px left of the dock, 10 px under the 3D view's top,
  // clear of the tree, the phone in the 390:844 shape and at most 760 px
  // high.
  const view = await box(page.locator("#view3d"));
  const pv = await box(page.getByTestId("long-text-preview"));
  expect(Math.round(dock.x - (pv.x + pv.width)), at).toBe(14);
  expect(Math.round(pv.y - view.y), at).toBe(10);
  const tree = await box(page.locator("#shell-tree"));
  expect(pv.x, at).toBeGreaterThanOrEqual(tree.x + tree.width + 10 - 0.5);
  const phone = await box(page.locator(".lw-phone"));
  expect(Math.abs(phone.width / phone.height - 390 / 844), at).toBeLessThan(
    0.01,
  );
  expect(phone.height, at).toBeLessThanOrEqual(760 + 0.5);
  expect(phone.y + phone.height, at).toBeLessThanOrEqual(view.y + view.height);
}

test("words typed just before Ctrl+S are in the saved tour", async ({
  page,
}) => {
  // Why: the writer writes its text into the tour only after a pause in
  // typing; a save inside that pause must commit it first (the save's
  // flush of the shell), or the file is saved without the last words, or
  // not at all ("Nothing to save").
  test.slow();
  await openEssay(page);
  const area = page.getByTestId("long-text-writer");
  await area.click();
  await page.keyboard.press("Control+End");
  const download = page.waitForEvent("download");
  await page.keyboard.type(" Saved at once.");
  await page.keyboard.press("Control+s");
  const zip = readFileSync(await (await download).path());
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)));
  const entry = (await reader.getEntries()).find(
    (e) => e.filename === "tour.json",
  );
  const tour = JSON.parse((await entry?.getData?.(new TextWriter())) ?? "{}");
  await reader.close();
  const gate = tour.stations.find((/** @type {any} */ s) => s.id === "gate");
  const essay = gate.blocks.find(
    (/** @type {any} */ b) => b.id === "gate-essay",
  );
  expect(essay.body).toMatch(/ Saved at once\.$/);
});

test("the writer and the preview sit in place at 1440x900, 1280x720 and 1024x768, beside the prototype", async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  await openEssay(page);
  const proto = await context.newPage();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    // The inspector eases to its width, and the preview lays itself out
    // from a resize observer once it has.
    await expect
      .poll(
        async () =>
          (await page.locator("#shell-inspector").boundingBox())?.width ?? 0,
      )
      .toBe(size.width <= 1100 ? 340 : 360);
    await expect
      .poll(async () => {
        const d = await page.locator("#shell-inspector").boundingBox();
        const p = await page.getByTestId("long-text-preview").boundingBox();
        return d !== null && p !== null
          ? Math.round(d.x - (p.x + p.width))
          : -1;
      })
      .toBe(14);
    await expectWriterLayout(page, size);
    const name = `${String(size.width)}x${String(size.height)}`;
    await page.screenshot({ path: testInfo.outputPath(`build-${name}.png`) });
    await proto.setViewportSize(size);
    await proto.goto(PROTOTYPE);
    await proto.locator("#wta").waitFor({ state: "visible" });
    await proto.screenshot({
      path: testInfo.outputPath(`prototype-${name}.png`),
    });
  }
  await proto.close();
});
