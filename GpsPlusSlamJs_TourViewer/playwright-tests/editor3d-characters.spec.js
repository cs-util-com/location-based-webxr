// @ts-check
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

import { makeCharacter } from "./character-sheet.js";
import {
  installTourViewerArFakes,
  lockFixtureCode,
  seedAlignment,
  standAt,
} from "./ar-fakes.js";
import {
  OLDER_VIEW,
  answerHosts,
  openSampleIn3d,
  openZip,
} from "./editor3d-fixture.js";
import { fileCommand, save } from "./editor-menus.js";
import { stationBlocks } from "./tour-fixture.mjs";

/**
 * Why this test matters: a guide character reaches a tour in four places
 * that only meet in the page - the maker (its cut worker and its library in
 * the origin-private file system), the maker shown over the editor in a
 * frame of the same origin, the editor's Characters list reading that
 * library when the maker closes, and the tour file written with the
 * character's two pictures. This walks it as a creator does: a station's
 * "+" menu, "Character", the maker over the editor, a character made and
 * saved there, back to the tour, where he stands in the station; then the
 * tour saved and opened again in a new page, the character and his
 * pictures still in it, and the Characters list showing him as in this
 * tour. The sheet is drawn by the test, not by the code under test.
 *
 * The second test takes a character added with the add menu through the
 * 3D view (drawn at a free spot, selected with the gizmo, listed, moved)
 * and into the visitor's world.
 *
 * What they cannot catch: how good the cut is on real image-AI pictures,
 * and how the figure looks.
 */

test.describe.configure({ mode: "default" });

/** @param {import("@playwright/test").Page} page */
function tourNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/** @param {Buffer} zip */
async function entries(zip) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)));
  /** @type {Map<string, Uint8Array>} */
  const out = new Map();
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue;
    out.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
  }
  await reader.close();
  return out;
}

/** The station's free character naming `characterId`, if any.
 *  @param {any} manifest @param {string} stationId @param {string} characterId */
function standing(manifest, stationId, characterId) {
  const station = manifest.stations.find(
    (/** @type {any} */ s) => s.id === stationId,
  );
  return stationBlocks(station).find(
    (/** @type {any} */ b) =>
      b.kind === "character" && b.character === characterId,
  );
}

