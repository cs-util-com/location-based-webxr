// @ts-check
import { expect, test } from "@playwright/test";

import { useWideFont } from "./wide-font.js";

/**
 * The landing at the top of a creator's page: a visitor's way in, the
 * hero, the five step cards, the short "Make your own tour", the use
 * cases, and the setup stage right below.
 *
 * Why these tests matter: the design system zeroes every margin, so a
 * gap that is not set explicitly is simply gone, and the intro this
 * replaces once reached its readers with its spacing lost while every
 * presence test passed. These pin positions and gaps
 * at a phone, a phone held across and a desktop, also in a wide face, and
 * the wide-screen layout (the hero side by side, the stage on the column)
 * at three desktop sizes. The
 * cards' pictures must play only in view, pause on a tap until the next,
 * and hold still under reduced motion. A device that used the setup
 * before opens at the setup, but never against the browser's own scroll
 * restoration or a link to a place in the page. A visitor must not pay
 * for any of it.
 */

const FIRST_VISIT = { cookies: [], origins: [] };
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
];

/**
 * @param {import("@playwright/test").Locator} locator
 */
async function box(locator) {
  const found = await locator.boundingBox();
  if (found === null) throw new Error(`no box for ${String(locator)}`);
  return found;
}

/** The gap from `upper`'s bottom to `lower`'s top, in px. */
const gap = (
  /** @type {{ y: number, height: number }} */ upper,
  /** @type {{ y: number }} */ lower,
) => lower.y - (upper.y + upper.height);

/**
 * A first visit, its moving parts mounted.
 *
 * @param {import("@playwright/test").Page} page
 */
async function openLanding(page) {
  await page.goto("/?nocache=1");
  await expect(page.locator(".landing-cards")).toHaveAttribute(
    "data-mount",
    "ready",
  );
  await expect(page.getByTestId("landing-uses")).toHaveAttribute(
    "data-mount",
    "ready",
  );
}

/** The gaps each layout sets (index.html, "The landing"). */
const GAPS = {
  "390x844": {
    hero: 16,
    h1: 8,
    lede: 10,
    make: 12,
    needs: 7,
    cta: 14,
    film: 18,
  },
  "844x390": { hero: 16, h1: 8, lede: 6, make: 6, needs: 4, cta: 10, film: 18 },
  "1440x900": {
    hero: 34,
    h1: 8,
    lede: 10,
    make: 20,
    needs: 7,
    cta: 14,
    film: 28,
  },
};

