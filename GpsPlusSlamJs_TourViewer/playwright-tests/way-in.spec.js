// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";

/**
 * The way in (tour editor plan 2026-10-17-1816, W1): the first paint of
 * both pages, the "You already have a tour?" box, step 5 on a computer,
 * and the Android-only wording (D8).
 *
 * Why these tests matter: the owner opened /tour and saw "an empty grey
 * page with an empty box" before the page settled. The page's light paper
 * and its hidden header are keyed on `body[data-mode]`, and that used to be
 * set only by `main.ts`, after its imports - so the first paint showed the
 * design system's dark default, the plain header and step 5's empty card.
 * Nothing measured the page BEFORE its module ran: every spec waits for
 * `load`, by which time the module has run. These hold the module back and
 * look at what is painted meanwhile.
 */

const SAMPLE = "http://127.0.0.1:5197/ranges-ok/sample-tour.zip";
const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
const PHONE = { width: 412, height: 915 };

/** The setup and visitor page's paper (`index.html`, the L5 look). */
const PAPER = "rgb(244, 238, 223)";
/** `main.ts` writes `body[data-debug]` at boot on every page, whatever
 *  the URL ("false" without `?debug=1`); unset until it has run. The
 *  sentinel that proves the module was still held when the page was
 *  measured (M1 review #5: the attribute read before was unset either
 *  way, so it could not fail).
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<boolean>}
 */
async function moduleHasRun(page) {
  return page.evaluate(() => document.body.dataset["debug"] !== undefined);
}

/** The editor's own paper (`src/editor/editor.css`). */
const EDITOR_PAPER = "rgb(242, 241, 237)";

/**
 * Open `path` with the module script `script` held back, and wait until
 * the markup and the page's stylesheets are there: what a phone paints
 * while the module still loads.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} path
 * @param {string} script the module's URL glob
 * @param {string} sheet the end of a stylesheet's URL to wait for
 * @returns {Promise<() => Promise<void>>} lets the module through
 */
