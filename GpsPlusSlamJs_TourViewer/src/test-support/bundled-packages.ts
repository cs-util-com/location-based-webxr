/**
 * Test-only: which npm packages a production Vite build of this app pulls
 * in, read from the build's own module ids (never from `package.json`: a
 * dependency's dependency may be bundled, and a dependency may bring code
 * no page imports - `qrcode`'s command-line parts are never bundled).
 *
 * Two builds count: the app's own (`vite.config.ts`, every page it
 * builds), and an entry that imports the globe's editor blocks, which the
 * 3D editor will import (`globe-dependency.test.ts`).
 */
import { fileURLToPath } from "node:url";

import { build, type Plugin } from "vite";

/** This app's root (the package folder). */
const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const GLOBE_ENTRY = "globe-consumer-entry";

/** A plugin that serves the globe consumer's entry: the editor blocks,
 *  re-exported. */
const globeConsumerEntry: Plugin = {
  name: GLOBE_ENTRY,
  resolveId: (id) => (id === GLOBE_ENTRY ? `\0${GLOBE_ENTRY}` : null),
  load: (id) =>
    id === `\0${GLOBE_ENTRY}`
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

/** The module ids of every chunk of a build's result, with `/`. */
function moduleIdsOf(result: Awaited<ReturnType<typeof build>>): string[] {
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

/** The module ids of a production build of the globe consumer's entry,
 *  from this app's root. */
export async function globeEntryModuleIds(): Promise<string[]> {
  return moduleIdsOf(
    await build({
      configFile: false,
      root: APP_ROOT,
      logLevel: "silent",
      plugins: [globeConsumerEntry],
      build: {
        write: false,
        minify: false,
        modulePreload: false,
        rollupOptions: { input: GLOBE_ENTRY },
      },
    }),
  );
}

/** The module ids of this app's own production build (its config, every
 *  page), written nowhere. */
export async function appModuleIds(): Promise<string[]> {
  return moduleIdsOf(
    await build({
      configFile: `${APP_ROOT}vite.config.ts`,
      root: APP_ROOT,
      logLevel: "silent",
      build: { write: false, minify: false },
    }),
  );
}

/** The npm package under `node_modules` a module id belongs to, or null. */
export function packageOf(id: string): string | null {
  const match = /.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id);
  return match?.[1] ?? null;
}

/**
 * The virtual modules (ids starting with "\0", in no `node_modules`) a
 * build may contain without a licence shipping for them: Vite's
 * dynamic-import preload helper and its `modulepreload` polyfill, and
 * Rolldown's module runtime - a few lines of glue the build tools emit
 * into every build they make - and this file's own globe entry. Vite and
 * Rolldown are MIT, whose notice condition covers "copies or substantial
 * portions of the Software"; a bundle holds neither a copy of either tool
 * nor a substantial portion of one, so no notice ships (the NOTICE says
 * so). Any other virtual id fails `bundledPackages`: a plugin may inline a
 * library under one, and that needs a decision.
 */
const KNOWN_VIRTUAL_MODULES: ReadonlySet<string> = new Set([
  "\0vite/preload-helper.js",
  "\0vite/modulepreload-polyfill.js",
  "\0rolldown/runtime.js",
  `\0${GLOBE_ENTRY}`,
]);

/** The module ids' packages, each with its install directory.
 *  @throws Error for a virtual module not in {@link KNOWN_VIRTUAL_MODULES}. */
export function bundledPackages(ids: readonly string[]): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const id of ids) {
    const p = packageOf(id);
    if (p === null && id.startsWith("\0") && !KNOWN_VIRTUAL_MODULES.has(id)) {
      throw new Error(
        `the build bundles the virtual module ${JSON.stringify(id)}: decide whether its code needs a licence, then list it in KNOWN_VIRTUAL_MODULES`,
      );
    }
    if (p === null || dirs.has(p)) continue;
    const at = id.lastIndexOf(`/node_modules/${p}/`);
    dirs.set(p, id.slice(0, at + `/node_modules/${p}`.length));
  }
  return dirs;
}
