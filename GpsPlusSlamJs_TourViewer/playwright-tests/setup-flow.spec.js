// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";

/**
 * The six-step setup flow (polish round M2): where the tour lives, the
 * link given once and checked by itself, and a page that uses the screen.
 *
 * Why these tests matter: the owner found step 1 confusing (a test link
 * and a starter zip at once, with no reason given) and was asked for the
 * link twice. The host choice is the context every later step reads, so
 * it must survive a reload; the link check must run without a button; the
 * transport demo (gallery, transfer numbers) is a debugging aid, not a
 * step; and on a landscape phone the steps used half the screen.
 */

const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
const HOST_KEY = "tour-viewer.wizard.host";

test.describe("a first visit", () => {
  // No stored host: the suite's default (playwright.config.js) is cleared.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("starts at the host tiles, and a chosen host carries on to the link", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("step-host")).toHaveAttribute("open", "");
    const tiles = page.getByTestId("host-tiles").getByRole("button");
    await expect(tiles).toHaveText([
      "Google Drive",
      "Dropbox",
      "OneDrive",
      "GitHub",
      "Your own server",
    ]);
    // Nothing chosen yet: no steps, no starter zip, no Continue.
    await expect(page.getByTestId("host-steps")).toBeHidden();
    await expect(page.getByTestId("starter-zip")).toBeHidden();
    await expect(page.getByTestId("host-continue")).toBeHidden();

    const unchosen = await tiles
      .filter({ hasText: "Dropbox" })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await tiles.filter({ hasText: "Dropbox" }).click();
    await expect(tiles.filter({ hasText: "Dropbox" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The chosen tile LOOKS chosen: its style keys on the state attribute,
    // which changed name once already (PR #585 review).
    await expect
      .poll(() =>
        tiles
          .filter({ hasText: "Dropbox" })
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .not.toBe(unchosen);
    await expect(page.getByTestId("host-steps")).toContainText("Dropbox");
    // r820 feedback R2: the host's name opens the host, in a new tab.
    const home = page
      .getByTestId("host-steps")
      .getByRole("link", { name: "Dropbox" });
    await expect(home).toHaveAttribute("href", "https://www.dropbox.com/home");
    await expect(home).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("starter-zip")).toBeVisible();

    // An own server's link can come before its file: no starter zip, and
    // the server's two needs are named.
    await tiles.filter({ hasText: "Your own server" }).click();
    await expect(page.getByTestId("starter-zip")).toBeHidden();
    await expect(page.getByTestId("host-steps")).toContainText(
      "Access-Control-Allow-Origin",
    );

    await page.getByTestId("host-continue").click();
    await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
    await expect(page.getByTestId("link-input")).toBeFocused();

    // The choice survives a reload: the page opens at the link.
    await page.reload();
    await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
    expect(
      await page.evaluate((key) => localStorage.getItem(key), HOST_KEY),
    ).toBe("own");
  });
});

test("the link is checked by itself when the field is left, with no button", async ({
  page,
}) => {
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(ARCHIVE);
  await page.getByTestId("link-input").press("Tab");
  await expect(page.getByTestId("link-status")).toHaveText(
    "Tour found - the link works.",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("print-panel")).toHaveAttribute("open", "");
});

test("a link with no file behind it yet still reaches the print step, marked unverified", async ({
  page,
}) => {
  // An own server's link can come before its file (A16): the creator
  // gives it once and prints; the check before the PDF settles it.
  const NOT_YET = "http://127.0.0.1:5197/ranges-ok/not-uploaded-yet.zip";
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(NOT_YET);
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("link-status")).toContainText(
    "Not verified yet",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("print-panel")).toHaveAttribute("open", "");
  await expect(page.getByTestId("print-url-shown")).toHaveText(
    `${NOT_YET} - not verified yet`,
  );
  // The status line speaks alone: no "that file does not exist" under it
  // (PRs #584/#585 reviews).
  await expect(page.getByTestId("error")).toHaveText("");
  await expect(page.getByTestId("print-canvas")).toBeVisible();
});

