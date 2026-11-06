/**
 * The 3D editor's heavy packages, and the editor kit, stay on the editor's
 * pages.
 *
 * Why this test matters: the globe, the 3D tiles renderer and the OSM
 * package (its geoid table among it) are megabytes a visitor scanning a printed code on a phone must
 * never download. One import of them from a module the visitor's or the
 * phone creator's page reaches would put them on that page silently, and
 * every other test would still pass. The dependency rules
 * (`config/.dependency-cruiser.cjs`) read only `src/` (`includeOnly`), so
 * an import of a PACKAGE is invisible to them; this scan holds that half:
 * no production module outside `src/editor/` and `src/editor3d/` names one
 * of these packages, statically or through `import()`. (That top-level
 * modules never import `src/editor3d/` itself is the dependency rules'.)
 *
 * The editor kit (`gps-plus-slam-editor-kit`) is held the same way: only
 * its `./touch` entry (the touch gestures a visitor's page may share) is
 * open to every module; `./chrome`, `./scene` and `./globe` are the
 * editor's. And the editor's page (`src/editor/`) reaches the kit's
 * `./scene` and `./globe` only through `import()`: they bring three and
 * the globe, which the map page must not wait for
 * (`app-bundle.test.ts` holds the bundle).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/** The packages only the editor's pages may import, by specifier: every
 *  entry of the editor kit but its `./touch`. */
const EDITOR_ONLY =
  /^(?:(?:gps-plus-slam-globe|3d-tiles-renderer|gps-plus-slam-osm)(?:\/|$)|gps-plus-slam-editor-kit(?:\/(?!touch(?:\/|$))|$))/;

/** The editor kit's entries that bring three: outside the 3D view's own
 *  modules (which the editor's page reaches by `import()` alone), only
 *  `import()` may name them. */
const KIT_LAZY = /^gps-plus-slam-editor-kit\/(?:scene|globe)(?:\/|$)/;

