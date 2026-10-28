// @ts-check
import { expect, test } from "@playwright/test";
import {
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  SQUARE_GROUND_M,
  afterFrames,
  answerHosts,
  openSampleIn3d,
  openZip,
  view3d,
} from "./editor3d-fixture.js";
import { save } from "./editor-menus.js";
import { useWideFont } from "./wide-font.js";

/**
 * Why these tests matter: the tree is where a creator shapes the tour -
 * adds a station, puts the stations in the order a visitor walks them,
 * copies one, deletes one - and each of these must reach the tour as ONE
 * step (one undo), be saved and come back on the next open. Only the page
 * shows whether the tree's buttons, its drag, the scene's ground menu, the
 * store and the save work together. These open the sample tour in the 3D
 * view and drive the tree as a creator does; copy a station with a photo,
 * save it and open the saved file; and pin the tree's new controls in
 * place at a phone, a phone in landscape, a tablet and a desktop.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

/** The geoid's N at the square (m): the file's heights are ellipsoidal. */
const N_M = 45.68;

/** @param {import("@playwright/test").Page} page */
function tourNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/**
 * The tour's station ids, in its order.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
async function order(page) {
  const tour = await tourNow(page);
  return tour.stations.map((/** @type {any} */ s) => s.id);
}

/**
 * Wait until the camera has stopped moving: the screen point of
 * `selection` is the same two frames apart. The orbit keeps a pan's
 * momentum after the drag and spends it a share per frame (OrbitControls'
 * damping counts frames, not time), so on a slow renderer a fixed number
 * of frames after a drag can leave the camera still coasting - and then
 * a point pressed now is no longer under the same pixel a moment later.
 * @param {import("@playwright/test").Page} page
 * @param {string} selection
 */
async function cameraSettled(page, selection) {
  /** @type {readonly number[] | null} */
  let last = null;
  await expect
    .poll(
      async () => {
        await afterFrames(page, 2);
        const now = await page.evaluate(
          (id) => /** @type {any} */ (window).__tourEditor.view3dScreenOf(id),
          selection,
        );
        const still =
          last !== null &&
          now !== null &&
          Math.hypot(now[0] - last[0], now[1] - last[1]) < 0.05;
        last = now;
        return still;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

/** @param {import("@playwright/test").Page} page */
function revision(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.editor().revision(),
  );
}

/** @param {import("@playwright/test").Page} page */
function selected(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.selected(),
  );
}

/**
 * A station's card in the tree.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
function card(page, id) {
  return page.locator(`#tree-body .card[data-station="${id}"]`);
}

/** @param {import("@playwright/test").Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no box: the element is not shown");
  return b;
}

/**
 * Drag a station's card by its grip to the lower half of another's.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @param {string} below
 */
async function dragBelow(page, id, below) {
  const grip = await box(card(page, id).locator(".grip"));
  const onto = await box(card(page, below));
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height * 0.8, {
    steps: 6,
  });
}

