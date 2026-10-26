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
  answerHosts,
  openSampleIn3d,
  openZip,
} from "./editor3d-fixture.js";
import { save } from "./editor-menus.js";
import { useWideFont } from "./wide-font.js";

/**
 * Why these tests matter: the inspector is where a creator types a
 * station's name, its description and its radius, its place and heading,
 * and a pin's words, and where they put things back on the ground. Each
 * must reach the tour as ONE step (one undo), count as a change, be saved
 * and come back on the next open; a value that is no number must be said
 * and write nothing; a radius lowered under its items must leave them
 * where they are and say so; a locked station's place must not take a
 * typed value. Only the page shows the fields, the shell, the session and
 * the save working together. The last test pins the inspector's fields
 * in place, by the studio prototype's measures, at a phone, a phone in
 * landscape, a tablet and a desktop.
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
 * A station of the tour as it stands.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function stationNow(page, id) {
  const tour = await tourNow(page);
  return tour.stations.find((/** @type {any} */ s) => s.id === id);
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
 * The inspector's typed field `name`.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
function field(page, name) {
  return page.locator(`#shell-inspector [data-field="${name}"]`);
}

/**
 * The inspector's command `act`.
 * @param {import("@playwright/test").Page} page
 * @param {string} act
 */
function act(page, act) {
  return page.locator(`#shell-inspector [data-act="${act}"]`);
}

/**
 * Two stations a and b along the square, each with a pin 5 m north of
 * its anchor and 1.5 m up; b stands 3 m over the ground. As a zip.
 */
async function twoPinTour() {
  const station = (
    /** @type {string} */ id,
    /** @type {number} */ dLat,
    /** @type {number} */ upM,
  ) => ({
    id,
    title: `Station ${id.toUpperCase()}`,
    geo: {
      lat: 48.13725 + dLat,
      lon: 11.57549,
      alt: SQUARE_GROUND_M + N_M + upM,
      headingDeg: 0,
    },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    items: [
      {
        id: `p${id}`,
        kind: "pin",
        label: `Pin ${id}`,
        createdAtIso: "2026-10-25T09:00:00.000Z",
        pose: { position: [5, 1.5, 0], rotation: [0, 0, 0, 1] },
      },
    ],
  });
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Two pins",
    tourId: "fedcba9876543210fedcba9876543210",
    stations: [station("a", 0, 0), station("b", 0.0004, 3)],
  };
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "tour.json",
    new TextReader(serializeTourManifest(/** @type {any} */ (manifest))),
  );
  return Buffer.from(await writer.close());
}

/**
 * The editor with `zip` open in the 3D view; saves go to a download.
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} zip
 */
async function openTour(page, zip) {
  await page.context().addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, zip, "two-pins.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect(page.locator("#tree-body .card")).toHaveCount(2);
}

/**
 * Select a station by its tree card.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function selectStation(page, id) {
  await page.locator(`#tree-body .card[data-station="${id}"] .pick`).click();
  await expect.poll(() => selected(page)).toBe(`station:${id}`);
}

/**
 * The tour.json of a saved zip.
 * @param {Buffer} zip
 */
async function savedTour(zip) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)));
  const entry = (await reader.getEntries()).find(
    (e) => e.filename === "tour.json",
  );
  const text = (await entry?.getData?.(new TextWriter())) ?? "{}";
  await reader.close();
  return JSON.parse(text);
}