for (const viewport of VIEWPORTS) {
  const name = `${String(viewport.width)}x${String(viewport.height)}`;
  for (const wide of [false, true]) {
    test.describe(`the landing at ${name}${wide ? ", in a wide face" : ""}`, () => {
      test.use({ viewport, storageState: FIRST_VISIT });

      test("keeps the hero's gaps, the film's box and the cards' arrangement", async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        if (wide) await useWideFont(page);
        await openLanding(page);
        const expected = GAPS[/** @type {keyof typeof GAPS} */ (name)];
        const at = (/** @type {string} */ selector) =>
          box(page.locator(selector).first());

        // The way in: one band, first, the page's whole width.
        const way = await at(".landing-way");
        expect(way.y).toBe(0);
        expect(way.width).toBe(viewport.width);

        // The hero's lines, each gap as set.
        const kicker = await at(".landing-hero .landing-kicker");
        const h1 = await at(".landing h1");
        const lede = await at(".landing-lede");
        const make = await at(".landing-make-line");
        const needs = await at(".landing-needs");
        const cta = await at(".landing-hero .landing-cta");
        const film = await at("#landing-film");
        const near = (
          /** @type {number} */ actual,
          /** @type {number} */ want,
        ) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(1);
        near(gap(way, kicker), expected.hero);
        near(gap(kicker, h1), expected.h1);
        near(gap(h1, lede), expected.lede);
        near(gap(lede, make), expected.make);
        near(gap(make, needs), expected.needs);
        near(gap(needs, cta), expected.cta);
        // From 1000 px wide the film stands beside the text instead
        // (pinned by "the landing on a wide screen").
        const side = viewport.width >= 1000;
        if (!side) near(gap(cta, film), expected.film);

        // The film's picture keeps its proportion (9:10 upright, the
        // page's whole width; 3:2 on a sideways phone and 16:9 from 900 px
        // wide, centred), the picture and its
        // bar fit the view, and the captions' list (reduced motion) stays
        // inside the box.
        const upright =
          viewport.width < viewport.height && viewport.width < 900;
        const filmStage = await at("#landing-film .lf-stage");
        const filmBar = await at("#landing-film .lf-controls");
        expect(filmStage.width / filmStage.height).toBeCloseTo(
          upright ? 9 / 10 : viewport.width >= 900 ? 16 / 9 : 3 / 2,
          1,
        );
        if (upright) {
          expect(film.x).toBe(0);
          expect(film.width).toBe(viewport.width);
        } else if (!side) {
          near(film.x, (viewport.width - film.width) / 2);
        }
        expect(filmBar.y + filmBar.height - filmStage.y).toBeLessThanOrEqual(
          viewport.height - 24 + 1,
        );
        const filmList = await at("#landing-film .lf-captions");
        expect(filmList.y + filmList.height).toBeLessThanOrEqual(
          film.y + film.height,
        );

        // The first five seconds: the motivation and the phone it needs.
        if (viewport.height >= 800) {
          expect(needs.y + needs.height).toBeLessThanOrEqual(viewport.height);
          expect(cta.y + cta.height).toBeLessThanOrEqual(viewport.height);
        }

        // Five cards, one under another; each picture's box reserved at a
        // phone's height (twice its width, plus 28 px).
        const cards = page.getByTestId("landing-card");
        await expect(cards).toHaveCount(5);
        const pw = upright
          ? 206
          : viewport.height <= 560
            ? (viewport.height - 74) / 2 - 14
            : 214;
        const desktop = viewport.width >= 900;
        const sideways = !upright && viewport.height <= 560;
        // The space after a card is padding inside the card's own box, so
        // it is measured from what the card shows (its text or its
        // picture with the caption, whichever ends lower) to what the next
        // one shows (beside each other, the shorter of the two is centred
        // on the taller).
        const afterCard = desktop ? 56 : sideways ? 40 : 52;
        /** @type {number | null} */
        let shownEnd = null;
        for (let i = 0; i < 5; i++) {
          const card = cards.nth(i);
          const cardBox = await box(card);
          const text = await box(card.locator(".landing-card-text"));
          const pic = await box(card.locator(".landing-pic"));
          const caption = await box(card.locator("figcaption"));
          const fig = await box(card.locator(".landing-fig"));
          near(pic.height, pw * 2 + 28);
          near(gap(pic, caption), 9);
          // The text indented for the marks on the walk's line.
          near(text.x - cardBox.x, desktop ? 76 : 50);
          if (upright) {
            // Stacked: the picture under its text, 20 px below, at the
            // text's left edge.
            near(gap(text, pic), 20);
            near(pic.x, text.x);
          } else {
            // Beside its text, with the column gap between (5 % of the
            // view, at most 72 px, on a desktop).
            near(
              pic.x - (text.x + text.width),
              desktop ? Math.min(72, viewport.width * 0.05) : 22,
            );
          }
          // Inside the text: kicker, heading, lines.
          const kickerBox = await box(card.locator(".landing-card-kicker"));
          const heading = await box(card.locator("h3"));
          const says = card.locator(".landing-say");
          near(gap(kickerBox, heading), 6);
          near(gap(heading, await box(says.first())), sideways ? 8 : 12);
          const sayCount = await says.count();
          for (let k = 1; k < sayCount; k++) {
            near(gap(await box(says.nth(k - 1)), await box(says.nth(k))), 10);
          }
          if (shownEnd !== null) {
            near(Math.min(text.y, fig.y) - shownEnd, afterCard);
          }
          shownEnd = Math.max(text.y + text.height, fig.y + fig.height);
        }
        // Desktop pictures are a little wider than a phone's.
        if (viewport.width >= 900) {
          near((await box(cards.nth(1).locator(".landing-pic"))).width, 440);
        }

        // Make your own tour: the list, the line and the button, spaced;
        // two columns where there is room.
        const makeTitle = await at("#landing-make-title");
        const why = await at(".landing-why");
        const order = await at(".landing-order");
        const begin = await at("#setup-begin");
        near(gap(makeTitle, why), 14);
        near(gap(why, order), 14);
        // A phone held sideways tightens every button row to 10 px.
        near(gap(order, begin), name === "844x390" ? 10 : 14);
        const columns = await page
          .locator(".landing-reason")
          .evaluateAll(
            (els) =>
              new Set(
                els.map((el) => Math.round(el.getBoundingClientRect().left)),
              ).size,
          );
        expect(columns).toBe(
          desktop && viewport.height > 560 ? 3 : viewport.width >= 600 ? 2 : 1,
        );
        // A phone keeps its reading sizes (the larger ones start at
        // tablet width, and never on a phone held sideways).
        if (!desktop) {
          const fontSize = (/** @type {string} */ selector) =>
            page
              .locator(selector)
              .first()
              .evaluate((el) => getComputedStyle(el).fontSize);
          expect(await fontSize(".landing-way")).toBe("14.5px");
          expect(await fontSize(".landing-caption")).toBe(
            sideways ? "13px" : "14.5px",
          );
          expect(await fontSize(".landing-reason")).toBe("16px");
          expect(await fontSize("#setup-begin")).toBe("14px");
        }

        // The use cases: their heading the landing's section gap below
        // "Make your own tour", their grid one, two or three columns wide,
        // and every gap the section sets (use-cases.ts.md).
        const usesHost = await at("#landing-uses");
        const usesTitle = await at(".uc-heading");
        const usesSub = await at(".uc-sub");
        near(usesTitle.y - usesHost.y, viewport.width >= 900 ? 80 : 56);
        near(usesTitle.x, kicker.x);
        near(gap(usesTitle, usesSub), 8);
        // Its heading and line in the landing's own sizes.
        const size = (/** @type {string} */ selector) =>
          page
            .locator(selector)
            .first()
            .evaluate((el) => getComputedStyle(el).fontSize);
        expect(await size(".uc-heading")).toBe(
          await size("#landing-make-title"),
        );
        expect(await size(".uc-sub")).toBe(
          await size(".landing-story .landing-sub"),
        );
        const shownGrid = page.locator(".uc > .uc-grid");
        near(gap(usesSub, await box(shownGrid)), 22);
        const shown = shownGrid.locator(".uc-item");
        await expect(shown).toHaveCount(6);
        const usesColumns =
          viewport.width >= 1040 ? 3 : viewport.width >= 640 ? 2 : 1;
        const first = await box(shown.nth(0));
        const below = await box(shown.nth(usesColumns));
        near(gap(first, below), 26);
        if (usesColumns > 1) {
          const beside = await box(shown.nth(1));
          near(beside.y, first.y);
          near(beside.x - (first.x + first.width), 22);
        }
        const phone = await box(shown.nth(0).locator(".uc-phone"));
        const title = await box(shown.nth(0).locator(".uc-title"));
        const sentence = await box(shown.nth(0).locator(".uc-sentence"));
        near(gap(phone, title), 12);
        near(gap(title, sentence), 5);
        const toggle = await at(".uc-more-toggle");
        near(gap(await box(shownGrid), toggle), 28);
        expect(toggle.height).toBeGreaterThanOrEqual(44);
        const usesEnd = await box(page.locator(".uc"));
        near(usesHost.y + usesHost.height - (usesEnd.y + usesEnd.height), 40);

        // The stage follows right below the use cases, 40 px under what
        // they show, and nothing runs off the side.
        const stage = await at("#setup-stage");
        near(stage.y - (usesEnd.y + usesEnd.height), 40);
        // The drawings' own parts are clipped by their boxes: their svg
        // root is checked, not what it draws.
        const past = await page.evaluate(() =>
          [...document.querySelectorAll("#landing *")]
            .filter((el) => el.parentElement?.closest("svg") == null)
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > window.innerWidth + 0.5;
            })
            .map(
              (el) =>
                `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`,
            )
            .filter((what) => !what.includes("lc-")),
        );
        expect(past).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          ),
        ).toBeLessThanOrEqual(0);
      });
    });
  }
}

