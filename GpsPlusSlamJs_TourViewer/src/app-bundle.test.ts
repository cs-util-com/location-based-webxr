/**
 * The app's production bundle, read once: one Vite build of the app and
 * one of the globe consumer's entry serve every test here (a build is the
 * most CPU-heavy thing in the unit stage, and the three groups used to
 * build them twice each).
 *
 * The licences the bundle ships.
 *
 * Why these tests matter: the deployed app is a bundle of other people's
 * code, and their licences ask for their notices to travel with every
 * copy - MIT and BSD the copyright and permission notice, the Apache
 * License 2.0 its text (section 4(a)), the package's NOTICE file (4(d))
 * and a statement that a changed copy was changed (4(b)). A production
 * build keeps no licence comment (measured: none survive the minifier), so
 * the app ships each bundled package's own licence file, verbatim, under
 * `public/third-party-licenses/`, which the build copies into the site.
 *
 * The list is derived from the builds' module ids
 * (`test-support/bundled-packages.ts`), never kept by hand: a new
 * dependency, or a dependency's dependency, that reaches the bundle fails
 * here until its licence ships and the NOTICE names it.
 *
 * The project's own packages (`gps-plus-slam-*`) are not third-party and
 * carry their own licence and NOTICE.
 *
 * The 3D view's code loads only when it is asked for.
 *
 * Why this test matters: the 3D editor brings the globe's relief, the 3D
 * tiles renderer and the geoid (the geoid's table alone is about 170 KB).
 * A visitor scanning a printed code must never download any of it, and the
 * desktop editor's map page must not wait for it either: the view switch
 * imports it at the click. One static import anywhere on a page's module
 * graph would put it into that page's bundle silently, and every other
 * test would still pass. So a production build of the app is read here:
 * for every page, the modules it loads before any `import()` runs hold
 * none of the globe, the tile renderer, the elevation package or the 3D
 * view's own modules - and the editor's page does reach them through
 * `import()`, which proves the test can see them at all. The import
 * fences beside it (`editor-only-packages.test.ts`, the dependency rules
 * in `config/.dependency-cruiser.cjs`) hold the source; this holds the
 * bundle the browser gets.
 *
 * The same build holds the creator's landing to its shape: the main page
 * loads only its small static part before an `import()` (a visitor pays
 * for nothing else), and its dynamic chunks stay within a size budget, so
 * a picture or a film that grows the start page shows up here first.
 *
 * The globe package as a dependency.
 *
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
 *   state diverges).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { GROUND_HIT, groundReachM } from "gps-plus-slam-globe/editor";
import { beforeAll, describe, expect, it } from "vitest";

import {
  appChunks,
  appModuleIds,
  bundledPackages,
  globeEntryModuleIds,
  packageOf,
  staticClosure,
  type BuiltChunk,
} from "./test-support/bundled-packages.js";

const LICENCES = new URL("../public/third-party-licenses/", import.meta.url);

/** A package's shipped file name stem: `@scope/name` as `scope-name`. */
const slug = (p: string) => p.replace(/^@/, "").replace("/", "-");

/** Where the app ships a package's licence file and its NOTICE file. */
const shippedLicence = (p: string) =>
  new URL(`${slug(p)}-LICENSE.txt`, LICENCES);
const shippedNotice = (p: string) => new URL(`${slug(p)}-NOTICE.txt`, LICENCES);

/** The project's own packages: not third-party. */
const firstParty = (p: string) => p.startsWith("gps-plus-slam");

/** A package's own licence file, by the names packages use (any case:
 *  `LICENSE`, `LICENSE.md`, `license`, `LICENCE.txt`, ...), or null. */
function ownFile(dir: string, stem: RegExp): string | null {
  const name = readdirSync(dir).find((f) => stem.test(f));
  return name === undefined ? null : `${dir}/${name}`;
}
const LICENCE_FILE = /^licen[cs]e(\.(txt|md))?$/i;
const NOTICE_FILE = /^notice(\.(txt|md))?$/i;

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

/** The NOTICE's entry for a package: from its "(npm: <name>," to the next
 *  list item, or "" when it has none. */
function noticeEntry(notice: string, p: string): string {
  const at = notice.indexOf(`(npm: ${p},`);
  if (at < 0) return "";
  const next = notice.indexOf("\n- ", at);
  return notice.slice(at, next < 0 ? undefined : next);
}