test("the tree adds, reorders and deletes stations, each one step to undo", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await afterFrames(page, 3);
  expect(await order(page)).toEqual(["column", "gate", "steps"]);

  // "+": a station at the centre of the view, selected and said.
  const start = await revision(page);
  await page.locator("#tree-add").click();
  await expect.poll(async () => (await order(page)).length).toBe(4);
  const added = (await order(page))[3] ?? "";
  expect(await selected(page)).toBe(`station:${added}`);
  await expect(
    page.locator(".toast", {
      hasText: 'Added "Station 4" at the centre of the view',
    }),
  ).toBeVisible();
  await expect(card(page, added)).toBeVisible();
  expect(await revision(page)).toBe(start + 1);
  // Made here, so it starts unlocked: placing it is what comes next.
  await expect(
    page.locator("#shell-inspector [data-act='lock']"),
  ).toHaveAttribute("aria-pressed", "false");
  // Where the camera looks: under the orbit's centre.
  const stats = await view3d(page);
  const point = await page.evaluate(
    (id) => /** @type {any} */ (window).__tourEditor.view3dPointOf(id),
    `station:${added}`,
  );
  expect(
    Math.hypot(point[0] - stats.target[0], point[2] - stats.target[2]),
  ).toBeLessThan(0.5);
  await page.keyboard.press("Control+z");
  await expect.poll(() => order(page)).toEqual(["column", "gate", "steps"]);
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(() => order(page))
    .toEqual(["column", "gate", "steps", added]);
  // The undo dropped the selection with the station; select it again.
  await card(page, added).locator(".pick").click();
  expect(await selected(page)).toBe(`station:${added}`);

  // A drag by the grip: shown where it lands, then one reorder.
  const beforeDrag = await revision(page);
  await dragBelow(page, "column", "gate");
  await expect(card(page, "column")).toHaveClass(/dragging/);
  await expect(card(page, "steps")).toHaveClass(/drop-before/);
  await page.mouse.up();
  await expect
    .poll(() => order(page))
    .toEqual(["gate", "column", "steps", added]);
  expect(await revision(page)).toBe(beforeDrag + 1);
  await expect(page.locator("#tree-body .dragging")).toHaveCount(0);
  // A drag selects nothing and drops nothing of the selection.
  expect(await selected(page)).toBe(`station:${added}`);
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => order(page))
    .toEqual(["column", "gate", "steps", added]);

  // Escape drops a drag, writing nothing.
  await dragBelow(page, "column", "steps");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await order(page)).toEqual(["column", "gate", "steps", added]);
  expect(await selected(page)).toBe(`station:${added}`);

  // The inspector's Earlier and Later: the keyboard's way.
  const earlier = page.locator('#inspector-body [data-act="earlier"]');
  const later = page.locator('#inspector-body [data-act="later"]');
  await expect(later).toBeDisabled();
  await earlier.click();
  await expect
    .poll(() => order(page))
    .toEqual(["column", "gate", added, "steps"]);
  await expect(page.locator("#inspector-body .sub")).toHaveText(
    "Station 3 of 4",
  );
  // Said to a screen reader, which hears no move otherwise.
  await expect(page.locator("#shell-said")).toHaveText("Now Station 3 of 4");
  await expect(later).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => order(page))
    .toEqual(["column", "gate", "steps", added]);

  // The inspector's Delete: one step, its Undo in the toast.
  await page.locator('#inspector-body [data-act="delete"]').click();
  await expect.poll(() => order(page)).toEqual(["column", "gate", "steps"]);
  expect(await selected(page)).toBeNull();
  // The focus does not fall to the page: it goes to the card now in the
  // deleted station's place (at the end, the one before it).
  await expect(card(page, "steps").locator(".pick")).toBeFocused();
  await page
    .locator(".toast", { hasText: "Deleted" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect.poll(async () => (await order(page)).length).toBe(4);
});

test("New station here: a right click on the ground starts a station where it was pressed", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await afterFrames(page, 20);
  const canvas = await box(page.locator("#view3d canvas"));
  const at = { x: canvas.x + canvas.width / 2 + 60, y: canvas.y + 300 };
  const menu = page.locator("#scene-menu");
  const item = page.locator("#scene-new-station");

  // Escape closes it, writing nothing.
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(menu).toBeVisible();
  await expect(item).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  expect((await order(page)).length).toBe(3);

  // A right drag pans the camera: no menu after it.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(at.x + 80, at.y + 10, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await expect(menu).toBeHidden();

  // A right click without a move: the station where it was pressed. Once
  // the pan has stopped coasting: the station is placed under the pixel
  // pressed, and compared with it after the camera moved no further.
  await cameraSettled(page, `station:${(await order(page))[0] ?? ""}`);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(item).not.toHaveAttribute("aria-disabled", "true");
  await item.click();
  await expect(menu).toBeHidden();
  await expect.poll(async () => (await order(page)).length).toBe(4);
  const added = (await order(page))[3] ?? "";
  expect(await selected(page)).toBe(`station:${added}`);
  await expect(
    page.locator(".toast", { hasText: 'Added "Station 4" here' }),
  ).toBeVisible();
  await afterFrames(page, 3);
  const screen = await page.evaluate(
    (id) => /** @type {any} */ (window).__tourEditor.view3dScreenOf(id),
    `station:${added}`,
  );
  expect(Math.abs(screen[0] - (at.x - canvas.x))).toBeLessThan(4);
  expect(Math.abs(screen[1] - (at.y - canvas.y))).toBeLessThan(4);
  // On the ground: its height is the drawn ground's.
  const tour = await tourNow(page);
  expect(tour.stations[3].geo.alt).toBeCloseTo(SQUARE_GROUND_M + N_M, 0);
});

