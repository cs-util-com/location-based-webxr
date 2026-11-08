// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why this test matters: the lab is how a session tries a new kind of item
 * without touching the app, so it must really run the kind through both real
 * hosts. A page that only drew something would pass a look at it. These drive
 * the sample kind through `window.__itemLab` in both contexts and read what
 * each context did: words first, the voice channel shared, nothing left behind
 * when it stops, a lost file saying so, a late file doing nothing.
 *
 * Not pinned here: how a kind looks (that is the point of the page, judged by
 * eye), and the contract over every kind (`src/item-contract.test.ts`).
 */

const WORDS = "Stamped at the old gate. Tap to hear it land.";
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];

/** @param {import("@playwright/test").Page} page */
async function openLab(page, kind = "stamp-1") {
  await page.goto(`/item-lab.html?kind=${kind}`);
  await page.waitForFunction(() => window.__itemLab !== undefined);
  await page.waitForFunction(() => {
    const state = window.__itemLab?.state();
    return state?.story.imageShown === true && state.free.standing === true;
  });
}

/** @param {import("@playwright/test").Page} page */
function state(page) {
  return page.evaluate(() => window.__itemLab?.state());
}

/** @param {import("@playwright/test").Page} page */
async function tapBoth(page) {
  await page.evaluate(() => {
    window.__itemLab?.tap("story");
  });
  await page.waitForFunction(() => {
    const now = window.__itemLab?.state();
    return now?.sound.story === "playing";
  });
}