test("the gallery and the transfer numbers show only with ?debug=1", async ({
  page,
}) => {
  for (const [query, shown] of /** @type {const} */ ([
    ["/?nocache=1", false],
    ["/?nocache=1&debug=1", true],
  ])) {
    await page.goto(query);
    await page.getByTestId("link-input").fill(ARCHIVE);
    await page.getByTestId("open-button").click();
    // Filled only while shown (follow-up F14): without the flag a creator's
    // open decodes no photo at all - the gallery stays empty once the
    // open has settled; with it, all eight stream in.
    await expect(page.locator("body")).toHaveAttribute(
      "data-tour-open",
      "settled",
      {
        timeout: 15000,
      },
    );
    await expect(page.getByTestId("gallery").locator("img")).toHaveCount(
      shown ? 8 : 0,
    );
    await expect(page.getByTestId("stats")).not.toHaveText("");
    for (const id of ["gallery", "stats"]) {
      if (shown) await expect(page.getByTestId(id)).toBeVisible();
      else await expect(page.getByTestId(id)).toBeHidden();
    }
  }
});

test.describe("a landscape phone", () => {
  test.use({ viewport: { width: 915, height: 412 } });

  test("uses the width, without scrolling sideways", async ({ page }) => {
    // A14, then M2b: on a landscape phone the map and the step card share
    // the screen side by side, rather than one narrow column.
    await page.goto("/?nocache=1");
    const map = await page.getByTestId("setup-map").boundingBox();
    const card = await page.getByTestId("setup-card").boundingBox();
    if (map === null || card === null)
      throw new Error("map or card not laid out");
    expect(card.x).toBeGreaterThanOrEqual(map.x + map.width - 1);
    expect(map.width + card.width).toBeGreaterThan(800);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("the L5 look (polish round M2b)", () => {
  // Why: the owner chose a page that shows one step at a time as a station
  // on a route. The card must hold exactly one step, the dots and the
  // map's stations must move between them, and the row must follow the
  // verdict: no Back on step 1, no Next on step 5, no row on step 6.
  test("shows one step at a time and moves between them by station", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("setup-intro")).toBeVisible();
    await expect(page.getByTestId("map-station-host")).toBeVisible();
    const openSteps = page.locator("#setup-card .step[open]");
    await expect(openSteps).toHaveCount(1);
    await expect(page.getByTestId("setup-of")).toHaveText("Step 2 of 6");

    await page.getByTestId("map-station-hang").locator("circle").click();
    await expect(page.getByTestId("step-hang")).toHaveAttribute("open", "");
    await expect(page.getByTestId("step-link")).toBeHidden();
    await expect(openSteps).toHaveCount(1);

    await page.getByTestId("setup-next").click();
    await expect(page.getByTestId("setup-of")).toHaveText("Step 5 of 6");
    await expect(page.getByTestId("setup-next")).toBeHidden();
    await expect(page.getByTestId("setup-back")).toBeVisible();

    await page.getByTestId("station-done").click();
    await expect(page.getByTestId("setup-nav")).toBeHidden();

    await page.getByTestId("station-host").click();
    await expect(page.getByTestId("setup-back")).toBeHidden();
    // A tap on the open step's heading must not collapse it.
    await page.getByTestId("step-host").locator("summary").click();
    await expect(page.getByTestId("step-host")).toHaveAttribute("open", "");
  });

  // Why (D-P1): the paper palette is the setup page's; over the camera the
  // overlay keeps the design system's own tokens.
  test("drops the paper palette while an AR session runs", async ({ page }) => {
    await page.goto("/?nocache=1");
    const paper = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--paper")
          .trim()
          .toLowerCase(),
      );
    expect(await paper()).toBe("#f4eedf");
    expect(await paperInAr(page)).not.toBe("#f4eedf");
  });

  // The visitor's start page wears the paper look too since the owner
  // chose V4 (polish round M4a, D-R12); a running session does not.
  test("gives the visitor's start page the paper look, and AR the sheet's", async ({
    page,
  }) => {
    await page.goto(
      `/?qr=${encodeURIComponent("http://127.0.0.1:5197/ranges-ok/tour.zip")}`,
    );
    await expect(page.getByTestId("visitor-screen")).toBeVisible();
    await expect(page.getByTestId("setup-intro")).toBeHidden();
    await expect(page.getByTestId("setup-map")).toBeHidden();
    const paper = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--paper")
          .trim()
          .toLowerCase(),
      );
    expect(await paper()).toBe("#f4eedf");
    expect(await paperInAr(page)).not.toBe("#f4eedf");
  });
});