/**
 * A tour of one station with a photo (a real JPEG the browser made), as a
 * zip.
 * @param {import("@playwright/test").Page} page
 */
async function photoTour(page) {
  const jpeg = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(8, 6);
    const g = canvas.getContext("2d");
    if (g === null) throw new Error("no 2d context");
    g.fillStyle = "#c85";
    g.fillRect(0, 0, 8, 6);
    const blob = await canvas.convertToBlob({ type: "image/jpeg" });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const geo = {
    lat: 48.13725,
    lon: 11.57549,
    alt: SQUARE_GROUND_M + N_M,
    headingDeg: 0,
  };
  const manifest = {
    ...createEmptyTourManifest(),
    title: "One photo",
    assets: [{ id: "shot", path: "content/shot.jpg", width: 8, height: 6 }],
    stations: [
      {
        id: "fountain",
        title: "The fountain",
        geo,
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        steps: [],
        blocks: [
          {
            id: "shot",
            kind: "picture",
            view: "plane",
            image: "shot",
            widthM: 1,
            createdAtIso: "2026-10-25T09:00:00.000Z",
            pose: { position: [3, 1.5, 0], rotation: [0, 0, 0, 1] },
          },
        ],
      },
    ],
  };
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "tour.json",
    new TextReader(serializeTourManifest(/** @type {any} */ (manifest))),
  );
  await writer.add(
    "content/shot.jpg",
    new Uint8ArrayReader(new Uint8Array(jpeg)),
  );
  return { zip: Buffer.from(await writer.close()), jpeg };
}

/**
 * Each entry of a zip, as bytes.
 * @param {Buffer} zip
 * @returns {Promise<Map<string, Uint8Array>>}
 */
async function entries(zip) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)));
  const out = new Map();
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue;
    out.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
  }
  await reader.close();
  return out;
}