test("a station's name, description and radius typed in the inspector are one step each, saved, and open again", async ({
  page,
  context,
}) => {
  test.slow();
  await openTour(page, await twoPinTour());
  await selectStation(page, "a");
  const start = await revision(page);

  // The name: Enter keeps it, the tree says it.
  await field(page, "title").fill("Market gate");
  await field(page, "title").press("Enter");
  await expect
    .poll(async () => (await stationNow(page, "a")).title)
    .toBe("Market gate");
  expect(await revision(page)).toBe(start + 1);
  await expect(
    page.locator('#tree-body .card[data-station="a"]'),
  ).toContainText("Market gate");

  // Escape puts the tour's value back and writes nothing; the station
  // stays selected.
  await field(page, "title").fill("Not this");
  await field(page, "title").press("Escape");
  await expect(field(page, "title")).toHaveValue("Market gate");
  expect(await revision(page)).toBe(start + 1);
  expect(await selected(page)).toBe("station:a");

  // The description: leaving the field keeps it.
  await field(page, "description").fill("Where the market meets");
  await field(page, "radius").focus();
  await expect
    .poll(async () => (await stationNow(page, "a")).description)
    .toBe("Where the market meets");
  expect(await revision(page)).toBe(start + 2);

  // The radius, typed with a comma, lowered under the pin: the pin stays
  // in the station, and a line says it stands outside the circle.
  await field(page, "radius").fill("3,5");
  await field(page, "radius").press("Tab");
  await expect
    .poll(async () => (await stationNow(page, "a")).foundRadiusM)
    .toBe(3.5);
  expect(await revision(page)).toBe(start + 3);
  await expect(page.locator("#shell-inspector .warn")).toHaveText(
    "1 item stands outside the circle: visitors see it only from inside the circle.",
  );
  expect(
    (await stationNow(page, "a")).items.map((/** @type {any} */ i) => i.id),
  ).toEqual(["pa"]);

  // A value that is no number is said, and writes nothing.
  await field(page, "radius").fill("ten");
  await field(page, "radius").press("Enter");
  await expect(
    page.locator(".toast", { hasText: "Type a number, like 12.5" }),
  ).toBeVisible();
  await expect(field(page, "radius")).toHaveValue("3.5");
  expect(await revision(page)).toBe(start + 3);

  // One undo takes back the radius alone; redo brings it again.
  await page.locator("#studio-undo").click();
  await expect
    .poll(async () => (await stationNow(page, "a")).foundRadiusM)
    .toBe(25);
  expect((await stationNow(page, "a")).description).toBe(
    "Where the market meets",
  );
  await page.locator("#studio-redo").click();
  await expect
    .poll(async () => (await stationNow(page, "a")).foundRadiusM)
    .toBe(3.5);

  // Saved, and opened again: the three fields as typed.
  const download = page.waitForEvent("download");
  await save(page);
  const saved = await (await download).path();
  const { readFileSync } = await import("node:fs");
  const zip = readFileSync(saved);
  const written = (await savedTour(zip)).stations[0];
  expect(written).toMatchObject({
    id: "a",
    title: "Market gate",
    description: "Where the market meets",
    foundRadiusM: 3.5,
  });
  const next = await context.newPage();
  await openTour(next, zip);
  await selectStation(next, "a");
  await expect(field(next, "title")).toHaveValue("Market gate");
  await expect(field(next, "description")).toHaveValue(
    "Where the market meets",
  );
  await expect(field(next, "radius")).toHaveValue("3.5");
});