// A laptop's window less its browser bar is often about 1280x600: the
// film's picture must keep its 16:9 there too (its width follows the
// view's height), never only capped in height, with its bar in view.
test.describe("the film's box on a short desktop window", () => {
  test.use({
    viewport: { width: 1280, height: 600 },
    storageState: FIRST_VISIT,
  });

  test("keeps the picture 16:9 and the picture and bar in view", async ({
    page,
  }) => {
    await openLanding(page);
    const stage = await box(page.locator("#landing-film .lf-stage"));
    const bar = await box(page.locator("#landing-film .lf-controls"));
    expect(stage.width / stage.height).toBeCloseTo(16 / 9, 1);
    expect(stage.width).toBeLessThan(1280 - 32);
    expect(bar.y + bar.height - stage.y).toBeLessThanOrEqual(600 - 24 + 1);
  });
});

// On a wide screen the landing uses its width: the hero's text and film
// side by side with the whole film on the first screen, larger reading
// text and buttons, the six reasons in three columns, the setup stage on
// the landing's own column with its card in view beside the map, and each
// step's picture starting at its kicker's line. Positions and gaps, not
// presence: a layout that merely shows everything passes a presence test.
// Also in a wide face: the headline beside the film wraps by its face's
// widths, and a button that fits this machine's face by a few lines can
// end below the first screen in the CI's.
for (const { viewport, wide } of [
  { width: 1100, height: 700 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
].flatMap((vp) => [false, true].map((w) => ({ viewport: vp, wide: w })))) {
  test.describe(`the landing on a wide screen, ${String(viewport.width)}x${String(viewport.height)}${wide ? ", in a wide face" : ""}`, () => {
    test.use({ viewport, storageState: FIRST_VISIT });

    test("sets the hero side by side, the text larger, the reasons in three columns, the stage on the column and its card beside the map", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (wide) await useWideFont(page);
      await openLanding(page);
      await expect(page.getByTestId("landing-film")).toHaveAttribute(
        "data-mount",
        "ready",
      );
      const near = (/** @type {number} */ actual, /** @type {number} */ want) =>
        expect(Math.abs(actual - want)).toBeLessThanOrEqual(1);
      const at = (/** @type {string} */ selector) =>
        box(page.locator(selector).first());
      // The landing's column: the hero's content box.
      const column = await page.locator(".landing-hero").evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          left: r.left + parseFloat(s.paddingLeft),
          right: r.right - parseFloat(s.paddingRight),
        };
      });
      near(column.right - column.left, Math.min(1128, viewport.width - 32));

      // The hero: text left, film right, 48 px apart, the film's top on
      // the kicker's, the film's right edge on the column's.
      const kicker = await at(".landing-hero .landing-kicker");
      const text = await at(".landing-hero-text");
      const film = await at("#landing-film");
      const stage = await at("#landing-film .lf-stage");
      const bar = await at("#landing-film .lf-controls");
      near(text.x, column.left);
      near(film.x - (text.x + text.width), 48);
      near(film.x + film.width, column.right);
      near(film.y, kicker.y);
      expect(stage.width / stage.height).toBeCloseTo(16 / 9, 1);
      // The film's column is 58 % of the row less the gap.
      near(film.width, (column.right - column.left - 48) * 0.58);
      // The picture and its bar on the first screen, 23 px or more clear.
      expect(stage.y).toBeGreaterThanOrEqual(0);
      expect(bar.y + bar.height).toBeLessThanOrEqual(viewport.height - 23);
      // The button under the text on the first screen too.
      const cta = await at(".landing-hero .landing-cta");
      expect(cta.y + cta.height).toBeLessThanOrEqual(viewport.height);

      // The reading text and the main buttons, larger than a phone's.
      const size = (/** @type {string} */ selector) =>
        page
          .locator(selector)
          .first()
          .evaluate((el) => getComputedStyle(el).fontSize);
      expect(await size(".landing-way")).toBe("16px");
      expect(await size(".landing-caption")).toBe("16px");
      expect(await size(".landing-reason")).toBe("17.5px");
      expect(await size(".landing-order")).toBe("17.5px");
      expect(await size(".uc-sentence")).toBe("17px");
      for (const id of ["landing-begin-top", "setup-begin"]) {
        const begin = page
          .getByTestId(id)
          .or(page.locator(`#${id}`))
          .first();
        expect(
          await begin.evaluate((el) => getComputedStyle(el).fontSize),
        ).toBe("17px");
        expect((await box(begin)).height).toBeGreaterThanOrEqual(52);
      }

      // The six reasons across the whole column, three to a row.
      const why = await at(".landing-why");
      near(why.x, column.left);
      near(why.width, column.right - column.left);
      const lefts = await page
        .locator(".landing-reason")
        .evaluateAll((els) =>
          els.map((el) => Math.round(el.getBoundingClientRect().left)),
        );
      expect(new Set(lefts).size).toBe(3);
      expect(lefts).toHaveLength(6);

      // Each step's picture starts at its kicker's line; the cards 56 px
      // apart (from what one shows to what the next shows).
      const cards = page.getByTestId("landing-card");
      /** @type {number | null} */
      let shownEnd = null;
      for (let i = 0; i < 5; i++) {
        const card = cards.nth(i);
        const cardKicker = card.locator(".landing-card-kicker");
        const line = await cardKicker.evaluate(
          (el) =>
            el.getBoundingClientRect().top +
            parseFloat(getComputedStyle(el).paddingTop),
        );
        const pic = await box(card.locator(".landing-pic"));
        const cardText = await box(card.locator(".landing-card-text"));
        const fig = await box(card.locator(".landing-fig"));
        near(pic.y, line);
        if (shownEnd !== null) {
          near(Math.min(cardText.y, fig.y) - shownEnd, 56);
        }
        shownEnd = Math.max(cardText.y + cardText.height, fig.y + fig.height);
      }

      // The setup stage on the same column: the map's title and the
      // outer line of its frame on the column's left edge, the card's
      // right edge on its right edge.
      const title = await at(".setup-map-title");
      const frame = await at(".setup-map-frame");
      const card = await at("#setup-card");
      near(title.x, column.left);
      // the frame's outline sits 4 px outside it (1 px line, 3 px offset)
      near(frame.x - 4, column.left);
      near(card.x + card.width, column.right);

      // Scrolled into the stage, the step card stays in view beside the
      // map while the map is. On this short first-visit page the page
      // ends about where the stage does, so room is added below it first
      // (a longer step, or a page that opened at the stage, has it).
      // The card can travel as far as the map runs on below it (the
      // stage ends with the map); half of that is scrolled, or, where the
      // travel is short (a wide face makes the card taller), just enough
      // to take the map's top out of view, and never past the travel. The
      // card, left alone, would sit that far above the view's top + 16.
      const { travel, scrolled } = await page
        .getByTestId("setup-stage")
        .evaluate((el) => {
          const room = document.createElement("div");
          room.style.height = "2000px";
          document.body.append(room);
          el.scrollIntoView({ block: "start", behavior: "instant" });
          const cardEl = /** @type {HTMLElement} */ (
            document.getElementById("setup-card")
          );
          const mapEl = /** @type {HTMLElement} */ (
            document.querySelector(".setup-map-frame")
          );
          const below =
            mapEl.getBoundingClientRect().bottom -
            cardEl.getBoundingClientRect().bottom;
          const by = Math.max(below / 2, mapEl.getBoundingClientRect().top + 4);
          window.scrollBy({ top: by, behavior: "instant" });
          return { travel: below, scrolled: by };
        });
      expect(travel).toBeGreaterThan(40);
      expect(scrolled).toBeLessThan(travel);
      const mapNow = await at(".setup-map-frame");
      const cardNow = await at("#setup-card");
      expect(mapNow.y).toBeLessThan(0);
      expect(mapNow.y + mapNow.height).toBeGreaterThan(cardNow.y);
      near(cardNow.y, 16);
    });
  });
}