test("the add menu's Character: made in the maker over the editor, standing in the station, saved and opened again", async ({
  page,
  context,
}) => {
  // Two editor pages and the maker over a software-drawn 3D view, which
  // pauses while the maker shows: measured 2026-11-10 at 1440 x 900, the
  // cut took about 1 s, the save 0.1 s and the add 3.5-3.8 s (12-23 s,
  // 19 s and 25 s before the pause). The budget leaves a slower runner
  // room for the two page loads.
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addInitScript(() => {
    // The save goes to a download, and the file input opens it again.
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await openSampleIn3d(page);

  // The station's "+": the type menu, then "Character".
  const gate = page.locator('#tree-body .card[data-station="gate"]');
  await gate.locator(".head").hover();
  await gate.locator(".head .add").click();
  const menu = page.locator("#tree-add-menu");
  await expect(menu).toBeVisible();
  await menu.locator('[data-kind="character"]').click();

  // The maker over the editor, on a new character.
  const dialog = page.locator("#characters-maker");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#characters-maker-frame")).toHaveAttribute(
    "src",
    /characters\.html\?in=editor&start=new$/,
  );
  const maker = page.frameLocator("#characters-maker-frame");
  await makeCharacter(maker, page, "Ranger Rita");
  await expect(maker.locator("#savedBox")).toContainText(
    "Go back to your tour with the button at the top",
  );
  // Every toast the page shows from here on, so the short working toast
  // is seen even when it is gone before an assertion could look.
  await page.evaluate(() => {
    const box = /** @type {HTMLElement} */ (document.getElementById("toasts"));
    /** @type {string[]} */
    const seen = [];
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes) seen.push(n.textContent ?? "");
    }).observe(box, { childList: true });
    /** @type {any} */ (window).__toastsSeen = seen;
  });
  await page.locator("#characters-maker-back").click();
  await expect(dialog).toBeHidden();

  // Back in the tour: declared, standing in the station, selected, said.
  // His pictures are read and copied in beside the software-drawn view
  // (3.5-3.8 s measured), so the outcome gets time; any outcome is waited
  // for, so a refusal fails with the words the page said. The working
  // toast shown from the maker's close is gone with the outcome.
  const outcome = page.locator(".toast").filter({
    hasText: /Ranger Rita|nothing was added|could not be read|was not added/,
  });
  await expect(outcome.first()).toBeVisible({ timeout: 30_000 });
  await expect(outcome.first()).toContainText('Added Ranger Rita to "');
  await expect(
    page.locator(".toast", { hasText: "Adding the character to the tour" }),
  ).toHaveCount(0);
  const seen = await page.evaluate(
    () => /** @type {any} */ (window).__toastsSeen,
  );
  const working = seen.findIndex((/** @type {string} */ t) =>
    t.includes("Adding the character to the tour..."),
  );
  const added = seen.findIndex((/** @type {string} */ t) =>
    t.includes("Added Ranger Rita"),
  );
  expect(working).toBeGreaterThanOrEqual(0);
  expect(working).toBeLessThan(added);
  const made = await tourNow(page);
  const rita = (made.characters ?? []).find(
    (/** @type {any} */ c) => c.name === "Ranger Rita",
  );
  expect(rita).toBeTruthy();
  const item = standing(made, "gate", rita.id);
  expect(item).toMatchObject({ kind: "character", view: "speak" });
  expect(
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.selected(),
    ),
  ).toBe(item.id);

  // Saved: the declaration with both pictures, the item naming him.
  const download = page.waitForEvent("download");
  await save(page);
  const saved = readFileSync(await (await download).path());
  const files = await entries(saved);
  const written = JSON.parse(
    new TextDecoder().decode(files.get("tour.json") ?? new Uint8Array()),
  );
  const declared = written.characters.find(
    (/** @type {any} */ c) => c.id === rita.id,
  );
  expect(declared?.name).toBe("Ranger Rita");
  for (const assetId of [declared.image, declared.frames]) {
    const path = written.assets.find(
      (/** @type {any} */ a) => a.id === assetId,
    )?.path;
    expect(path, `the file for ${String(assetId)}`).toBeTruthy();
    expect(files.get(path)?.byteLength ?? 0).toBeGreaterThan(100);
  }
  expect(standing(written, "gate", rita.id)).toBeTruthy();

  // Opened again in a new page: he is still there, and the list says so.
  await page.close();
  const next = await context.newPage();
  await next.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(next);
  await next.goto("/edit.html?globe=0");
  await expect(next.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(next, saved, "sample-with-rita.zip");
  await expect(next.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  const reopened = await tourNow(next);
  expect(standing(reopened, "gate", rita.id)).toBeTruthy();
  await fileCommand(next, "characters");
  await expect(next.locator("#characters-panel")).toBeVisible();
  await expect(next.locator("#characters-tour li")).toHaveCount(1);
  await expect(next.locator("#characters-tour li")).toContainText(
    "Ranger Rita",
  );
  const onDevice = next.locator("#characters-lib li", {
    hasText: "Ranger Rita",
  });
  await expect(onDevice).toContainText("In this tour");
  await expect(onDevice.locator("[data-add]")).toHaveCount(0);
});

/** The geoid's N at the fixture's square (m): the tour's heights are
 *  ellipsoidal, the answered relief's over the geoid. */
const GEOID_N_M = 45.68;

/** The blocks tour (the stations tour whose gate holds a placed arch, two
 *  pictures and two free characters), as the test's archive server
 *  serves it: its gate's code is the one the visitor's fakes lock. */
const BLOCKS_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/blocks-tour.zip";

/** The two editor hooks the walk reads.
 *  @param {import("@playwright/test").Page} page @param {string} id */
function pointOf(page, id) {
  return page.evaluate(
    (who) => /** @type {any} */ (window).__tourEditor.view3dPointOf(who),
    id,
  );
}

/** @param {import("@playwright/test").Page} page */
function revision(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.editor().revision(),
  );
}

/**
 * How many points of a 4 px grid round `id`'s canvas point a press there
 * selects `id` by: his figure's footprint on the screen (0 when he is not
 * drawn).
 * @param {import("@playwright/test").Page} page @param {string} id
 */
function footprint(page, id) {
  return page.evaluate((who) => {
    const hook = /** @type {any} */ (window).__tourEditor;
    const foot = hook.view3dScreenOf(who);
    if (foot === null) return 0;
    let cells = 0;
    for (let dx = -160; dx <= 160; dx += 4) {
      for (let dy = -160; dy <= 160; dy += 4) {
        if (hook.view3dUnder(foot[0] + dx, foot[1] + dy)?.pick === who) {
          cells++;
        }
      }
    }
    return cells;
  }, id);
}

