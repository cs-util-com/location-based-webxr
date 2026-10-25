// @ts-check
/**
 * The desktop editor's top-bar menus, as the specs drive them: File's Open,
 * Save, Save a copy, Tour details, Add debug data, Keep the debug data and
 * Share and publish, and View's Top view, Frame, Show debug data and the
 * view switch. Each command opens its menu by its button and clicks its
 * item, as a creator does - so a spec checks the menus too, and a renamed
 * item is changed here once.
 */

/** File's items by command. */
const FILE_ITEMS = /** @type {const} */ ({
  open: "#file-open",
  save: "#file-save",
  saveCopy: "#file-save-copy",
  details: "#file-details",
  debugAdd: "#file-debug-add",
  keepWalk: "#file-keep-walk",
  publish: "#file-publish",
});

/** View's items by command. */
const VIEW_ITEMS = /** @type {const} */ ({
  top: "#studio-top",
  frame: "#studio-frame",
  debug: "#view-debug",
  switch: "#view-switch",
});

/**
 * @typedef {import("@playwright/test").Page} Page
 * @typedef {keyof typeof FILE_ITEMS} FileCommand
 * @typedef {keyof typeof VIEW_ITEMS} ViewCommand
 */

/**
 * Open a menu by its button, unless it is open already.
 * @param {Page} page
 * @param {string} button
 */
async function openMenu(page, button) {
  const b = page.locator(button);
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
}

/**
 * File's item for `command` (for its state: disabled, its words, checked).
 * @param {Page} page
 * @param {FileCommand} command
 */
export function fileItem(page, command) {
  return page.locator(FILE_ITEMS[command]);
}

/**
 * View's item for `command`.
 * @param {Page} page
 * @param {ViewCommand} command
 */
export function viewItem(page, command) {
  return page.locator(VIEW_ITEMS[command]);
}

/**
 * Run File's `command`: open the menu, click the item.
 * @param {Page} page
 * @param {FileCommand} command
 */
export async function fileCommand(page, command) {
  await openMenu(page, "#file-menu-btn");
  await fileItem(page, command).click();
}

/**
 * Run View's `command`: open the menu, click the item.
 * @param {Page} page
 * @param {ViewCommand} command
 */
export async function viewCommand(page, command) {
  await openMenu(page, "#view-menu-btn");
  await viewItem(page, command).click();
}

/** File > Save. @param {Page} page */
export const save = (page) => fileCommand(page, "save");

/** File > Share and publish… (once "Done"). @param {Page} page */
export const publish = (page) => fileCommand(page, "publish");

/** File > Open… (once "Open another tour"). @param {Page} page */
export const openAnother = (page) => fileCommand(page, "open");

/**
 * Open tours on the 2D map, not in the 3D view (the default): most editor
 * specs work on the map's markers, rail and card. The page reads the flag
 * in its dev build only. Call it before the page loads; it holds for every
 * page of the context.
 * @param {import("@playwright/test").BrowserContext} context
 */
export async function startOnMap(context) {
  await context.addInitScript(() => {
    /** @type {any} */ (window).__tourEditorStartOnMap = true;
  });
}