// The film itself, not only its picture and bar, fits the first screen
// beside the text: measured with the film playing (drawn flat, so the
// shared machine does not render it in software).
test.describe("the hero film on a wide screen", () => {
  test.use({
    viewport: { width: 1280, height: 720 },
    storageState: FIRST_VISIT,
  });

  test("is wholly on the first screen, beside the text", async ({ page }) => {
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      // @ts-expect-error a stand-in that refuses only WebGL
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        if (String(kind).startsWith("webgl")) return null;
        return get.call(this, kind, ...rest);
      };
    });
    await openLanding(page);
    const film = page.getByTestId("landing-film");
    await expect(film).toHaveAttribute("data-film-state", "playing");
    const filmBox = await box(film);
    const text = await box(page.locator(".landing-hero-text"));
    expect(filmBox.y).toBeGreaterThanOrEqual(0);
    expect(filmBox.y + filmBox.height).toBeLessThanOrEqual(720);
    expect(filmBox.x).toBeGreaterThan(text.x + text.width);
  });
});

// The hero's button and the film's picture and bar end on the first
// screen at seven desktop sizes, short windows included, in this
// machine's face and in a wide one. Beside the film, a 48 px headline
// wraps to four or five lines in a wide face and pushed the button below
// a 600 or 700 px high window, so the headline is 40 px where the text
// column is narrow (under 1160 px wide) or the window short (under
// 680 px high), and 48 px elsewhere; both are pinned here.
for (const wide of [false, true]) {
  test.describe(`the hero on the first screen${wide ? ", in a wide face" : ""}`, () => {
    test.use({
      viewport: { width: 1000, height: 700 },
      storageState: FIRST_VISIT,
    });

    test("keeps the button and the film's picture and bar in view at seven desktop sizes", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (wide) await useWideFont(page);
      await openLanding(page);
      await expect(page.getByTestId("landing-film")).toHaveAttribute(
        "data-mount",
        "ready",
      );
      /** @type {[number, number, string][]} */
      const sizes = [
        [1000, 700, "40px"],
        [1100, 600, "40px"],
        [1100, 700, "40px"],
        [1280, 600, "40px"],
        [1280, 720, "48px"],
        [1440, 900, "48px"],
        [1920, 1080, "48px"],
      ];
      for (const [width, height, headline] of sizes) {
        const where = `${String(width)}x${String(height)}`;
        await page.setViewportSize({ width, height });
        await page.waitForFunction(
          ([w, h]) => innerWidth === w && innerHeight === h,
          [width, height],
        );
        // two frames, so the film's own resize handling has run
        await page.evaluate(
          () =>
            new Promise((done) => {
              requestAnimationFrame(() => requestAnimationFrame(done));
            }),
        );
        const cta = await box(page.locator(".landing-hero .landing-cta"));
        expect(cta.y + cta.height, `${where}: the button`).toBeLessThanOrEqual(
          height,
        );
        const stage = await box(page.locator("#landing-film .lf-stage"));
        const bar = await box(page.locator("#landing-film .lf-controls"));
        expect(stage.y, `${where}: the picture`).toBeGreaterThanOrEqual(0);
        expect(bar.y + bar.height, `${where}: the bar`).toBeLessThanOrEqual(
          height,
        );
        expect(
          await page
            .locator(".landing h1")
            .evaluate((el) => getComputedStyle(el).fontSize),
          `${where}: the headline`,
        ).toBe(headline);
      }
    });
  });
}

