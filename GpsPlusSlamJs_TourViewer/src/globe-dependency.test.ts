/**
 * Why these tests matter: the 3D editor imports the globe's building blocks
 * into this Vite app, and until now the globe package was served without a
 * build to the design system's lab only: no `exports`, never resolved by
 * Vite as a dependency, never built into an app's bundle. They pin that:
 * - the package resolves by its name (`gps-plus-slam-globe/editor`)
 *   through Vite's resolver (vitest's) and TypeScript's (this file is
 *   type-checked under the app's compiler options), and its code runs;
 * - a production Vite build of an entry that imports the editor blocks
 *   succeeds and holds ONE three (two copies would make the globe's meshes
 *   foreign to the app's scene: `instanceof` checks fail and two renderers'
 *   state diverges);
 * - every third-party package that build pulls in is named in this app's
 *   NOTICE, so a new dependency of the globe cannot ship unattributed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GROUND_HIT, groundReachM } from "gps-plus-slam-globe/editor";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = "globe-consumer-entry";

/** A plugin that serves the consumer's entry: the editor blocks, re-exported. */
const consumerEntry: Plugin = {
  name: "globe-consumer-entry",
  resolveId: (id) => (id === ENTRY ? `\0${ENTRY}` : null),
  load: (id) =>
    id === `\0${ENTRY}`
      ? [
          "export {",
          "  createGlobeTerrain,",
          "  createGlobeOsmOverlay,",
          "  groundHit,",
          "  groundReachM,",
          "  applyEyeControls,",
          "  reliefCacheBudget,",
          '} from "gps-plus-slam-globe/editor";',
        ].join("\n")
      : null,
};

/** The module ids of a production build of that entry, from this app's root. */
async function builtModuleIds(): Promise<string[]> {
  const result = await build({
    configFile: false,
    root: ROOT,
    logLevel: "silent",
    plugins: [consumerEntry],
    build: {
      write: false,
      minify: false,
      modulePreload: false,
      rollupOptions: { input: ENTRY },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const ids: string[] = [];
  for (const out of outputs) {
    if (!("output" in out)) throw new Error("expected a build, not a watcher");
    for (const item of out.output) {
      if (item.type === "chunk") ids.push(...item.moduleIds);
    }
  }
  return ids.map((id) => id.replaceAll("\\", "/"));
}

/** The npm packages under `node_modules` a module id belongs to. */
function packageOf(id: string): string | null {
  const match = /.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id);
  return match?.[1] ?? null;
}

describe("the globe package as a dependency of this Vite app", () => {
  it("resolves by its name and runs", () => {
    expect(groundReachM(1.7)).toBe(GROUND_HIT.maxDistanceM);
    expect(groundReachM(3_000) / 1000).toBeCloseTo(195.5, 0);
  });

  it("builds with one three, and every third-party package it bundles is in the NOTICE", async () => {
    const ids = await builtModuleIds();
    // The globe's own source is in the build, through the package link.
    expect(
      ids.some((id) => id.endsWith("GpsPlusSlamJs_Globe/src/globe-editor.ts")),
    ).toBe(true);
    // One three: every three module from one installed copy.
    const threeDirs = new Set(
      ids
        .filter((id) => packageOf(id) === "three")
        .map((id) => id.replace(/\/node_modules\/three\/.*$/, "")),
    );
    expect([...threeDirs]).toHaveLength(1);
    const bundled = new Set(
      ids.map(packageOf).filter((p): p is string => p !== null),
    );
    expect(bundled.has("3d-tiles-renderer")).toBe(true);
    const notice = readFileSync(new URL("../NOTICE", import.meta.url), "utf8");
    // Named as the NOTICE names a package: "(npm: <name>,".
    const missing = [...bundled].filter((p) => !notice.includes(`(npm: ${p},`));
    expect(missing).toEqual([]);
  }, 120_000);
});
