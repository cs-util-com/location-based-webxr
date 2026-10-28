// @ts-check
import { expect, test } from "@playwright/test";

import {
  SQUARE_GROUND_M,
  answerHosts,
  openSample,
  view3d,
} from "./editor3d-fixture.js";
import { viewCommand } from "./editor-menus.js";

/**
 * Why these tests matter: a model's notes and sections are placed by a
 * click on the model in the 3D view, written in the model file's own
 * space, and typed in the inspector - only the page shows the inspector's
 * buttons, the wait for the click, the ray on the drawn model, the store
 * and the session working together. The default view rule (the first note
 * shows a placed model's notes, the last one deleted takes them away, a
 * view the creator chose is kept) is the owner's and must hold in the
 * page, and every view of a model must keep the gizmo: moved, turned and
 * resized by hand, one step each.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

const MODEL = "model-e2e";
/** The geoid's N at the square (m): the file's heights are ellipsoidal. */
const N_M = 45.68;
/** The sample's arch (the file's metres): two pillars and a beam over
 *  them, 2.9 m wide and 3 m high, drawn at its size (3 m). */
const BEAM = /** @type {const} */ ([0, 2.75, 0]);
const PILLAR = /** @type {const} */ ([1.2, 1.25, 0]);

/**
 * The editor with the sample tour, the sample's arch placed as a model
 * 4 m east of its first station's point, on the ground, and the 3D view
 * shown with the model selected.
 * @param {import("@playwright/test").Page} page
 */
async function openWithModel(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSample(page);
  const placed = await page.evaluate(
    ({ id, alt }) => {
      const hook = /** @type {any} */ (window).__tourEditor;
      const first = hook.manifest().stations[0];
      const out = hook.editor().place({
        id,
        kind: "model",
        view: "placed",
        asset: "arch",
        sizeM: 3,
        createdAtIso: "2026-10-28T08:00:00.000Z",
        station: first.id,
        geo: {
          lat: first.geo.lat,
          lon:
            first.geo.lon +
            4 / (111_320 * Math.cos((first.geo.lat * Math.PI) / 180)),
          alt,
          headingDeg: 0,
        },
      });
      hook.edited();
      return { kind: out.kind, station: first.id };
    },
    { id: MODEL, alt: SQUARE_GROUND_M + N_M },
  );
  expect(placed.kind).toBe("placed");
  await viewCommand(page, "switch");
  await expect(page.locator("#view-switch")).toHaveText("2D map", {
    timeout: 60_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  const row = page.locator(`#tree-body [data-select="${MODEL}"]`);
  if (!(await row.isVisible())) {
    await page
      .locator(`#tree-body [data-select="station:${placed.station}"]`)
      .click();
  }
  await row.click();
  await expect.poll(() => selected(page)).toBe(MODEL);
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  await expect
    .poll(() => modelScreen(page, BEAM), { timeout: 20_000 })
    .not.toBeNull();
}

/** @param {import("@playwright/test").Page} page */
function selected(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.selected(),
  );
}

/** @param {import("@playwright/test").Page} page */
function changes(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.editor().revision(),
  );
}

/**
 * The model as the tour has it.
 * @param {import("@playwright/test").Page} page
 */
async function modelNow(page) {
  const tour = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
  for (const station of tour.stations) {
    const block = station.blocks.find((/** @type {any} */ b) => b.id === MODEL);
    if (block !== undefined) return block;
  }
  return null;
}

/**
 * A point of the drawn model (its own space) on the canvas, or null.
 * @param {import("@playwright/test").Page} page
 * @param {readonly [number, number, number]} at
 */
function modelScreen(page, at) {
  return page.evaluate(
    ({ id, at }) =>
      /** @type {any} */ (window).__tourEditor.view3dModelScreen(id, at),
    { id: MODEL, at },
  );
}

/**
 * A point of the canvas on the page.
 * @param {import("@playwright/test").Page} page
 * @param {readonly [number, number] | null} at
 */
async function onPage(page, at) {
  if (at === null) throw new Error("not on the screen");
  const drawn = page.locator("#view3d canvas");
  await drawn.waitFor({ state: "visible", timeout: 20_000 });
  const canvas = await drawn.boundingBox();
  if (canvas === null) throw new Error("no canvas");
  return { x: canvas.x + at[0], y: canvas.y + at[1] };
}

/**
 * Click the drawn model at a point of its own space.
 * @param {import("@playwright/test").Page} page
 * @param {readonly [number, number, number]} at
 */
