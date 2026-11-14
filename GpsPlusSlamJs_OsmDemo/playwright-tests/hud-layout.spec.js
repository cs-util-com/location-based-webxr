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
  focusPageForHotkeys,
  stubNetwork,
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

/**
 * Shows the cell details panel filled to its height cap, as a cell with a
 * long attribute list fills it; an empty panel would measure only its padding.
 */
const showDetails = (page) =>
  page.evaluate(() => {
    const details = document.querySelector("#details");
    if (!(details instanceof HTMLElement)) throw new Error("no details panel");
    details.replaceChildren(
      ...Array.from({ length: 60 }, (_, i) => {
        const line = document.createElement("p");
        line.textContent = `attribute ${i}`;
        return line;
      }),
    );
    details.hidden = false;
  });

const hideDetails = (page) =>
  page.evaluate(() => {
    const details = document.querySelector("#details");
    if (!(details instanceof HTMLElement)) return;
    details.hidden = true;
    details.replaceChildren();
  });

/** Opens the light dialog from its button in the drawer's sun section. */
async function openLightDialog(page) {
  if (!(await page.locator("#settings-drawer").isVisible()))
    await page.locator("#settings-open").click();
  const group = page.locator("#sun-group");
  if ((await group.getAttribute("open")) === null)
    await group.locator(":scope > summary").click();
  await page.locator("#light-open").click();
  await expect(page.locator("#light-dialog")).toBeVisible();
}

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

        // The light dialog stacks over the drawer's place; the details
        // panel floats over the panes. Neither resizes the canvas, and
        // neither may hide the toast, the error channel.
        await openLightDialog(page);
        const others = FLOATING.filter((s) => s !== "#ar-offer");
        expect(
          overlaps(
            await boxes(page, ["#light-dialog", ...others]),
            others.map((s) => ["#light-dialog", s]),
          ),
          "light dialog overlaps",
        ).toEqual([]);
        expect(await page.locator("#scene canvas").boundingBox()).toEqual(rest);
        await page.locator("#settings-open").click();
        await expect(page.locator("#light-dialog")).toBeHidden();

        await showDetails(page);
        const withDetails = await boxes(page, [
          "#details",
          "#command-bar",
          "#toast-root .toast",
        ]);
        expect(Object.keys(withDetails)).toContain("#details");
        expect(
          overlaps(withDetails, [
            ["#details", "#command-bar"],
            ["#details", "#toast-root .toast"],
          ]),
        ).toEqual([]);
        expect(await page.locator("#scene canvas").boundingBox()).toEqual(rest);
        await hideDetails(page);
        await hideTransients(page);
      });

      // Only where the two share a place: on a desktop the offer sits in the
      // 3D view, away from the drawer, and the check would prove nothing.
      if (viewport.width <= 860)
        await test.step("the AR offer stacks above an open drawer", async () => {
          await page.locator("#settings-open").click();
          await page.evaluate(() => {
            const offer = document.querySelector("#ar-offer");
            if (offer instanceof HTMLElement) offer.hidden = false;
          });
          const shared = await boxes(page, ["#ar-offer", "#settings-drawer"]);
          expect(
            overlaps(shared, [["#ar-offer", "#settings-drawer"]]),
            "the offer shares the drawer's place",
          ).not.toEqual([]);
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
        // With the cells on, the legend plate is in view: the at-rest
        // overlap check again, with the plate measured.
        await showTransients(page);
        const measured = await boxes(page, FLOATING);
        expect(Object.keys(measured)).toEqual(
          expect.arrayContaining(["#legend-plate", "#toast-root .toast"]),
        );
        expect(overlaps(measured, allPairs(FLOATING))).toEqual([]);
        await hideTransients(page);
        await page.locator("#layer-cells").uncheck();
        expect(await page.locator("#scene canvas").boundingBox()).toEqual(rest);
      });
    });
  });
}

/**
 * Every control the bar holds, by box: the bar is a fixed-height strip, so a
 * control that wraps onto a second line is drawn below the bar's own box, over
 * the map zoom, the toast and the panels, while the bar's box still measures
 * as it should. Measuring the bar alone cannot see that; measuring what it
 * holds can. The quest readout is left out on purpose: it hangs below its
 * button by design and holds no control.
 */