/**
 * The paper token with the page's "a session is up" flag set, read in the
 * SAME task that sets it. `ar-entry.ts` rewrites that flag on every render
 * (a tour's open, the location permission's answer), so a set and a read
 * in two evaluates raced those renders: the visitor test failed 3 runs in
 * 5 of the full spec on 2026-10-18, never alone.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string>}
 */
function paperInAr(page) {
  return page.evaluate(() => {
    document.body.dataset["arActive"] = "true";
    return getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim()
      .toLowerCase();
  });
}

test.describe("the print PDF (polish round M0b)", () => {
  // Why: where the browser shows PDFs itself, the owner wants the PDF to
  // open there rather than land in a downloads folder; the tab must be
  // opened inside the tap (a pop-up blocker refuses one opened after an
  // await) and filled once the PDF is built.
  test("opens in a tab where the browser shows PDFs", async ({ page }) => {
    await installTourViewerArFakes(page, { pdfViewer: true });
    await page.goto("/?nocache=1");
    await page.getByTestId("station-print").click();
    await page
      .getByTestId("print-url")
      .fill("https://www.dropbox.com/scl/fi/abc/tour.zip?rlkey=k&dl=0");
    await page.getByTestId("print-url").press("Tab");
    await expect(page.getByTestId("print-tile")).toHaveCount(3);
    await page.getByTestId("print-pdf").click();
    await expect(page.getByTestId("print-info")).toContainText("Opened", {
      timeout: 15000,
    });
    const tabs = await page.evaluate(async () => {
      const shown = /** @type {any} */ (window).__tourViewerTest.pdfTabs;
      return Promise.all(
        shown.map(async (/** @type {any} */ t) =>
          t.shown === undefined ? "closed" : (await t.shown.text()).slice(0, 5),
        ),
      );
    });
    expect(tabs).toEqual(["%PDF-"]);
    // Nothing was downloaded on this path.
    expect(
      await page.evaluate(
        () => /** @type {any} */ (window).__tourViewerTest.downloads.length,
      ),
    ).toBe(0);
  });
});