async function clickModel(page, at) {
  // An edit of the model draws it anew (its file loads again), so it may
  // be off the screen for a moment.
  await expect.poll(() => modelScreen(page, at)).not.toBeNull();
  const p = await onPage(page, await modelScreen(page, at));
  await page.mouse.click(p.x, p.y);
}

/**
 * The page point of a gizmo part, once it shows.
 * @param {import("@playwright/test").Page} page
 * @param {"middle" | "knob" | "dot"} part
 */
async function handle(page, part) {
  const of = () =>
    page.evaluate(
      (p) => /** @type {any} */ (window).__tourEditor.view3dHandle(p),
      part,
    );
  // A view's change loads the model again, and the gizmo comes back with
  // it: slow on a software-rendered page beside other workers.
  await expect.poll(of, { timeout: 20_000 }).not.toBeNull();
  return onPage(page, await of());
}

/**
 * Drag with the mouse from `from` by `steps` points.
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }} from
 * @param {{ x: number, y: number }[]} path
 */
async function drag(page, from, path) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const p of path) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
}

/** @param {import("@playwright/test").Page} page @param {string} act */
function act(page, act) {
  return page.locator(`#shell-inspector [data-act="${act}"]`);
}

/** @param {import("@playwright/test").Page} page @param {string} name */
function field(page, name) {
  return page.locator(`#shell-inspector [data-field="${name}"]`);
}

test("a note is added by a click on the model, typed, placed again, focused from its disc and deleted; the view follows the notes until the creator chooses one", async ({
  page,
}) => {
  test.slow();
  await openWithModel(page);
  const steps = await changes(page);

  // Added: the button waits for the click, the click writes one step.
  await act(page, "note-add").click();
  await expect(act(page, "note-add")).toHaveText("Click the model...");
  await clickModel(page, BEAM);
  await expect.poll(() => changes(page)).toBe(steps + 1);
  const added = await modelNow(page);
  expect(added.annotations).toHaveLength(1);
  expect(added.annotations[0].title).toBe("Note 1");
  // On the beam's face toward the camera, in the file's metres.
  const [x, y, z] = added.annotations[0].position;
  expect(Math.abs(x)).toBeLessThan(0.3);
  expect(y).toBeGreaterThan(2.45);
  expect(y).toBeLessThan(3.05);
  expect(Math.abs(Math.abs(z) - 0.25)).toBeLessThan(0.02);
  // The first note shows the model's notes; the new one is in focus, its
  // disc drawn.
  expect(added.view).toBe("hotspots");
  await expect(act(page, "note-add")).toHaveText(
    "+ Add note (click the model)",
  );
  await expect(
    page.locator('#shell-inspector .anno.on[data-note="0"]'),
  ).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() =>
            /** @type {any} */ (window).__tourEditor.view3dModelParts(),
          )
        )?.discs[0],
    )
    .not.toBeNull();
  await expect(page.locator(".note-disc.on")).toHaveText("1");

  // Typed: the title and the text, each one step.
  await field(page, "note-title:0").fill("Keystone");
  await field(page, "note-title:0").press("Enter");
  await expect
    .poll(async () => (await modelNow(page)).annotations[0].title)
    .toBe("Keystone");
  await field(page, "note-text:0").fill("Set last, it holds the arch.");
  await field(page, "note-text:0").press("Tab");
  await expect
    .poll(async () => (await modelNow(page)).annotations[0].text)
    .toBe("Set last, it holds the arch.");
  // A blank title is refused in words, the note kept.
  await field(page, "note-title:0").fill(" ");
  await field(page, "note-title:0").press("Enter");
  await expect(page.locator(".toast").last()).toBeVisible();
  expect((await modelNow(page)).annotations[0].title).toBe("Keystone");

  // Placed again on a pillar: its words kept.
  await act(page, "note-place:0").click();
  await expect(act(page, "note-place:0")).toHaveText("Click the model...");
  await clickModel(page, PILLAR);
  await expect
    .poll(async () => (await modelNow(page)).annotations[0].position[1])
    .toBeLessThan(2.5);
  expect((await modelNow(page)).annotations[0]).toMatchObject({
    title: "Keystone",
    text: "Set last, it holds the arch.",
  });

  // Its disc takes the focus away, and gives it back.
  await page.locator(".note-disc").first().click();
  await expect(page.locator("#shell-inspector .anno.on")).toHaveCount(0);
  await page.locator(".note-disc").first().click();
  await expect(
    page.locator('#shell-inspector .anno.on[data-note="0"]'),
  ).toHaveCount(1);

  // Deleted: the last note takes the notes' view away.
  await act(page, "note-delete:0").click();
  await expect
    .poll(async () => (await modelNow(page)).annotations)
    .toBeUndefined();
  expect((await modelNow(page)).view).toBe("placed");
  await expect(page.locator(".note-disc")).toHaveCount(0);

  // A view chosen by the creator is kept when a note comes.
  await act(page, "view:ghost").click();
  await expect.poll(async () => (await modelNow(page)).view).toBe("ghost");
  await act(page, "note-add").click();
  await clickModel(page, BEAM);
  await expect
    .poll(async () => (await modelNow(page)).annotations?.length)
    .toBe(1);
  expect((await modelNow(page)).view).toBe("ghost");
  // One undo step takes the note away again.
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await modelNow(page)).annotations)
    .toBeUndefined();
});