/**
 * Serve `zip` on the page's own origin at `path`, as a host that honours
 * byte ranges does (the visitor reads an archive by ranges).
 * @param {import("@playwright/test").Page} page
 * @param {string} path
 * @param {Buffer} zip
 */
async function serveZip(page, path, zip) {
  await page.route(`**${path}`, async (route) => {
    const request = route.request();
    const headers = {
      "accept-ranges": "bytes",
      "content-type": "application/zip",
      etag: '"e2e-character-tour"',
    };
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers().range ?? "");
    if (request.method() === "HEAD") {
      await route.fulfill({
        status: 200,
        headers: { ...headers, "content-length": String(zip.length) },
      });
    } else if (range !== null) {
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), zip.length - 1);
      await route.fulfill({
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${String(start)}-${String(end)}/${String(zip.length)}`,
        },
        body: zip.subarray(start, end + 1),
      });
    } else {
      await route.fulfill({ status: 200, headers, body: zip });
    }
  });
}

// Why: the add menu's Character ends in a free character the creator
// then works with like any other item, and the visitor must see him too.
// Each link is a different module (the free spot, the 3D view's figure,
// the gizmo, the tree, the visitor's stage), so only the page shows that
// a character made in the maker gets through all of them: drawn in the 3D
// view at a spot clear of the station's other items, selected with the
// gizmo's handles, a row in the station's list, moved by the gizmo as one
// step, and standing in the world when the saved tour is visited. The
// maker draws its sheet in the test and every host is answered by the
// test, so nothing goes to the network.
test("a character added with the add menu is drawn at a free spot, selected with handles, listed, moved by the gizmo and drawn for the visitor", async ({
  page,
  context,
}) => {
  // The maker over the software-drawn view (about 25 s with the add, as
  // measured for the walk above), the drag (5-6 s), the save and a
  // visitor's page.
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  const blocks = Buffer.from(
    await (await page.request.get(BLOCKS_ARCHIVE)).body(),
  );
  // The ground answered at the gate's own height (its height is over the
  // ellipsoid, the relief's over the geoid), so a new item put on the
  // ground stands beside the gate's other items, not far above or below.
  const blocksTour = JSON.parse(
    new TextDecoder().decode((await entries(blocks)).get("tour.json")),
  );
  const gateAlt = blocksTour.stations.find(
    (/** @type {any} */ s) => s.id === "gate",
  ).geo.alt;
  await answerHosts(page, { groundM: gateAlt - GEOID_N_M });
  await page.goto(OLDER_VIEW);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, blocks, "blocks-tour.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });

  const gate = page.locator('#tree-body .card[data-station="gate"]');
  await gate.locator(".head").hover();
  await gate.locator(".head .add").click();
  await page.locator('#tree-add-menu [data-kind="character"]').click();
  const maker = page.frameLocator("#characters-maker-frame");
  await makeCharacter(maker, page, "Ranger Rita");
  await page.locator("#characters-maker-back").click();
  await expect(page.locator("#characters-maker")).toBeHidden();
  const outcome = page.locator(".toast").filter({
    hasText: /Ranger Rita|nothing was added|could not be read|was not added/,
  });
  await expect(outcome.first()).toBeVisible({ timeout: 30_000 });
  await expect(outcome.first()).toContainText('Added Ranger Rita to "');
  const made = await tourNow(page);
  const rita = (made.characters ?? []).find(
    (/** @type {any} */ c) => c.name === "Ranger Rita",
  );
  const item = standing(made, "gate", rita?.id);
  expect(item, "his item in the gate").toBeTruthy();
  const id = /** @type {string} */ (item.id);
  await expect
    .poll(() =>
      page.evaluate(() => /** @type {any} */ (window).__tourEditor.selected()),
    )
    .toBe(id);

  // Framed (F), as a creator looks at what he just added: from the
  // tour's overview he is a few pixels tall.
  await page.keyboard.press("f");
  await expect
    .poll(() =>
      page.evaluate(
        () => /** @type {any} */ (window).__tourEditor.view3d()?.flying,
      ),
    )
    .toBe(false);

  // A row in the station's list.
  await expect(page.locator(`#tree-body [data-select="${id}"]`)).toBeVisible();

  // Drawn in the 3D view: a footprint a press selects him by.
  await expect
    .poll(() => footprint(page, id), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // At a free spot: more than 2 m from every other item of the gate the
  // view draws (a new item keeps 2.2 m in the station's plane).
  const his = await pointOf(page, id);
  const gateStation = made.stations.find(
    (/** @type {any} */ s) => s.id === "gate",
  );
  let others = 0;
  for (const block of stationBlocks(gateStation)) {
    if (block.id === id) continue;
    const at = await pointOf(page, block.id);
    if (at === null || his === null) continue;
    others++;
    expect(
      Math.hypot(at[0] - his[0], at[1] - his[1], at[2] - his[2]),
      `${String(block.id)} from him (m)`,
    ).toBeGreaterThan(2);
  }
  expect(others, "other items drawn at the gate").toBeGreaterThan(0);

  // Selected: the gizmo's handles show; its disc moves him, one step.
  // Seen from above (T), as a creator moves an item among others: from
  // a low camera the gate's other figures can stand in front of his feet.
  await page.keyboard.press("t");
  await expect
    .poll(() =>
      page.evaluate(
        () => /** @type {any} */ (window).__tourEditor.view3d()?.top,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => /** @type {any} */ (window).__tourEditor.view3d()?.flying,
      ),
    )
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(() =>
        /** @type {any} */ (window).__tourEditor.view3dHandle("middle"),
      ),
    )
    .not.toBeNull();
  const canvas = await page.locator("#view3d canvas").boundingBox();
  const middle = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dHandle("middle"),
  );
  if (canvas === null || middle === null) throw new Error("no handle");
  // A point of his disc no other item covers: from some headings one of
  // the gate's figures stands in front of his feet, and a press over
  // another item is that item's (a tap selects it), never the disc's.
  const grip = await page.evaluate(([who, at]) => {
    const hook = /** @type {any} */ (window).__tourEditor;
    for (let r = 0; r <= 80; r += 4) {
      for (let a = 0; a < 360; a += 15) {
        const x = at[0] + r * Math.cos((a * Math.PI) / 180);
        const y = at[1] + r * Math.sin((a * Math.PI) / 180);
        const under = hook.view3dUnder(x, y);
        if (under?.onDisc === true && (under.pick ?? who) === who) {
          return [x, y];
        }
      }
    }
    return null;
  }, /** @type {[string, [number, number]]} */ ([id, middle]));
  expect(grip, "a point of his disc no other item covers").not.toBeNull();
  if (grip === null) return;
  const from = { x: canvas.x + grip[0], y: canvas.y + grip[1] };
  const steps = await revision(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + i * 8, from.y + i * 3);
  }
  await page.mouse.up();
  await expect.poll(() => revision(page)).toBe(steps + 1);
  const moved = await pointOf(page, id);
  if (his === null || moved === null) throw new Error("he is not drawn");
  expect(
    Math.hypot(moved[0] - his[0], moved[2] - his[2]),
    "moved by the drag (m)",
    // 85 px from close above: 0.38 m measured; any clear move counts.
  ).toBeGreaterThan(0.1);
  expect(
    standing(await tourNow(page), "gate", rita.id),
    "his saved item after the drag",
  ).not.toEqual(item);

  // Saved, then visited: he stands in the world beside the gate's three
  // figures (its story's knight and its two free characters).
  const download = page.waitForEvent("download");
  await save(page);
  const saved = readFileSync(await (await download).path());
  const visitor = await context.newPage();
  await serveZip(visitor, "/e2e/character-tour.zip", saved);
  await installTourViewerArFakes(visitor);
  const link = new URL("/e2e/character-tour.zip", page.url()).href;
  await visitor.goto(`/?qr=${encodeURIComponent(link)}`);
  await expect(visitor.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15_000 },
  );
  const enter = visitor.getByTestId("enter-ar");
  await expect(enter).toBeEnabled({ timeout: 10_000 });
  await enter.click();
  await seedAlignment(visitor);
  await standAt(visitor, 0, 0, 0);
  await lockFixtureCode(visitor);
  await expect
    .poll(
      () =>
        visitor.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
          /** @param {any} o @returns {boolean} */
          const holdsFigure = (o) =>
            o.name === "station-character" ||
            (o.children ?? []).some(holdsFigure);
          return /** @type {any} */ (
            window
          ).__tourViewerTest.fakeScene.children.filter(
            (/** @type {any} */ c) =>
              c.name === "station-stage:gate" && holdsFigure(c),
          ).length;
        }),
      { timeout: 20_000 },
    )
    .toBe(4);
});