async function openWithModuleHeld(page, path, script, sheet) {
  /** @type {(() => void) | undefined} */
  let release;
  const held = new Promise((resolve) => {
    release = () => {
      resolve(undefined);
    };
  });
  await page.route(script, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(path, { waitUntil: "commit" });
  // "interactive": the parser has read the whole markup. A held module
  // script is deferred, so it cannot have run yet (M1 review #5: the old
  // wait on `body > *:last-child` was true from the body's first child).
  await page.waitForFunction(
    (end) =>
      document.readyState !== "loading" &&
      Array.from(document.styleSheets).some((s) =>
        (s.href ?? "").endsWith(end),
      ),
    sheet,
  );
  return async () => {
    release?.();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  };
}

test.describe("the first paint, before the page's module has run", () => {
  // The design system's default is dark; a light device gets a light sheet
  // of its own, which would hide the wrong colour this guards against.
  test.use({ colorScheme: "dark" });

  test("the setup page paints its paper, without the header or an empty step", async ({
    page,
  }) => {
    const release = await openWithModuleHeld(
      page,
      "/",
      "**/src/main.ts*",
      "/design.css",
    );
    const painted = await page.evaluate(() => ({
      mode: document.body.dataset["mode"],
      paper: getComputedStyle(document.body).backgroundColor,
      header: getComputedStyle(
        /** @type {Element} */ (document.querySelector("body > header")),
      ).display,
      step5: getComputedStyle(
        /** @type {Element} */ (document.getElementById("step-measure")),
      ).display,
    }));
    // Still held: nothing of main.ts has run, so the inline script alone
    // painted this.
    expect(await moduleHasRun(page)).toBe(false);
    expect(painted).toEqual({
      mode: "creator",
      paper: PAPER,
      header: "none",
      step5: "none",
    });
    await release();
    // The sentinel can change: once the module runs, it does.
    await expect.poll(() => moduleHasRun(page)).toBe(true);
  });

  test("the visitor's page paints its paper, without the header", async ({
    page,
  }) => {
    const release = await openWithModuleHeld(
      page,
      `/?qr=${encodeURIComponent(SAMPLE)}`,
      "**/src/main.ts*",
      "/design.css",
    );
    const painted = await page.evaluate(() => ({
      mode: document.body.dataset["mode"],
      paper: getComputedStyle(document.body).backgroundColor,
      header: getComputedStyle(
        /** @type {Element} */ (document.querySelector("body > header")),
      ).display,
    }));
    expect(await moduleHasRun(page)).toBe(false);
    expect(painted).toEqual({ mode: "visitor", paper: PAPER, header: "none" });
    await release();
    await expect.poll(() => moduleHasRun(page)).toBe(true);
  });

  test("the editor paints its own look, not the browser's plain page", async ({
    page,
  }) => {
    // The editor's stylesheet is a <link> of the page, not an import of its
    // module: a module's CSS arrives with the module (in a dev server it is
    // injected by the module itself).
    const release = await openWithModuleHeld(
      page,
      "/edit.html",
      "**/src/editor/edit-main.ts*",
      "/editor.css",
    );
    const paper = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(paper).toBe(EDITOR_PAPER);
    await release();
  });
});

/**
 * Why these tests matter: a returning creator could not find the desktop
 * editor (reachable only by typing /tour/edit), and on a phone there was
 * no way back into a tour except through the six steps. The box sits BELOW
 * the map and the steps, so the first-time story stays first; which half
 * shows follows the page's AR check: a device without AR gets the editor,
 * a phone with AR opens a tour and asks "Play it, or continue setting it
 * up?" (plan 2026-10-15-0348, round 2).
 */
test.describe("a computer (no AR)", () => {
  // No fakes: headless Chromium has no WebXR, i.e. a computer.
  test("offers the editor below the map and the steps", async ({ page }) => {
    await page.goto("/?nocache=1");
    const box = page.getByTestId("have-tour");
    await expect(box).toBeVisible({ timeout: 10000 });
    await expect(box.getByRole("heading")).toHaveText(
      "You already have a tour?",
    );
    const editor = page.getByTestId("have-tour-editor");
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText("Open the editor");
    await expect(editor).toHaveAttribute("href", "edit.html");
    // A link wearing the button: the sheet's .btn is written for a
    // <button>, so the label sat at the top, underlined, without this.
    await expect(editor).toHaveCSS("align-items", "center");
    await expect(editor).toHaveCSS("text-decoration-line", "none");
    // What the editor's Save does in THIS browser (PR #637 review): back
    // into the chosen file where the file picker exists, else a new copy.
    const picker = await page.evaluate(
      () => typeof Reflect.get(window, "showOpenFilePicker") === "function",
    );
    await expect(page.getByTestId("have-tour-editor-text")).toContainText(
      picker
        ? "save it back into the tour file"
        : "a new copy of the tour file",
    );
    await expect(page.getByTestId("have-tour-phone")).toBeHidden();
    // Below the story, never in front of it.
    const stage = await page.getByTestId("setup-stage").boundingBox();
    const boxAt = await box.boundingBox();
    expect(boxAt?.y ?? 0).toBeGreaterThanOrEqual(
      (stage?.y ?? 0) + (stage?.height ?? 0),
    );
    await editor.click();
    await expect(page).toHaveURL(/\/edit\.html$/);
    await expect(page.locator("#open-title")).toHaveText("Open a tour");
  });

  test("the box waits for the AR check: no heading over an empty box", async ({
    page,
  }) => {
    // Why (PR #637 review): while the check ran (and before it began) both
    // halves were hidden but the section was not, so "You already have a
    // tour?" stood over nothing. The states are set by hand: the real
    // check settles too fast to be caught in between.
    await page.goto("/?nocache=1");
    const box = page.getByTestId("have-tour");
    await expect(box).toBeVisible({ timeout: 10000 });
    const arState = (/** @type {string | null} */ state) =>
      page.evaluate((value) => {
        const button = document.getElementById("enter-ar");
        if (button === null) throw new Error("no #enter-ar");
        if (value === null) button.removeAttribute("data-ar-state");
        else button.setAttribute("data-ar-state", value);
      }, state);
    await arState("checking");
    await expect(box).toBeHidden();
    await arState(null);
    await expect(box).toBeHidden();
    await arState("unsupported");
    await expect(box).toBeVisible();
  });

  test("step 5 points to the editor and to an Android phone, not to a dead button", async ({
    page,
  }) => {
    // Why (plan review #9): step 5 on a computer was a disabled "AR not
    // supported on this device" and nothing else.
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("enter-ar")).toHaveAttribute(
      "data-ar-state",
      "unsupported",
      { timeout: 10000 },
    );
    await page.getByTestId("station-measure").click();
    const pointer = page.getByTestId("measure-desktop");
    await expect(pointer).toBeVisible();
    await expect(pointer).toContainText("Android phone with Chrome");
    await expect(
      pointer.getByRole("link", { name: "Open the editor" }),
    ).toHaveAttribute("href", "edit.html");
    await expect(page.getByTestId("enter-ar")).toBeHidden();
  });

  test("the visitor's page says the tour needs an Android phone with Chrome", async ({
    page,
  }) => {
    // D8: Android-only, said plainly; no view without AR.
    await page.goto(`/?qr=${encodeURIComponent(SAMPLE)}`);
    await expect(page.getByTestId("ar-status")).toContainText(
      "needs an Android phone with Chrome",
      { timeout: 10000 },
    );
    await expect(page.getByTestId("have-tour")).toBeHidden();
    // Why (PR #637 review, coderabbit): the rule that shows step 5's
    // computer pointer once AR is unsupported has no mode check. It is
    // `.creator-only` and keeps `hidden` on a visitor's page, which the
    // design system's [hidden] rule wins over.
    await expect(page.getByTestId("enter-ar")).toHaveAttribute(
      "data-ar-state",
      "unsupported",
    );
    await expect(page.getByTestId("measure-desktop")).toBeHidden();
  });
});