test.describe("the cards' pictures", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    storageState: FIRST_VISIT,
  });

  test("the one in view plays and loops, pauses on a tap until the next, and plays again on Show again", async ({
    page,
  }) => {
    await openLanding(page);
    const card = page.getByTestId("landing-card").nth(2);
    const dock = card.locator(".lc-dock");
    const hold = card.locator(".landing-hold");
    await dock.evaluate((el) => {
      el.scrollIntoView({ block: "center", behavior: "instant" });
    });
    await expect(dock).toHaveAttribute("data-phase", "playing");
    // Only the picture in view moves.
    await expect(
      page.getByTestId("landing-card").nth(1).locator(".lc-dock"),
    ).toHaveAttribute("data-phase", "still");
    const motion = () =>
      card.locator(".lc-tcard").evaluate((el) => {
        const style = getComputedStyle(el);
        return `${style.animationName} ${style.animationPlayState}`;
      });
    expect(await motion()).toBe("lc-card-in running");
    // It loops: its last frame held, then played again.
    await expect(dock).toHaveAttribute("data-phase", "holding");
    await expect(dock).toHaveAttribute("data-phase", "playing");

    await hold.click();
    await expect(hold).toHaveAttribute("aria-pressed", "true");
    await expect(dock).toHaveAttribute("data-paused", "true");
    expect(await motion()).toBe("lc-card-in paused");
    await expect
      .poll(() =>
        hold
          .locator(".landing-pause-mark")
          .evaluate((el) => getComputedStyle(el).opacity),
      )
      .toBe("1");
    await hold.click();
    await expect(dock).toHaveAttribute("data-paused", "false");

    // Each card's buttons say which step they belong to, and "Show again"
    // is a full tap target.
    const again = card.getByRole("button", { name: "Show again" });
    await expect(hold).toHaveAccessibleDescription("Add what you know.");
    await expect(again).toHaveAccessibleDescription("Add what you know.");
    expect((await box(again)).height).toBeGreaterThanOrEqual(44);

    await hold.click();
    await again.click();
    await expect(dock).toHaveAttribute("data-paused", "false");
    await expect(dock).toHaveAttribute("data-phase", "playing");
    await expect(hold).toHaveAttribute("aria-pressed", "false");
  });

  test("under reduced motion nothing moves by itself, and Show again plays once", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    await openLanding(page);
    const card = page.getByTestId("landing-card").nth(2);
    const dock = card.locator(".lc-dock");
    await dock.evaluate((el) => {
      el.scrollIntoView({ block: "center", behavior: "instant" });
    });
    await page.clock.runFor(3000);
    await expect(dock).toHaveAttribute("data-phase", "still");
    await expect(card.locator(".landing-hold")).toBeHidden();
    await card.getByRole("button", { name: "Show again" }).click();
    await expect(dock).toHaveAttribute("data-phase", "playing");
    await page.clock.runFor(3300 + 50);
    await expect(dock).toHaveAttribute("data-phase", "still");
  });
});