test("a section is added by a click on the model, named, flipped and deleted, its plane drawn while the model is selected", async ({
  page,
}) => {
  test.slow();
  await openWithModel(page);
  const parts = () =>
    page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.view3dModelParts(),
    );
  await act(page, "section-add").click();
  await expect(act(page, "section-add")).toHaveText("Click the model...");
  await clickModel(page, BEAM);
  await expect
    .poll(async () => (await modelNow(page)).sections?.length)
    .toBe(1);
  const cut = (await modelNow(page)).sections[0];
  expect(cut.name).toBe("Section 1");
  // Its normal is one of the model's axes, toward the camera.
  expect(cut.normal.map(Math.abs).reduce((a, b) => a + b, 0)).toBe(1);
  await expect.poll(async () => (await parts())?.planes).toBe(1);
  // Sections never move the view: the creator picks the cutaway.
  expect((await modelNow(page)).view).toBe("placed");

  await field(page, "section-name:0").fill("Through the beam");
  await field(page, "section-name:0").press("Enter");
  await expect
    .poll(async () => (await modelNow(page)).sections[0].name)
    .toBe("Through the beam");
  await act(page, "section-flip:0").click();
  await expect
    .poll(async () => (await modelNow(page)).sections[0].normal)
    .toEqual(cut.normal.map((/** @type {number} */ n) => 0 - n));

  await act(page, "section-delete:0").click();
  await expect
    .poll(async () => (await modelNow(page)).sections)
    .toBeUndefined();
  await expect.poll(async () => (await parts())?.planes).toBe(0);
});

