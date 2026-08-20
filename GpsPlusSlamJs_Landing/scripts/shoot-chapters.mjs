// Manual visual-review helper (round-4): captures the 3D scroll story at
// chapter framings or exact timeline positions, per palette. Golden-image
// CI assertions were consciously rejected (headless-GPU output differs per
// machine) — this script makes the MANUAL screenshot pass cheap instead.
//
// Usage (from GpsPlusSlamJs_Landing/):
//   pnpm run shoot -- fusion dive                 # chapter centers, dark
//   pnpm run shoot -- --palettes=dark,light hero  # multiple palettes
//   pnpm run shoot -- ms:3550 ms:3860             # exact timeline ms
//   pnpm run shoot -- --mobile cta                # 412x915 viewport
// Output: test-results/shots/<target>-<palette>[-mobile].png (gitignored).
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve } from "path";

const CHAPTER_IDS = [
  "hero",
  "qr",
  "fusion",
  "dive",
  "anywhere",
  "gallery",
  "cta",
];
const STORY_DURATION_MS = 7000; // CHAPTER_COUNT * CHAPTER_DURATION_MS
/** Scrub smoothing tau is 240ms — this settles displayed progress fully. */
const SETTLE_MS = 1400;

const args = process.argv.slice(2).filter((a) => a !== "--");
const palettes = (
  args.find((a) => a.startsWith("--palettes=")) ?? "--palettes=dark"
)
  .split("=")[1]
  .split(",");
const mobile = args.includes("--mobile");
const landscape = args.includes("--landscape");
const targets = args.filter((a) => !a.startsWith("--"));
if (targets.length === 0) {
  targets.push(...CHAPTER_IDS);
}

const outDir = resolve("test-results/shots");
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) {
  throw new Error("vite dev server reported no local URL");
}

const browser = await chromium.launch();
try {
  for (const palette of palettes) {
    const context = await browser.newContext({
      viewport: landscape
        ? { width: 915, height: 412 }
        : mobile
          ? { width: 412, height: 915 }
          : { width: 1280, height: 800 },
    });
    await context.addInitScript((p) => {
      localStorage.setItem("gps-landing-theme", p);
    }, palette);
    const page = await context.newPage();
    await page.goto(url);
    await page.locator("#scene-root canvas").waitFor({ state: "visible" });
    await page.waitForTimeout(SETTLE_MS); // intro + first scrub settle

    for (const target of targets) {
      if (target.startsWith("ms:")) {
        // Exact timeline position: invert scroll-story.ts's PIECEWISE
        // mapping (round-13 follow-up) — storyProgress = (i + f) / N for
        // the center line at fraction f of section i, so ms decomposes
        // into a chapter index and an in-section fraction.
        const ms = Number(target.slice(3));
        await page.evaluate(
          ([wantedMs, durationMs]) => {
            const story = document.getElementById("story");
            const sections = [...story.querySelectorAll("section.chapter")];
            const p = Math.min(1, Math.max(0, wantedMs / durationMs));
            const scaled = Math.min(
              p * sections.length,
              sections.length - 1e-9,
            );
            const index = Math.floor(scaled);
            const fraction = scaled - index;
            const active = sections[index];
            story.scrollTop =
              active.offsetTop +
              fraction * active.offsetHeight -
              story.clientHeight / 2;
          },
          [ms, STORY_DURATION_MS],
        );
      } else {
        await page.locator(`#chapter-${target}`).scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(SETTLE_MS);
      const name = target.replace(":", "");
      const suffix = landscape ? "-landscape" : mobile ? "-mobile" : "";
      const file = `${outDir}/${name}-${palette}${suffix}.png`;
      await page.screenshot({ path: file });
      console.log(file);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
