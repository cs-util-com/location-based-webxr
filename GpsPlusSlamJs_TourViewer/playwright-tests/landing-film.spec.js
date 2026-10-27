// @ts-check
import { expect, test } from "@playwright/test";

/**
 * The hero film on a creator's first visit: a model park in eight parts,
 * with a bar to pause, play and jump, and a caption under the picture.
 *
 * Why these tests matter: the film runs on the page every creator opens,
 * on phones that also run AR. Its unit tests pin each promise through
 * seams; these pin the same promises on the real page, where the host's
 * CSS, the page's AR start and the chunk loading take part: it starts by
 * itself only once enough of it is in view, a tap or the button pauses
 * it, it plays once and offers to play again, reduced motion opens on
 * the last picture with every caption as a list, a browser without WebGL
 * gets the drawn park, a failed chunk keeps the page's still, and AR gets
 * the GPU (the film lets go of its renderer, is not mistaken for a lost
 * one, and builds a new one the next time it is in view).
 */

const FIRST_VISIT = { cookies: [], origins: [] };

/**
 * The page's errors from now on (a broken film must not be quiet).
 *
 * @param {import("@playwright/test").Page} page
 */
function pageErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/**
 * A browser without WebGL: every canvas refuses a WebGL context.
 *
 * @param {import("@playwright/test").Page} page
 */
async function refuseWebGL(page) {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error a stand-in that refuses only WebGL
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      if (String(kind).startsWith("webgl")) return null;
      return get.call(this, kind, ...rest);
    };
  });
}

/**
 * A first visit with the film mounted.
 *
 * @param {import("@playwright/test").Page} page
 */
async function openFilm(page) {
  await page.goto("/?nocache=1");
  const host = page.getByTestId("landing-film");
  await expect(host).toHaveAttribute("data-mount", "ready");
  await expect(host.locator(".lf-film")).toBeVisible();
  return host;
}