test("the gizmo moves, turns and resizes a model in each of its views, one step each", async ({
  page,
}) => {
  // Twelve drags, each loading the model again: minutes on a
  // software-rendered page beside other workers.
  test.setTimeout(240_000);
  await openWithModel(page);
  const views = ["ghost", "hotspots", "cutaway", "toy"];
  for (const [k, view] of views.entries()) {
    // Back and forth, so four moves keep it inside its station's circle.
    const sign = k % 2 === 0 ? 1 : -1;
    await act(page, `view:${view}`).click();
    await expect.poll(async () => (await modelNow(page)).view).toBe(view);
    await expect(act(page, `view:${view}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Moved by its middle.
    let steps = await changes(page);
    let before = await modelNow(page);
    const middle = await handle(page, "middle");
    await drag(
      page,
      middle,
      Array.from({ length: 8 }, (_, i) => ({
        x: middle.x + sign * (i + 1) * 5,
        y: middle.y + sign * (i + 1) * 2,
      })),
    );
    await expect.poll(() => changes(page), { message: view }).toBe(steps + 1);
    let after = await modelNow(page);
    expect(after.pose.position, view).not.toEqual(before.pose.position);

    // Turned by its knob, about its middle.
    steps = await changes(page);
    before = after;
    const centre = await handle(page, "middle");
    const knob = await handle(page, "knob");
    const r = Math.hypot(knob.x - centre.x, knob.y - centre.y);
    const a0 = Math.atan2(knob.y - centre.y, knob.x - centre.x);
    await drag(
      page,
      knob,
      Array.from({ length: 8 }, (_, i) => {
        const a = a0 + ((i + 1) * 5 * Math.PI) / 180;
        return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) };
      }),
    );
    await expect.poll(() => changes(page), { message: view }).toBe(steps + 1);
    after = await modelNow(page);
    expect(after.pose.rotation, view).not.toEqual(before.pose.rotation);

    // Resized by a dot, outward.
    steps = await changes(page);
    before = after;
    const mid = await handle(page, "middle");
    const dot = await handle(page, "dot");
    const len = Math.hypot(dot.x - mid.x, dot.y - mid.y);
    const ux = (dot.x - mid.x) / len;
    const uy = (dot.y - mid.y) / len;
    await drag(
      page,
      dot,
      Array.from({ length: 8 }, (_, i) => ({
        x: dot.x + ux * (i + 1) * 5,
        y: dot.y + uy * (i + 1) * 5,
      })),
    );
    await expect.poll(() => changes(page), { message: view }).toBe(steps + 1);
    after = await modelNow(page);
    expect(after.sizeM, view).toBeGreaterThan(before.sizeM);
    expect(after.view, view).toBe(view);
  }
});

/**
 * A box on the page, once laid out.
 * @param {import("@playwright/test").Locator} locator
 */
async function boxOf(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("not laid out");
  return b;
}

// Why: the model's parts were built from the station blocks prototype's
// editor mode, and the studio's styles zero most margins, so a port can
// lose every gap and still pass a test that asks only whether a button is
// there. This pins the arrangement the prototype chose, on the desktop the
// 3D editor is for: the view, the clip, the notes and the sections in that
// order; the view's chips in a row 6 px apart; each note a card, 6 px
// apart, its numbered badge (22 px) left of its title, its text, its count
// and its tools below with 6 px gaps, its place at the card's right.
test("a model's parts sit in the inspector as the prototype arranged them", async ({
  page,
}) => {
  test.slow();
  await openWithModel(page);
  await page.evaluate((id) => {
    const hook = /** @type {any} */ (window).__tourEditor;
    const at = { position: [0, 2.75, 0.25], normal: [0, 0, 1] };
    hook.editor().editModel(id, { kind: "note-add", at });
    hook.editor().editModel(id, { kind: "note-add", at });
    hook.editor().editModel(id, { kind: "section-add", at });
    hook.edited();
  }, MODEL);
  await expect(page.locator("#shell-inspector .anno[data-note]")).toHaveCount(
    2,
  );
  const sections = [".mview", ".manim", ".mnotes", ".msections"];
  const boxes = [];
  for (const s of sections) {
    boxes.push(await boxOf(page.locator(`#shell-inspector .isec${s}`)));
  }
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i].y, sections[i]).toBeGreaterThanOrEqual(
      boxes[i - 1].y + boxes[i - 1].height - 0.5,
    );
  }

  const chips = page.locator("#shell-inspector .vchips .chip");
  const first = await boxOf(chips.nth(0));
  const second = await boxOf(chips.nth(1));
  expect(second.y).toBeCloseTo(first.y, 0);
  expect(second.x - (first.x + first.width)).toBeCloseTo(6, 0);

  const cards = page.locator("#shell-inspector .anno[data-note]");
  const c0 = await boxOf(cards.nth(0));
  const c1 = await boxOf(cards.nth(1));
  expect(c1.y - (c0.y + c0.height)).toBeCloseTo(6, 0);
  const card = cards.nth(0);
  const badge = await boxOf(card.locator(".badge"));
  const title = await boxOf(card.locator('[data-field="note-title:0"]'));
  const text = await boxOf(card.locator('[data-field="note-text:0"]'));
  const count = await boxOf(card.locator(":scope > output.count"));
  const tools = await boxOf(card.locator(".tools"));
  const pos = await boxOf(card.locator(".tools .pos"));
  expect(badge.width).toBeCloseTo(22, 0);
  expect(badge.height).toBeCloseTo(22, 0);
  // 1 px of border and 8 px of padding inside the card.
  expect(badge.x - c0.x).toBeCloseTo(9, 0);
  expect(title.x - (badge.x + badge.width)).toBeCloseTo(6, 0);
  expect(badge.y + badge.height / 2).toBeCloseTo(title.y + title.height / 2, 0);
  expect(text.y).toBeGreaterThan(title.y + title.height);
  expect(text.x).toBeCloseTo(c0.x + 9, 0);
  expect(count.y).toBeGreaterThanOrEqual(text.y + text.height - 0.5);
  // 6 px under the count's line (an inline output, its line box up to
  // 2 px taller than its own box).
  const toolsGap = tools.y - (count.y + count.height);
  expect(toolsGap).toBeGreaterThanOrEqual(5.5);
  expect(toolsGap).toBeLessThanOrEqual(8);
  expect(c0.x + c0.width - (pos.x + pos.width)).toBeCloseTo(9, 0);
});
