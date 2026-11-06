// @ts-check
import { test, expect } from "./e2e-test.js";

// Why these tests matter: the landing's logic is unit-tested, but only a
// real browser exercises the WebGL boot, the anime.js scrub, and the DOM
// wiring together. A headless smoke run of exactly this shape caught two
// real visual defects during initial implementation. The suite stays
// small on purpose: boot + scroll integrity, fallback floor, navigation and
// theme persistence, phones, reduced motion. The links are static markup and
// are read from the file in src/index-html.test.ts.

/** Must match src/chapters.ts (CHAPTERS order). */
const CHAPTER_IDS = [
  "hero",
  "qr",
  "fusion",
  "dive",
  "anywhere",
  "gallery",
  "cta",
];

/** @param {import('@playwright/test').Page} page */
function collectErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") {
      return;
    }
    // WebGL context loss is an ENVIRONMENT event (GPU pressure), not a
    // page bug — the page handles it via the static-floor fallback, so
    // it must not fail the zero-errors assertion.
    if (/context lost|context_lost_webgl|context restored/i.test(msg.text())) {
      return;
    }
    errors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    errors.push(String(err));
  });
  return errors;
}

test("boots with a canvas or the static floor, the snippet open, every chapter activating, the QR handoff, and zero errors @pr", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/");
  for (const id of CHAPTER_IDS) {
    await expect(page.locator(`#chapter-${id}`)).toBeAttached();
  }
  // A GPU under pressure can lose the WebGL context at ANY moment and the
  // page then flips to the static floor (and back on restore) — so assert
  // that the page is in ONE of the two consistent states, re-evaluating
  // the floor flag inside the retry loop instead of racing it once.
  await expect(async () => {
    const usesFloor = await page.evaluate(() =>
      document.body.classList.contains("no-webgl"),
    );
    if (usesFloor) {
      // No WebGL right now: canvas layer hidden, copy fully readable —
      // that IS correct behavior, not a bug.
      await expect(page.locator("#scene-root")).toBeHidden({ timeout: 500 });
      await expect(page.locator("#chapter-hero .hero-content")).toBeVisible({
        timeout: 500,
      });
    } else {
      const canvas = page.locator("#scene-root canvas");
      await expect(canvas).toBeVisible({ timeout: 500 });
      const box = await canvas.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);
    }
  }).toPass({ timeout: 15000 });
  // The snippet is a <details> expander: desktop-class viewports get it open
  // at boot (the developer hook stays one glance away), phones keep it
  // collapsed (see the mobile suite).
  await expect(page.locator("#hero-snippet")).toHaveAttribute("open", "");
  await expect(page.locator("#hero-snippet pre")).toBeVisible();
  for (const id of CHAPTER_IDS) {
    await page.locator(`#chapter-${id}`).scrollIntoViewIfNeeded();
    // The active class is set by the scroll state machine; expect() polls,
    // so no fixed timeouts are needed. The hero carries its content in
    // .hero-content (normal-landing layout), the rest in .copy panels.
    await expect(page.locator(`#chapter-${id}.active`)).toBeAttached();
    const content = id === "hero" ? ".hero-content" : ".copy";
    await expect(page.locator(`#chapter-${id} ${content}`)).toBeVisible();
  }
  // Headless desktop chromium reports no navigator.xr and the default context
  // is a fine-pointer 1280px viewport: exactly the device class the QR handoff
  // in the last chapter targets.
  await expect(page.locator("#qr-handoff svg")).toBeVisible();
  await expect(page.locator("#qr-handoff .qr-caption")).toHaveText(
    "Scan to try on your phone",
  );
  // The hero veil must have fully lifted this far into the story (R4).
  expect(
    await page.evaluate(() =>
      Number(document.getElementById("hero-veil")?.style.opacity ?? "1"),
    ),
  ).toBeLessThan(0.1);
  // The DOCUMENT must never scroll — #story is the page's only scroller
  // (keeps the mobile URL bar stationary; round-1 feedback F1b).
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // The canvas layer must cover at least the full (large) viewport so a
  // collapsing mobile browser bar can never expose a black band (R2) —
  // unless the WebGL-context-loss floor legitimately hid it (no-webgl).
  expect(
    await page.evaluate(
      () =>
        document.body.classList.contains("no-webgl") ||
        (document.getElementById("scene-root")?.offsetHeight ?? 0) >=
          window.innerHeight,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.getElementById("story")?.scrollTop ?? 0),
  ).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("a ?qr= launch forwards to the tour viewer with the payload intact @pr", async ({
  page,
}) => {
  // Why this matters: printed QR codes encode the BARE host so the densest
  // QR forms stay available (ZD-9); this forward is the only thing standing
  // between a physical, unchangeable printout and a dead link. The dev
  // server SPA-falls-back on /tour/, so the URL is the assertion. The head
  // script replaces the location DURING the first load, which aborts that
  // navigation (net::ERR_ABORTED) — expected, hence the catch.
  await page
    .goto("/?qr=https%3A%2F%2Fexample.com%2Ftour.zip&nocache=1")
    .catch(() => undefined);
  // RegExp, not a URL glob: a glob's `?` is a single-character wildcard and
  // can never match the literal query separator.
  await page.waitForURL(/\/tour\/\?qr=https%3A%2F%2Fexample\.com%2Ftour\.zip/);
});

