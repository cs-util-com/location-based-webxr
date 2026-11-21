// @ts-check
import { expect, test } from "@playwright/test";

import { drawSheet } from "./character-sheet.js";

/**
 * Why this test matters: the character maker (`characters.html`) is the
 * only way a guide character gets onto a device, and most of what can go
 * wrong with it lives at device seams the unit tests replace: the cut
 * worker, the private file system, canvas PNG writing, downloads and file
 * inputs. These walk the real page with a synthetic four-pose sheet drawn
 * here (not by the code under test): make, save, find it in the library
 * after a reload, give it away as a file and take that file back in, and
 * the refusals and failures a person meets, each with its in-progress and
 * final state. A layout pin per viewport keeps the arrangement chosen in
 * the prototype (`public/prototypes/character-library-1/maker.html`).
 *
 * What they cannot catch: how good the cut is on real image-AI pictures
 * (the cut's own unit tests and a by-eye check), and a clipboard paste
 * (headless Chromium has no user clipboard to grant).
 */

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone sideways", width: 844, height: 390 },
  { name: "desktop", width: 1440, height: 900 },
];

/** A plain white picture: nothing to cut. */
function drawBlank() {
  const c = document.createElement("canvas");
  c.width = 1536;
  c.height = 1024;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, c.width, c.height);
  return c.toDataURL("image/png").split(",")[1];
}

/** Records every label a button shows, so a short in-progress label that
 *  is gone before an assertion could look is still seen. */
async function recordLabels(page, selector) {
  await page.evaluate((sel) => {
    const el = /** @type {HTMLElement} */ (document.querySelector(sel));
    const seen = [el.textContent?.trim() ?? ""];
    new MutationObserver(() => seen.push(el.textContent?.trim() ?? "")).observe(
      el,
      { childList: true, characterData: true, subtree: true },
    );
    /** @type {any} */ (window).__labels = seen;
  }, selector);
}
const labels = (page) =>
  page.evaluate(() => /** @type {any} */ (window).__labels);

/**
 * A slow cut worker and a slow PNG writer, switched on from the test with
 * `window.__cutDelay` and `window.__pngDelay` (ms): a worker's final
 * answer (not its phase reports) and a canvas's toBlob are held that long.
 * `window.__cutPosts` counts the cut requests sent, `window.__cutAnswers`
 * the final answers handed to the page; the count moves after the page's
 * handler ran, so a test that sees it can look at what the answer did.
 * Installed before the page loads, so the page's own worker is wrapped.
 */
function slowSeams() {
  const w = /** @type {any} */ (window);
  w.__cutDelay = 0;
  w.__pngDelay = 0;
  w.__cutPosts = 0;
  w.__cutAnswers = 0;
  const RealWorker = window.Worker;
  window.Worker = class extends RealWorker {
    /** @param {any} m @param {any} [t] */
    postMessage(m, t) {
      if (m && m.type === "cut") w.__cutPosts += 1;
      super.postMessage(m, t);
    }
    set onmessage(fn) {
      super.onmessage = (/** @type {MessageEvent} */ ev) => {
        if (ev.data && ev.data.type === "phase") return fn?.call(this, ev);
        setTimeout(() => {
          fn?.call(this, ev);
          w.__cutAnswers += 1;
        }, w.__cutDelay);
      };
    }
    get onmessage() {
      return super.onmessage;
    }
  };
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
    toBlob.call(this, (b) => setTimeout(() => cb(b), w.__pngDelay), ...rest);
  };
}
const counter = (page, name) =>
  page.evaluate((n) => /** @type {any} */ (window)[n], name);

async function toStep4(page) {
  await page.goto("/characters.html");
  await page.locator("#makeBtn").click();
  await page.locator("#desc").fill("a friendly fox ranger with a green hat");
  for (let i = 0; i < 3; i++) await page.locator("#nextBtn").click();
  await expect(page.locator('[data-panel="3"]')).toBeVisible();
}

async function bringPicture(page, draw) {
  const b64 = await page.evaluate(draw);
  await page.locator("#picFile").setInputFiles({
    name: "sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from(b64, "base64"),
  });
}