test.describe("step 3 on a phone (the owner's r819 screenshot)", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  // Why: the QR library sizes its canvas inline; on the owner's phone that
  // made step 3 wider than the card, so the fields and buttons ran past its
  // edge and were cut off. Nothing in the print step may reach past the
  // card, with a long Drive link and three tiles drawn.
  test("keeps every field, button and tile inside the card", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await page.getByTestId("station-print").click();
    await page
      .getByTestId("print-url")
      .fill(
        "https://drive.google.com/file/d/1A4mU8eV16aaIvy6Msd76RC3_cbbftRk/view?usp=drivesdk",
      );
    await page.getByTestId("print-url").press("Tab");
    await expect(page.getByTestId("print-tile")).toHaveCount(3, {
      timeout: 15000,
    });
    const past = await page.evaluate(() => {
      const card = document.getElementById("setup-card");
      if (card === null) return ["no card"];
      const right = card.getBoundingClientRect().right;
      return [...document.querySelectorAll("#print-panel *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > right + 0.5;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    });
    expect(past).toEqual([]);
  });
});

// Why (r820 feedback R1): the intro reached the owner with the prototype's
// spacing gone (the design system zeroes paragraph and list margins) and
// its four "why" bullets wrapping raggedly; every test passed, because
// they asserted presence and fit. These pin the arrangement the owner
// chose in the L5 prototype: four bullets, two per row, and room between
// the text, the bullets and the button - at a phone, a phone held across,
// and a desktop.
for (const viewport of [
  { width: 412, height: 915 },
  { width: 915, height: 412 },
  { width: 1366, height: 900 },
]) {
  test.describe(`the intro at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport });

    test("lays the four reasons out two per row, with room around them", async ({
      page,
    }) => {
      await page.goto("/?nocache=1");
      await expect(page.getByTestId("setup-intro")).toBeVisible();
      const box = async (selector) => {
        const found = await page.locator(selector).boundingBox();
        if (found === null) throw new Error(`no box for ${selector}`);
        return found;
      };
      const items = await page.locator(".setup-why li").evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left) };
        }),
      );
      expect(items).toHaveLength(4);
      const rows = [...new Set(items.map((i) => i.top))];
      expect(rows).toHaveLength(2);
      for (const top of rows) {
        expect(items.filter((i) => i.top === top)).toHaveLength(2);
      }
      // The two columns line up.
      expect(items[0]?.left).toBe(items[2]?.left);
      expect(items[1]?.left).toBe(items[3]?.left);
      const lede = await box(".setup-lede");
      const why = await box(".setup-why");
      const cta = await box(".setup-cta");
      expect(why.y - (lede.y + lede.height)).toBeGreaterThanOrEqual(12);
      expect(cta.y - (why.y + why.height)).toBeGreaterThanOrEqual(16);
    });
  });
}

// Why: the intro's phone came from the chosen prototype without its
// animation - the markup kept its classes but no rule moved them, so the
// route, the pin, its label and the photo stood still, and nothing could
// tell. These pin that each part runs the prototype's 7 s loop, and that
// a visitor who asked for reduced motion gets none, with the picture
// shown whole.
test.describe("the intro's phone", () => {
  const PARTS = [
    [".h-dots-mask", "intro-dots"],
    [".h-pin", "intro-pin"],
    [".h-label", "intro-label"],
    [".h-photo", "intro-photo"],
  ];
  /** Each part's computed animation, and whether it shows. */
  const partsOf = (page) =>
    page.evaluate((parts) => {
      return parts.map(([selector]) => {
        const el = document.querySelector(`.setup-intro-art ${selector}`);
        if (el === null) return null;
        const style = getComputedStyle(el);
        return {
          name: style.animationName,
          duration: style.animationDuration,
          iterations: style.animationIterationCount,
          opacity: style.opacity,
        };
      });
    }, PARTS);

  test("runs the prototype's loop on the route, the pin, its label and the photo", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("setup-intro")).toBeVisible();
    const parts = await partsOf(page);
    parts.forEach((part, i) => {
      expect(part, PARTS[i][0]).toEqual(
        expect.objectContaining({
          name: PARTS[i][1],
          duration: "7s",
          iterations: "infinite",
        }),
      );
    });
    // The route is dotted, as the prototype draws it.
    expect(
      await page
        .locator(".setup-intro-art .h-dots")
        .evaluate((el) => getComputedStyle(el).strokeDasharray),
    ).toMatch(/^0\.1(px)?,? 7(px)?$/);
  });

  test("under reduced motion runs nothing and shows the whole picture", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("setup-intro")).toBeVisible();
    const parts = await partsOf(page);
    parts.forEach((part, i) => {
      expect(part, PARTS[i][0]).not.toBeNull();
      expect(part?.name, PARTS[i][0]).toBe("none");
      if (PARTS[i][0] !== ".h-dots-mask") {
        expect(part?.opacity, PARTS[i][0]).toBe("1");
      }
    });
    // The route is drawn whole: the mask's one dash (its path is 100
    // long) sits at offset 0, not where the loop starts it hidden.
    const mask = await page
      .locator(".setup-intro-art .h-dots-mask")
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          offset: style.strokeDashoffset,
          dashes: style.strokeDasharray,
          length: el.getAttribute("pathLength"),
        };
      });
    expect(mask.offset).toMatch(/^0(px)?$/);
    expect(mask.dashes).toMatch(/^100(px)?,? 100(px)?$/);
    expect(mask.length).toBe("100");
  });
});
