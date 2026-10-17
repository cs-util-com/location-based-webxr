// @ts-check
import { expect, test } from "@playwright/test";

/**
 * The way in (tour editor plan 2026-10-17-1816, W1): the first paint of
 * both pages.
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

/** The setup and visitor page's paper (`index.html`, the L5 look). */
const PAPER = "rgb(244, 238, 223)";
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
  await page.waitForFunction(
    (end) =>
      document.querySelector("body > *:last-child") !== null &&
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
      // Still held: nothing of main.ts has run.
      wired: document.body.dataset["tourOpen"],
    }));
    expect(painted).toEqual({
      mode: "creator",
      paper: PAPER,
      header: "none",
      step5: "none",
      wired: undefined,
    });
    await release();
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
    expect(painted).toEqual({ mode: "visitor", paper: PAPER, header: "none" });
    await release();
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