test.describe("the use cases", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    storageState: FIRST_VISIT,
  });

  // Why: twenty examples would outweigh the page, so six show and the
  // rest wait behind "More ideas", a native disclosure that must open from
  // the keyboard as well as by a tap, and every picture must say what it
  // shows to a screen reader.
  test("show six, open the other fourteen by Enter or Space, and describe every picture", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLanding(page);
    const section = page.getByRole("region", {
      name: "What people make with it",
    });
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { level: 2 })).toHaveCount(1);
    const items = section.locator(".uc-item");
    await expect(items).toHaveCount(20);
    const visible = () =>
      // A closed details element keeps its content laid out but hidden
      // (content-visibility), so its size says nothing; this does.
      items.evaluateAll(
        (els) => els.filter((el) => el.checkVisibility()).length,
      );
    expect(await visible()).toBe(6);
    const more = section.locator("details.uc-more");
    const toggle = more.locator("summary");
    await expect(more).not.toHaveAttribute("open");
    // The summary holds both labels; the CSS shows one (innerText reads
    // only what is rendered).
    const label = () => toggle.evaluate((el) => el.innerText.trim());
    await expect.poll(label).toBe("More ideas (14)");

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("open", "");
    await expect.poll(label).toBe("Fewer ideas");
    expect(await visible()).toBe(20);
    // The folded grid sits 26 px below the toggle.
    const toggleBox = await box(toggle);
    const folded = await box(more.locator(".uc-grid"));
    expect(
      Math.abs(folded.y - (toggleBox.y + toggleBox.height) - 26),
    ).toBeLessThanOrEqual(1);

    await page.keyboard.press("Enter");
    await expect(more).not.toHaveAttribute("open");
    await page.keyboard.press("Space");
    await expect(more).toHaveAttribute("open", "");
    expect(await visible()).toBe(20);

    const screens = section.getByRole("img");
    await expect(screens).toHaveCount(20);
    const labels = await screens.evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? ""),
    );
    expect(labels.filter((label) => label.trim().length < 10)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});

