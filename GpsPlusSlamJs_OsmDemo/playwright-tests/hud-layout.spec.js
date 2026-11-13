// @ts-check
/**
 * THE COMMAND BAR'S LAYOUT, measured at the three viewports it was designed
 * for: a phone upright (390 x 844), a phone on its side (844 x 390) and a
 * desktop (1280 x 800), plus the 1280 x 720 window the coverage budget and
 * the click test are pinned at.
 *
 * WHY ONE LAYOUT SPEC. The bar, the panels, the dock (toast and legend) and
 * the map's own controls all float over the two views, so every claim here is
 * about BOXES: what covers what, what stays reachable, and that the 3D canvas
 * keeps one size whatever is open. A DOM assertion passes on any arrangement
 * of the same markup, so each step measures.
 *
 * The coverage metric is the one the chosen prototype reported (a 4 px grid
 * over the 3D pane, skipping the map sheet on a phone, counting points under a
 * visible `[data-hud]` element), so the build is held to the number the owner
 * chose the design by, plus 0.02 of slack.
 */

import { test, expect } from "./e2e-test.js";

import {
  AT_FIXTURE,
  enableCellLayer,
  expectCanvasFillsContainer,
  stubNetwork,
  SUN_PIN_DATE,
  waitForRefresh,
} from "./fixtures.js";