test.describe("the hero film on a desktop", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    storageState: FIRST_VISIT,
  });

  test("waits while under half of it is in view, plays once half is, and names its parts on the bar", async ({
    page,
  }) => {
    // A window narrow enough that the film stands under the text (from
    // 1000 px it stands beside it, wholly in view) and short enough that
    // only part of it is in view at the top of the page, so it must wait
    // and start only when scrolled to.
    await page.setViewportSize({ width: 960, height: 640 });
    const errors = pageErrors(page);
    const host = await openFilm(page);
    // The film's own view observer reports in the same step as one made
    // after it: once this one has reported, the film has seen the view
    // too, so "waiting" below is its answer to a real share, not the
    // state before any report.
    const firstShare = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const el = document.getElementById("landing-film");
          if (!el) throw new Error("no film");
          const io = new IntersectionObserver(
            (entries) => {
              io.disconnect();
              const last = entries[entries.length - 1];
              requestAnimationFrame(() => resolve(last?.intersectionRatio));
            },
            { threshold: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1] },
          );
          io.observe(el);
        }),
    );
    expect(firstShare).toBeGreaterThan(0);
    expect(firstShare).toBeLessThan(0.5);
    await expect(host).toHaveAttribute("data-film-state", "waiting");
    await expect(host).toHaveAttribute("data-playing", "false");

    const changes = page.evaluate(
      () =>
        new Promise((resolve) => {
          document
            .getElementById("landing-film")
            ?.addEventListener(
              "landing-film-change",
              (event) =>
                resolve(/** @type {CustomEvent} */ (event).detail.status),
              { once: true },
            );
        }),
    );
    await host.scrollIntoViewIfNeeded();
    await expect(host).toHaveAttribute("data-film-state", "playing");
    await expect(host).toHaveAttribute("data-playing", "true");
    expect(await changes).toBe("playing");

    const parts = host.locator(".lf-seg");
    await expect(parts).toHaveCount(8);
    await expect(parts.first()).toHaveAccessibleName(/^Part 1 of 8: /);
    await expect(host.locator(".lf-seg[aria-current]")).toHaveCount(1);
    await expect(parts.first()).toHaveAttribute("aria-current", "step");

    // A jump plays from that part's start.
    await parts.nth(5).click();
    await expect(host).toHaveAttribute("data-film-beat", "5");
    await expect(parts.nth(5)).toHaveAttribute("aria-current", "step");
    await expect(host.locator(".lf-seg[aria-current]")).toHaveCount(1);
    await expect(host).toHaveAttribute("data-film-state", "playing");

    // A tap on the picture pauses, a second one plays on.
    const stage = host.locator(".lf-stage");
    await stage.click();
    await expect(host).toHaveAttribute("data-film-state", "paused");
    await expect(host).toHaveAttribute("data-playing", "false");
    await stage.click();
    await expect(host).toHaveAttribute("data-film-state", "playing");

    // The button does the same from the keyboard.
    const button = host.locator(".lf-play");
    await expect(button).toHaveAccessibleName("Pause the film");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(host).toHaveAttribute("data-film-state", "paused");
    await expect(button).toHaveAccessibleName("Play the film");
    await page.keyboard.press("Space");
    await expect(host).toHaveAttribute("data-film-state", "playing");
    expect(errors).toEqual([]);
  });

  test("plays once, ends with every part seen, and plays again when asked", async ({
    page,
  }) => {
    // Drawn flat (no WebGL), so stepping the clock through a part costs
    // little real time; the end of the film is the same with either renderer.
    await refuseWebGL(page);
    await page.clock.install({ time: 0 });
    const host = await openFilm(page);
    await page.clock.pauseAt(10_000);
    await host.scrollIntoViewIfNeeded();
    await page.clock.runFor(200);
    await expect(host).toHaveAttribute("data-film-state", "playing");
    await host.locator(".lf-seg").nth(7).click();
    // The clock steps a second at a time (each step runs its frames). The
    // last part is about 17 s at the default pace (of 70 s); 40 steps
    // leave room for a slower pace without waiting on anything else.
    for (let s = 0; s < 40; s++) {
      if ((await host.getAttribute("data-film-state")) === "finished") break;
      await page.clock.runFor(1000);
    }
    await expect(host).toHaveAttribute("data-film-state", "finished");
    await expect(host).toHaveAttribute("data-playing", "false");
    await expect(host.locator(".lf-seg-seen")).toHaveCount(8);
    const again = host.locator(".lf-play");
    await expect(again).toHaveAccessibleName("Play again");
    await expect(again).toContainText("Play again");

    // It does not start over by itself, in view or after a scroll.
    await page.clock.runFor(5000);
    await expect(host).toHaveAttribute("data-film-state", "finished");

    await again.click();
    await page.clock.runFor(100);
    await expect(host).toHaveAttribute("data-film-state", "playing");
    await expect(host).toHaveAttribute("data-film-beat", "0");
  });

  test("hands the GPU to AR, is not counted as lost, and builds a new renderer next time in view", async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const host = await openFilm(page);
    await host.scrollIntoViewIfNeeded();
    await expect(host.locator("canvas.lf-gl")).toHaveCount(1);
    await expect(host).toHaveAttribute("data-film-state", "playing");

    // The AR entry marks a live session on the body (ar-entry.ts).
    await page.evaluate(() => {
      document.body.dataset["arActive"] = "true";
    });
    await expect(host.locator("canvas.lf-gl")).toHaveCount(0);
    await expect(host).not.toHaveAttribute("data-film-state", "playing");
    await expect(host).not.toHaveAttribute("data-film-fallback");
    // Still in view, it does not start again behind the session.
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 600)),
    );
    await expect(host.locator("canvas.lf-gl")).toHaveCount(0);
    await expect(host).not.toHaveAttribute("data-film-state", "playing");

    await page.evaluate(() => {
      document.body.dataset["arActive"] = "false";
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    await host.scrollIntoViewIfNeeded();
    await expect(host.locator("canvas.lf-gl")).toHaveCount(1);
    await expect(host).not.toHaveAttribute("data-film-fallback");
    expect(errors).toEqual([]);
  });

  test("a tap on Start lets go of the renderer before AR asks for the camera", async ({
    page,
  }) => {
    const host = await openFilm(page);
    await host.scrollIntoViewIfNeeded();
    await expect(host.locator("canvas.lf-gl")).toHaveCount(1);
    // The film listens in the capture phase on the document, so a click
    // that reaches Start counts even where the button itself is disabled
    // in this browser (it has no AR).
    await page.evaluate(() => {
      document
        .getElementById("enter-ar")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(host.locator("canvas.lf-gl")).toHaveCount(0);
    await expect(host).not.toHaveAttribute("data-film-fallback");
  });
});

