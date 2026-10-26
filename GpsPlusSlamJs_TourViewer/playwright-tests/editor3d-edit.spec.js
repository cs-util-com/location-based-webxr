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
import { readFileSync } from "node:fs";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";

import {
  SQUARE_GROUND_M,
  afterFrames,
  answerHosts,
  openSample,
  openZip,
  view3d,
} from "./editor3d-fixture.js";
import { save, viewCommand } from "./editor-menus.js";
import { useWideFont } from "./wide-font.js";

/**
 * Why these tests matter: the 3D view is where a creator moves things by
 * hand, and only the page shows whether the gizmo, the ground under the
 * pointer, OrbitControls and the store work together: a drag the camera
 * also takes, a drag that writes nothing (or a step per frame), keys that
 * do nothing in the browser, a second finger that leaves half an edit
 * behind, or handles drawn too small to grab all pass every unit test.
 * These open the sample tour with a pin placed beside its first station
 * (on a flat relief at the square's height), select it, drag it with the
 * mouse and check the saved file; drive every key; cancel a touch drag
 * with a second finger; and measure the gizmo on the screen at four
 * window sizes, in a wide face. A code laid flat in the top view is
 * measured on screen at the same four sizes.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

const PIN = "pin-e2e";
/** The geoid's N at the square (m): the file's heights are ellipsoidal. */
const N_M = 45.68;

/**
 * The editor with the sample tour, a pin 2 m east of its first station's
 * point, 1.5 m over the ground, and the 3D view shown.
 * @param {import("@playwright/test").Page} page
 */
