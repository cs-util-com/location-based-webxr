// @ts-check
// The character maker walk the specs share (character-maker.spec.js on the
// maker's own page, the editor's specs with the maker over the editor): a
// synthetic four-pose sheet drawn here, not by the code under test, and the
// maker's six steps from the description to the saved character.
import { expect } from "@playwright/test";

/** Four outlined figures on near-white, the fourth pointing to the right,
 *  the mouths closed, half open, wide open, closed. Runs in the page; the
 *  PNG as base64. */
export function drawSheet() {
  const w = 1536;
  const h = 1024;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  x.fillStyle = "#fefefe";
  x.fillRect(0, 0, w, h);
  const H = 560;
  const foot = 880;
  for (const k of [0, 1, 2, 3]) {
    const cx = (k + 0.5) * (w / 4);
    x.lineWidth = 6;
    x.strokeStyle = "#221a14";
    x.fillStyle = "#d67a30";
    x.beginPath();
    x.ellipse(cx, foot - H * 0.33, H * 0.17, H * 0.33, 0, 0, Math.PI * 2);
    x.fill();
    x.stroke();
    x.beginPath();
    x.arc(cx, foot - H * 0.8, H * 0.15, 0, Math.PI * 2);
    x.fill();
    x.stroke();
    if (k === 3) {
      x.beginPath();
      x.rect(cx + H * 0.12, foot - H * 0.55, H * 0.2, H * 0.06);
      x.fill();
      x.stroke();
    }
    x.fillStyle = "#461616";
    x.fillRect(cx - 20, foot - H * 0.74, 40, k === 1 ? 10 : k === 2 ? 22 : 3);
  }
  return c.toDataURL("image/png").split(",")[1];
}

/**
 * The maker's steps from the first one to the saved character: describe,
 * skip the prompt and the image AI, bring the sheet in, keep the cut, name
 * and save. `maker` is the maker's page, or its frame over the editor;
 * `page` draws the sheet.
 * @param {import("@playwright/test").Page | import("@playwright/test").FrameLocator} maker
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
export async function makeCharacter(maker, page, name) {
  await maker.locator("#desc").fill("a friendly fox ranger with a green hat");
  for (let i = 0; i < 3; i++) await maker.locator("#nextBtn").click();
  await expect(maker.locator('[data-panel="3"]')).toBeVisible();
  const b64 = await page.evaluate(drawSheet);
  await maker.locator("#picFile").setInputFiles({
    name: "sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from(b64, "base64"),
  });
  await expect(maker.locator('[data-panel="4"]')).toBeVisible();
  await maker.locator("#nextBtn").click();
  await maker.locator("#charName").fill(name);
  await maker.locator("#nextBtn").click();
  await expect(maker.locator("#savedBox")).toContainText(
    `${name} is on this device now`,
  );
}