const sameText = (a: string, b: string) =>
  a.replaceAll("\r\n", "\n").trim() === b.replaceAll("\r\n", "\n").trim();

describe("the third-party licences the app ships", () => {
  /** Every third-party package either build bundles, with its directory. */
  let bundled: Map<string, string>;
  const notice = readFileSync(new URL("../NOTICE", import.meta.url), "utf8");

  beforeAll(async () => {
    const ids = [...(await appModuleIds()), ...(await globeEntryModuleIds())];
    bundled = new Map(
      [...bundledPackages(ids)].filter(([p]) => !firstParty(p)),
    );
  }, 180_000);

  it("finds the bundle's packages: the app's own and the globe's", () => {
    // A build that silently bundled nothing would pass every check below.
    for (const p of [
      "three",
      "leaflet",
      "@zip.js/zip.js",
      "3d-tiles-renderer",
    ]) {
      expect(bundled.has(p), p).toBe(true);
    }
  });

  it("every bundled package has a licence file of its own", () => {
    // Its own failure, legibly: a package without one cannot be shipped
    // by copying, and needs a decision (its licence text from elsewhere).
    const without = [...bundled]
      .filter(([, dir]) => ownFile(dir, LICENCE_FILE) === null)
      .map(([p]) => p);
    expect(without).toEqual([]);
  });

  it("ships every bundled package's licence file verbatim", () => {
    const unshipped = [...bundled]
      .filter(([p, dir]) => {
        const own = ownFile(dir, LICENCE_FILE);
        return (
          own !== null &&
          (!existsSync(shippedLicence(p)) ||
            !sameText(
              readFileSync(shippedLicence(p), "utf8"),
              readFileSync(own, "utf8"),
            ))
        );
      })
      .map(([p]) => p);
    expect(unshipped).toEqual([]);
  });

  it("ships a bundled package's NOTICE file verbatim (Apache 2.0, 4(d))", () => {
    const unshipped = [...bundled]
      .filter(([p, dir]) => {
        const own = ownFile(dir, NOTICE_FILE);
        return (
          own !== null &&
          (!existsSync(shippedNotice(p)) ||
            !sameText(
              readFileSync(shippedNotice(p), "utf8"),
              readFileSync(own, "utf8"),
            ))
        );
      })
      .map(([p]) => p);
    expect(unshipped).toEqual([]);
  });

  it("ships nothing for a package the app no longer bundles", () => {
    const expected = new Set([
      // The app's own NOTICE ships beside the licences (checked below).
      "NOTICE.txt",
      ...[...bundled].flatMap(([p, dir]) => [
        `${slug(p)}-LICENSE.txt`,
        ...(ownFile(dir, NOTICE_FILE) === null
          ? []
          : [`${slug(p)}-NOTICE.txt`]),
      ]),
    ]);
    const stale = readdirSync(LICENCES).filter((f) => !expected.has(f));
    expect(stale).toEqual([]);
  });

  it("names every bundled package in the NOTICE", () => {
    // Named as the NOTICE names a package: "(npm: <name>,".
    const missing = [...bundled.keys()].filter(
      (p) => !notice.includes(`(npm: ${p},`),
    );
    expect(missing).toEqual([]);
  });

  it("says, per patched bundled package, that its copy is modified and by which patch (Apache 2.0, 4(b))", () => {
    const patched = patchedPackages();
    expect(patched.has("3d-tiles-renderer")).toBe(true);
    const unsaid = [...bundled.keys()].filter((p) => {
      const patch = patched.get(p);
      if (patch === undefined) return false;
      const entry = noticeEntry(notice, p);
      return !/\bmodified\b/i.test(entry) || !entry.includes(patch);
    });
    expect(unsaid).toEqual([]);
  });
});

describe("the build tools' own modules", () => {
  // Why: a build's virtual modules (ids starting with "\0") belong to no
  // npm package, so the licence checks above never see them. The known
  // ones are a few lines of runtime the build tools emit into every build
  // (`test-support/bundled-packages.ts` says why no licence ships for
  // them); an unknown one may be a plugin's library inlined under a
  // virtual id, and must fail until someone decides.
  it("accepts the known ones", () => {
    expect(
      bundledPackages([
        "\0vite/preload-helper.js",
        "\0vite/modulepreload-polyfill.js",
        "\0rolldown/runtime.js",
      ]).size,
    ).toBe(0);
  });

  it("fails on a virtual module it does not know", () => {
    expect(() => bundledPackages(["\0some-plugin/inlined-lib.js"])).toThrow(
      /some-plugin\/inlined-lib\.js/,
    );
  });
});