// The claim sits in the landing's first lines (its first five seconds),
// under the motivation, not further down where a reader may never get.
test("the setup page says the tour needs an Android phone with Chrome", async ({
  page,
}) => {
  await page.goto("/?nocache=1");
  await expect(page.getByTestId("landing-needs")).toContainText(
    "Android phones with Chrome",
  );
});

test.describe("a phone with AR", () => {
  test.use({ viewport: PHONE });

  test.beforeEach(async ({ page }) => {
    await installTourViewerArFakes(page);
  });

  test("opens a tour from its link, then asks: play it, or continue setting it up", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    const phone = page.getByTestId("have-tour-phone");
    await expect(phone).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("have-tour-desktop")).toBeHidden();
    await page.getByTestId("have-tour-link").fill(ARCHIVE);
    const open = page.getByTestId("have-tour-open");
    await open.click();
    const ask = page.getByTestId("have-tour-ask");
    await expect(ask).toBeVisible({ timeout: 15000 });
    await expect(ask).toContainText("Play it, or continue setting it up?");
    await expect(open).toHaveText("Open the link");
    await expect(open).toBeEnabled();
    const play = page.getByTestId("have-tour-play");
    await expect(play).toHaveAttribute(
      "href",
      `?qr=${encodeURIComponent(ARCHIVE)}`,
    );
    // Continue: the steps, at the step the open moved them to.
    await page.getByTestId("have-tour-continue").click();
    await expect(ask).toBeHidden();
    await expect(page.getByTestId("print-panel")).toHaveAttribute("open", "");
    await expect(page.getByTestId("setup-card")).toBeInViewport();
    // Play: the visitor's page for that link.
    await open.click();
    await expect(ask).toBeVisible({ timeout: 15000 });
    await play.click();
    await expect(page.locator("body")).toHaveAttribute("data-mode", "visitor");
    await expect(page.getByTestId("visitor-screen")).toBeVisible();
  });

  test("opens a tour from this device, and offers only to continue: a file has no link to play", async ({
    page,
    request,
  }) => {
    const response = await request.get(ARCHIVE);
    await page.goto("/?nocache=1");
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("have-tour-file").click();
    await (
      await chooser
    ).setFiles({
      name: "castle.zip",
      mimeType: "application/zip",
      buffer: await response.body(),
    });
    const ask = page.getByTestId("have-tour-ask");
    await expect(ask).toBeVisible({ timeout: 15000 });
    await expect(ask).toContainText("To play it, open its link");
    await expect(page.getByTestId("have-tour-play")).toBeHidden();
    await expect(page.getByTestId("have-tour-file")).toHaveText(
      "From this device",
    );
  });

  test("says why a link did not open, and gives the buttons back", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await page
      .getByTestId("have-tour-link")
      .fill("http://127.0.0.1:5197/no-cors/tour.zip");
    await page.getByTestId("have-tour-open").click();
    // In the box's own words (M1 review #3): the way around is its other
    // button, not step 2's printing advice.
    const status = page.getByTestId("have-tour-status");
    await expect(status).toContainText("refused the browser access", {
      timeout: 15000,
    });
    await expect(status).toContainText('open it with "From this device"');
    await expect(status).not.toContainText("printed code");
    await expect(page.getByTestId("have-tour-ask")).toBeHidden();
    await expect(page.getByTestId("have-tour-open")).toBeEnabled();
  });
});
