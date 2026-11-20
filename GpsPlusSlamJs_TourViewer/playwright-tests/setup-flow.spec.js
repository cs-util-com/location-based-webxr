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

  test("starts at the question, and a new tour routes to the host tiles @pr", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("step-host")).toHaveAttribute("open", "");
    await expect(
      page.getByTestId("start-answers").getByRole("button"),
    ).toHaveText([
      "New tour - I want to share it now",
      "I have my tour's link",
      "The tour file is on this phone",
      "Start on this phone now, share later",
    ]);
    await page.getByTestId("start-answer-new").click();
    await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
    await expect(page.getByTestId("start-host")).toBeVisible();
    await expect(page.getByTestId("link-field")).toBeVisible();
    const tiles = page.getByTestId("host-tiles").getByRole("button");
    await expect(tiles).toHaveText([
      "Google Drive",
      "Dropbox",
      "OneDrive",
      "GitHub",
      "Your own server",
    ]);
    // Nothing chosen yet: no steps, no starter zip.
    await expect(page.getByTestId("host-steps")).toBeHidden();
    await expect(page.getByTestId("starter-zip")).toBeHidden();

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

    // The choice survives a reload: the page opens at the new-tour panel.
    await page.reload();
    await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
    await expect(page.getByTestId("start-host")).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), HOST_KEY),
    ).toBe("own");
  });

  // Why: a tap on an answer only routes, and each answer shows its own one
  // action; the link answer is the one place "the code already hangs"
  // (scan-to-open) is offered, and the back link returns to the question.
  test("each answer shows its own panel, and back returns to the question", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await page.getByTestId("start-answer-link").click();
    await expect(page.getByTestId("link-field")).toBeVisible();
    await expect(page.getByTestId("start-code-hangs")).toBeVisible();
    await expect(page.getByTestId("start-host")).toBeHidden();
    await page.getByTestId("start-back").click();
    await expect(page.getByTestId("step-host")).toHaveAttribute("open", "");

    await page.getByTestId("start-answer-file").click();
    await expect(page.getByTestId("start-file")).toBeVisible();
    await expect(page.getByTestId("link-field")).toBeHidden();
    await page.getByTestId("start-back").click();

    await page.getByTestId("start-answer-link").click();
    await page.getByTestId("code-hangs-button").click();
    await expect(page.getByTestId("step-measure")).toHaveAttribute("open", "");
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
    // A14, then the creator setup layout round: on a landscape phone the
    // step card takes the whole width, and the map is a sticker on its
    // top-right corner, over its edges, rather than a column beside it
    // that left an empty block under the map.
    await page.goto("/?nocache=1");
    const map = await page.getByTestId("setup-map").boundingBox();
    const card = await page.getByTestId("setup-card").boundingBox();
    if (map === null || card === null)
      throw new Error("map or card not laid out");
    expect(card.width).toBeGreaterThan(860);
    expect(map.y).toBeLessThan(card.y);
    expect(map.x + map.width).toBeGreaterThan(card.x + card.width);
    expect(map.width).toBeLessThanOrEqual(card.width / 3);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * Measures the setup card as laid out: the sticker's size, what lies under
 * it, what leaves the card, the gaps of the step's stack and the start
 * answers' widths. One function, so every viewport is measured the same.
 */
function measureCard() {
  const card = /** @type {HTMLElement} */ (
    document.getElementById("setup-card")
  );
  const map = /** @type {HTMLElement} */ (document.getElementById("setup-map"));
  const s = map.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  const pad = parseFloat(cs.paddingLeft);
  // The box of a slightly turned sticker is a little larger than the
  // sticker itself.
  const inset = 4;
  /** @param {DOMRect} r */
  const shown = (r) => r.width > 0 && r.height > 0;
  /** @param {DOMRect} r */
  const under = (r) =>
    shown(r) &&
    r.right > s.left + inset &&
    r.left < s.right - inset &&
    r.bottom > s.top + inset &&
    r.top < s.bottom - inset;
  const covered = [];
  const parts =
    "#setup-card .setup-card-top > *, #setup-card .step[open] :is(button, input, select), #setup-nav button";
  for (const el of document.querySelectorAll(parts)) {
    if (under(el.getBoundingClientRect())) covered.push(el.outerHTML);
  }
  // A block's box runs under a float while its lines wrap beside it, so
  // text is measured by its line boxes.
  for (const el of document.querySelectorAll(
    "#setup-card .step[open] :is(h2, p, a, li, label)",
  )) {
    const range = document.createRange();
    range.selectNodeContents(el);
    if ([...range.getClientRects()].some(under))
      covered.push(el.textContent?.trim());
  }
  // Nothing of the step may leave the card's border box: an edge or a
  // rounded corner would cut it (a cut "Back to the question" was seen in
  // an earlier layout).
  const outside = [];
  for (const el of card.querySelectorAll(
    ".setup-card-top *, .step[open] *, #setup-nav *",
  )) {
    const r = el.getBoundingClientRect();
    if (!shown(r)) continue;
    if (
      r.left < c.left + 1.5 ||
      r.right > c.right - 1.5 ||
      r.top < c.top + 1.5 ||
      r.bottom > c.bottom - 1.5
    )
      outside.push(el.outerHTML.slice(0, 80));
  }
  const open = /** @type {HTMLElement} */ (card.querySelector(".step[open]"));
  const summary = /** @type {HTMLElement} */ (open.querySelector("summary"));
  const blocks = [...open.children].filter(
    (el) => el !== summary && shown(el.getBoundingClientRect()),
  );
  const nav = /** @type {HTMLElement} */ (document.getElementById("setup-nav"));
  const last = blocks.at(-1)?.getBoundingClientRect();
  return {
    stickerWidth: map.offsetWidth,
    stickerLeft: s.left,
    stickerRight: s.right,
    stickerTop: s.top,
    cardTop: c.top,
    pad,
    covered,
    outside,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    headingToWhy:
      blocks[0].getBoundingClientRect().top -
      summary.getBoundingClientRect().bottom,
    whyToNext:
      blocks.length > 1
        ? blocks[1].getBoundingClientRect().top -
          blocks[0].getBoundingClientRect().bottom
        : null,
    toFooter:
      last !== undefined && shown(nav.getBoundingClientRect())
        ? nav.getBoundingClientRect().top - last.bottom
        : null,
    answers: [...document.querySelectorAll(".start-answer")]
      .filter((b) => shown(b.getBoundingClientRect()))
      .map((b) => {
        const r = b.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(b);
        return {
          width: r.width,
          lines: new Set(
            [...range.getClientRects()].map((q) => Math.round(q.top)),
          ).size,
          words: range.getBoundingClientRect().width,
        };
      }),
    contentWidth: c.width - 2 * pad - 3,
  };
}

// The chosen sticker size (size "l" of map-size.ts): 37 % of the
// window's width, from 11.5rem up to 23.5rem, and never past 58 % of its
// height. Its layout width, before the slight turn.
/** @param {{ width: number, height: number }} vp */
const stickerWidthAt = (vp) =>
  Math.min(Math.min(Math.max(184, 0.37 * vp.width), 376), 0.58 * vp.height);

// Why: the chosen layout is the map as a
// sticker on the card's corner, at a size picked from four, with a spacing
// scale (8 under a heading, 16 between groups, 24 before the footer) and
// start answers only as wide as their words. Positions and gaps, not
// presence: a card that shows everything passes a presence test with the
// map over a button or a corner cutting a link.
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 880, height: 1000 },
  { width: 1000, height: 880 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test.describe(`the setup card at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport, storageState: { cookies: [], origins: [] } });

    test("keeps the sticker's size, the spacing scale, and every part readable and inside", async ({
      page,
    }) => {
      await page.goto("/?nocache=1");
      await expect(page.getByTestId("start-answers")).toBeVisible();
      for (const answer of [null, "new", "link", "later"]) {
        if (answer !== null) {
          await page.getByTestId(`start-answer-${answer}`).click();
          await expect(page.getByTestId("step-link")).toHaveAttribute(
            "open",
            "",
          );
        }
        const m = await page.evaluate(measureCard);
        const at = `${answer ?? "question"}: `;
        expect(
          Math.abs(m.stickerWidth - stickerWidthAt(viewport)),
          at,
        ).toBeLessThanOrEqual(1);
        // Over the card's top and right edges, inside the window.
        expect(m.stickerTop, at).toBeLessThan(m.cardTop);
        expect(m.stickerLeft, at).toBeGreaterThan(0);
        // The turned box may reach a fraction of a pixel past the edge (0.13 px
        // at 880 wide); the page itself must not scroll sideways (overflow below).
        expect(m.stickerRight, at).toBeLessThanOrEqual(viewport.width + 0.5);
        expect(m.overflow, at).toBeLessThanOrEqual(0);
        expect(m.covered, at).toEqual([]);
        expect(m.outside, at).toEqual([]);
        expect(m.pad, at).toBe(viewport.width >= 600 ? 24 : 16);
        expect(Math.abs(m.headingToWhy - 8), at).toBeLessThanOrEqual(1);
        if (m.whyToNext !== null)
          expect(Math.abs(m.whyToNext - 16), at).toBeLessThanOrEqual(1);
        // The footer is a flow box: 24 above it, more only where it had
        // to pass the sticker.
        if (m.toFooter !== null)
          expect(m.toFooter, at).toBeGreaterThanOrEqual(23);
        if (answer === null) {
          // All as wide as the longest, which is about its words and
          // padding - never the card's width. One line where the room beside
          // the sticker allows; a wider font may wrap one to two lines
          // rather than push the answers below the sticker.
          expect(m.answers).toHaveLength(4);
          const widest = Math.max(...m.answers.map((a) => a.words));
          for (const a of m.answers) {
            expect(a.lines, at).toBeLessThanOrEqual(2);
            expect(
              Math.abs(a.width - m.answers[0].width),
              at,
            ).toBeLessThanOrEqual(1);
            expect(a.width - widest, at).toBeLessThanOrEqual(48);
          }
        } else {
          await page.getByTestId("start-back").click();
          await expect(page.getByTestId("start-answers")).toBeVisible();
        }
      }
    });
  });
}

// Why: the answers' width depends on the font, and a machine with wider
// glyphs once had the two-column answers too wide for the room beside the
// sticker, so the grid dropped below it whole and left a 160 px hole under
// the why line. Widening the letters here makes that case reproducible on
// any machine.
test.describe("the start answers with a wider font", () => {
  test.use({
    viewport: { width: 1000, height: 880 },
    storageState: { cookies: [], origins: [] },
  });

  test("stay beside the sticker and wrap rather than drop below it", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("start-answers")).toBeVisible();
    await page.addStyleTag({
      content: ".start-answer { letter-spacing: 1.6px !important; }",
    });
    const m = await page.evaluate(measureCard);
    expect(Math.abs((m.whyToNext ?? 0) - 16)).toBeLessThanOrEqual(1);
    expect(m.covered).toEqual([]);
    expect(m.outside).toEqual([]);
    expect(m.overflow).toBeLessThanOrEqual(0);
    for (const a of m.answers) {
      expect(a.width - m.answers[0].width).toBeLessThanOrEqual(1);
      expect(a.words).toBeLessThanOrEqual(a.width);
    }
  });
});

test.describe("the map sticker on a phone held upright", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Why: on a phone the sticker is small (the route and its numbered
  // stations only), so a tap shows the whole map larger, across the card,
  // and the next one puts it back - without moving a step.
  test("shows the map larger on a tap, and back on the next", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    const zoom = page.getByTestId("setup-map-zoom");
    const width = async () =>
      (await page.getByTestId("setup-map").boundingBox())?.width ?? 0;
    await expect(zoom).toBeVisible();
    await expect(zoom).toHaveAttribute("aria-expanded", "false");
    const small = await width();
    const content = await page
      .getByTestId("setup-card")
      .evaluate(
        (el) =>
          el.clientWidth - 2 * parseFloat(getComputedStyle(el).paddingLeft),
      );
    await zoom.click();
    await expect(zoom).toHaveAttribute("aria-expanded", "true");
    expect(await width()).toBeGreaterThan(small * 1.5);
    expect(await width()).toBeGreaterThanOrEqual(content - 2);
    await zoom.click();
    await expect(zoom).toHaveAttribute("aria-expanded", "false");
    expect(Math.abs((await width()) - small)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
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
    // The landing sits above the stage, on the same page.
    await expect(page.getByTestId("landing")).toBeVisible();
    await expect(page.getByTestId("map-station-host")).toBeVisible();
    // A large sticker's stations are tapped themselves: the tap target
    // that shows a small one larger must not lie over them.
    await expect(page.getByTestId("setup-map-zoom")).toBeHidden();
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
    await expect(page.getByTestId("landing")).toBeHidden();
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

// The intro's spacing (the design system zeroes margins) and its phone's
// loop are pinned for the landing in landing.spec.js: positions and gaps at
// three viewports, the cards' pictures playing, pausing and holding still
// under reduced motion.
