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
 *   NOTICE, so a new dependency of the globe cannot ship unattributed;
 * - every bundled package under the Apache License 2.0 has its licence
 *   text shipped with the app (section 4(a): a copy goes with every
 *   redistribution), verbatim, under `public/third-party-licenses/`, which
 *   the build copies into the site;
 * - every bundled package the workspace patches (`patchedDependencies`)
 *   is said in the NOTICE to be modified, by its patch (section 4(b)).
 */
import { existsSync, readFileSync } from "node:fs";
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

/** The module ids' packages, each with its install directory. */
function bundledPackages(ids: string[]): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const id of ids) {
    const p = packageOf(id);
    if (p === null || dirs.has(p)) continue;
    const at = id.lastIndexOf(`/node_modules/${p}/`);
    dirs.set(p, id.slice(0, at + `/node_modules/${p}`.length));
  }
  return dirs;
}

/** Where the app ships a package's licence text (a file name per package). */
const licenceUrl = (p: string) =>
  new URL(
    `../public/third-party-licenses/${p.replace(/^@/, "").replace("/", "-")}-LICENSE.txt`,
    import.meta.url,
  );

/** The workspace's patched packages, name to patch file (`name@version: path`). */
function patchedPackages(): Map<string, string> {
  const yaml = readFileSync(
    new URL("../../pnpm-workspace.yaml", import.meta.url),
    "utf8",
  );
  const block = /^patchedDependencies:\n((?:[ \t]+.*\n?)*)/m.exec(yaml)?.[1];
  const patched = new Map<string, string>();
  for (const line of (block ?? "").split("\n")) {
    const m = /^\s+["']?((?:@[^/@]+\/)?[^@"'\s]+)@[^:]+:\s*(\S+)/.exec(line);
    if (m) patched.set(m[1]!, m[2]!);
  }
  return patched;
}

const sameText = (a: string, b: string) =>
  a.replaceAll("\r\n", "\n").trim() === b.replaceAll("\r\n", "\n").trim();

describe("the globe package as a dependency of this Vite app", () => {
  it("resolves by its name and runs", () => {
    expect(groundReachM(1.7)).toBe(GROUND_HIT.maxDistanceM);
    expect(groundReachM(3_000) / 1000).toBeCloseTo(195.5, 0);
  });

  it("builds with one three; every bundled package is in the NOTICE, Apache licences shipped, patches declared", async () => {
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
    const dirs = bundledPackages(ids);
    // Apache 2.0: the licence text ships with the app, verbatim.
    const apache = [...dirs].filter(([, dir]) =>
      /Apache-2\.0/.test(
        String(
          (
            JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as {
              license?: unknown;
            }
          ).license,
        ),
      ),
    );
    expect(apache.map(([p]) => p)).toContain("3d-tiles-renderer");
    const unshipped = apache
      .filter(
        ([p, dir]) =>
          !existsSync(licenceUrl(p)) ||
          !sameText(
            readFileSync(licenceUrl(p), "utf8"),
            readFileSync(`${dir}/LICENSE`, "utf8"),
          ),
      )
      .map(([p]) => p);
    expect(unshipped).toEqual([]);
    // A patched package is said to be modified, by its patch.
    const patched = patchedPackages();
    expect(patched.has("3d-tiles-renderer")).toBe(true);
    const unsaid = [...bundled].filter(
      (p) => patched.has(p) && !notice.includes(patched.get(p)!),
    );
    expect(unsaid).toEqual([]);
  }, 120_000);
});