test("the dot rail and the jump link navigate the story, and the palette persists across a reload", async ({
  page,
}) => {
  await page.goto("/");
  // Seven dots, one per chapter: a click scrolls to the chapter and the
  // active dot moves.
  await expect(page.locator("#chapter-dots button")).toHaveCount(7);
  await page.locator('#chapter-dots button[data-index="6"]').click();
  await expect(page.locator("#chapter-cta.active")).toBeAttached();
  await expect(
    page.locator('#chapter-dots button[data-index="6"].active'),
  ).toBeAttached();

  // The hero link used to scroll to scroller.scrollHeight: the absolute
  // bottom, which since the FAQ landed is the FAQ, not the demos. It must
  // stop at the CTA chapter's top instead.
  await page.evaluate(() => {
    const story = document.getElementById("story");
    if (story) story.scrollTop = 0;
  });
  await expect(page.locator("#chapter-hero.active")).toBeAttached();
  await page.locator("#jump-demos").click();
  await expect(page.locator("#chapter-cta h2")).toBeInViewport();
  const atBottom = await page.evaluate(() => {
    const story = document.getElementById("story");
    if (!story) {
      return true;
    }
    return story.scrollTop >= story.scrollHeight - story.clientHeight - 50;
  });
  expect(atBottom).toBe(false);

  // Last, because the reload resets the page. Cycles to the NEXT palette
  // (five ids, not a toggle).
  const initial = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  await page.locator("#theme-toggle").click();
  await expect(page.locator(`html[data-theme="${initial}"]`)).toHaveCount(0);
  const cycled = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  await page.reload();
  // The FOUC guard must restore the persisted choice before/at first paint.
  await expect(page.locator(`html[data-theme="${cycled}"]`)).toBeAttached();
});

// Most real users open the landing page on a phone (round-2 request):
// pin that BOTH mobile orientations boot, show every chapter readable,
// and keep the document non-scrolling — with touch + mobile emulation on.
// Portrait runs twice: with reduced motion, so one boot holds the promise that
// every chapter stays readable without errors when the scrub is off, and with
// the motion on, as most phones open it.
for (const [orientation, viewport, reducedMotion] of [
  ["portrait", { width: 412, height: 915 }, "reduce"],
  ["portrait", { width: 412, height: 915 }, "no-preference"],
  ["landscape", { width: 915, height: 412 }, "no-preference"],
]) {
  test.describe(`mobile ${orientation}, motion ${reducedMotion}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true, reducedMotion });

    test(`shows every chapter readable on a phone (${orientation})${reducedMotion === "reduce" ? " @pr" : ""}`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.goto("/");
      for (const id of CHAPTER_IDS) {
        await page.locator(`#chapter-${id}`).scrollIntoViewIfNeeded();
        const content = id === "hero" ? ".hero-content" : ".copy";
        await expect(page.locator(`#chapter-${id} ${content}`)).toBeVisible();
      }
      // Phones never get the desktop QR handoff (v2 B2): the emulated
      // mobile context reports a coarse pointer, so it must stay hidden.
      await expect(page.locator("#qr-handoff")).toBeHidden();
      // The hero snippet stays COLLAPSED on phones (round-9 R9-5): the
      // summary is tappable but the code must not push the fold.
      await expect(page.locator("#hero-snippet")).not.toHaveAttribute(
        "open",
        "",
      );
      await expect(page.locator("#hero-snippet summary")).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(errors).toEqual([]);
    });
  });
}
