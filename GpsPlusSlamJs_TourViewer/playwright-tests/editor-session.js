// @ts-check
import { expect } from "@playwright/test";

import { stationBlocks } from "./tour-fixture.mjs";

/**
 * Helpers for the editor walks that run with no 3D view: WebGL refused
 * before the page loads, so an opened tour shows the page that says the 3D
 * view cannot open, while the File menu, the status line, the toasts and the
 * draft stay in use. An edit goes through the editor session the way a
 * control of the page would (the dev server's `window.__tourEditor` hook,
 * its `edit()`: the inspector's own commit path), and what the tour holds
 * is read from the manifest the page would write.
 */

// The editor fixture's objects (editor-tours.js): the "Town hall" pin, the
// "Fountain" photo; the wrapped tour's pin and the one another program adds.
export const TOWN_HALL = "pin-markup";
export const FOUNTAIN = "photo-ok";
export const WRAPPED_PIN = "pin-wrapped";
export const ADDED_ELSEWHERE = "pin-elsewhere";

/**
 * Take the file picker away and refuse WebGL for every page of `context`
 * (a second tab opens without a 3D view too). A walk that opens in place
 * puts its own picker back after the page loads.
 * @param {import("@playwright/test").BrowserContext} context
 */
export async function withoutWebgl(context) {
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
}

/**
 * Wait until an opened tour shows: the start dialog closed (it closes once
 * the tour it opened is the editor's, so a tour opened again is not edited
 * in its predecessor's stead) and, with no WebGL, the page that says the
 * 3D view cannot open.
 * @param {import("@playwright/test").Page} page
 */
export async function tourShown(page) {
  await expect(page.locator("#open-modal")).toBeHidden();
  await expect(page.locator("#view3d-failed")).toBeVisible();
}

/**
 * One edit through the editor session, followed as an edit of the page's
 * own controls is; the session's answer must be `expected`.
 * @param {import("@playwright/test").Page} page
 * @param {{ act: "editText" | "remove" | "move", id: string, args?: unknown[] }} edit
 * @param {string} expected
 */
export async function sessionEdit(page, edit, expected) {
  await tourShown(page);
  const kind = await page.evaluate(
    ({ act, id, args }) =>
      // @ts-expect-error - the editor's dev-only test hook.
      window.__tourEditor.edit((/** @type {any} */ session) =>
        session[act](id, ...(args ?? [])),
      ),
    edit,
  );
  expect(kind).toBe(expected);
}

/** @param {import("@playwright/test").Page} page @param {string} id @param {string} text */
export const editText = (page, id, text) =>
  sessionEdit(page, { act: "editText", id, args: [text] }, "edited");

/** @param {import("@playwright/test").Page} page @param {string} id */
export const remove = (page, id) =>
  sessionEdit(page, { act: "remove", id }, "deleted");

/**
 * Delete `id` the way the page's own Delete does: the edit, then the
 * "Deleted ..." toast with its Undo button.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
export async function deleteWithUndo(page, id) {
  await tourShown(page);
  await page.evaluate((target) => {
    // @ts-expect-error - the editor's dev-only test hook.
    window.__tourEditor.deleteSelection(target);
  }, id);
}

/**
 * The tour as the page would write it, read back into the test (the
 * helpers that walk it are not in the page).
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<any>}
 */
export function editorManifest(page) {
  return page.evaluate(() =>
    // @ts-expect-error - the editor's dev-only test hook.
    window.__tourEditor.manifest(),
  );
}

/** What `captionOf` answers for an object the tour does not hold: never
 *  a caption, so an object that is there with no caption reads apart. */
export const GONE = null;

/**
 * The text (a pin's) or caption (a photo's) of the tour's object `id` as
 * the page would write it (`undefined`: it has none), or `GONE` when the
 * tour has no such object.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @returns {Promise<string | undefined | null>}
 */
export async function captionOf(page, id) {
  const manifest = await editorManifest(page);
  const block = manifest.stations
    .flatMap((/** @type {any} */ s) => stationBlocks(s))
    .find((/** @type {{ id: string }} */ b) => b.id === id);
  return block === undefined ? GONE : block.caption;
}

/**
 * Where the tour's object `id` stands as the page would write it: its
 * station's place (an object placed on its own is a station of its own)
 * and its pose's position in that station's frame, or `undefined` when
 * the tour has no such object.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @returns {Promise<{ lat: number, lon: number, position: number[] } | undefined>}
 */
export async function placeOf(page, id) {
  const manifest = await editorManifest(page);
  for (const station of manifest.stations) {
    const block = stationBlocks(station).find(
      (/** @type {{ id: string }} */ b) => b.id === id,
    );
    if (block !== undefined) {
      return {
        lat: station.geo.lat,
        lon: station.geo.lon,
        position: [...block.pose.position],
      };
    }
  }
  return undefined;
}

/**
 * Wait until the tour shows and its object `id` reads `caption`
 * (`GONE`: the tour no longer holds it).
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @param {string | null} caption
 */
export async function expectCaption(page, id, caption) {
  await tourShown(page);
  await expect.poll(() => captionOf(page, id)).toBe(caption);
}

/**
 * Set the tour's "no GPS" choice in Tour details and apply it.
 * @param {import("@playwright/test").Page} page
 * @param {boolean} on
 */
export async function setNoGps(page, on) {
  await page.locator("#tour-name").click();
  await page.locator("#details-no-gps").setChecked(on);
  await page.locator("#details-apply").click();
  await expect(page.locator("#details-modal")).toBeHidden();
}