test.describe("the item lab", () => {
  test("shows the kind's words and picture in both contexts", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openLab(page);
    const now = await state(page);
    expect(now.story.text).toBe(WORDS);
    expect(now.story.speaker).toBe("The gate stamp");
    expect(now.story.stage).toContain("The gate stamp (speak)");
    expect(now.free.line).toBe(WORDS);
    await expect(page.locator("#lab-text")).toBeVisible();
    await expect(page.locator("#lab-image")).toBeVisible();
    expect(now.declared).toEqual(expect.arrayContaining(now.reads));
    expect(errors).toEqual([]);
  });

  // Why this test matters: the scene view shows its Continue button on a
  // tap step, so the button a person sees must move the story on; the hook's
  // `next` alone would pass with a dead button.
  test("moves through the two-step story by its Continue button and reports its end once", async ({
    page,
  }) => {
    await openLab(page);
    const proceed = page.getByRole("button", { name: "Continue" });
    await proceed.click();
    await expect(page.locator("#lab-text")).toHaveText(
      "The story's next step.",
    );
    await proceed.click();
    await expect.poll(async () => (await state(page)).story.ended).toBe(1);
    const free = (await state(page)).free;
    expect(free.standing).toBe(true);
  });

  // Why this test matters: the free side goes through the real decoder, which
  // flips a bitmap for WebGL, and a character look paints it on a canvas. The
  // character check page hands the look a plain image, so only here could a
  // figure standing on its head show up.
  test("the figure stands the right way up, its stamp above its post", async ({
    page,
  }) => {
    await openLab(page);
    await page.evaluate(() => window.__itemLab?.settle());
    const shot = await page.locator("#lab-world canvas").screenshot();
    const rows = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no canvas");
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      const found = { red: [], brown: [] };
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const i = (y * image.width + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (r > 150 && g < 80 && b < 80) found.red.push(y);
          else if (r > 80 && r < 140 && g > 50 && g < 100 && b < 70) {
            found.brown.push(y);
          }
        }
      }
      const middle = (list) => list[Math.floor(list.length / 2)];
      return { red: middle(found.red), brown: middle(found.brown) };
    }, shot.toString("base64"));
    expect(rows.red).toBeLessThan(rows.brown);
  });

  test("a tap on the canvas reaches the figure through the real pick", async ({
    page,
  }) => {
    await openLab(page);
    await page.evaluate(() => window.__itemLab?.settle());
    const box = await page.locator("#lab-world canvas").boundingBox();
    if (box === null) throw new Error("no canvas");
    // The figure stands in the middle of the view.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(async () => (await state(page)).sound.free).toBe(true);
  });

  test("the two contexts and a second sound share one voice channel", async ({
    page,
  }) => {
    await openLab(page);
    await tapBoth(page);
    await page.evaluate(() => {
      window.__itemLab?.tap("free");
    });
    await expect.poll(async () => (await state(page)).sound.free).toBe(true);
    let now = await state(page);
    expect(now.sound.story).toBe("held");
    await page.evaluate(() => {
      window.__itemLab?.secondSound();
    });
    now = await state(page);
    expect(now.sound.second).toBe("playing");
    expect(now.sound.free).toBe(false);
    await page.evaluate(() => {
      window.__itemLab?.secondSound();
    });
    now = await state(page);
    expect(now.sound.second).toBe("off");
    expect(now.sound.story).not.toBe("off");
  });

  test("stop leaves no sound, no live URL, and a late file does nothing", async ({
    page,
  }) => {
    await openLab(page);
    await tapBoth(page);
    await page.evaluate(() => {
      window.__itemLab?.stop();
    });
    await page.evaluate(() => window.__itemLab?.settle());
    let now = await state(page);
    expect(now.sound).toMatchObject({ story: "off", free: false });
    expect(now.urls).toBe(0);
    expect(now.free.standing).toBe(false);

    await page.evaluate(() => {
      window.__itemLab?.holdLoads();
      window.__itemLab?.start();
    });
    await page.evaluate(() => window.__itemLab?.settle());
    await page.evaluate(() => {
      window.__itemLab?.stop();
      window.__itemLab?.releaseLoads();
    });
    await page.evaluate(() => window.__itemLab?.settle());
    await page.evaluate(() => window.__itemLab?.settle());
    now = await state(page);
    expect(now.urls).toBe(0);
    expect(now.story.imageShown).toBe(false);
    expect(now.free.standing).toBe(false);
  });

  test("a lost file keeps the story's words and says so in both contexts", async ({
    page,
  }) => {
    await openLab(page);
    await page.getByRole("button", { name: "Lose stamp-image" }).click();
    await expect(page.locator("#lab-status")).toContainText(
      "could not be loaded",
    );
    await expect(page.locator("#lab-free-status")).toContainText(
      "could not be shown here",
    );
    const now = await state(page);
    expect(now.story.text).toBe(WORDS);
    expect(now.free.standing).toBe(false);
  });

  test("a walk away and back stands the figure again", async ({ page }) => {
    await openLab(page);
    await page.evaluate(() => {
      window.__itemLab?.walk(true);
    });
    await expect
      .poll(async () => (await state(page)).free.standing)
      .toBe(false);
    await page.evaluate(() => {
      window.__itemLab?.walk(false);
    });
    await expect.poll(async () => (await state(page)).free.standing).toBe(true);
  });

  test("says so when the kind cannot be read", async ({ page }) => {
    await page.goto("/item-lab.html?kind=no-such-kind");
    await expect(page.locator("#lab-error")).toContainText("could not be read");
    await page.goto("/item-lab.html?kind=..%2Fx");
    await expect(page.locator("#lab-error")).toContainText("not the name");
  });

  // Why this test matters: a kind's `assets(block)` is untyped code from a
  // session's folder. One that throws must fail once, as the page loads,
  // with its words on the page, not on every frame behind a running lab.
  test("says so at load when the kind's assets() throws", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/prototypes/item-kinds/broken-1/kind.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: [
          "export function show(block, host) { host.slots.text.textContent = 'x'; }",
          "export function assets() { throw new Error('assets broke'); }",
        ].join("\n"),
      }),
    );
    await page.route("**/prototypes/item-kinds/broken-1/sample.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          name: "Broken",
          words: "Broken words.",
          block: { kind: "broken" },
          assets: [{ id: "pic", kind: "image", file: "pic.png" }],
        }),
      }),
    );
    await page.goto("/item-lab.html?kind=broken-1");
    await expect(page.locator("#lab-error")).toContainText("assets broke");
    expect(await page.evaluate(() => window.__itemLab)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  for (const viewport of VIEWPORTS) {
    test(`fits a ${viewport.name} with no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openLab(page);
      await page.evaluate(() => window.__itemLab?.settle());
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