describe("the NOTICE the app ships", () => {
  // Why: the NOTICE (with the 3d-tiles-renderer "MODIFIED" statement,
  // Apache 2.0 4(b)) sits beside the source; only public/ reaches the
  // site, so a copy ships there and must not drift from it.
  it("ships the package's NOTICE verbatim", () => {
    const shipped = new URL("NOTICE.txt", LICENCES);
    expect(existsSync(shipped)).toBe(true);
    expect(
      sameText(
        readFileSync(shipped, "utf8"),
        readFileSync(new URL("../NOTICE", import.meta.url), "utf8"),
      ),
    ).toBe(true);
  });
});

// --- the 3D view's code in the bundle -----------------------------------------

/** What only the 3D view may load: the globe (the workspace package's
 *  source), its tile renderer, the elevation package and the view's own
 *  modules. */
const THREE_D_ONLY: readonly [string, RegExp][] = [
  ["the globe", /\/GpsPlusSlamJs_Globe\/|\/gps-plus-slam-globe\//],
  ["the 3D tiles renderer", /\/node_modules\/3d-tiles-renderer\//],
  ["the elevation package", /\/GpsPlusSlamJs_Osm\/|\/gps-plus-slam-osm\//],
  ["the 3D view", /\/src\/editor3d\//],
  [
    "the editor kit's scene or globe",
    /\/(?:GpsPlusSlamJs_EditorKit|gps-plus-slam-editor-kit)\/src\/(?:scene|globe)\//,
  ],
];

/** A module of the editor kit (the workspace package's source); its
 *  first group is the kit's entry folder (`touch`, `chrome`, ...). */
const KIT_MODULE =
  /\/(?:GpsPlusSlamJs_EditorKit|gps-plus-slam-editor-kit)\/src\/([^/]+)\//;

/** The kit's entry folders a page's id belongs to (unique, sorted). */
function kitEntriesOf(ids: Iterable<string>): string[] {
  const entries = new Set<string>();
  for (const id of ids) {
    const match = KIT_MODULE.exec(id);
    if (match !== null) entries.add(match[1]!);
  }
  return [...entries].sort();
}

/** The landing's modules the main page may load before any `import()`:
 *  the mount shim and the returning-device rule (today's two), and the
 *  cards' controller with its one helper (small, no DOM; allowed, today
 *  they ride in the cards' chunk). Everything else under `src/landing/`
 *  (the cards' drawing, the film, the use cases) is a dynamic chunk, so a
 *  visitor never downloads it. */
const LANDING_STATIC = [
  "landing-mount.ts",
  "card-play.ts",
  "clamp01.ts",
  "landing-skip.ts",
];

/** The landing's dynamic chunks' JavaScript together, gzipped,
 *  unminified (the build here does not minify, so this bounds the shipped
 *  JavaScript from above). JavaScript only: the chunks' CSS is not
 *  counted, nor the hero's still drawing (public/landing, about 16 kB
 *  gzip for each of its two layouts, one of which a creator's page
 *  fetches), nor three.js, which the film imports from chunks the main
 *  page loads statically anyway. Measured 2026-10-26 at 61.7 kB with the
 *  cards, the use cases and the film (the film 35.0 of it; minified the
 *  three are 43.8 kB); the budget leaves about a fifth of headroom, far
 *  under the plan's 250 kB ceiling for the landing's own code
 *  (landing-mount.ts.md, "Size"). */
const LANDING_BUDGET_KB = 74;

/** The visitor's pages (the editor's page is the creator's). */
const VISITOR_PAGES = ["main", "writeProbe"];

/** Every module a page can load: its entry chunk and every chunk it
 *  imports, statically or by import(), transitively. */
function fullClosure(chunks: readonly BuiltChunk[], entry: string) {
  return chunksFrom(
    chunks,
    chunks.filter((c) => c.entry === entry),
    true,
  ).flatMap((c) => c.moduleIds);
}

/** The chunks reached from `start` by static imports (and by import()
 *  with `dynamic`), transitively, `start` included. */
function chunksFrom(
  chunks: readonly BuiltChunk[],
  start: readonly BuiltChunk[],
  dynamic: boolean,
): BuiltChunk[] {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const seen = new Map<string, BuiltChunk>();
  const queue = [...start];
  for (let chunk = queue.pop(); chunk !== undefined; chunk = queue.pop()) {
    if (seen.has(chunk.fileName)) continue;
    seen.set(chunk.fileName, chunk);
    const next = dynamic
      ? [...chunk.imports, ...chunk.dynamicImports]
      : chunk.imports;
    for (const name of next) {
      const found = byName.get(name);
      if (found !== undefined) queue.push(found);
    }
  }
  return [...seen.values()];
}

/** The chunk holding `module` (a path ending), which must exist. */
function chunkOf(chunks: readonly BuiltChunk[], module: string): BuiltChunk {
  const found = chunks.find((c) =>
    c.moduleIds.some((id) => id.endsWith(module)),
  );
  if (found === undefined) throw new Error(`no chunk holds ${module}`);
  return found;
}

/** The pages with a script of their own (`legal.html` has none: it loads
 *  no module at all). */
const PAGES = ["main", "edit", "writeProbe"];

describe("the 3D view's code in the app's bundle", () => {
  let chunks: BuiltChunk[];

  beforeAll(async () => {
    chunks = await appChunks();
  }, 180_000);

  it.each(PAGES)(
    "is not loaded by the %s page before an import() runs",
    (page) => {
      const loaded = [...staticClosure(chunks, page)];
      for (const [what, pattern] of THREE_D_ONLY) {
        expect(
          loaded.filter((id) => pattern.test(id)),
          `${page} loads ${what}`,
        ).toEqual([]);
      }
    },
  );

  // Why: a visitor's pages must not reach the 3D views even by import():
  // the static check above lets a lazy chunk through, and one import()
  // from a visitor's module would ship the globe to the phone on demand.
  it.each(VISITOR_PAGES)(
    "is not reached by the %s page even through import()",
    (page) => {
      const reached = [...fullClosure(chunks, page)];
      for (const [what, pattern] of THREE_D_ONLY) {
        expect(
          reached.filter((id) => pattern.test(id)),
          `${page} reaches ${what}`,
        ).toEqual([]);
      }
    },
  );

  // Why: of the editor kit, a visitor's page may load only its touch
  // gestures; the shell chrome and the 3D blocks are the editor's, and one
  // import from a visitor's module (even an import()) would ship them.
  it.each(VISITOR_PAGES)(
    "reaches no editor kit module but its touch from the %s page",
    (page) => {
      expect(
        kitEntriesOf(fullClosure(chunks, page)).filter((e) => e !== "touch"),
      ).toEqual([]);
    },
  );

  // Why: the editor's page loads the shell chrome at once and nothing of
  // the kit's 3D blocks; it holds the chrome, which proves the check sees
  // the kit's modules through the workspace link at all.
  it("loads of the editor kit only its chrome and touch on the editor's page", () => {
    const entries = kitEntriesOf(staticClosure(chunks, "edit"));
    expect(entries).toContain("chrome");
    expect(entries.filter((e) => e !== "chrome" && e !== "touch")).toEqual([]);
  });

  it("keeps the landing's moving parts out of the main page's first load", () => {
    const loaded = [...staticClosure(chunks, "main")];
    const landing = loaded
      .filter((id) => id.includes("/src/landing/"))
      .map((id) => id.slice(id.lastIndexOf("/") + 1))
      .sort();
    // The check sees the landing at all: the shim is always there.
    expect(landing).toContain("landing-mount.ts");
    expect(landing.filter((file) => !LANDING_STATIC.includes(file))).toEqual(
      [],
    );
  });

  it("keeps the landing's dynamic chunks within their budget", () => {
    const first = new Set(
      [...staticClosure(chunks, "main")].filter((id) =>
        id.includes("/src/landing/"),
      ),
    );
    const lazy = chunks.filter(
      (c) =>
        c.entry === null &&
        c.moduleIds.some(
          (id) => id.includes("/src/landing/") && !first.has(id),
        ),
    );
    // The cards' pictures and the use cases, at least: the check sees them.
    expect(lazy.length).toBeGreaterThanOrEqual(2);
    const kb = lazy.reduce((sum, c) => sum + gzipSync(c.code).length, 0) / 1024;
    expect(kb).toBeLessThanOrEqual(LANDING_BUDGET_KB);
  });

  // Why (the full-globe editor plan's cold review, finding 13): the site
  // ships /globe-assets/ now, so nothing but a reference keeps a visitor's
  // phone from fetching 12.6 MB of whole-Earth imagery. No chunk a
  // visitor's page can reach, even by import(), may name the path; the
  // editor's globe view does, which proves the check sees it.
  it.each(VISITOR_PAGES)(
    "names no /globe-assets/ path in the %s page's bundle, even through import()",
    (page) => {
      const reached = chunksFrom(
        chunks,
        chunks.filter((c) => c.entry === page),
        true,
      );
      expect(reached.length).toBeGreaterThan(0);
      expect(
        reached
          .filter((c) => c.code.includes("/globe-assets/"))
          .map((c) => c.fileName),
      ).toEqual([]);
    },
  );

  it("names /globe-assets/ in the editor's globe view, so the check sees it", () => {
    const globeOwn = chunksFrom(
      chunks,
      [chunkOf(chunks, "/src/editor3d/editor3d-globe.ts")],
      false,
    );
    expect(globeOwn.some((c) => c.code.includes("/globe-assets/"))).toBe(true);
  });

  it("is reached from the editor's page by import(), the geoid with it", () => {
    const edit = chunks.find((c) => c.entry === "edit");
    expect(edit).toBeDefined();
    // Everything the build holds, the lazy chunks included.
    const all = chunks.flatMap((c) => c.moduleIds);
    expect(
      all.some((id) => id.endsWith("/src/editor3d/editor3d-scene.ts")),
    ).toBe(true);
    expect(
      all.some((id) => /\/node_modules\/3d-tiles-renderer\//.test(id)),
    ).toBe(true);
    expect(all.some((id) => /elevation\/egm96/.test(id))).toBe(true);
    // The scene's chunk is a dynamic import of the editor's page.
    const scene = chunks.find((c) =>
      c.moduleIds.some((id) => id.endsWith("/src/editor3d/editor3d-scene.ts")),
    );
    expect(scene).toBeDefined();
    const reachedLazily = chunks.some((c) =>
      c.dynamicImports.includes(scene!.fileName),
    );
    expect(reachedLazily).toBe(true);
  });

  // Why: the globe's whole-Earth imagery (about 12.6 MB at /globe-assets/:
  // the dev server's route, the site build's root copy) belongs to the editor on the globe
  // view alone, behind its link switch: no other code may hold its
  // factory, the OrbitControls view (a plain ground under the map)
  // included, and the reach is by import() only.
  it("holds the globe's whole-Earth imagery only in the globe view's chunks", () => {
    const withImagery = chunks
      .filter((c) => c.code.includes("createGlobeImagery"))
      .map((c) => c.fileName);
    // The check can see the imagery at all.
    expect(withImagery.length).toBeGreaterThan(0);
    const globeView = chunkOf(chunks, "/src/editor3d/editor3d-globe.ts");
    const scene = chunkOf(chunks, "/src/editor3d/editor3d-scene.ts");
    const globeOwn = new Set(
      chunksFrom(chunks, [globeView], false).map((c) => c.fileName),
    );
    const sceneOwn = new Set(
      chunksFrom(chunks, [scene], false).map((c) => c.fileName),
    );
    for (const name of withImagery) {
      expect(globeOwn.has(name), `${name} outside the globe view`).toBe(true);
      expect(sceneOwn.has(name), `${name} in the OrbitControls view`).toBe(
        false,
      );
    }
    for (const page of PAGES) {
      const loaded = staticClosure(chunks, page);
      expect(
        globeView.moduleIds.some((id) => loaded.has(id)),
        `${page} loads the globe view first`,
      ).toBe(false);
    }
    // The editor's page reaches the globe view by import().
    expect(
      chunks.some((c) => c.dynamicImports.includes(globeView.fileName)),
    ).toBe(true);
    // The files themselves are not the app's: the dev server routes them and
    // the site build copies them to the site root.
    expect(existsSync(new URL("../public/globe-assets", import.meta.url))).toBe(
      false,
    );
  });
});

// --- the globe package as a dependency ----------------------------------------

describe("the globe package as a dependency of this Vite app", () => {
  it("resolves by its name and runs", () => {
    expect(groundReachM(1.7)).toBe(GROUND_HIT.maxDistanceM);
    expect(groundReachM(3_000) / 1000).toBeCloseTo(195.5, 0);
  });

  it("builds with one three, the globe's own source and its tile renderer in the bundle", async () => {
    const ids = await globeEntryModuleIds();
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
    expect(ids.some((id) => packageOf(id) === "3d-tiles-renderer")).toBe(true);
  }, 120_000);
});