test.describe("a returning device", () => {
  // The suite's default storage holds a chosen host: a returning device.
  test.use({ viewport: { width: 390, height: 844 } });

  // Rounded to the pixel; "+ 0" reads a top just above the line (-0.3
  // rounds to -0, the film's box is a fractional height) as 0.
  const stageTop = (/** @type {import("@playwright/test").Page} */ page) =>
    page
      .getByTestId("setup-stage")
      .evaluate((el) => Math.round(el.getBoundingClientRect().top) + 0);

  /**
   * Holds back the module at `pattern` until `release` is called (the dev
   * server serves each source module by its own URL).
   *
   * @param {import("@playwright/test").Page} page
   * @param {RegExp} pattern
   */
  async function holdModule(page, pattern) {
    /** @type {() => void} */
    let release = () => undefined;
    const gate = new Promise((resolve) => {
      release = () => {
        resolve(undefined);
      };
    });
    await page.route(pattern, async (route) => {
      await gate;
      await route.continue();
    });
    return () => {
      release();
    };
  }

  // Before the app's script has run, the page that opened at the setup
  // shows the setup's map and says the steps are coming, instead of an
  // empty card outline on blank paper (a cold load on a slow network can
  // take seconds here).
  test("shows the map and a loading line at the stage before the app has run", async ({
    page,
  }) => {
    const release = await holdModule(page, /\/src\/main\.ts/);
    // Not "load": the page's load waits for the module held back here.
    await page.goto("/?nocache=1", { waitUntil: "commit" });
    await expect(page.getByTestId("setup-map")).toBeVisible();
    await expect(page.getByTestId("setup-loading")).toBeVisible();
    await expect(page.getByTestId("setup-loading")).toHaveText(
      "Loading the setup...",
    );
    expect(Math.abs(await stageTop(page))).toBeLessThanOrEqual(1);
    release();
    await expect(page.getByTestId("setup-card")).toBeVisible();
    await expect(page.getByTestId("wizard")).toBeVisible();
    await expect(page.getByTestId("setup-loading")).toBeHidden();
  });

  // The landing's parts arrive after the jump (here the use cases, held
  // back on purpose): each one that grows the page above the stage must
  // not move it. Then the hold ends by itself, so a reader who scrolls in
  // a way that sends no input event is never pulled back.
  test("opens with the setup stage at the top, keeps it there as the landing mounts, then lets go", async ({
    page,
  }) => {
    const release = await holdModule(page, /\/src\/landing\/use-cases\.ts/);
    await page.goto("/?nocache=1");
    await expect(page.locator(".landing-cards")).toHaveAttribute(
      "data-mount",
      "ready",
    );
    await expect(page.getByTestId("setup-card")).toBeVisible();
    expect(Math.abs(await stageTop(page))).toBeLessThanOrEqual(1);
    await expect(page.locator("html")).toHaveAttribute(
      "data-landing-skip",
      "applied",
    );
    release();
    await expect(page.getByTestId("landing-uses")).toHaveAttribute(
      "data-mount",
      "ready",
    );
    await expect
      .poll(() => stageTop(page).then(Math.abs))
      .toBeLessThanOrEqual(1);
    await expect(page.locator("html")).toHaveAttribute(
      "data-landing-skip",
      "released",
    );
  });

  // A scroll the hold did not make is the reader's, whatever caused it
  // (a scrollbar drag, a screen reader's browse mode, a script): the page
  // is the reader's from then on.
  test("lets go on any scroll the hold did not make", async ({ page }) => {
    await holdModule(page, /\/src\/landing\/use-cases\.ts/);
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("setup-card")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-landing-skip",
      "applied",
    );
    await page.evaluate(() => {
      window.scrollBy({ top: -200, behavior: "instant" });
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-landing-skip",
      "moved",
    );
  });

  // The skip moved the view; the keyboard follows it. A first Tab from the
  // top would focus the landing's first link and scroll the page back.
  test("starts the keyboard at the stage", async ({ page }) => {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("setup-card")).toBeVisible();
    await expect(page.getByTestId("setup-stage")).toBeFocused();
    await page.keyboard.press("Tab");
    const inLanding = await page.evaluate(
      () => document.activeElement?.closest("#landing") != null,
    );
    expect(inLanding).toBe(false);
    expect(Math.abs(await stageTop(page))).toBeLessThan(844 / 2);
  });

  // The wizard reloads the page mid-setup on purpose (after an AR session,
  // after the print dialog), and the browser restores where the creator
  // was. If the use cases' chunk mounts after that restoration (a slow
  // network), the section must not grow the page above the stage.
  for (const reduced of [false, true]) {
    // Under reduced motion the film opens with its captions as a list,
    // which grows its box when it mounts: that growth sits above the
    // stage too.
    test(`comes back to the stage after a reload, also when the use cases arrive late${reduced ? ", under reduced motion" : ""}`, async ({
      page,
    }) => {
      if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
      await comesBackAfterReload(page);
    });
  }

  /** @param {import("@playwright/test").Page} page */
  async function comesBackAfterReload(page) {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("landing-uses")).toHaveAttribute(
      "data-mount",
      "ready",
    );
    await page.mouse.move(195, 400);
    await page.mouse.wheel(0, 1);
    await expect(page.locator("html")).toHaveAttribute(
      "data-landing-skip",
      "moved",
    );
    await page.getByTestId("setup-stage").evaluate((el) => {
      el.scrollIntoView({ block: "start", behavior: "instant" });
    });
    expect(Math.abs(await stageTop(page))).toBeLessThanOrEqual(1);
    const release = await holdModule(page, /\/src\/landing\/use-cases\.ts/);
    await page.reload();
    await expect(page.locator(".landing-cards")).toHaveAttribute(
      "data-mount",
      "ready",
    );
    await expect(page.getByTestId("setup-card")).toBeVisible();
    release();
    await expect(page.getByTestId("landing-uses")).toHaveAttribute(
      "data-mount",
      "ready",
    );
    // The reserved height is a lower bound of the mounted section's (10 px
    // under it at this width, index.html.md): without it the page landed
    // about 1 700 px past the stage.
    await expect
      .poll(() => stageTop(page).then(Math.abs))
      .toBeLessThanOrEqual(24);
    // and the film too has mounted by then (its box the last to settle)
    await expect(page.getByTestId("landing-film")).toHaveAttribute(
      "data-mount",
      "ready",
    );
    expect(Math.abs(await stageTop(page))).toBeLessThanOrEqual(24);
  }

  // A first visit keeps the stage at its own height; only a page that
  // opened at the stage needs it a view tall.
  test("is a view tall only on a page that skipped", async ({ page }) => {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("setup-card")).toBeVisible();
    const minHeight = () =>
      page
        .getByTestId("setup-stage")
        .evaluate((el) => getComputedStyle(el).minHeight);
    expect(await minHeight()).toBe("844px");
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.goto("/?nocache=2");
    await expect(page.getByTestId("setup-card")).toBeVisible();
    expect(["0px", "auto"]).toContain(await minHeight());
  });

  test("leaves a reload to the browser's own scroll restoration", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await expect(page.getByTestId("setup-card")).toBeVisible();
    await expect(page.getByTestId("landing-uses")).toHaveAttribute(
      "data-mount",
      "ready",
    );
    // A reader scrolls by a wheel, a touch or a key: that input releases
    // the page from the skip's hold (a scripted scroll alone does not).
    await page.mouse.move(195, 400);
    await page.mouse.wheel(0, -40);
    await expect(page.locator("html")).toHaveAttribute(
      "data-landing-skip",
      "moved",
    );
    await page.evaluate(() => {
      window.scrollTo({ top: 300, behavior: "instant" });
    });
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(300);
    await page.reload();
    await expect(page.locator(".landing-cards")).toHaveAttribute(
      "data-mount",
      "ready",
    );
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(300);
  });

  test("follows a link to a place in the page instead", async ({ page }) => {
    await page.goto("/?nocache=1#landing-make-title");
    await expect(page.locator(".landing-cards")).toHaveAttribute(
      "data-mount",
      "ready",
    );
    await expect
      .poll(() =>
        page
          .locator("#landing-make-title")
          .evaluate((el) => Math.abs(el.getBoundingClientRect().top)),
      )
      .toBeLessThanOrEqual(1);
    expect(await stageTop(page)).toBeGreaterThan(0);
  });
});