/** The share of the resting 3D pane covered by HUD, as prototype A measured it. */
const coverage = (page) =>
  page.evaluate(() => {
    const visible = (node) => {
      if (!(node instanceof HTMLElement) || node.hidden) return false;
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const scene = document.querySelector("#scene");
    const map = document.querySelector("#map");
    if (scene === null || map === null) throw new Error("no panes");
    const pane = scene.getBoundingClientRect();
    const phone = matchMedia("(width <= 860px)").matches;
    const sheet = phone ? map.getBoundingClientRect() : null;
    const huds = [...document.querySelectorAll("[data-hud]")]
      .filter(visible)
      .map((n) => n.getBoundingClientRect());
    let total = 0;
    let covered = 0;
    const step = 4;
    for (let y = pane.top + step / 2; y < pane.bottom; y += step) {
      for (let x = pane.left + step / 2; x < pane.right; x += step) {
        if (sheet && y >= sheet.top && x >= sheet.left && x <= sheet.right)
          continue;
        total++;
        if (
          huds.some(
            (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
          )
        )
          covered++;
      }
    }
    return total === 0 ? 0 : covered / total;
  });

/** Boxes of the visible elements among `selectors`, keyed by selector. */
const boxes = (page, selectors) =>
  page.evaluate((list) => {
    /** @type {Record<string, {x: number, y: number, w: number, h: number}>} */
    const out = {};
    for (const selector of list) {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (el.hidden || style.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out[selector] = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return out;
  }, selectors);

/** Pairs among `measured` whose boxes overlap by more than a pixel. */
const overlaps = (measured, pairs) => {
  const hits = [];
  for (const [a, b] of pairs) {
    const p = measured[a];
    const q = measured[b];
    if (p === undefined || q === undefined) continue;
    const dx = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
    const dy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
    if (dx > 1 && dy > 1)
      hits.push(`${a} x ${b} (${dx.toFixed(0)} x ${dy.toFixed(0)} px)`);
  }
  return hits;
};

const FLOATING = [
  "#command-bar",
  "#toast-root .toast",
  "#legend-plate",
  "#legal-link",
  "#map .leaflet-control-attribution",
  "#map .leaflet-control-zoom",
  ".locate-control",
  ".ar-control",
  "#ar-offer",
];
const PANELS = [
  ["settings", "#settings-open", "#settings-drawer"],
  ["info", "#info-open", "#info-panel"],
  ["sun", "#sun-chip", "#sun-pop"],
];

/** Every pair among `list`, each once. */
const allPairs = (list) =>
  list.flatMap((a, i) => list.slice(i + 1).map((b) => [a, b]));

/**
 * Boots with XR support stubbed (so the AR button and offer exist), a probe
 * toast in the dock and the AR offer shown: the two transient elements are
 * populated directly, as the quest-readout layout step does, because a layout
 * claim whose setup can quietly not happen is worse than none.
 */
async function bootWithEveryFloat(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "xr", {
      configurable: true,
      value: { isSessionSupported: () => Promise.resolve(true) },
    });
  });
  await stubNetwork(page);
  await page.goto(AT_FIXTURE);
  await waitForRefresh(page);
  await expect(page.locator("#enter-ar")).toBeVisible({ timeout: 10000 });
}

const showTransients = (page) =>
  page.evaluate(() => {
    const root = document.querySelector("#toast-root");
    const offer = document.querySelector("#ar-offer");
    if (root === null || !(offer instanceof HTMLElement))
      throw new Error("no toast root or AR offer");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = "Location permission denied";
    root.append(toast);
    offer.hidden = false;
  });

const hideTransients = (page) =>
  page.evaluate(() => {
    document.querySelector("#toast-root .toast")?.remove();
    const offer = document.querySelector("#ar-offer");
    if (offer instanceof HTMLElement) offer.hidden = true;
  });

for (const { name, viewport, maxCoverage } of [
  {
    name: "a phone upright",
    viewport: { width: 390, height: 844 },
    maxCoverage: 0.216 + 0.02,
  },
  {
    name: "a phone on its side",
    viewport: { width: 844, height: 390 },
    maxCoverage: undefined,
  },
  {
    name: "a desktop",
    viewport: { width: 1280, height: 800 },
    maxCoverage: undefined,
  },
]) {
  test.describe(`the command bar on ${name}`, () => {
    test.use({ viewport });

    test("covers little of the 3D view, keeps the canvas one size, overlaps nothing and keeps every target 44 px", async ({
      page,
    }, testInfo) => {
      await bootWithEveryFloat(page);

      await test.step("the canvas is the 3D pane, and the pane spans under the bar", async () => {
        await expectCanvasFillsContainer(page);
        const scene = await page.locator("#scene").boundingBox();
        expect(scene?.y ?? -1).toBeLessThanOrEqual(1);
      });

      await test.step("the resting HUD covers little of the 3D view", async () => {
        const measured = await coverage(page);
        testInfo.annotations.push({
          type: "coverage",
          description: `${viewport.width}x${viewport.height}: ${measured.toFixed(3)}`,
        });
        if (maxCoverage !== undefined)
          expect(measured).toBeLessThanOrEqual(maxCoverage);
        // Every panel starts closed, the phone included.
        for (const [, , panel] of PANELS)
          await expect(page.locator(panel)).toBeHidden();
      });

      await test.step("nothing that floats overlaps anything else, at rest", async () => {
        await showTransients(page);
        const measured = await boxes(page, FLOATING);
        // The transients are measured, not merely present.
        expect(Object.keys(measured)).toEqual(
          expect.arrayContaining(["#toast-root .toast", "#ar-offer"]),
        );
        expect(overlaps(measured, allPairs(FLOATING))).toEqual([]);
        await hideTransients(page);
      });

      await test.step("an open panel overlaps nothing that floats, and the canvas keeps its size", async () => {
        const rest = await page.locator("#scene canvas").boundingBox();
        await showTransients(page);
        for (const [panelName, opener, panel] of PANELS) {
          await page.locator(opener).click();
          await expect(page.locator(panel)).toBeVisible();
          const others = FLOATING.filter((s) => s !== "#ar-offer");
          const measured = await boxes(page, [panel, ...others]);
          expect(
            overlaps(
              measured,
              others.map((s) => [panel, s]),
            ),
            `${panelName} overlaps`,
          ).toEqual([]);
          // Locate and AR stay reachable while a panel is open.
          for (const control of [".locate-button", "#enter-ar"]) {
            const box = await page.locator(control).boundingBox();
            if (box === null) throw new Error(`no box for ${control}`);
            const hit = await page.evaluate(
              ({ x, y, sel }) =>
                document.elementFromPoint(x, y)?.closest(sel) !== null,
              {
                x: box.x + box.width / 2,
                y: box.y + box.height / 2,
                sel: control,
              },
            );
            expect(hit, `${control} is reachable with ${panelName} open`).toBe(
              true,
            );
          }
          expect(await page.locator("#scene canvas").boundingBox()).toEqual(
            rest,
          );
          await page.locator(opener).click();
          await expect(page.locator(panel)).toBeHidden();
        }
        await hideTransients(page);
      });

      await test.step("the AR offer stacks above an open drawer", async () => {
        await page.locator("#settings-open").click();
        await page.evaluate(() => {
          const offer = document.querySelector("#ar-offer");
          if (offer instanceof HTMLElement) offer.hidden = false;
        });
        const box = await page.locator("#ar-offer-enter").boundingBox();
        if (box === null) throw new Error("no box for the offer's button");
        const onTop = await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest("#ar-offer") !== null,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        );
        expect(onTop).toBe(true);
        await hideTransients(page);
        await page.locator("#settings-open").click();
      });

      await test.step("every bar and panel target is at least 44 px", async () => {
        await page.locator("#settings-open").click();
        const targets = [
          "#site",
          "#category",
          "#bar-analysis .layer-toggle",
          "#geo-event",
          "#sun-chip",
          "#info-open",
          "#settings-open",
          "#settings-hide",
          "#settings-drawer summary",
        ];
        for (const selector of targets) {
          const all = page.locator(selector);
          const count = await all.count();
          expect(count, `${selector} exists`).toBeGreaterThan(0);
          for (let i = 0; i < count; i++) {
            const box = await all.nth(i).boundingBox();
            if (box === null) throw new Error(`no box for ${selector}`);
            expect(box.height, `${selector} height`).toBeGreaterThanOrEqual(44);
            expect(box.width, `${selector} width`).toBeGreaterThanOrEqual(44);
          }
        }
        await page.locator("#settings-open").click();
      });

      await test.step("the canvas keeps its size with the cells on and off", async () => {
        const rest = await page.locator("#scene canvas").boundingBox();
        await enableCellLayer(page);
        expect(await page.locator("#scene canvas").boundingBox()).toEqual(rest);
        await page.locator("#layer-cells").uncheck();
        expect(await page.locator("#scene canvas").boundingBox()).toEqual(rest);
      });
    });
  });
}

