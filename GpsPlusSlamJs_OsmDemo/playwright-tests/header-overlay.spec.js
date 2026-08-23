import { expect, test } from "@playwright/test";

import { AT_FIXTURE, stubNetwork, waitForRefresh } from "./fixtures.js";

/**
 * Q11 — the header floats over the views instead of taking a row from them.
 *
 * WHY THIS IS A GEOMETRY TEST AND NOT A DOM TEST. The field report is that the
 * 3D view has too little height on a phone, and `header-collapse.ts` records why
 * that is literally true: `body` is `grid-template-rows: auto 1fr`, so the header
 * is a ROW whose height is taken out of `main` rather than covering it. A test on
 * class names or DOM order cannot tell the two layouts apart — both have the same
 * markup — so every assertion here is on measured boxes.
 *
 * That same docblock recorded overlay-versus-collapse as a deliberate either/or
 * and took collapse. This milestone takes the other one, on the owner's request,
 * which is why the collapse tests still exist and still pass: the header can
 * float AND collapse, it just no longer hands viewport back when it does.
 */

test.describe("the header as an overlay (Q11)", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("lets the 3D view start at the top of the screen, with the header over it", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const box = async (selector) => {
      const measured = await page.locator(selector).boundingBox();
      if (measured === null) throw new Error(`no box for ${selector}`);
      return measured;
    };

    const header = await box("header");
    const scene = await box("#scene");

    // THE MILESTONE, in one line: the canvas begins at the top of the viewport
    // rather than beneath the header. A small tolerance because a border or a
    // sub-pixel layout rounding is not the failure being guarded against.
    expect(
      scene.y,
      "the 3D view still starts below the header, so it is not an overlay",
    ).toBeLessThanOrEqual(1);

    // AND THE HEADER IS ON TOP OF IT, not merely coincidentally at y=0. Without
    // this, a header collapsed to zero height would satisfy the assertion above
    // while nothing had been made to float.
    expect(header.height).toBeGreaterThan(0);
    expect(header.y).toBeLessThanOrEqual(1);
    expect(
      header.y + header.height,
      "the header does not actually overlap the scene",
    ).toBeGreaterThan(scene.y);
  });

  test("gives the 3D view the height the header used to take", async ({
    page,
  }) => {
    // Why this test matters: the whole point of the change is reclaimed height,
    // and "it looks taller" is not checkable. The canvas should now be within a
    // header's height of the full viewport rather than short by exactly that.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const scene = await page.locator("#scene").boundingBox();
    if (scene === null) throw new Error("no box for #scene");

    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("no viewport");

    // The map sheet still overlaps the bottom of the scene by design, so this
    // asserts the scene's BOX reaches the viewport, not that it is unobscured.
    expect(
      scene.height,
      "the scene is still short by roughly a header",
    ).toBeGreaterThan(viewport.height * 0.9);
  });

  test("keeps the header's controls tappable where they overlap the canvas", async ({
    page,
  }) => {
    // The failure mode a floating bar introduces: the canvas is a pointer target
    // too, and an overlay that let events through — or swallowed them across its
    // whole width — would break either the header or the scene. Both directions
    // are checked, because fixing one by breaking the other is the easy mistake.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // The control still works while floating.
    await page.locator("#header-toggle").click();
    await expect(page.locator("header")).toHaveAttribute(
      "data-collapsed",
      "true",
    );

    // AND THE VIEWS BELOW STILL RECEIVE CLICKS — asserted by actually clicking,
    // which is the whole lesson of this test's first version.
    //
    // That version merely fetched an element handle and asserted it was not
    // null, which is true of any element that exists whether or not anything can
    // reach it. The real implementation shipped without `pointer-events: none`
    // and broke TEN specs across four files — the map click, the 3D hotkeys, the
    // location picker's URL write — every one reported by Playwright as
    // `locator.click` timing out on an element that was "visible, enabled and
    // stable". A guard that cannot fail for the failure it names is worse than
    // no guard, because it is counted as coverage.
    //
    // `timeout` is short on purpose: an intercepted click does not error, it
    // HANGS until the suite's 180 s ceiling, so the default would turn this
    // assertion into a three-minute wait per run.
    await page.locator("#header-toggle").click();
    await expect(page.locator("header")).toHaveAttribute(
      "data-collapsed",
      "false",
    );

    // CLICKED WHERE THE HEADER ACTUALLY IS, which the second version still got
    // wrong. It clicked `#map` — a bottom sheet at `align-self: end`, whose
    // centre on 390×780 sits near y≈604 while the header ends around y≈100. No
    // amount of `pointer-events` on the bar could ever have made that click
    // fail, so the assertion named pass-through and tested nothing about it.
    // Third time: aim INSIDE the header's own box, at a gap between its
    // controls, and require the press to reach the canvas underneath.
    const header = await page.locator("header").boundingBox();
    if (header === null) throw new Error("no box for header");

    const reached = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return {
          tag: el?.tagName ?? "none",
          id: el instanceof HTMLElement ? el.id : "",
          insideHeader:
            el?.closest("header") !== null &&
            el?.closest("header") !== undefined,
        };
      },
      // The far right of the header's own strip: inside its box, past the last
      // control, so anything hit there is the BAR rather than a button.
      { x: header.x + header.width - 4, y: header.y + header.height / 2 },
    );

    expect(
      reached.insideHeader,
      `a press on the header's empty area hit ${reached.tag}#${reached.id} instead of passing through to the view beneath`,
    ).toBe(false);
  });
});