test("a station copied with its photo is saved with a picture of its own, and opens again with it", async ({
  page,
  context,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  // On the context: the page opened again later has no pickers either.
  await context.addInitScript(() => {
    // The file input opens it, and the save goes to a download.
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const { zip, jpeg } = await photoTour(page);
  await openZip(page, zip, "one-photo.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect(card(page, "fountain")).toBeVisible();
  await card(page, "fountain").locator(".pick").click();
  expect(await selected(page)).toBe("station:fountain");

  // The bottom bar's Duplicate: the copy beside it, selected, said.
  await page.locator('#shell-acts [data-bar="duplicate"]').click();
  await expect.poll(async () => (await order(page)).length).toBe(2);
  const copy = (await order(page))[1] ?? "";
  expect(await selected(page)).toBe(`station:${copy}`);
  await expect(
    page.locator(".toast", { hasText: "Duplicated The fountain" }),
  ).toBeVisible();
  await expect(
    page.locator("#shell-inspector [data-act='lock']"),
  ).toHaveAttribute("aria-pressed", "false");

  const download = page.waitForEvent("download");
  await save(page);
  const saved = await (await download).path();
  const { readFileSync } = await import("node:fs");
  const files = await entries(readFileSync(saved));
  const written = JSON.parse(
    new TextDecoder().decode(files.get("tour.json") ?? new Uint8Array()),
  );
  expect(written.stations).toHaveLength(2);
  const pictures = written.stations.map(
    (/** @type {any} */ s) =>
      written.assets.find((/** @type {any} */ a) => a.id === s.blocks[0]?.image)
        ?.path,
  );
  // Two photos, two pictures: the copy's is its own file, the same bytes.
  expect(new Set(pictures).size).toBe(2);
  for (const path of pictures) {
    expect([...(files.get(path) ?? [])]).toEqual(jpeg);
  }

  // Opened again: both cards, each with its picture.
  const next = await context.newPage();
  await next.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(next);
  await next.goto("/edit.html");
  await expect(next.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(next, readFileSync(saved), "one-photo.zip");
  await expect(next.locator("#tree-body .card")).toHaveCount(2, {
    timeout: 60_000,
  });
  for (const hero of await next.locator("#tree-body .hero").all()) {
    await expect
      .poll(() => hero.evaluate((el) => getComputedStyle(el).backgroundImage))
      .toMatch(/^url\(/);
  }
  // Nothing of the photos was lost on the way: a reader of the file
  // finds every picture it names.
  const reread = await entries(readFileSync(saved));
  for (const path of pictures) expect(reread.has(path)).toBe(true);
  const names = await new ZipReader(
    new Uint8ArrayReader(new Uint8Array(readFileSync(saved))),
  ).getEntries();
  const tourJson = names.find((e) => e.filename === "tour.json");
  expect(await tourJson?.getData(new TextWriter())).toContain(copy);
});

/**
 * The tree's head and a card's grip, and the bottom bar's actions, at one
 * window size: placed by the prototype's measures.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function expectTreeControls(page, size) {
  const at = `at ${String(size.width)}x${String(size.height)}`;
  const head = await box(page.locator("#shell-tree .dhead"));
  const add = await box(page.locator("#tree-add"));
  const fold = await box(page.locator("#tree-fold"));
  // "+" is a 26 px icon button beside the fold arrow, 6 px from it, in
  // line with it, inside the head (whose box takes a 1 px line at its foot
  // when unfolded, so its own middle is half a pixel low).
  expect(add.width, at).toBe(26);
  expect(add.height, at).toBe(26);
  expect(fold.x - (add.x + add.width), at).toBe(6);
  expect(add.y, at).toBe(fold.y);
  expect(add.height, at).toBe(fold.height);
  expect(add.y, at).toBeGreaterThanOrEqual(head.y);
  expect(add.y + add.height, at).toBeLessThanOrEqual(head.y + head.height);
  // A card's grip: in the hero, left of its fold arrow, clear of the
  // number badge.
  const hero = await box(page.locator("#tree-body .hero").first());
  const grip = await box(page.locator("#tree-body .grip").first());
  const tw = await box(page.locator("#tree-body .hero .tw").first());
  const n = await box(page.locator("#tree-body .hero .n").first());
  expect(grip.x, at).toBeGreaterThanOrEqual(n.x + n.width);
  expect(tw.x - (grip.x + grip.width), at).toBe(4);
  expect(grip.y, at).toBe(tw.y);
  expect(grip.height, at).toBe(tw.height);
  expect(grip.y + grip.height, at).toBeLessThanOrEqual(hero.y + hero.height);
}

/**
 * A tour of three stations a, b and c along the square, each with a pin
 * (pa, pb, pc), as a zip.
 */
async function threePinTour() {
  const station = (/** @type {string} */ id, /** @type {number} */ dLat) => ({
    id,
    title: `Station ${id.toUpperCase()}`,
    geo: {
      lat: 48.13725 + dLat,
      lon: 11.57549,
      alt: SQUARE_GROUND_M + N_M,
      headingDeg: 0,
    },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    blocks: [
      {
        id: `p${id}`,
        kind: "shortText",
        view: "pin",
        caption: `Pin ${id}`,
        createdAtIso: "2026-10-25T09:00:00.000Z",
        pose: { position: [2, 1.5, 0], rotation: [0, 0, 0, 1] },
      },
    ],
  });
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Three pins",
    // Its own id: a file without one is given a new id at every open.
    tourId: "0123456789abcdef0123456789abcdef",
    stations: [station("a", 0), station("b", 0.0002), station("c", 0.0004)],
  };
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "tour.json",
    new TextReader(serializeTourManifest(/** @type {any} */ (manifest))),
  );
  return Buffer.from(await writer.close());
}

// Why: the tree's commands each write the draft, and a reload must give
// the same tour back - a station added here (untitled, holding nothing),
// the order changed, an item split off into a station right after its
// own, a station deleted with its route. Each piece has unit tests
// against the reducer; only the page shows the session, the autosave and
// the restore agreeing on all of them at once.
test("add, reorder, split and delete come back whole from the draft after a reload", async ({
  page,
  context,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const zip = await threePinTour();
  await openZip(page, zip, "three-pins.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect.poll(() => order(page)).toEqual(["a", "b", "c"]);

  // Add: a station at the view's centre, selected; then one place earlier.
  await page.locator("#tree-add").click();
  await expect.poll(async () => (await order(page)).length).toBe(4);
  const added = (await order(page))[3] ?? "";
  await page.locator('#inspector-body [data-act="earlier"]').click();
  await expect.poll(() => order(page)).toEqual(["a", "b", added, "c"]);

  // Split: b's pin into a station of its own, right after b.
  await card(page, "b").locator(".tw").click();
  await card(page, "b").locator('[data-select="pb"]').click();
  await page.locator('#inspector-body [data-act="split"]').click();
  await expect.poll(async () => (await order(page)).length).toBe(5);
  const split = (await order(page))[2] ?? "";
  expect(["a", "b", added, "c"]).not.toContain(split);
  expect(await order(page)).toEqual(["a", "b", split, added, "c"]);

  // Delete: station a with its pin.
  await card(page, "a").locator(".pick").click();
  await page.locator('#inspector-body [data-act="delete"]').click();
  await expect.poll(() => order(page)).toEqual(["b", split, added, "c"]);

  await expect(page.locator("body")).toHaveAttribute("data-draft", "saved");
  const before = await tourNow(page);
  await page.close();

  const next = await context.newPage();
  await next.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(next);
  await next.goto("/edit.html");
  await expect(next.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(next, zip, "three-pins.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(offer).toHaveCount(0);
  await expect.poll(() => order(next)).toEqual(["b", split, added, "c"]);
  expect(await tourNow(next)).toEqual(before);
});

test("the tree's add, its grips and the bar's actions sit in place at a phone, a phone in landscape, a tablet and a desktop", async ({
  page,
}) => {
  test.slow();
  await useWideFont(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  // The inspector's Delete names its key as the prototype does: dim
  // letters in the row, not a keycap.
  await card(page, "gate").locator(".pick").click();
  const del = page.locator('#inspector-body [data-act="delete"] kbd');
  await expect(del).toHaveText("Del");
  expect(
    await del.evaluate((k) => {
      const s = getComputedStyle(k);
      return { background: s.backgroundColor, border: s.borderTopWidth };
    }),
  ).toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px" });
  await page.keyboard.press("Escape");
  for (const size of [
    { width: 1440, height: 900 },
    { width: 820, height: 1180 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    if (
      await page
        .locator("#shell-tree")
        .evaluate((t) => t.classList.contains("collapsed"))
    ) {
      await page.locator("#tree-fold").click();
    }
    await expectTreeControls(page, size);
    // The bar's actions follow the view line, inside the bar, each a
    // button with its words (shown, or its name where they fold away).
    await card(page, "gate").locator(".pick").click();
    const bar = await box(page.locator("#shell-bar"));
    const view = await box(page.locator("#shell-view"));
    const acts = page.locator("#shell-acts .sact");
    await expect(acts).toHaveCount(2);
    const first = await box(acts.first());
    expect(first.x).toBeGreaterThanOrEqual(view.x + view.width);
    for (const act of await acts.all()) {
      const b = await box(act);
      expect(b.x + b.width).toBeLessThanOrEqual(bar.x + bar.width);
      expect(b.y).toBeGreaterThanOrEqual(bar.y);
      expect(b.y + b.height).toBeLessThanOrEqual(bar.y + bar.height);
      expect(
        (await act.getAttribute("aria-label")) ?? (await act.textContent()),
      ).not.toBe("");
    }
    const words = page.locator("#shell-acts .sact .lbl").first();
    if (size.width > 820) await expect(words).toBeVisible();
    else await expect(words).toBeHidden();
    // Deselected: the bar has no actions to show.
    await page.keyboard.press("Escape");
    await expect(acts).toHaveCount(0);
  }
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  // Why: the grip is drawn 16 x 20 px, too small for a finger; on a touch
  // screen its hit area grows to 24 x 24 (WCAG's least target size) while
  // the drawn grip, and the layout pinned above, stay as they are.
  test("a card's grip takes a press anywhere in 24 x 24 px around it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await answerHosts(page);
    await openSampleIn3d(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    if (
      await page
        .locator("#shell-tree")
        .evaluate((t) => t.classList.contains("collapsed"))
    ) {
      await page.locator("#tree-fold").click();
    }
    const grip = page.locator('#tree-body [data-drag="gate"]');
    const b = await box(grip);
    expect([b.width, b.height]).toEqual([16, 20]);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    for (const [dx, dy] of [
      [-11.5, -11.5],
      [11.5, -11.5],
      [-11.5, 11.5],
      [11.5, 11.5],
    ]) {
      const hit = await page.evaluate(
        ([x, y]) =>
          document
            .elementFromPoint(x ?? 0, y ?? 0)
            ?.closest("[data-drag]")
            ?.getAttribute("data-drag") ?? null,
        [cx + (dx ?? 0), cy + (dy ?? 0)],
      );
      expect(hit, `${String(dx)}, ${String(dy)}`).toBe("gate");
    }
  });
});
