/**
 * Guardrails for the ambient occlusion in `BuildingView`, read from source.
 *
 * WHY SOURCE TEXT: `BuildingView` constructs a `THREE.WebGLRenderer`, so the
 * unit suite cannot instantiate it, and the three properties below are about
 * where code sits, not what one frame looks like (the frame itself is pinned
 * in `playwright-tests/scene-3d.spec.js`). Same precedent as
 * `building-view-content.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "building-view.ts"), "utf8");
const AO_MODULE = "visualization/ambient-occlusion";

const numberAfter = (pattern: RegExp): number => {
  const match = pattern.exec(source);
  if (match === null)
    throw new Error(`not found in building-view.ts: ${pattern}`);
  return Number(match[1]);
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|js)$/.test(name) && !/\.test\.|\.spec\./.test(name)
      ? [full]
      : [];
  });

describe("BuildingView's ambient occlusion", () => {
  // Why this test matters: the `ao=strong` link reaches the pass only through
  // this option; absent, the framework's own 1 / 2.2 applies, so the default
  // look cannot change without the knob.
  it("hands the link's display exponent to the pass, and nothing else", () => {
    expect(source).toMatch(
      /createAmbientOcclusion\(\{[^}]*displayExponent: options\.aoDisplayExponent,/,
    );
    const main = readFileSync(path.join(here, "main.ts"), "utf8");
    expect(main).toMatch(
      /aoDisplayExponent: aoDisplayExponent\(window\.location\.search\)/,
    );
  });

  // Why this test matters: the AO factor is exactly 1 past its fade end, which
  // is what keeps the fogged distance and the sky bit-identical with AO on. A
  // fade end moved past where the fog starts at the SHORTEST render distance
  // would darken fog and break the light gates' sky and horizon colours.
  it("fades out before the nearest the fog ever starts", () => {
    const farPlane = numberAfter(/export const FAR_PLANE_M = ([\d.]+);/);
    const fogRatio = numberAfter(/const FOG_NEAR_RATIO = ([\d.]+);/);
    const fadeStart = numberAfter(/const AO_FADE = \{ fadeStartM: ([\d.]+),/);
    const fadeEnd = numberAfter(/const AO_FADE = \{[^}]*fadeEndM: ([\d.]+) \}/);
    expect(fadeStart).toBeLessThan(fadeEnd);
    expect(fadeEnd).toBeLessThan(farPlane * fogRatio);
  });

  // Why this test matters: every `renderer.render` resets `renderer.info`, so
  // an AO pass drawn before the cost capture would report the AO's own
  // full-screen draws as the scene's cost to the perf overlay and the e2e.
  it("is drawn after the frame's draw cost is captured", () => {
    const capture = source.indexOf("this.lastDrawCost = {");
    const frameAo = source.indexOf("this.ao.render();", capture);
    expect(capture).toBeGreaterThan(-1);
    expect(frameAo).toBeGreaterThan(capture);
    // Right behind the capture, not some later render elsewhere in the file.
    expect(frameAo - capture).toBeLessThan(400);
  });

  // Why this test matters: the AO's normal/depth pass draws every mesh with
  // one override material, which does not run the ground's GPU displacement
  // shader. With the ground displaced on the GPU the AO would see a flat
  // ground under raised terrain and darken the wrong places, so the pass
  // stays off in that mode whatever the switch says, and comes back when the
  // ground leaves it. Both setters must re-decide, or the order in which the
  // two settings arrive decides the frame.
  it("stays off while the ground is displaced on the GPU", () => {
    const body = (signature: string): string => {
      const start = source.indexOf(`  ${signature}(`);
      if (start < 0) throw new Error(`not found: ${signature}`);
      return source.slice(start, source.indexOf("\n  }\n", start));
    };
    expect(body("setAmbientOcclusion")).toContain(
      "this.applyAmbientOcclusion();",
    );
    expect(body("setGroundDisplacement")).toContain(
      "this.applyAmbientOcclusion();",
    );
    expect(body("private applyAmbientOcclusion")).toMatch(
      /const on = this\.aoWanted && this\.displacement !== "gpu";/,
    );
  });

  // Why this test matters: AR is kept free of the AO by construction (its own
  // renderer; `BuildingView` suspended). This pins the construction: nothing in
  // OsmDemo but `BuildingView`, and nothing in the framework's AR code, reaches
  // the module.
  it("is imported by BuildingView only, and by no framework AR code", () => {
    const demoImporters = sourceFiles(here)
      .filter((file) => readFileSync(file, "utf8").includes(AO_MODULE))
      .map((file) => path.relative(here, file).replace(/\\/g, "/"));
    expect(demoImporters).toEqual(["building-view.ts"]);

    const frameworkAr = path.join(
      here,
      "../../GpsPlusSlamJs_AppFramework/src/ar",
    );
    const arImporters = sourceFiles(frameworkAr).filter((file) =>
      /ambient-occlusion/.test(readFileSync(file, "utf8")),
    );
    expect(arImporters).toEqual([]);
  });
});