const barChildrenOutside = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector("#command-bar");
    if (bar === null) throw new Error("no command bar");
    const b = bar.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const out = [];
    const children = bar.querySelectorAll(
      ".bar-group > :not(.bar-analysis), .bar-analysis > *",
    );
    for (const child of children) {
      if (!(child instanceof HTMLElement)) continue;
      if (getComputedStyle(child).display === "none") continue;
      const r = child.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const name = child.id || child.className;
      if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5)
        out.push(
          `${name}: y ${r.top.toFixed(0)}-${r.bottom.toFixed(0)} outside the bar ${b.top.toFixed(0)}-${b.bottom.toFixed(0)}`,
        );
      if (r.left < -0.5 || r.right > width + 0.5)
        out.push(
          `${name}: x ${r.left.toFixed(0)}-${r.right.toFixed(0)} outside the viewport 0-${width}`,
        );
    }
    if (children.length < 7) out.push(`only ${children.length} bar controls`);
    return out;
  });

test.describe("the command bar between the phone and the desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("holds every control inside its own box and the viewport at every width", async ({
    page,
  }) => {
    // WHY: the bar's height is one token, and every panel, the toast and the
    // map zoom are placed below it by that token. A width where the controls
    // wrap draws a second line over all of them, invisible to any measurement
    // of the bar's own box. One boot, resized: the layout is CSS only.
    // The toast is the error channel, so it stays clear of the drawer and
    // the details panel at every width, the narrow desktops included.
    await bootWithEveryFloat(page);
    await showTransients(page);
    await showDetails(page);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 601, height: 720 },
      { width: 760, height: 720 },
      { width: 761, height: 720 },
      { width: 640, height: 720 },
      { width: 768, height: 720 },
      { width: 844, height: 390 },
      { width: 861, height: 720 },
      { width: 900, height: 720 },
      { width: 976, height: 720 },
      { width: 1280, height: 720 },
    ]) {
      const at = `at ${viewport.width} x ${viewport.height}`;
      await page.setViewportSize(viewport);
      expect(await barChildrenOutside(page), at).toEqual([]);
      // The quests button keeps one width whichever of its two labels it
      // shows, so a search does not shift the bar under the user's finger.
      const widths = await page.locator("#geo-event").evaluate((button) => {
        const label = button.textContent ?? "";
        const width = () => button.getBoundingClientRect().width;
        const idle = width();
        button.textContent = "Finding…";
        const busy = width();
        button.textContent = label;
        return { idle, busy };
      });
      expect(
        Math.abs(widths.busy - widths.idle),
        `${at}, quests width`,
      ).toBeLessThan(0.5);
      const toast = "#toast-root .toast";
      expect(
        overlaps(await boxes(page, [toast, "#details", "#command-bar"]), [
          [toast, "#details"],
          [toast, "#command-bar"],
        ]),
        `${at}, details shown`,
      ).toEqual([]);
      await page.locator("#settings-open").click();
      expect(
        overlaps(await boxes(page, [toast, "#settings-drawer"]), [
          [toast, "#settings-drawer"],
        ]),
        `${at}, drawer open`,
      ).toEqual([]);
      await page.locator("#settings-open").click();
    }
  });
});

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
    // The quests button's press opens its time picker on the same press.
    await page.locator("#geo-event").click({ timeout: 5000 });
    await expect(page.locator("#geo-event-picker")).toBeVisible();
    await expect(page.locator("#geo-event")).toBeEnabled({ timeout: 30_000 });
    // Clear closes the picker; nothing else but its own buttons does.
    await page.locator("#geo-event-clear").click();
    await expect(page.locator("#geo-event-picker")).toBeHidden();

    // EVERY CONTROL KEEPS ITS ACCESSIBLE NAME: the suite addresses controls
    // by id, so a renamed label would pass every other test while a screen
    // reader or voice control no longer finds it. Cells on, so the switch
    // that only shows with them is in the tree; every section unfolded.
    await enableCellLayer(page);
    await page.locator("#settings-open").click();
    await page.locator("#settings-drawer details").evaluateAll((sections) => {
      for (const section of sections) section.setAttribute("open", "");
    });
    /** @type {[Parameters<import('@playwright/test').Page["getByRole"]>[0], string | RegExp, string][]} */
    const named = [
      ["combobox", "location", "site"],
      ["combobox", "category", "category"],
      ["button", "Show Quests", "geo-event"],
      ["button", /^Sun time \d{2}:\d{2}$/, "sun-chip"],
      ["button", "Status", "info-open"],
      ["button", "Settings", "settings-open"],
      ["button", "Hide settings", "settings-hide"],
      ["button", "Light", "light-open"],
      ["slider", "Sun time of day, dawn to dusk", "sun-time"],
      ["checkbox", "below threshold", "show-below"],
      ["checkbox", "cells", "layer-cells"],
      ["checkbox", "areas", "layer-areas"],
      ["checkbox", "buildings", "layer-buildings"],
      ["checkbox", "trees", "layer-trees"],
      ["checkbox", "woods", "layer-woods"],
      ["checkbox", "furniture", "layer-furniture"],
      ["checkbox", "landuse", "layer-plates"],
      ["checkbox", "land-use colours", "layer-tint"],
      ["checkbox", "roads", "layer-roads"],
      ["checkbox", "POI", "layer-poi"],
      ["checkbox", "underground", "layer-underground"],
    ];
    for (const [role, name, id] of named) {
      await expect(
        page.getByRole(role, { name, exact: true }),
        `${role} "${name}"`,
      ).toHaveId(id);
    }
    await expect(page.locator("#sun-date")).toHaveAccessibleName("Sun date");
    await page.locator("#settings-open").click();
    await page.locator("#sun-chip").click();
    await expect(
      page.getByRole("slider", { name: "Quick sun time", exact: true }),
    ).toHaveId("sun-time-quick");
    await page.locator("#sun-chip").click();
  });

  test("Escape closes the top layer and hands focus back to its opener, and the panel just opened is the top layer at its own centre", async ({
    page,
  }) => {
    // ONE BOOT FOR BOTH LAYERING CLAIMS: the first step ends with every
    // panel closed, which is where the second starts.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await test.step("Escape closes the top layer and hands focus back to its opener", async () => {
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

      // The popovers answer Escape the same way, and opening one moves focus
      // into it, so Tab reaches its controls before the map's.
      for (const [opener, panel, inner] of [
        ["#info-open", "#info-panel", null],
        ["#sun-chip", "#sun-pop", "#sun-time-quick"],
      ]) {
        await page.locator(opener).click();
        await expect(page.locator(panel)).toBeFocused();
        if (inner) {
          await page.keyboard.press("Tab");
          await expect(page.locator(inner)).toBeFocused();
        }
        await page.keyboard.press("Escape");
        await expect(page.locator(panel)).toBeHidden();
        await expect(page.locator(opener)).toBeFocused();
      }
    });

    await test.step("the panel just opened is the top layer at its own centre", async () => {
      // WHY: the light dialog sits in the drawer's place above every panel.
      // Left open under a popover it hid the popover's controls, and left open
      // over a closed drawer it floated alone. A visible-and-inside check
      // passes both; only the element under the panel's centre tells.
      const dialog = page.locator("#light-dialog");
      const topAtCentre = (selector) =>
        page.locator(selector).evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return hit !== null && el.contains(hit);
        });
      const openLight = async () => {
        await openLightDialog(page);
        expect(await topAtCentre("#light-dialog")).toBe(true);
      };

      for (const [opener, panel] of [
        ["#info-open", "#info-panel"],
        ["#sun-chip", "#sun-pop"],
      ]) {
        await openLight();
        await page.locator(opener).click();
        await expect(page.locator(panel)).toBeVisible();
        await expect(dialog).toBeHidden();
        expect(await topAtCentre(panel)).toBe(true);
        await page.locator(opener).click();
        await expect(page.locator(panel)).toBeHidden();
      }

      // Closing the drawer closes the dialog stacked over it.
      await openLight();
      await page.locator("#settings-open").click();
      await expect(page.locator("#settings-drawer")).toBeHidden();
      await expect(dialog).toBeHidden();

      // The hotkey opens the dialog over a popover by closing the popover.
      await page.locator("#info-open").click();
      await focusPageForHotkeys(page);
      await page.keyboard.press("l");
      await expect(dialog).toBeVisible();
      await expect(page.locator("#info-panel")).toBeHidden();
      expect(await topAtCentre("#light-dialog")).toBe(true);
    });
  });

  test("an error toasts and never opens a panel; a refresh and a drawer switch still applying show on the bar", async ({
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
    // The map's refresh shows on the bar's info button, behind which its
    // status line lives: held open here, so the busy state cannot be missed.
    const counts = await stubNetwork(page);
    counts.holdOverpass();
    await page.goto(AT_FIXTURE);
    await expect(page.locator("#info-open")).toHaveAttribute(
      "data-busy",
      "true",
      { timeout: 30_000 },
    );
    await expect(page.locator("#info-panel")).toBeHidden();
    counts.releaseOverpass();
    await waitForRefresh(page);
    await expect(page.locator("#info-open")).toHaveAttribute(
      "data-busy",
      "false",
      { timeout: 60_000 },
    );

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
});