async function openWithPin(page) {
  await page.addInitScript(() => {
    // @ts-expect-error - the save goes to a download the test reads.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await openSample(page);
  const placed = await page.evaluate(
    ({ id, alt }) => {
      const hook = /** @type {any} */ (window).__tourEditor;
      const first = hook.manifest().stations[0];
      const out = hook.editor().place({
        id,
        kind: "pin",
        label: "Drag me",
        createdAtIso: "2026-10-22T08:00:00.000Z",
        station: first.id,
        geo: {
          lat: first.geo.lat,
          lon:
            first.geo.lon +
            2 / (111_320 * Math.cos((first.geo.lat * Math.PI) / 180)),
          alt,
          headingDeg: 0,
        },
      });
      hook.edited();
      return { kind: out.kind, station: first.id };
    },
    { id: PIN, alt: SQUARE_GROUND_M + N_M + 1.5 },
  );
  expect(placed.kind).toBe("placed");
  await viewCommand(page, "switch");
  await expect(page.locator("#view-switch")).toHaveText("2D map", {
    timeout: 60_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  return placed.station;
}

/** @param {import("@playwright/test").Page} page */
function manifest(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/** @param {import("@playwright/test").Page} page */
function changes(page) {
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
 * The pin's pose in its station, and its station.
 * @param {any} tour
 */
function pinOf(tour) {
  for (const station of tour.stations) {
    const item = station.items.find((/** @type {any} */ i) => i.id === PIN);
    if (item !== undefined) return { item, station };
  }
  return null;
}

/**
 * A point of the hook (CSS px on the canvas) on the page.
 * @param {import("@playwright/test").Page} page
 * @param {readonly [number, number] | null} at
 */
async function onPage(page, at) {
  if (at === null) throw new Error("not on the screen");
  const canvas = await page.locator("#view3d canvas").boundingBox();
  if (canvas === null) throw new Error("no canvas");
  return { x: canvas.x + at[0], y: canvas.y + at[1] };
}

/**
 * The page point of a gizmo part, once it shows.
 * @param {import("@playwright/test").Page} page
 * @param {"middle" | "knob" | "dot"} part
 */
async function handle(page, part) {
  await expect
    .poll(() =>
      page.evaluate(
        (p) => /** @type {any} */ (window).__tourEditor.view3dHandle(p),
        part,
      ),
    )
    .not.toBeNull();
  return onPage(
    page,
    await page.evaluate(
      (p) => /** @type {any} */ (window).__tourEditor.view3dHandle(p),
      part,
    ),
  );
}

/**
 * Select the pin from the tree (a click on its station unfolds it),
 * and wait for the flight to it to end.
 * @param {import("@playwright/test").Page} page
 * @param {string} station
 */
async function selectPin(page, station) {
  const pin = page.locator(`#tree-body [data-select="${PIN}"]`);
  // A second click on a station folds it again.
  if (!(await pin.isVisible())) {
    await page.locator(`#tree-body [data-select="station:${station}"]`).click();
  }
  await pin.click();
  await expect.poll(() => selected(page)).toBe(PIN);
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
}

/**
 * A placed item's height over the flat ground (m): its station's
 * ellipsoidal height plus its local up, less the ground's (a few metres
 * from the station the Earth's curve is under a millimetre).
 * @param {{ item: any, station: any }} placed
 */
function heightM(placed) {
  return (
    placed.station.geo.alt +
    placed.item.pose.position[1] -
    (SQUARE_GROUND_M + N_M)
  );
}

/** The horizontal distance between two local poses (m). @param {any} a @param {any} b */
function horizontalM(a, b) {
  return Math.hypot(
    b.pose.position[0] - a.pose.position[0],
    b.pose.position[2] - a.pose.position[2],
  );
}

/** The turn about up from pose a to pose b (degrees, the short way). @param {any} a @param {any} b */
function turnDeg(a, b) {
  const [x1, y1, z1, w1] = a.pose.rotation;
  const [x2, y2, z2, w2] = b.pose.rotation;
  const dot = Math.abs(x1 * x2 + y1 * y2 + z1 * z2 + w1 * w2);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/**
 * The saved file's manifest, through the browser's download.
 * @param {import("@playwright/test").Page} page
 */
async function saveAndRead(page) {
  const download = page.waitForEvent("download");
  await save(page);
  const file = await download;
  const bytes = new Uint8Array(readFileSync(await file.path()));
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  let json = "";
  for (const entry of await reader.getEntries()) {
    if (entry.filename === "tour.json" && !entry.directory) {
      json = await entry.getData(new TextWriter());
    }
  }
  await reader.close();
  return JSON.parse(json);
}

test("drags a selected pin over the ground with the mouse: one step, kept above the ground, saved, undone and redone", async ({
  page,
}) => {
  const station = await openWithPin(page);
  await selectPin(page, station);
  const before = pinOf(await manifest(page));
  const steps = await changes(page);
  const from = await handle(page, "middle");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + i * 8, from.y + i * 3);
  }
  // Nothing is written while the drag runs.
  expect(await changes(page)).toBe(steps);
  await page.mouse.up();
  await expect.poll(() => changes(page)).toBe(steps + 1);
  const after = pinOf(await manifest(page));
  if (before === null || after === null) throw new Error("the pin is gone");
  expect(horizontalM(before.item, after.item)).toBeGreaterThan(0.5);
  // Flat ground: its height over the ground kept, whichever station the
  // station rule seats it in (a few metres of drag may leave the first
  // one's found radius).
  expect(heightM(after)).toBeCloseTo(heightM(before), 3);
  expect(after.item.pose.rotation).toEqual(before.item.pose.rotation);
  // The saved file carries the moved pin.
  const saved = pinOf(await saveAndRead(page));
  expect(saved?.item.pose).toEqual(after.item.pose);
  // One undo step takes it back exactly; a redo moves it again.
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => pinOf(await manifest(page))?.item.pose)
    .toEqual(before.item.pose);
  await page.keyboard.press("Control+y");
  await expect
    .poll(async () => pinOf(await manifest(page))?.item.pose)
    .toEqual(after.item.pose);
});

/** The camera's position. @param {import("@playwright/test").Page} page */
async function cameraAt(page) {
  return /** @type {number[]} */ ((await view3d(page))?.camera ?? []);
}

// Why: a camera still moving when the gizmo is grabbed (a card's or
// Frame's flight, the orbit's coast) moves the object under a pointer
// that holds still, and T, F or Home pressed during a drag would fly the
// camera away mid-drag. The camera must stand still from the press until
// the release.
test("holds the camera still from a press on the gizmo until its release, even mid-flight and against T", async ({
  page,
}) => {
  const station = await openWithPin(page);
  await selectPin(page, station);
  const steps = await changes(page);
  await page.keyboard.press("f");
  const from = await handle(page, "middle");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const held = await cameraAt(page);
  await afterFrames(page, 20);
  expect(await cameraAt(page)).toEqual(held);
  expect((await view3d(page))?.flying).toBe(false);
  // The shell's camera keys wait for the drag's end.
  await page.keyboard.press("t");
  await page.keyboard.press("Home");
  await afterFrames(page, 10);
  expect(await cameraAt(page)).toEqual(held);
  expect((await view3d(page))?.top).toBe(false);
  // It was a drag of the gizmo all along: a move writes one step.
  for (let i = 1; i <= 5; i++) await page.mouse.move(from.x + i * 8, from.y);
  await page.mouse.up();
  await expect.poll(() => changes(page)).toBe(steps + 1);
});

test("answers every key: nudges, turns, height, delete, duplicate, Esc, and leaves T, F and Home to the shell", async ({
  page,
}) => {
  // About 15 s alone, and past the default 30 s on a loaded machine: a
  // dozen edits, each waited for in a software-drawn view.
  test.slow();
  const station = await openWithPin(page);
  await selectPin(page, station);
  const pose = async () => pinOf(await manifest(page))?.item;
  const start = await pose();
  let steps = await changes(page);
  /** @param {string} key */
  const press = async (key) => {
    await page.keyboard.press(key);
    steps += 1;
    await expect.poll(() => changes(page)).toBe(steps);
  };
  await press("ArrowRight");
  expect(horizontalM(start, await pose())).toBeCloseTo(0.1, 3);
  await press("Shift+ArrowUp");
  const nudged = await pose();
  await press("ArrowLeft");
  expect(horizontalM(nudged, await pose())).toBeCloseTo(0.1, 3);
  const before = await pose();
  await press("e");
  expect(turnDeg(before, await pose())).toBeCloseTo(5, 6);
  await press("Shift+q");
  expect(turnDeg(before, await pose())).toBeCloseTo(10, 6);
  await press("Alt+ArrowRight");
  expect(turnDeg(before, await pose())).toBeCloseTo(5, 6);
  const low = await pose();
  await press("PageUp");
  expect((await pose()).pose.position[1] - low.pose.position[1]).toBeCloseTo(
    0.1,
    6,
  );
  await press("Shift+PageDown");
  expect((await pose()).pose.position[1] - low.pose.position[1]).toBeCloseTo(
    -0.9,
    6,
  );
  // T is the shell's (top view), F and Home frame: no edit.
  await page.keyboard.press("t");
  await expect
    .poll(() =>
      page.evaluate(
        () => /** @type {any} */ (window).__tourEditor.view3d()?.top,
      ),
    )
    .toBe(true);
  await page.keyboard.press("f");
  await page.keyboard.press("Home");
  expect(await changes(page)).toBe(steps);
  // Ctrl+D copies it beside itself and selects the copy.
  await press("Control+d");
  await expect(page.locator(".toast", { hasText: "Duplicated" })).toBeVisible();
  const copy = await selected(page);
  expect(copy).not.toBe(PIN);
  // Del deletes the copy (an Undo offered), Esc deselects.
  await press("Delete");
  await expect(page.locator(".toast", { hasText: "Deleted" })).toBeVisible();
  expect(
    (await manifest(page)).stations.some((/** @type {any} */ s) =>
      s.items.some((/** @type {any} */ i) => i.id === copy),
    ),
  ).toBe(false);
  await selectPin(page, station);
  await page.keyboard.press("Escape");
  await expect.poll(() => selected(page)).toBeNull();
  // Nothing selected: the arrows edit nothing.
  await page.keyboard.press("ArrowRight");
  expect(await changes(page)).toBe(steps);
});

// Why: the menus are driven from the keyboard, and their keys are the
// menu's own. Pressed in an open menu, or on a menu's button, an arrow
// nudged the selected pin, Home flew the camera to the whole tour and T
// switched the top view, each behind the menu where the creator did not
// look; and the help's Escape, taken first, left an open menu open.
test("keys pressed in a menu stay in the menu: no nudge, no camera move, no top view", async ({
  page,
}) => {
  test.slow();
  const station = await openWithPin(page);
  await selectPin(page, station);
  await afterFrames(page, 3);
  const pose = pinOf(await manifest(page))?.item.pose;
  const steps = await changes(page);
  const camera = await cameraAt(page);
  const viewButton = page.locator("#view-menu-btn");
  const viewMenu = page.locator("#view-menu");
  await viewButton.focus();
  await page.keyboard.press("ArrowDown");
  await expect(viewMenu).toBeVisible();
  for (const key of ["ArrowDown", "ArrowDown", "End", "Home", "t"]) {
    await page.keyboard.press(key);
  }
  await page.keyboard.press("Escape");
  await expect(viewMenu).toBeHidden();
  await expect(viewButton).toBeFocused();
  await afterFrames(page, 10);
  expect(await changes(page)).toBe(steps);
  expect(pinOf(await manifest(page))?.item.pose).toEqual(pose);
  expect(await cameraAt(page)).toEqual(camera);
  expect((await view3d(page))?.top).toBe(false);
  // Escape closed the menu only: the pin is still selected.
  expect(await selected(page)).toBe(PIN);
  // On the closed menu's button Home is the page's again: it frames the
  // whole tour. The camera is panned away first so the framing shows.
  const canvas = await page.locator("#view3d canvas").boundingBox();
  if (canvas === null) throw new Error("no canvas");
  const mid = {
    x: canvas.x + canvas.width / 2,
    y: canvas.y + canvas.height / 2,
  };
  /** The orbit's centre (m in the view's frame). */
  const target = async () =>
    /** @type {number[]} */ ((await view3d(page))?.target ?? []);
  /** @param {number[]} a @param {number[]} b */
  const apart = (a, b) =>
    Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
  const framed = await target();
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(mid.x + 160, mid.y + 40, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await afterFrames(page, 20);
  const panned = await target();
  // The pan still coasts a little (the orbit's damping): Home must take
  // the centre back much farther than that, half the pan at least.
  const pan = apart(panned, framed);
  expect(pan).toBeGreaterThan(1);
  await viewButton.focus();
  await page.keyboard.press("Home");
  await expect
    .poll(async () => apart(await target(), panned))
    .toBeGreaterThan(pan / 2);
  await expect(viewMenu).toBeHidden();
  expect(await changes(page)).toBe(steps);
  // With the help open, Escape in a menu still closes the menu.
  await page.locator("#studio-help").click();
  await expect(page.locator("#shell-help")).toBeVisible();
  await viewButton.focus();
  await page.keyboard.press("ArrowDown");
  await expect(viewMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewMenu).toBeHidden();
  // And with the focus gone from the open menu (to the page), Escape
  // closes the menu before the help: the newer of the two goes first.
  await expect(page.locator("#shell-help")).toBeVisible();
  await page.evaluate(() => {
    // A script's click: no press outside the help, which stays open.
    document.getElementById("view-menu-btn")?.click();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await expect(viewMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewMenu).toBeHidden();
  await expect(page.locator("#shell-help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#shell-help")).toBeHidden();
  expect(await selected(page)).toBe(PIN);
});

// Why: the bottom bar's and the inspector's item actions are one step
// each, and only the page shows that the bar's buttons, the 3D view's turn
// and the clipboard work together: Align must leave the pin facing its
// station's way exactly (and say so, writing nothing, the second time),
// the copied text must be the inspector's numbers, and "Move to a new
// station" must give the pin a station of its own without moving it.
test("an item's actions: turned to its station's way, its position copied, moved into a station of its own", async ({
  page,
  context,
}) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const station = await openWithPin(page);
  await selectPin(page, station);
  const pose = async () => pinOf(await manifest(page))?.item;
  const straight = { pose: { rotation: [0, 0, 0, 1] } };
  let steps = await changes(page);
  await page.keyboard.press("e");
  steps += 1;
  await expect.poll(() => changes(page)).toBe(steps);
  expect(turnDeg(straight, await pose())).toBeGreaterThan(1);

  const align = page.locator('#shell-acts [data-bar="align"]');
  await align.click();
  steps += 1;
  await expect.poll(() => changes(page)).toBe(steps);
  expect(turnDeg(straight, await pose())).toBeLessThan(0.01);
  // Already facing that way: said, nothing written.
  await align.click();
  await expect(
    page.locator(".toast", { hasText: "already faces the way its station" }),
  ).toBeVisible();
  expect(await changes(page)).toBe(steps);
  await page.keyboard.press("Control+z");
  await expect.poll(() => changes(page)).toBe(steps + 1);
  expect(turnDeg(straight, await pose())).toBeGreaterThan(1);

  await page.locator('#shell-acts [data-bar="copy"]').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(
    /^-?\d+\.\d\d m north, -?\d+\.\d\d m east, -?\d+\.\d\d m up of its station, heading \d+ deg$/,
  );
  await expect(
    page.locator(".toast", { hasText: `Position copied: ${copied}` }),
  ).toBeVisible();

  // Its own station, where it stands: the pin does not move.
  const at = await page.evaluate(
    (id) => /** @type {any} */ (window).__tourEditor.view3dPointOf(id),
    PIN,
  );
  const before = await changes(page);
  await page.locator('#inspector-body [data-act="split"]').click();
  await expect
    .poll(async () => pinOf(await manifest(page))?.station.id)
    .not.toBe(station);
  const own = pinOf(await manifest(page))?.station.id;
  expect(await selected(page)).toBe(`station:${own}`);
  expect(await changes(page)).toBe(before + 1);
  await expect(
    page.locator("#shell-inspector [data-act='lock']"),
  ).toHaveAttribute("aria-pressed", "false");
  const now = await page.evaluate(
    (id) => /** @type {any} */ (window).__tourEditor.view3dPointOf(id),
    PIN,
  );
  for (const axis of [0, 1, 2]) expect(now[axis]).toBeCloseTo(at[axis], 2);
  await expect(
    page.locator(".toast", { hasText: "with the pin in it" }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => pinOf(await manifest(page))?.station.id)
    .toBe(station);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("a second finger cancels a drag of the gizmo and leaves the tour as it was", async ({
    page,
  }) => {
    const station = await openWithPin(page);
    await selectPin(page, station);
    const before = await manifest(page);
    const steps = await changes(page);
    const from = await handle(page, "middle");
    const cdp = await page.context().newCDPSession(page);
    /** @param {string} type @param {{x: number, y: number, id: number}[]} points */
    const touch = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await touch("touchStart", [{ x: from.x, y: from.y, id: 1 }]);
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", [{ x: from.x + i * 6, y: from.y, id: 1 }]);
    }
    const one = { x: from.x + 36, y: from.y, id: 1 };
    await touch("touchStart", [one, { x: from.x + 140, y: from.y, id: 2 }]);
    await expect(
      page.locator(".toast", {
        hasText: "Two fingers move the camera - the edit was undone",
      }),
    ).toBeVisible();
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", [
        { x: one.x, y: one.y - i * 6, id: 1 },
        { x: from.x + 140, y: from.y - i * 6, id: 2 },
      ]);
    }
    await touch("touchEnd", []);
    expect(await changes(page)).toBe(steps);
    expect(await manifest(page)).toEqual(before);
  });
});

test("draws the gizmo's handles at their size on the screen, at a phone, a tablet and a desktop, in a wide face", async ({
  page,
}) => {
  await useWideFont(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const station = await openWithPin(page);
  // A station: four dots of 30 px (picked from the tree, which a phone's
  // window folds away).
  await page.locator(`#tree-body [data-select="station:${station}"]`).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          /** @type {any} */ (window).__tourEditor.view3dGizmoSizes()?.dotPx,
      ),
    )
    .toBeCloseTo(30, 1);
  await selectPin(page, station);
  // Straight down, the screen shows the ground plane undistorted.
  await page.keyboard.press("t");
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 820, height: 1180 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    const at = `at ${String(size.width)}x${String(size.height)}`;
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              /** @type {any} */ (window).__tourEditor.view3dGizmoSizes()
                ?.knobPx,
          ),
        { message: at },
      )
      .toBeCloseTo(42, 1);
    const sizes = await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.view3dGizmoSizes(),
    );
    // A pin: no dots; its ring at least 32 px.
    expect(sizes.dotPx, at).toBe(0);
    expect(sizes.ringPx, at).toBeGreaterThanOrEqual(32 - 0.5);
    // The knob stands its 30 px stalk beyond the ring, on the screen.
    // The pixels are counted at the ground's depth, and the knob is drawn
    // 0.35 m over the ground (the design's), nearer the camera: so it reads
    // a few per cent further out at a close zoom, never nearer.
    const middle = await handle(page, "middle");
    const knob = await handle(page, "knob");
    const reach = Math.hypot(knob.x - middle.x, knob.y - middle.y);
    expect(reach, at).toBeGreaterThanOrEqual(sizes.ringPx + 30 - 1);
    expect(reach, at).toBeLessThanOrEqual((sizes.ringPx + 30) * 1.06);
    // Inside the view.
    const box = await page.locator("#view3d canvas").boundingBox();
    if (box === null) throw new Error("no canvas");
    for (const p of [middle, knob]) {
      expect(p.x, at).toBeGreaterThan(box.x);
      expect(p.x, at).toBeLessThan(box.x + box.width);
    }
  }
});