test("Put items on the ground, Put on the ground, Add pin, a pin's text and a typed place are one step each", async ({
  page,
}) => {
  test.slow();
  await openTour(page, await twoPinTour());
  await selectStation(page, "a");
  const ground = SQUARE_GROUND_M + N_M;
  const pinAlt = async (/** @type {string} */ station) => {
    const at = await page.evaluate(
      (id) => /** @type {any} */ (window).__tourEditor.view3dPointOf(id),
      `p${station}`,
    );
    return at;
  };
  expect(await pinAlt("a")).not.toBeNull();

  // Station a's pin stands 1.5 m up: once the ground has loaded, the
  // command says one item is off it.
  await expect(act(page, "ground-items")).toContainText("1 off", {
    timeout: 30_000,
  });
  const start = await revision(page);
  await act(page, "ground-items").click();
  await expect(
    page.locator(".toast", { hasText: "Put 1 item on the ground" }),
  ).toBeVisible();
  expect(await revision(page)).toBe(start + 1);
  const anchor = (await stationNow(page, "a")).geo.alt;
  expect((await stationNow(page, "a")).items[0].pose.position[1]).toBeCloseTo(
    0,
    1,
  );
  expect(anchor).toBeCloseTo(ground, 1);
  // Nothing off it now: the command is off.
  await expect(act(page, "ground-items")).toBeDisabled();
  await page.locator("#studio-undo").click();
  await expect
    .poll(async () => (await stationNow(page, "a")).items[0].pose.position[1])
    .toBeCloseTo(1.5, 1);

  // Station b stands 3 m over the ground; locked, its own Put on the
  // ground is off, and its place takes no typing.
  await selectStation(page, "b");
  await page.locator('#shell-inspector [data-act="position"]').click();
  await expect(act(page, "ground")).toBeDisabled();
  await expect(field(page, "east")).toHaveAttribute("readonly", "");
  await act(page, "lock").click();
  await expect(act(page, "ground")).toBeEnabled();
  await expect(act(page, "ground")).toContainText("3.0 m up");
  const before = await revision(page);
  await act(page, "ground").click();
  await expect(
    page.locator(".toast", { hasText: "Put on the ground" }),
  ).toBeVisible();
  expect(await revision(page)).toBe(before + 1);
  expect((await stationNow(page, "b")).geo.alt).toBeCloseTo(ground, 1);

  // A typed place: 5 m further east, where the 3D view draws it.
  const was = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dPointOf("station:b"),
  );
  const east = Number(await field(page, "east").inputValue());
  await field(page, "east").fill(String(east + 5));
  await field(page, "east").press("Enter");
  await expect.poll(() => revision(page)).toBe(before + 2);
  const now = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dPointOf("station:b"),
  );
  expect(now[0] - was[0]).toBeCloseTo(5, 1);
  expect(now[2] - was[2]).toBeCloseTo(0, 1);
  // A typed heading: the station faces it.
  await field(page, "heading").fill("90");
  await field(page, "heading").press("Enter");
  await expect.poll(() => revision(page)).toBe(before + 3);
  await expect(field(page, "heading")).toHaveValue("90.0");

  // Add pin: a new pin in b, selected and said; its words typed in the
  // head.
  await act(page, "add-pin").click();
  await expect(
    page.locator(".toast", { hasText: 'Added a pin to "Station B"' }),
  ).toBeVisible();
  expect(await revision(page)).toBe(before + 4);
  const pin = await selected(page);
  expect(
    (await stationNow(page, "b")).items.map((/** @type {any} */ i) => i.id),
  ).toContain(pin);
  await expect(field(page, "title")).toHaveValue("New pin 2");
  await field(page, "title").fill("Look up");
  await field(page, "title").press("Enter");
  await expect
    .poll(
      async () =>
        (await stationNow(page, "b")).items.find(
          (/** @type {any} */ i) => i.id === pin,
        )?.label,
    )
    .toBe("Look up");
  expect(await revision(page)).toBe(before + 5);

  // A draw while typing: a change made elsewhere (the radius, through the
  // session) draws the inspector again under the cursor. Chromium fires
  // the field's focusout during that draw; the half-typed words are not
  // written, and stay, focused. Finished, they are one step, and one undo
  // takes them back alone.
  await selectStation(page, "a");
  const typedFrom = await revision(page);
  await field(page, "description").fill("By the foun");
  await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor
      .editor()
      .editStation("a", { foundRadiusM: 24 }),
  );
  await expect(field(page, "radius")).toHaveValue("24.0");
  expect(await revision(page)).toBe(typedFrom + 1);
  await expect(field(page, "description")).toBeFocused();
  await expect(field(page, "description")).toHaveValue("By the foun");
  await field(page, "description").press("End");
  await field(page, "description").pressSequentially("tain");
  await field(page, "description").press("Enter");
  await expect
    .poll(async () => (await stationNow(page, "a")).description)
    .toBe("By the fountain");
  expect(await revision(page)).toBe(typedFrom + 2);
  await page.locator("#studio-undo").click();
  await expect
    .poll(async () => (await stationNow(page, "a")).description ?? "")
    .toBe("");
  expect((await stationNow(page, "a")).foundRadiusM).toBe(24);

  // An item typed out of its station's circle is seated again, said in a
  // toast naming it and its new station: into the circle it lands in, or,
  // out of every circle, into a station of its own, which, made here,
  // starts unlocked.
  await page
    .locator('#tree-body .card[data-station="a"] [data-select="pa"]')
    .click();
  await expect.poll(() => selected(page)).toBe("pa");
  await act(page, "position").click();
  // 60 m north of a: inside b's circle (b is 44 m north, its radius 25).
  await field(page, "north").fill("60");
  await field(page, "north").press("Enter");
  await expect(
    page.locator(".toast", { hasText: `"Pin a" is now in Station B` }),
  ).toBeVisible();
  // 100 m south of b: out of a's circle too.
  await field(page, "north").fill("-100");
  await field(page, "north").press("Enter");
  await expect(
    page.locator(".toast", {
      hasText: `"Pin a" left its station's circle: it is now in a station of its own`,
    }),
  ).toBeVisible();
  const home = (await tourNow(page)).stations.find((/** @type {any} */ s) =>
    s.items.some((/** @type {any} */ i) => i.id === "pa"),
  );
  expect(home.id).not.toBe("a");
  await selectStation(page, home.id);
  await expect(act(page, "lock")).toHaveAttribute("aria-pressed", "false");
});