test.describe("the hero film on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    storageState: FIRST_VISIT,
  });

  test("asks for no animation frame while paused", async ({ page }) => {
    await page.addInitScript(() => {
      const w = /** @type {Window & { __frames?: number }} */ (window);
      w.__frames = 0;
      const ask = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        w.__frames = (w.__frames ?? 0) + 1;
        return ask(callback);
      };
    });
    const host = await openFilm(page);
    await expect(host).toHaveAttribute("data-film-state", "playing");
    await host.locator(".lf-stage").click();
    await expect(host).toHaveAttribute("data-film-state", "paused");
    const frames = () =>
      page.evaluate(
        () =>
          /** @type {Window & { __frames?: number }} */ (window).__frames ?? 0,
      );
    // Let the last frames in flight settle, then count over a second: the
    // cards below are out of view at the top of the page, so nothing else
    // on it animates.
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 300)),
    );
    const before = await frames();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 1000)),
    );
    expect((await frames()) - before).toBe(0);
  });

  test("under reduced motion opens on the last picture with every caption, and plays only when asked", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const host = await openFilm(page);
    await host.scrollIntoViewIfNeeded();
    const list = host.locator(".lf-captions");
    await expect(list).toBeVisible();
    await expect(list.locator("li")).toHaveCount(8);
    await expect(host.locator(".lf-caption")).toBeHidden();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 600)),
    );
    await expect(host).not.toHaveAttribute("data-film-state", "playing");
    // The list grows the box below its picture, never over it.
    const listBox = await list.boundingBox();
    const hostBox = await host.boundingBox();
    if (listBox === null || hostBox === null) throw new Error("no box");
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(
      hostBox.y + hostBox.height,
    );

    const play = host.locator(".lf-play");
    await expect(play).toHaveAccessibleName("Play the film");
    await play.click();
    await expect(host).toHaveAttribute("data-film-state", "playing");
    await expect(list).toBeHidden();
    await expect(host.locator(".lf-caption")).toBeVisible();
  });

  test("draws the park flat without WebGL, and says so on its box", async ({
    page,
  }) => {
    await refuseWebGL(page);
    const errors = pageErrors(page);
    const host = await openFilm(page);
    await expect(host).toHaveAttribute("data-film-fallback", "no-webgl");
    await expect(host.locator("canvas.lf-gl")).toHaveCount(0);
    await expect(host.locator("svg.lf-floor")).toBeVisible();
    await expect(host).toHaveAttribute("data-film-state", "playing");
    expect(errors).toEqual([]);
  });

  test("keeps the page's still when the film's chunk cannot load", async ({
    page,
  }) => {
    await page.route(/\/src\/landing\/landing-film\.ts/, (route) =>
      route.abort(),
    );
    await page.goto("/?nocache=1");
    const host = page.getByTestId("landing-film");
    await expect(host).toHaveAttribute("data-mount", "failed");
    await expect(page.getByTestId("landing-still")).toBeVisible();
    await expect(host.locator(".lf-film")).toHaveCount(0);
  });
});

// The box is reserved before the film arrives: the page's still stands
// where the film's picture will be, at its proportion, and the box keeps
// its height when the film replaces it (no jump under the reader).
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
]) {
  test.describe(`the film's box at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport, storageState: FIRST_VISIT });

    test("holds the film's place with the still, and keeps its size when the film mounts", async ({
      page,
    }) => {
      /** @type {() => void} */
      let release = () => undefined;
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      await page.route(/\/src\/landing\/landing-film\.ts/, async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto("/?nocache=1");
      const host = page.getByTestId("landing-film");
      const still = page.getByTestId("landing-still");
      await expect(still).toBeVisible();
      await expect(host.locator("picture")).toBeVisible();
      const before = await host.boundingBox();
      const picture = await host.locator("picture").boundingBox();
      release();
      await expect(host.locator(".lf-film")).toBeVisible();
      const after = await host.boundingBox();
      const stage = await host.locator(".lf-stage").boundingBox();
      if (!before || !picture || !after || !stage) throw new Error("no box");
      expect(after).toEqual(before);
      for (const key of /** @type {const} */ (["x", "y", "width", "height"])) {
        expect(Math.abs(stage[key] - picture[key])).toBeLessThanOrEqual(1);
      }
    });
  });
}
