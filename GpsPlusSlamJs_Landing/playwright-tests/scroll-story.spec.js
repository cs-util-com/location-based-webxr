// @ts-check
import { test, expect } from "@playwright/test";

// Why these tests matter: the landing's logic is unit-tested, but only a
// real browser exercises the WebGL boot, the anime.js scrub, and the DOM
// wiring together. A headless smoke run of exactly this shape caught two
// real visual defects during initial implementation. The suite stays
// small on purpose: boot + scroll integrity, fallback floor, theme
// persistence, demo links, reduced motion.

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

test("boots and activates every chapter while scrolling, with zero errors", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/");
  for (const id of CHAPTER_IDS) {
    await expect(page.locator(`#chapter-${id}`)).toBeAttached();
  }
  for (const id of CHAPTER_IDS) {
    await page.locator(`#chapter-${id}`).scrollIntoViewIfNeeded();
    // The active class is set by the scroll state machine; expect() polls,
    // so no fixed timeouts are needed. The hero carries its content in
    // .hero-content (normal-landing layout), the rest in .copy panels.
    await expect(page.locator(`#chapter-${id}.active`)).toBeAttached();
    const content = id === "hero" ? ".hero-content" : ".copy";
    await expect(page.locator(`#chapter-${id} ${content}`)).toBeVisible();
  }
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

test("renders the 3D canvas, or engages the static-DOM floor cleanly", async ({
  page,
}) => {
  await page.goto("/");
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
});

test("palette button cycles the palette and the choice persists across reload", async ({
  page,
}) => {
  await page.goto("/");
  const initial = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  await page.locator("#theme-toggle").click();
  // Cycled to the NEXT palette (round-2 R19: five ids, not a toggle).
  await expect(page.locator(`html[data-theme="${initial}"]`)).toHaveCount(0);
  const cycled = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  await page.reload();
  // The FOUC guard must restore the persisted choice before/at first paint.
  await expect(page.locator(`html[data-theme="${cycled}"]`)).toBeAttached();
});

test("all five demo apps stay launchable from the demos hub", async ({
  page,
}) => {
  await page.goto("/");
  for (const href of [
    "/starter/",
    "/minimal/",
    "/qr-demo/",
    "/recorder/",
    "/physics/",
  ]) {
    const card = page.locator(`a.demo-card[href="${href}"]`);
    await expect(card).toBeAttached();
    // Round-10 R10-1: demo apps open in a NEW TAB as well — every
    // outbound click keeps the landing alive in the background.
    await expect(card).toHaveAttribute("target", "_blank");
    await expect(card).toHaveAttribute("rel", /noopener/);
  }
  // Round-9 R9-4: ONE primary CTA carrying the GitHub mark (the separate
  // "Open source on GitHub" badge duplicated it and was removed), and
  // every external link opens a NEW TAB — the landing must stay open.
  const primary = page.locator(
    'a.btn-primary[href="https://github.com/cs-util-com/location-based-webxr"]',
  );
  await expect(primary).toBeAttached();
  await expect(primary).toHaveAttribute("target", "_blank");
  await expect(primary.locator("svg")).toBeAttached();
  await expect(page.locator("a.github-badge")).toHaveCount(0);
  for (const external of await page.locator('a[href^="https://"]').all()) {
    await expect(external).toHaveAttribute("target", "_blank");
    await expect(external).toHaveAttribute("rel", /noopener/);
  }
});

test("FAQ accordions exist and open natively", async ({ page }) => {
  // The FAQ (v2 B6) is native <details> — no JS involved. Round-14
  // R14-21: four expanders + the license row, which is now a LINK that
  // opens the repo LICENSE in a new tab (looks like a row, doesn't
  // expand).
  await page.goto("/");
  await expect(page.locator(".faq details")).toHaveCount(4);
  const first = page.locator(".faq details").first();
  await first.locator("summary").click();
  await expect(first).toHaveAttribute("open", "");
  await expect(first.locator("p")).toBeVisible();

  const license = page.locator(".faq .faq-link");
  await expect(license).toHaveAttribute(
    "href",
    "https://github.com/cs-util-com/location-based-webxr/blob/main/LICENSE",
  );
  await expect(license).toHaveAttribute("target", "_blank");
  await expect(license).toHaveAttribute("rel", /noopener/);
});

test("jump-to-demos stops at the demos hub, not the page bottom", async ({
  page,
}) => {
  // Round-10 R10-2: the hero link used to scroll to scroller.scrollHeight
  // — the absolute bottom, which since the FAQ landed is the FAQ, not
  // the demos. It must stop at the CTA chapter's top instead.
  await page.goto("/");
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
});

test("hero code snippet starts expanded on desktop", async ({ page }) => {
  // Round-9 R9-5: the snippet is a <details> expander — desktop-class
  // viewports get it open at boot (the developer hook stays one glance
  // away), phones keep it collapsed (see the mobile suite).
  await page.goto("/");
  await expect(page.locator("#hero-snippet")).toHaveAttribute("open", "");
  await expect(page.locator("#hero-snippet pre")).toBeVisible();
});

test("chapter dot rail navigates the story", async ({ page }) => {
  // v3 F6: seven dots (one per chapter, labels from chapters.ts as
  // aria-labels), click scrolls to the chapter and the active dot moves.
  await page.goto("/");
  await expect(page.locator("#chapter-dots button")).toHaveCount(7);
  await page.locator('#chapter-dots button[data-index="6"]').click();
  await expect(page.locator("#chapter-cta.active")).toBeAttached();
  await expect(
    page.locator('#chapter-dots button[data-index="6"].active'),
  ).toBeAttached();
});

test("desktop without WebXR gets the QR handoff in the CTA", async ({
  page,
}) => {
  // Headless desktop chromium reports no navigator.xr and the default
  // context is a fine-pointer 1280px viewport — exactly the device class
  // the QR handoff (v2 B2) targets.
  await page.goto("/");
  await page.locator("#chapter-cta").scrollIntoViewIfNeeded();
  await expect(page.locator("#qr-handoff svg")).toBeVisible();
  await expect(page.locator("#qr-handoff .qr-caption")).toHaveText(
    "Scan to try on your phone",
  );
});

// Most real users open the landing page on a phone (round-2 request):
// pin that BOTH mobile orientations boot, show every chapter readable,
// and keep the document non-scrolling — with touch + mobile emulation on.
for (const [orientation, viewport] of [
  ["portrait", { width: 412, height: 915 }],
  ["landscape", { width: 915, height: 412 }],
]) {
  test.describe(`mobile ${orientation}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test(`shows every chapter readable on a phone (${orientation})`, async ({
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

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("still presents every chapter readable, without errors", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    for (const id of CHAPTER_IDS) {
      await page.locator(`#chapter-${id}`).scrollIntoViewIfNeeded();
      const content = id === "hero" ? ".hero-content" : ".copy";
      await expect(page.locator(`#chapter-${id} ${content}`)).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});
