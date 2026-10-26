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
 * at a phone, a phone held across and a desktop, also in a wide face. The
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
        near(gap(cta, film), expected.film);

        // The film's box keeps its aspect (4:5 upright, 16:9 otherwise),
        // never taller than the view, and shows the still.
        const upright =
          viewport.width < viewport.height && viewport.width < 900;
        expect(film.width / film.height).toBeCloseTo(
          upright ? 4 / 5 : 16 / 9,
          2,
        );
        expect(film.height).toBeLessThanOrEqual(viewport.height - 24 + 1);
        await expect(page.getByTestId("landing-still")).toBeVisible();

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
        const afterCard = desktop ? 76 : sideways ? 40 : 52;
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
        expect(columns).toBe(viewport.width >= 600 ? 2 : 1);

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
// film fills its box at a fixed aspect, so the box must stay 16:9 there
// too, never only capped in height.
test.describe("the film's box on a short desktop window", () => {
  test.use({
    viewport: { width: 1280, height: 600 },
    storageState: FIRST_VISIT,
  });

  test("stays 16:9 and fits the view", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLanding(page);
    const film = await box(page.locator("#landing-film"));
    expect(film.width / film.height).toBeCloseTo(16 / 9, 2);
    expect(film.height).toBeLessThanOrEqual(600 - 24 + 1);
  });
});

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
    expect(await motion()).toBe("lc-cardIn running");
    // It loops: its last frame held, then played again.
    await expect(dock).toHaveAttribute("data-phase", "holding");
    await expect(dock).toHaveAttribute("data-phase", "playing");

    await hold.click();
    await expect(hold).toHaveAttribute("aria-pressed", "true");
    await expect(dock).toHaveAttribute("data-paused", "true");
    expect(await motion()).toBe("lc-cardIn paused");
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

  const stageTop = (/** @type {import("@playwright/test").Page} */ page) =>
    page
      .getByTestId("setup-stage")
      .evaluate((el) => Math.round(el.getBoundingClientRect().top));

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
  test("comes back to the stage after a reload, also when the use cases arrive late", async ({
    page,
  }) => {
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
  });

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
          .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
      )
      .toBe(0);
    await expect(
      page.getByTestId("step-host").locator("summary"),
    ).toBeFocused();
  });
});

/** What the landing downloads for a creator: its chunks' modules (the dev
 *  server serves each by its own URL) and the hero's still. */
const LANDING_DOWNLOADS = /landing-cards|film-placeholder|use-case|hero-still/;

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
  expect(seen.some((url) => url.includes("use-case"))).toBe(true);
});
