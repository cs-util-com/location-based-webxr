// @ts-check
/**
 * The plate's accent strip on a SCROLLING plate (owner feedback 2026-09-26,
 * programme plan 2026-09-26-0539 W1 M1).
 *
 * Why this file matters: the strip was an absolutely positioned `::after`,
 * one box high, so on a plate that scrolls it ended where the first screen
 * ended and scrolled away with the content. The owner saw it on the look-dev
 * panel; OsmDemo's details panel and light dialog scroll too. The strip is
 * now a background layer, which stays put while the content scrolls.
 *
 * The claim is read from pixels (a screenshot decoded in the page), because
 * a pseudo-element's box says nothing about what is painted. The `.legacy`
 * plate reproduces the old rule, so the probe is shown to see the bug.
 */
import { expect, test } from "@playwright/test";

/** The strip's colour and a column inside it, read from the page. */
async function stripProbe(page, id, scrollFraction) {
  await page.evaluate(
    ([el, f]) => {
      const box = document.getElementById(el);
      box.scrollTop = (box.scrollHeight - box.clientHeight) * f;
    },
    [id, scrollFraction],
  );
  const shot = await page.screenshot();
  return page.evaluate(
    async ([el, png]) => {
      const box = document.getElementById(el);
      const rect = box.getBoundingClientRect();
      const accent =
        getComputedStyle(box).getPropertyValue("--accent-signature");
      const probe = document.createElement("div");
      probe.style.color = accent;
      document.body.append(probe);
      const rgb = getComputedStyle(probe)
        .color.match(/\d+/g)
        .slice(0, 3)
        .map(Number);
      probe.remove();
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const scale = image.width / window.innerWidth;
      // 3 px inside the right edge: inside the 5 px strip, clear of the
      // 1 px border ring.
      const x = Math.round((rect.right - 3) * scale);
      const hits = [0.1, 0.5, 0.9].map((f) => {
        // Clear of the rounded corners, which clip the strip legitimately.
        const inset = Math.min(Math.max(rect.height * f, 16), rect.height - 16);
        const y = Math.round((rect.top + inset) * scale);
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        return (
          Math.abs(r - rgb[0]) + Math.abs(g - rgb[1]) + Math.abs(b - rgb[2]) <=
          30
        );
      });
      return {
        hits,
        scrolls: box.scrollHeight > box.clientHeight,
        accent: rgb,
      };
    },
    [id, shot.toString("base64")],
  );
}

test("the plate's strip spans a scrolling plate at every scroll position", async ({
  page,
}) => {
  await page.goto("/3d/fixtures/plate-scroll.html");
  for (const height of [200, 300, 600]) {
    await page.evaluate((h) => {
      for (const id of ["plate", "legacy"]) {
        document.getElementById(id).style.maxHeight = `${h}px`;
      }
    }, height);
    for (const fraction of [0, 0.25, 0.5, 1]) {
      const fixed = await stripProbe(page, "plate", fraction);
      // The fixture must really scroll, or the check passes vacuously.
      expect(fixed.scrolls, `plate scrolls at ${height} px`).toBe(true);
      expect(fixed.hits, `plate at ${height} px, scrolled ${fraction}`).toEqual(
        [true, true, true],
      );
    }
    // THE CONTROL: the old rule loses the strip once scrolled to the end.
    const legacy = await stripProbe(page, "legacy", 1);
    expect(legacy.scrolls).toBe(true);
    expect(
      legacy.hits,
      `legacy at ${height} px, scrolled to the end`,
    ).not.toEqual([true, true, true]);
  }
});

test("a plate that does not scroll still shows its strip", async ({ page }) => {
  await page.goto("/3d/fixtures/plate-scroll.html");
  const still = await stripProbe(page, "static", 0);
  expect(still.scrolls).toBe(false);
  expect(still.hits).toEqual([true, true, true]);
});