test("a station's position is locked until it is unlocked in the inspector: its gizmo is its radius dots, and its keys move nothing", async ({
  page,
}) => {
  // Why: a station's pose places every item in it, so a stray drag or
  // key press would move all of its content on site. Every station opens
  // locked: its gizmo is its radius dots alone, a nudge says why it did
  // nothing, and the inspector's lock beside Position unlocks it.
  await page.setViewportSize({ width: 1440, height: 900 });
  const station = await openWithPin(page);
  await page.locator(`#tree-body [data-select="station:${station}"]`).click();
  await expect.poll(() => selected(page)).toBe(`station:${station}`);
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  /** @param {"middle" | "knob" | "dot"} part */
  const shown = (part) =>
    page.evaluate(
      (p) => /** @type {any} */ (window).__tourEditor.view3dHandle(p),
      part,
    );
  await handle(page, "dot");
  await afterFrames(page, 2);
  expect(await shown("knob")).toBeNull();
  expect(await shown("middle")).toBeNull();
  const lock = page.locator("#shell-inspector [data-act='lock']");
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  const before = await manifest(page);
  const steps = await changes(page);
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator(".toast", { hasText: "position is locked" }),
  ).toBeVisible();
  expect(await changes(page)).toBe(steps);
  expect(await manifest(page)).toEqual(before);
  // Unlocked: the knob and the middle are handles again, and a nudge
  // moves the station (one step).
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await handle(page, "knob");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => changes(page)).toBe(steps + 1);
  const moved = (await manifest(page)).stations.find(
    (/** @type {any} */ s) => s.id === station,
  );
  const was = before.stations.find((/** @type {any} */ s) => s.id === station);
  expect(moved.geo.lon).toBeGreaterThan(was.geo.lon);
});