test.describe("the command bar at 1280 x 720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("covers at most the chosen design's share, and every bar control and the map zoom answer a click", async ({
    page,
  }, testInfo) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const measured = await coverage(page);
    testInfo.annotations.push({
      type: "coverage",
      description: `1280x720: ${measured.toFixed(3)}`,
    });
    expect(measured).toBeLessThanOrEqual(0.072 + 0.02);

    // THE ZOOM BUTTONS sit below the bar, not under it: a click on each must
    // reach Leaflet and change the zoom. Before the bar moved them down, the
    // bar's z-index would have swallowed the press.
    // Leaflet writes 2^zoom into the proxy's transform as its scale, so one
    // step in doubles it and one step out halves it again.
    const scale = () =>
      page.evaluate(() => {
        const style =
          document
            .querySelector("#map .leaflet-proxy")
            ?.getAttribute("style") ?? "";
        return Number(/scale\(([\d.e+-]+)\)/.exec(style)?.[1] ?? Number.NaN);
      });
    const zoomIn = page.locator("#map .leaflet-control-zoom-in");
    const zoomOut = page.locator("#map .leaflet-control-zoom-out");
    const bar = await page.locator("#command-bar").boundingBox();
    const inBox = await zoomIn.boundingBox();
    if (bar === null || inBox === null) throw new Error("no boxes");
    expect(inBox.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    const start = await scale();
    expect(start).toBeGreaterThan(0);
    await zoomIn.click({ timeout: 5000 });
    await expect.poll(scale).toBe(start * 2);
    // Leaflet ignores a zoom asked for while one is still animating, and it
    // marks that animation on the map pane, not on the container.
    await expect(page.locator("#map .leaflet-map-pane")).not.toHaveClass(
      /leaflet-zoom-anim/,
    );
    await zoomOut.click({ timeout: 5000 });
    await expect.poll(scale).toBe(start);

    // EVERY BAR CONTROL answers a real click (short timeouts: an intercepted
    // click does not fail, it hangs).
    for (const [opener, panel] of [
      ["#settings-open", "#settings-drawer"],
      ["#info-open", "#info-panel"],
      ["#sun-chip", "#sun-pop"],
    ]) {
      await page.locator(opener).click({ timeout: 5000 });
      await expect(page.locator(panel)).toBeVisible();
      await expect(page.locator(opener)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await page.locator(opener).click({ timeout: 5000 });
      await expect(page.locator(panel)).toBeHidden();
    }
    await page.locator("#site").click({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.locator("#category").click({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.locator("#layer-cells").click({ timeout: 5000 });
    await expect(page.locator("#layer-cells")).toBeChecked();
    // The switch stays disabled while the cells it asked for are built.
    await expect(page.locator("#layer-cells")).toBeEnabled({ timeout: 60_000 });
    await page.locator("#layer-cells").click({ timeout: 5000 });
    await page.locator("#geo-event").click({ timeout: 5000 });
  });

  test("Escape closes the top layer and hands focus back to its opener", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await page.locator("#settings-open").click();
    await page.locator("#sun-group > summary").click();
    await page.locator("#light-open").click();
    await expect(page.locator("#light-dialog")).toBeVisible();

    // One Escape, one layer: the light dialog first, the drawer second.
    await page.keyboard.press("Escape");
    await expect(page.locator("#light-dialog")).toBeHidden();
    await expect(page.locator("#settings-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#settings-drawer")).toBeHidden();
    await expect(page.locator("#settings-open")).toBeFocused();
  });

  test("an error toasts and never opens a panel; a drawer switch still applying shows on the bar", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const denied = { code: 1, PERMISSION_DENIED: 1, message: "denied" };
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (_ok, fail) => fail?.(denied),
          watchPosition: (_ok, fail) => {
            fail?.(denied);
            return 1;
          },
          clearWatch: () => {},
        },
      });
    });
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await page.locator(".locate-button").click();
    await expect(page.locator("#toast-root .toast")).toHaveText(/./, {
      timeout: 15000,
    });
    for (const [, , panel] of PANELS)
      await expect(page.locator(panel)).toBeHidden();

    // A build choice is a rebuild with an "Applying" status line; with the
    // drawer closed again, the bar's settings button carries the state.
    await page.locator("#settings-open").click();
    await page.locator("#layer-group-look > summary").click();
    await page.locator("#markings").uncheck();
    await page.locator("#settings-open").click();
    await expect(page.locator("#settings-drawer")).toBeHidden();
    await expect(page.locator("#settings-open")).toHaveAttribute(
      "data-busy",
      "true",
    );
    await expect(page.locator("#settings-open")).toHaveAttribute(
      "data-busy",
      "false",
      { timeout: 60000 },
    );
  });

  test("a URL knob's value shows in its drawer control, and the quick sun slider mirrors the canonical one", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(`${AT_FIXTURE}&roofs=off`);
    await waitForRefresh(page);
    // The knobs are read at boot into the store; the drawer shows what they
    // set, with the drawer closed (a read, not an action) and once opened.
    await expect(page.locator("#invented-roofs")).not.toBeChecked();
    await expect(page.locator("#sun-date")).toHaveValue(SUN_PIN_DATE);
    await page.locator("#settings-open").click();
    await page.locator("#layer-group-look > summary").click();
    await expect(page.locator("#invented-roofs")).toBeVisible();
    await expect(page.locator("#invented-roofs")).not.toBeChecked();
    await page.locator("#layer-group-look > summary").click();
    await page.locator("#settings-open").click();

    await page.locator("#sun-chip").click();
    const quick = page.locator("#sun-time-quick");
    await expect(quick).toHaveValue(
      await page.locator("#sun-time").inputValue(),
    );
    const chipBefore = await page.locator("#sun-chip-time").textContent();
    await quick.fill("150");
    await expect(page.locator("#sun-time")).toHaveValue("150");
    await expect(page.locator("#sun-chip-time")).not.toHaveText(
      chipBefore ?? "",
    );
  });
});