/** An import statement of a kit entry, by its specifier. */
const KIT_IMPORT =
  /^\s*import\s+[^'";]*?\sfrom\s+["'](gps-plus-slam-editor-kit(?:\/[^"']*)?)["']/gm;

/** The globe's whole view: only the 3D view's modules import it. */
const GLOBE_VIEW = /^gps-plus-slam-globe\/view$/;

/** The folders whose modules may import them. */
const EDITOR_DIRS = ["editor", "editor3d"];

/** An import or re-export statement's specifier. */
const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;

/** An `import()`'s specifier. */
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** Every specifier `source` imports or re-exports statically (type-only
 *  imports included: a rule about pages reads them too). */
function staticSpecifiers(source: string): string[] {
  return [...source.matchAll(STATIC_IMPORT)].map((match) => match[1]!);
}

/** Every specifier `source` imports or re-exports, static or dynamic. */
function importedSpecifiers(source: string): string[] {
  return [
    ...staticSpecifiers(source),
    ...[...source.matchAll(DYNAMIC_IMPORT)].map((match) => match[1]!),
  ];
}

/** The production modules under `dir` (tests and declarations left out). */
function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return productionFiles(path);
    return name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

/** Whether `file` (under `src/`) is one of the editor's modules. */
function isEditorModule(file: string): boolean {
  const top = relative(SRC, file).split(/[\\/]/)[0];
  return top !== undefined && EDITOR_DIRS.includes(top);
}

describe("the editor's heavy packages", () => {
  it("are imported by no module outside src/editor/ and src/editor3d/", () => {
    const offenders = productionFiles(SRC)
      .filter((file) => !isEditorModule(file))
      .flatMap((file) =>
        importedSpecifiers(readFileSync(file, "utf8"))
          .filter((spec) => EDITOR_ONLY.test(spec))
          .map((spec) => `${relative(SRC, file)} imports ${spec}`),
      );
    expect(offenders).toEqual([]);
  });

  // Why: the globe's whole view (`gps-plus-slam-globe/view`) carries the
  // whole-Earth imagery and the sky; only the 3D view's own modules, which
  // the editor's page reaches by import() alone, may name it. One import
  // from the page's own modules (src/editor/) would put it on the map
  // page's first load.
  it("leaves the globe's whole view to the 3D view's modules", () => {
    const importers = productionFiles(SRC).filter((file) =>
      importedSpecifiers(readFileSync(file, "utf8")).some((spec) =>
        GLOBE_VIEW.test(spec),
      ),
    );
    expect(
      importers
        .map((file) => relative(SRC, file).replaceAll("\\", "/"))
        .filter((file) => !file.startsWith("editor3d/")),
    ).toEqual([]);
    // The rule can see an importer at all.
    expect(importers.length).toBeGreaterThan(0);
  });

  // Why: the kit's `./scene` and `./globe` bring three and the globe; one
  // static import of them from the editor's page (`src/editor/`) would put
  // them on the map page's first load.
  it("leaves the kit's scene and globe to import() outside the 3D view", () => {
    const offenders = productionFiles(SRC)
      .filter(
        (file) =>
          !relative(SRC, file).replaceAll("\\", "/").startsWith("editor3d/"),
      )
      .flatMap((file) =>
        staticSpecifiers(readFileSync(file, "utf8"))
          .filter((spec) => KIT_LAZY.test(spec))
          .map((spec) => `${relative(SRC, file)} imports ${spec}`),
      );
    expect(offenders).toEqual([]);
  });

  // Why: a module that names one kit entry in several import statements
  // reads as several dependencies and hides which blocks it uses; one
  // statement per entry per module keeps the kit's surface in a module
  // readable at a glance. (The app's editor page had six, its shell nine.)
  it("names each kit entry in one import statement per module", () => {
    const offenders = productionFiles(SRC).flatMap((file) => {
      const counts = new Map<string, number>();
      for (const match of readFileSync(file, "utf8").matchAll(KIT_IMPORT)) {
        const entry = match[1]!;
        counts.set(entry, (counts.get(entry) ?? 0) + 1);
      }
      return [...counts]
        .filter(([, count]) => count > 1)
        .map(([entry, count]) => `${relative(SRC, file)}: ${count} x ${entry}`);
    });
    expect(offenders).toEqual([]);
  });

  it("reads every import form the rule is about", () => {
    // The scan is only as good as its parser: each form a module could use
    // is read, so none slips past it.
    expect(
      importedSpecifiers(
        [
          'import { a } from "gps-plus-slam-globe/editor";',
          'import type { B } from "3d-tiles-renderer";',
          'export * from "gps-plus-slam-osm/elevation/egm96";',
          'import "3d-tiles-renderer/plugins";',
          'const m = await import("gps-plus-slam-globe");',
        ].join("\n"),
      ).filter((spec) => EDITOR_ONLY.test(spec)),
    ).toHaveLength(5);
    // The kit: every entry but ./touch is the editor's, and a static import
    // of its scene or globe is told from an import() of them.
    expect(EDITOR_ONLY.test("gps-plus-slam-editor-kit/chrome")).toBe(true);
    expect(EDITOR_ONLY.test("gps-plus-slam-editor-kit/scene")).toBe(true);
    expect(EDITOR_ONLY.test("gps-plus-slam-editor-kit/globe")).toBe(true);
    expect(EDITOR_ONLY.test("gps-plus-slam-editor-kit")).toBe(true);
    expect(EDITOR_ONLY.test("gps-plus-slam-editor-kit/touch")).toBe(false);
    expect(EDITOR_ONLY.test("gps-plus-slam-editor-kit/touchy")).toBe(true);
    expect(EDITOR_ONLY.test("gps-plus-slam-editor-kits")).toBe(false);
    const kitSource = [
      'import { a } from "gps-plus-slam-editor-kit/chrome";',
      'export { b } from "gps-plus-slam-editor-kit/scene";',
      'const g = await import("gps-plus-slam-editor-kit/globe");',
    ].join("\n");
    expect(
      staticSpecifiers(kitSource).filter((spec) => KIT_LAZY.test(spec)),
    ).toEqual(["gps-plus-slam-editor-kit/scene"]);
    expect(
      importedSpecifiers(kitSource).filter((spec) => KIT_LAZY.test(spec)),
    ).toHaveLength(2);
    // The whole OSM package, not only its geoid table: no part of it is
    // a visitor's yet, and a part is carved out only with a reason.
    expect(EDITOR_ONLY.test("gps-plus-slam-osm")).toBe(true);
    expect(EDITOR_ONLY.test("gps-plus-slam-osm/tiles")).toBe(true);
    expect(EDITOR_ONLY.test("gps-plus-slam-osmosis")).toBe(false);
    expect(EDITOR_ONLY.test("gps-plus-slam-globetrotter")).toBe(false);
  });
});