/**
 * A tour of one station on the square and one 20 cm code on a wall 2 m
 * east of it, its face to the east (near enough to stay in a phone's view
 * from 12 m up). As a zip.
 */
async function oneCodeTour() {
  const lat = 48.13725;
  const lon = 11.57549;
  const east = 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const manifest = {
    ...createEmptyTourManifest(),
    title: "One code",
    stations: [
      {
        id: "a",
        title: "Station A",
        geo: { lat, lon, alt: SQUARE_GROUND_M + N_M, headingDeg: 0 },
        activateRadiusM: 30,
        foundRadiusM: 5,
        hint: "arrow",
        steps: [],
        items: [],
      },
    ],
  };
  const id = await qrCodeId("https://gps.csutil.com/tour/?qr=editor3d&n=1");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "tour.json",
    new TextReader(serializeTourManifest(/** @type {any} */ (manifest))),
  );
  await writer.add(
    `qr/${id}.json`,
    new TextReader(
      JSON.stringify({
        version: 1,
        qr: {
          physicalSizeM: 0.2,
          geo: {
            lat,
            lon: lon + east,
            alt: SQUARE_GROUND_M + N_M + 1.5,
            headingDeg: 0,
          },
        },
      }),
    ),
  );
  return { zip: Buffer.from(await writer.close()), id };
}