/**
 * The inspector's fields at one window size, by the prototype's
 * measures: the name in the head, the commands, a field's label and its
 * box, the card's pictures, all inside the dock and the window.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function expectInspectorLayout(page, size) {
  const at = `at ${String(size.width)}x${String(size.height)}`;
  const box = async (/** @type {import("@playwright/test").Locator} */ l) => {
    const b = await l.boundingBox();
    if (b === null) throw new Error(`not shown ${at}`);
    return b;
  };
  const dock = await box(page.locator("#shell-inspector"));
  expect(dock.x, at).toBeGreaterThanOrEqual(0);
  expect(dock.x + dock.width, at).toBeLessThanOrEqual(size.width);
  // The name: a 26 px box in the head, 6 px after the kind's icon.
  const icon = await box(page.locator("#inspector-head .hic"));
  const title = await box(field(page, "title"));
  expect(title.height, at).toBe(26);
  expect(title.x - (icon.x + icon.width), at).toBe(6);
  // The commands: 28 px rows, 6 px in from the dock's 1 px border, one
  // under another.
  const acts = await page.locator("#inspector-body > .acts > .act").all();
  expect(acts.length, at).toBe(3);
  let last = null;
  for (const a of acts) {
    const b = await box(a);
    expect(b.height, at).toBe(28);
    expect(b.x - dock.x, at).toBe(7);
    if (last !== null) expect(b.y, at).toBe(last.y + last.height);
    last = b;
  }
  // A field: its label 74 px, its box 6 px after, 24 px high, inside the
  // dock's 12 px padding (and its left border: the dock is flush with the
  // window's right edge).
  for (const name of ["description", "radius"]) {
    const input = field(page, name);
    const row = input.locator("xpath=ancestor::div[contains(@class,'f')][1]");
    const r = await box(row);
    const label = await box(row.locator("label"));
    const shown = await box(
      name === "radius" ? input.locator("xpath=..") : input,
    );
    expect(label.width, `${name} ${at}`).toBe(74);
    expect(shown.x - (label.x + label.width), `${name} ${at}`).toBe(6);
    expect(shown.height, `${name} ${at}`).toBe(24);
    expect(r.x - dock.x, `${name} ${at}`).toBe(13);
    expect(shown.x + shown.width, `${name} ${at}`).toBeLessThanOrEqual(
      dock.x + dock.width - 12 + 0.5,
    );
  }
  // The card's pictures: 54 x 32 px, after the label's 74 px and a 6 px
  // gap, the label centred beside them.
  const thumb = await box(
    page.locator("#shell-inspector button.thumb").first(),
  );
  expect([thumb.width, thumb.height], at).toEqual([54, 32]);
  const tag = await box(
    page.locator("#shell-inspector .flabel", { hasText: "Card image" }),
  );
  expect(tag.width, at).toBe(74);
  expect(thumb.x - (tag.x + tag.width), at).toBe(6);
  expect(
    Math.abs(tag.y + tag.height / 2 - (thumb.y + thumb.height / 2)),
    at,
  ).toBeLessThanOrEqual(1);
  // Position, open: the anchor, then the heading, then the height.
  const rows = await page
    .locator("#shell-inspector .pos > .f > :is(label, .flabel)")
    .allTextContents();
  expect(rows, at).toEqual(["Anchor", "Heading", "Height"]);
}

test("the inspector's fields sit in place at a phone, a phone in landscape, a tablet and a desktop", async ({
  page,
}) => {
  test.slow();
  await useWideFont(page);
  await answerHosts(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSampleIn3d(page);
  // The gate, whose card can show the tour's image: the picker shows.
  await selectStation(page, "gate");
  for (const size of [
    { width: 1440, height: 900 },
    { width: 820, height: 1180 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect(field(page, "title")).toBeVisible();
    // A folded dock (the dock rule at a narrow window) shows its head
    // only: unfold it to measure.
    const fold = page.locator('#inspector-head [data-act="fold"]');
    if ((await fold.getAttribute("aria-label")) === "Show the details") {
      await fold.click();
    }
    const disc = page.locator('#shell-inspector [data-act="position"]');
    if ((await disc.getAttribute("aria-expanded")) !== "true") {
      await disc.click();
    }
    await expectInspectorLayout(page, size);
  }
});