test.describe("character maker", () => {
  test("makes a character, keeps it over a reload, and gives it away and back as a file", async ({
    page,
    browser,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await toStep4(page);
    await bringPicture(page, drawSheet);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    await expect(page.locator("#summary")).toContainText("4 poses found");
    // "As drawn" is preselected; "Steady body" is one tap away.
    await expect(
      page.locator('input[name="style"][value="drawn"]'),
    ).toBeChecked();
    await page
      .locator('input[name="style"][value="steady"]')
      .check({ force: true });
    await expect(page.locator("#toasts")).toContainText("Steady body chosen");
    // The cut settings are folded away until asked for.
    await expect(page.locator("#cutBox")).not.toHaveAttribute("open", "");

    await page.locator("#nextBtn").click();
    await page.locator("#charName").fill("Ranger Rita");
    await recordLabels(page, "#nextBtn");
    await page.locator("#nextBtn").click();
    await expect(page.locator("#savedBox")).toContainText(
      "Ranger Rita is on this device now",
    );
    expect(await labels(page)).toContain("Saving...");
    await expect(page.locator("#toasts")).toContainText(
      "Saved on this device: Ranger Rita",
    );

    await page.reload();
    await expect(page.locator("#libList li")).toHaveCount(1);
    const row = page.locator("#libList li").first();
    await expect(row).toContainText("Ranger Rita");
    await expect(row.locator("img.thumb")).toHaveAttribute(
      "src",
      /^data:image\/png/,
    );

    const downloaded = page.waitForEvent("download");
    await row.locator('[data-act="file"]').click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/^Ranger Rita.*\.png$/);
    const path = await file.path();

    // Another browser profile: an empty library takes the file in.
    const other = await browser.newContext();
    const page2 = await other.newPage();
    await page2.goto("/characters.html");
    await expect(page2.locator("#libCount")).toHaveText("0 characters");
    // The downloaded copy has no file extension, so the browser gives it no
    // type: the import must go by the bytes, as it must for a file a chat
    // app saved without one.
    await page2.locator("#impFile").setInputFiles(path);
    await expect(page2.locator("#libList li")).toHaveCount(1);
    await expect(page2.locator("#libList li").first()).toContainText(
      "Ranger Rita",
    );
    await expect(page2.locator("#toasts")).toContainText(
      "Imported Ranger Rita",
    );
    await other.close();
    expect(errors).toEqual([]);
  });

  test("a picture that cannot be cut says why, and a JPEG is refused on import", async ({
    page,
  }) => {
    await toStep4(page);
    await bringPicture(page, drawBlank);
    await expect(page.locator("#cutErr")).toBeVisible();
    await expect(page.locator("#cutErr")).toContainText("No figure was found");
    await expect(page.locator('[data-panel="3"]')).toBeVisible();
    await expect(page.locator("#toasts .err")).toBeVisible();

    await page.locator("#toHome").click();
    await page.locator("#impFile").setInputFiles({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]),
    });
    await expect(page.locator("#homeErr")).toBeVisible();
    await expect(page.locator("#homeErr")).toContainText("Nothing was added.");
    await expect(page.locator("#libList li.empty-line")).toBeVisible();
    await expect(page.locator("#importBtn")).toBeEnabled();
  });

  test("a failed save says so, restores the button and keeps the character", async ({
    page,
  }) => {
    await toStep4(page);
    await bringPicture(page, drawSheet);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    await page.locator("#nextBtn").click();
    await page.evaluate(() => {
      FileSystemFileHandle.prototype.createWritable = () =>
        Promise.reject(new DOMException("disk full", "QuotaExceededError"));
    });
    await recordLabels(page, "#nextBtn");
    await page.locator("#nextBtn").click();
    await expect(page.locator("#toasts .err")).toContainText(
      "Saving did not work",
    );
    expect(await labels(page)).toContain("Saving...");
    await expect(page.locator("#nextBtn")).toBeEnabled();
    await expect(page.locator("#nextBtn")).not.toHaveText("Saving...");
    await expect(page.locator("#savedBox")).toBeHidden();
  });

  // Why: Discard on the library view starts a new character, so the next
  // "Make a character" must show an empty description, not the discarded
  // text the draft no longer holds; its Undo brings the text back.
  test("a discarded character leaves no text behind, and Undo brings it back", async ({
    page,
  }) => {
    await page.goto("/characters.html");
    await page.locator("#makeBtn").click();
    // The box holds no more than the draft keeps over a reload.
    await expect(page.locator("#desc")).toHaveAttribute("maxlength", "2000");
    await page.locator("#desc").fill("a friendly fox ranger with a green hat");
    await page.locator("#toHome").click();
    await page.locator("#draftRow [data-discard]").click();
    await expect(page.locator("#draftRow")).toBeHidden();
    await page.locator("#makeBtn").click();
    await expect(page.locator("#desc")).toHaveValue("");

    await page.locator("#toHome").click();
    await page.locator("#makeBtn").click();
    await page.locator("#desc").fill("a sleepy owl librarian");
    await page.locator("#toHome").click();
    await page.locator("#draftRow [data-discard]").click();
    await page.locator("#undoBox button").click();
    await page.locator("#draftRow [data-continue]").click();
    await expect(page.locator("#desc")).toHaveValue("a sleepy owl librarian");
  });

  // Why: Undo of "Start over" brings the old character back with its cut;
  // once a new picture is cut, that Undo would put the old picture over
  // the new one, so the new picture takes the offer away.
  test("a new picture takes away the Undo of Start over", async ({ page }) => {
    await toStep4(page);
    await bringPicture(page, drawSheet);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    await page.locator("#restart").click();
    await expect(page.locator("#undoBox button")).toBeVisible();
    await bringPicture(page, drawSheet);
    // Read at once: the offer would also go by itself after a few seconds,
    // so a later look could not tell the two apart.
    expect(await page.locator("#undoBox button").count()).toBe(0);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    await expect(page.locator("#summary")).toContainText("4 poses found");
  });

  // Why: "Adjust the cut" cuts the picture again in the worker. When that
  // answer arrives after "Start over", there is no cut on the page for it
  // to replace, so it is dropped, and the Undo that follows shows the old
  // cut without a line claiming it was just updated. The same holds when
  // Start over comes before the re-cut even began: the "Cutting again"
  // line does not stay behind.
  test("a re-cut that lands after Start over is dropped", async ({ page }) => {
    await page.addInitScript(slowSeams);
    await toStep4(page);
    await bringPicture(page, drawSheet);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    const posts = await counter(page, "__cutPosts");
    const answers = await counter(page, "__cutAnswers");
    await page.evaluate(() => {
      /** @type {any} */ (window).__cutDelay = 1500;
      const r = /** @type {HTMLInputElement} */ (
        document.querySelector("#rEdge")
      );
      r.value = String(Number(r.value) + 1);
      r.dispatchEvent(new Event("input"));
    });
    await expect.poll(() => counter(page, "__cutPosts")).toBe(posts + 1);
    await page.locator("#restart").click();
    await expect.poll(() => counter(page, "__cutAnswers")).toBe(answers + 1);
    await page.locator("#undoBox button").click();
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    await expect(page.locator("#cutStatus")).toHaveText("");
    await expect(page.locator("#stage")).not.toHaveClass(/recutting/);

    // A slider moved and Start over in one go: the re-cut has not begun.
    await page.evaluate(() => {
      const r = /** @type {HTMLInputElement} */ (
        document.querySelector("#rEdge")
      );
      r.value = String(Number(r.value) - 1);
      r.dispatchEvent(new Event("input"));
      /** @type {HTMLButtonElement} */ (
        document.querySelector("#restart")
      ).click();
    });
    await expect(page.locator("#cutStatus")).toHaveText("");
    await expect(page.locator("#stage")).not.toHaveClass(/recutting/);
  });

  // Why: after a cut the page waits a moment before it shows the check
  // step; a second picture brought in during that moment starts its own
  // cut, and the first cut's end must not mark the second one as over
  // (the picture buttons would come back while it still cuts).
  test("the end of one cut does not end the next one", async ({ page }) => {
    await page.addInitScript(slowSeams);
    await toStep4(page);
    const sheet = await page.evaluate(drawSheet);
    await page.evaluate((b64) => {
      const w = /** @type {any} */ (window);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const second = new File([bytes], "second.png", { type: "image/png" });
      const pick = /** @type {HTMLButtonElement} */ (
        document.querySelector("#pickBtn")
      );
      const input = /** @type {HTMLInputElement} */ (
        document.querySelector("#picFile")
      );
      const toasts = /** @type {HTMLElement} */ (
        document.querySelector("#toasts")
      );
      w.__enabledWhileCutting = false;
      let sent = false;
      // The moment the first cut reports its result, the second picture
      // comes in, and its answer is held back.
      new MutationObserver(() => {
        if (sent || !toasts.textContent?.includes("Four poses found")) return;
        sent = true;
        w.__cutDelay = 1500;
        const dt = new DataTransfer();
        dt.items.add(second);
        input.files = dt.files;
        input.dispatchEvent(new Event("change"));
      }).observe(toasts, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      new MutationObserver(() => {
        if (sent && w.__cutAnswers < 2 && !pick.disabled) {
          w.__enabledWhileCutting = true;
        }
      }).observe(pick, { attributes: true, attributeFilter: ["disabled"] });
    }, sheet);
    await page.locator("#picFile").setInputFiles({
      name: "sheet.png",
      mimeType: "image/png",
      buffer: Buffer.from(sheet, "base64"),
    });
    await expect
      .poll(() => counter(page, "__cutAnswers"), { timeout: 15000 })
      .toBe(2);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    expect(await counter(page, "__enabledWhileCutting")).toBe(false);
  });

  // Why: the pictures are written before the character is saved, and a
  // name typed meanwhile is the one the author sees, so it is the one
  // saved.
  test("a name typed while the pictures are written is the one saved", async ({
    page,
  }) => {
    await page.addInitScript(slowSeams);
    await toStep4(page);
    await bringPicture(page, drawSheet);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    await page.locator("#nextBtn").click();
    await page.locator("#charName").fill("Ranger Rita");
    await page.evaluate(() => {
      /** @type {any} */ (window).__pngDelay = 800;
    });
    await page.locator("#nextBtn").click();
    await expect(page.locator("#nextBtn")).toHaveText("Saving...");
    await page.locator("#charName").fill("Ranger Rob");
    await expect(page.locator("#savedBox")).toContainText(
      "Ranger Rob is on this device now",
    );
  });

  // Why: the save reads the name late (above), so a Discard while the
  // pictures are written would save the fresh draft's empty name and
  // description, and mark that fresh draft as saved. The save goes only
  // to the draft it was started from; a character put away meanwhile is
  // not saved, and the page says so.
  test("a character discarded while it is saved is not saved", async ({
    page,
  }) => {
    await page.addInitScript(slowSeams);
    await toStep4(page);
    await bringPicture(page, drawSheet);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    await page.locator("#nextBtn").click();
    await page.locator("#charName").fill("Ranger Rita");
    await page.evaluate(() => {
      /** @type {any} */ (window).__pngDelay = 800;
    });
    await page.locator("#nextBtn").click();
    await expect(page.locator("#nextBtn")).toHaveText("Saving...");
    await page.locator("#toHome").click();
    await page.locator("#draftRow [data-discard]").click();
    await expect(page.locator("#toasts")).toContainText(
      "The character was not saved",
    );
    await page.reload();
    await expect(page.locator("#libCount")).toHaveText("0 characters");
  });

  // Why: Start over sits in the header next to the save; while the
  // character is written it waits, so a tap cannot replace the draft being
  // saved, and it comes back when the save has ended.
  test("Start over waits while the character is saved", async ({ page }) => {
    await page.addInitScript(slowSeams);
    await toStep4(page);
    await bringPicture(page, drawSheet);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    await page.locator("#nextBtn").click();
    await page.evaluate(() => {
      /** @type {any} */ (window).__pngDelay = 800;
    });
    await page.locator("#nextBtn").click();
    await expect(page.locator("#nextBtn")).toHaveText("Saving...");
    await expect(page.locator("#restart")).toBeDisabled();
    await expect(page.locator("#savedBox")).toBeVisible();
    await expect(page.locator("#restart")).toBeEnabled();
  });

  // Why: a re-cut from the sliders shows "Cutting again" over a dimmed
  // stage. A new picture brought in while one re-cut runs and the next
  // waits ends the waiting one as aborted; the line and the dimming of a
  // cut that is gone must not stay behind over the new picture's check.
  // The aborted re-cut leaves them alone (a newer slider change may own
  // them); the running one clears them when it lands without a cut, and
  // the new picture's cut waits for it, so they are gone before its check.
  test("a new picture during a re-cut leaves no re-cut line behind", async ({
    page,
  }) => {
    await page.addInitScript(slowSeams);
    await toStep4(page);
    const sheet = await page.evaluate(drawSheet);
    await page.locator("#picFile").setInputFiles({
      name: "sheet.png",
      mimeType: "image/png",
      buffer: Buffer.from(sheet, "base64"),
    });
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    const posts = await counter(page, "__cutPosts");
    const answers = await counter(page, "__cutAnswers");
    const nudge = (by) =>
      page.evaluate((d) => {
        const r = /** @type {HTMLInputElement} */ (
          document.querySelector("#rEdge")
        );
        r.value = String(Number(r.value) + d);
        r.dispatchEvent(new Event("input"));
      }, by);
    await page.evaluate(() => {
      /** @type {any} */ (window).__cutDelay = 1500;
    });
    await nudge(1);
    await expect.poll(() => counter(page, "__cutPosts")).toBe(posts + 1);
    // A second change while the first re-cut runs: its re-cut waits. The
    // new picture comes in after that re-cut was asked for (the sliders
    // wait 220 ms) and replaces it.
    await nudge(-1);
    await page.evaluate(
      (b64) =>
        new Promise((done) =>
          setTimeout(() => {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const dt = new DataTransfer();
            dt.items.add(
              new File([bytes], "second.png", { type: "image/png" }),
            );
            const input = /** @type {HTMLInputElement} */ (
              document.querySelector("#picFile")
            );
            input.files = dt.files;
            input.dispatchEvent(new Event("change"));
            done(null);
          }, 500),
        ),
      sheet,
    );
    await expect
      .poll(() => counter(page, "__cutAnswers"), { timeout: 15000 })
      .toBe(answers + 2);
    await expect(page.locator('[data-panel="4"]')).toBeVisible();
    await expect(page.locator("#cutStatus")).toHaveText("");
    await expect(page.locator("#stage")).not.toHaveClass(/recutting/);
  });

  for (const vp of VIEWPORTS) {
    test(`keeps the prototype's arrangement on a ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await toStep4(page);
      await bringPicture(page, drawSheet);
      await expect(page.locator('[data-panel="4"]')).toBeVisible();
      const talk = await page.locator("#pvTalk").boundingBox();
      const beckon = await page.locator("#pvBeckon").boundingBox();
      const rail = await page.locator("#rail").boundingBox();
      const body = await page.locator("#body").boundingBox();
      const actions = await page.locator(".actions").boundingBox();
      if (!talk || !beckon || !rail || !body || !actions)
        throw new Error("not laid out");
      // The two moving previews stand side by side, the same size.
      expect(Math.abs(talk.y - beckon.y)).toBeLessThan(2);
      expect(beckon.x).toBeGreaterThan(talk.x + talk.width);
      expect(Math.abs(talk.width - beckon.width)).toBeLessThan(2);
      // The Back / Next bar sits at the bottom of the window.
      expect(actions.y + actions.height).toBeGreaterThan(vp.height - 2);
      if (vp.name === "desktop") {
        // The steps are a column on the left of the panel.
        expect(rail.x + rail.width).toBeLessThanOrEqual(body.x + 1);
        expect(rail.height).toBeGreaterThan(body.height / 2);
      } else if (vp.name === "phone sideways") {
        // The steps move into the header line to leave height for the panel.
        expect(rail.y + rail.height).toBeLessThanOrEqual(body.y + 1);
        expect(rail.height).toBeLessThan(70);
      } else {
        // The steps are a row above the panel, across the width.
        expect(rail.y + rail.height).toBeLessThanOrEqual(body.y + 1);
        expect(rail.width).toBeGreaterThan(vp.width * 0.8);
      }
    });

    // Why: the save step and the library view are the two the creator
    // meets every time; a style change that stacked the picture over the
    // name, or let the buttons drift off the column, would pass a check
    // for presence alone. The numbers are the prototype's, measured side
    // by side at these viewports.
    test(`keeps the prototype's save step and library view on a ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await toStep4(page);
      await bringPicture(page, drawSheet);
      await expect(page.locator('[data-panel="4"]')).toBeVisible();
      await page.locator("#nextBtn").click();
      await page.locator("#charName").fill("Ranger Rita");
      /** @param {string} selector */
      const box = async (selector) => {
        const b = await page.locator(selector).first().boundingBox();
        if (b === null) throw new Error(`${selector} is not laid out`);
        return b;
      };
      const head = await box('[data-panel="5"] h2');
      const grid = await box(".save-grid");
      const pic = await box("#pvSave");
      const name = await box("#charName");
      const facts = await box("#facts");
      // The picture on the left at 3:4, the name and the facts beside it,
      // 16 px apart, the name field to the grid's right edge.
      expect(head.y + head.height).toBeLessThanOrEqual(grid.y);
      expect(Math.abs(pic.x - grid.x)).toBeLessThan(2);
      expect(Math.abs(pic.y - grid.y)).toBeLessThan(2);
      expect(Math.abs(pic.width / pic.height - 0.75)).toBeLessThan(0.02);
      expect(Math.round(name.x - (pic.x + pic.width))).toBe(16);
      expect(
        Math.abs(name.x + name.width - (grid.x + grid.width)),
      ).toBeLessThan(2);
      expect(facts.y).toBeGreaterThan(name.y + name.height);
      expect(Math.abs(facts.x - name.x)).toBeLessThan(2);

      await page.locator("#nextBtn").click();
      await expect(page.locator("#savedBox")).toBeVisible();
      await page.locator("#toHome").click();
      await expect(
        page.locator("#libList li", { hasText: "Ranger Rita" }),
      ).toBeVisible();
      const lead = await box("#homeLead");
      const make = await box("#makeBtn");
      const imp = await box("#importBtn");
      const libHead = await box(".lib-head");
      const list = await box("#libList");
      const row = await box("#libList li");
      // The two buttons on one line under the lead, starting at its left
      // edge, 10 px apart; the list's head 16 px under them; each row the
      // list's whole width.
      expect(make.y).toBeGreaterThan(lead.y + lead.height - 1);
      expect(Math.abs(make.x - lead.x)).toBeLessThan(2);
      expect(
        Math.abs(make.y + make.height / 2 - (imp.y + imp.height / 2)),
      ).toBeLessThan(2);
      expect(Math.round(imp.x - (make.x + make.width))).toBe(10);
      expect(Math.round(libHead.y - (make.y + make.height))).toBe(16);
      expect(Math.abs(libHead.x - lead.x)).toBeLessThan(2);
      expect(list.y).toBeGreaterThanOrEqual(libHead.y + libHead.height);
      expect(Math.abs(row.width - list.width)).toBeLessThan(2);
      expect(Math.abs(row.x - lead.x)).toBeLessThan(2);
    });
  }

  // Why: the library's two buttons are one line in the prototype, and a
  // wider system font (Linux's, measured in CI) put "Import character..."
  // under "Make a character". Widened letters stand in for any wider font:
  // the row stays one line, the buttons one height, inside the column.
  test("keeps the library's two buttons on one line with a wider font", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/characters.html");
    await expect(page.locator("#makeBtn")).toBeVisible();
    await page.addStyleTag({
      content: "#makeBtn, #importBtn { letter-spacing: 6px; }",
    });
    const make = await page.locator("#makeBtn").boundingBox();
    const imp = await page.locator("#importBtn").boundingBox();
    const lead = await page.locator("#homeLead").boundingBox();
    if (make === null || imp === null || lead === null) {
      throw new Error("not laid out");
    }
    expect(Math.abs(make.y - imp.y)).toBeLessThan(2);
    expect(Math.abs(make.height - imp.height)).toBeLessThan(2);
    expect(Math.round(imp.x - (make.x + make.width))).toBe(10);
    expect(imp.x + imp.width).toBeLessThan(lead.x + lead.width + 1);
  });
});