// Why: from high above, a 20 cm code at its printed size is a dot (a cap
// of 8 times left it about 3 px wide). Laid flat in the top view it is
// drawn 12 px on screen wherever its printed size would look smaller, and
// at its printed size where that is larger, or tilted up. Measured on the
// canvas (its square's corners projected by the page's own camera): the
// page must hand the layer the camera it draws with and the view's real
// height, or a phone draws the desktop's size - both pass every unit test
// of the layer.
test("a code laid flat in the top view is drawn 12 px on screen from high above, at a phone, a tablet and a desktop", async ({
  page,
}) => {
  // Fourteen camera moves, each drawn and measured, plus four WebGL
  // screenshots: more than the 30 s default leaves under a loaded machine
  // (all of it measured, then timed out on the last near check).
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const { zip, id } = await oneCodeTour();
  await openZip(page, zip, "one-code.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect.poll(async () => (await view3d(page))?.codes).toBe(1);
  await page.keyboard.press("t");
  await expect.poll(async () => (await view3d(page))?.top).toBe(true);
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  await expect.poll(async () => (await view3d(page))?.standing).toBe(0);
  const code = await page.evaluate(
    (level) => /** @type {any} */ (window).__tourEditor.view3dPointOf(level),
    id,
  );
  /** The least side of a code laid flat on screen (CSS px). */
  const SCREEN_PX = 12;
  const PRINTED_M = 0.2;
  /**
   * The camera `m` from the orbit's centre, a screenshot kept for the
   * eye at 300 m, and the code then: its growth, its side measured on the canvas,
   * and the side its printed size alone would have.
   * @param {number} m
   */
  const at = async (m) => {
    await page.evaluate(
      (d) => /** @type {any} */ (window).__tourEditor.view3dDistance(d),
      m,
    );
    await afterFrames(page, 2);
    if (m === 300) {
      const size = page.viewportSize();
      await page.screenshot({
        path: test
          .info()
          .outputPath(`top-view-code-${size?.width}x${size?.height}-${m}m.png`),
      });
    }
    const stats = await view3d(page);
    const box = await page.locator(".view3d-canvas").boundingBox();
    // Pixels per radian of the canvas as drawn, through the 50 degree lens.
    const focal = (box?.height ?? 0) / 2 / Math.tan((25 * Math.PI) / 180);
    const toCode = [0, 1, 2].map((i) => code[i] - stats.camera[i]);
    const dist = Math.hypot(...toCode);
    const look = [0, 1, 2].map((i) => stats.target[i] - stats.camera[i]);
    const lookM = Math.hypot(...look);
    // Its depth in the view: a flat square facing the camera is drawn
    // its side times the focal over its depth.
    const depth = toCode.reduce((sum, v, i) => sum + (v * look[i]) / lookM, 0);
    const printedPx = (PRINTED_M * focal) / dist;
    return {
      dist,
      scale: stats.codeScales[0],
      px: stats.codePx[0],
      printedPx,
      // What it must measure: the larger of the two, seen at its depth.
      wantPx: (Math.max(SCREEN_PX, printedPx) * dist) / depth,
    };
  };
  for (const size of [
    { width: 1440, height: 900 },
    { width: 820, height: 1180 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    for (const m of [12, 300, 1000]) {
      const now = await at(m);
      const label = `${size.width}x${size.height} at ${m} m`;
      expect(now.px, label).toBeGreaterThan(SCREEN_PX - 0.1);
      expect(Math.abs(now.px - now.wantPx), label).toBeLessThan(0.3);
      if (now.printedPx >= SCREEN_PX) {
        expect(now.scale, label).toBe(1);
      } else {
        expect(now.scale, label).toBeCloseTo(SCREEN_PX / now.printedPx, 3);
      }
      if (m >= 300) expect(now.px, label).toBeLessThan(SCREEN_PX + 0.2);
    }
  }
  // Near, on the desktop, the printed size is the larger: the code is
  // drawn at it, larger than 12 px.
  await page.setViewportSize({ width: 1440, height: 900 });
  const near = await at(12);
  expect(near.scale).toBe(1);
  expect(near.px).toBeGreaterThan(SCREEN_PX + 3);
  // Tilted up, the code stands at its printed size, however far.
  await at(1000);
  await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dTilt(60),
  );
  await expect.poll(async () => (await view3d(page))?.standing).toBe(1);
  await expect.poll(async () => (await view3d(page))?.codeScales[0]).toBe(1);
});
