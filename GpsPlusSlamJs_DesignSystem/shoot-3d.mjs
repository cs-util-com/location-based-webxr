/**
 * Screenshot harness for the 3D look-dev page (plan 2026-09-23-0048,
 * DEC-SKY-11): renders every preset under every tone map, so a look can be
 * judged side by side and a round leaves a durable before/after record.
 *
 * Usage (from GpsPlusSlamJs_DesignSystem/):
 *   pnpm run shoot:3d                         # every preset × tone map
 *   pnpm run shoot:3d -- --preset=golden      # one preset
 *   pnpm run shoot:3d -- --tone=agx           # one tone map
 *   pnpm run shoot:3d -- --view=sun           # one camera view (city | sun | antisun | lake | aloft | inside | above)
 *   pnpm run shoot:3d -- --cloud-mode=sheet   # the fly-through cloud sheet, or slab (default: dome)
 *   pnpm run shoot:3d -- --slab-steps=8       # the slab's march steps (8 | 16 | 24 | 32; default 16)
 *   pnpm run shoot:3d -- --cover=0.5          # a cloud cover (default: each preset's)
 *   pnpm run shoot:3d -- --parity             # also print the GPU/CPU LUT parity
 *
 * Output: shots/3d/<preset>-<tone>[-<cloud-mode>]-<view>.png (gitignored). Like shoot.mjs this is an eyeball tool, not a gate: headless
 * Chromium rasterises on the CPU (SwiftShader), so pixels differ per machine
 * and timings mean nothing for a phone. Console and page errors DO fail it,
 * because a shader compile error only ever shows up as a console line.
 *
 * It starts its own server on the aux port 5198 (docs/dev-server-ports.md)
 * bound to 127.0.0.1, and never reuses one left running for a phone round.
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 5198;
const outDir = join(here, "shots", "3d");
mkdirSync(outDir, { recursive: true });

const args = new Map(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const body = a.replace(/^--/, "");
      const eq = body.indexOf("=");
      return eq < 0 ? [body, "true"] : [body.slice(0, eq), body.slice(eq + 1)];
    }),
);

const PRESETS = ["dawn", "noon", "golden", "blueHour", "hazy"];
const TONES = ["agx", "aces", "neutral"];
const presets = args.has("preset") ? [args.get("preset")] : PRESETS;
const tones = args.has("tone") ? [args.get("tone")] : TONES;
const views = args.has("view") ? [args.get("view")] : ["city", "sun"];
const cloudMode = args.get("cloud-mode") ?? "dome";
if (!["dome", "sheet", "slab"].includes(cloudMode)) {
  throw new Error(`--cloud-mode must be dome, sheet or slab, got ${cloudMode}`);
}
const slabSteps = Number(args.get("slab-steps") ?? 16);
if (![8, 16, 24, 32].includes(slabSteps)) {
  throw new Error(
    `--slab-steps must be 8, 16, 24 or 32, got ${args.get("slab-steps")}`,
  );
}
const cover = args.has("cover") ? Number(args.get("cover")) : null;
if (cover !== null && !(cover >= 0 && cover <= 1)) {
  throw new Error(`--cover must be in [0, 1], got ${args.get("cover")}`);
}

/** Start serve.mjs and resolve once it is listening. */
function startServer() {
  const child = spawn(process.execPath, [join(here, "serve.mjs")], {
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("design system served")) resolve(child);
    });
    child.on("exit", (code) => reject(new Error(`serve.mjs exited ${code}`)));
  });
}

const server = await startServer();
const browser = await chromium.launch();
const problems = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/3d/#preset=golden&tone=agx`);
  await page.waitForFunction(
    () => window.__lookdev?.ready || window.__lookdev?.error,
    null,
    { timeout: 60_000 },
  );
  const error = await page.evaluate(() => window.__lookdev.error);
  if (error) throw new Error(`page reported: ${error}`);

  // Two animation frames after each change: one to apply, one to draw.
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
  const shoot = async (name, view) => {
    await page.evaluate((v) => window.__lookdev.setView(v), view);
    await settle();
    const file = join(outDir, `${name}-${view}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  };
  for (const preset of presets) {
    for (const tone of tones) {
      await page.evaluate(
        ([p, t, m, c, n]) => {
          window.__lookdev.setPreset(p);
          window.__lookdev.setToneMapping(t);
          window.__lookdev.setCloudSlabSteps(n);
          window.__lookdev.setCloudMode(m);
          if (c !== null) window.__lookdev.setCloudCover(c);
        },
        [preset, tone, cloudMode, cover, slabSteps],
      );
      const suffix =
        (cloudMode === "dome" ? "" : `-${cloudMode}`) +
        (cloudMode === "slab" && slabSteps !== 16 ? `x${slabSteps}` : "") +
        (cover === null ? "" : `-cover${cover}`);
      for (const view of views) await shoot(`${preset}-${tone}${suffix}`, view);
    }
  }
  if (args.has("parity")) {
    const parity = await page.evaluate(() => {
      const p = window.__lookdev.parity();
      return {
        transmittance: p.transmittance,
        multiScattering: p.multiScattering,
        skyView: p.skyView,
        samples: p.samples.map((s) => ({
          ...s,
          error: Number(s.error.toFixed(4)),
        })),
      };
    });
    console.log(JSON.stringify(parity, null, 2));
  }
  console.log(
    JSON.stringify(await page.evaluate(() => window.__lookdev.stats())),
  );
} finally {
  await browser.close();
  server.kill();
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