test.describe("a first visit", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    storageState: FIRST_VISIT,
  });

  test("opens at the top", async ({ page }) => {
    await openLanding(page);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(page.getByTestId("landing-way")).toBeInViewport();
  });

  test("Make your tour brings the setup into view and the keyboard to the open step", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLanding(page);
    await page.getByTestId("landing-begin-top").click();
    await expect
      .poll(() =>
        page
          .getByTestId("setup-stage")
          // "+ 0": a top just above the line rounds to -0 (see stageTop)
          .evaluate((el) => Math.round(el.getBoundingClientRect().top) + 0),
      )
      .toBe(0);
    await expect(
      page.getByTestId("step-host").locator("summary"),
    ).toBeFocused();
  });
});

/** What the landing downloads for a creator: its chunks' modules (the dev
 *  server serves each by its own URL) and the hero's still. */
const LANDING_DOWNLOADS =
  /landing-cards|landing-film|film-|use-case|hero-still/;

/**
 * Every URL the page asks for from now on.
 *
 * @param {import("@playwright/test").Page} page
 */
function recordRequests(page) {
  /** @type {string[]} */
  const fetched = [];
  page.on("request", (request) => fetched.push(request.url()));
  return fetched;
}

test("a visitor's page shows no landing and downloads none of it", async ({
  page,
}) => {
  const fetched = recordRequests(page);
  await page.goto(
    `/?qr=${encodeURIComponent("http://127.0.0.1:5197/ranges-ok/tour.zip")}`,
  );
  await expect(page.getByTestId("visitor-screen")).toBeVisible();
  await expect(page.getByTestId("landing")).toBeHidden();
  await expect(page.getByTestId("enter-ar")).not.toHaveAttribute(
    "data-ar-state",
    "checking",
  );
  expect(fetched.filter((url) => LANDING_DOWNLOADS.test(url))).toEqual([]);

  // The filter sees the landing's downloads at all: a creator's page, in
  // the same browser afterwards, fetches them (a renamed module would
  // otherwise let the check above pass on nothing).
  const creator = recordRequests(page);
  await openLanding(page);
  const seen = creator.filter((url) => LANDING_DOWNLOADS.test(url));
  expect(seen.some((url) => url.includes("landing-cards"))).toBe(true);
  expect(seen.some((url) => url.includes("landing-film"))).toBe(true);
  expect(seen.some((url) => url.includes("use-case"))).toBe(true);
});
