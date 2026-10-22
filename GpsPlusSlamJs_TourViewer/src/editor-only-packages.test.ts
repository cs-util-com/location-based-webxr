/**
 * The 3D editor's heavy packages stay on the editor's pages.
 *
 * Why this test matters: the globe, the 3D tiles renderer and the geoid
 * table are megabytes a visitor scanning a printed code on a phone must
 * never download. One import of them from a module the visitor's or the
 * phone creator's page reaches would put them on that page silently, and
 * every other test would still pass. The dependency rules
 * (`config/.dependency-cruiser.cjs`) read only `src/` (`includeOnly`), so
 * an import of a PACKAGE is invisible to them; this scan holds that half:
 * no production module outside `src/editor/` and `src/editor3d/` names one
 * of these packages, statically or through `import()`. (That top-level
 * modules never import `src/editor3d/` itself is the dependency rules'.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/** The packages only the editor's pages may import, by specifier. */
const EDITOR_ONLY =
  /^(gps-plus-slam-globe|3d-tiles-renderer|gps-plus-slam-osm\/elevation\/egm96)(\/|$)/;

/** The folders whose modules may import them. */
const EDITOR_DIRS = ["editor", "editor3d"];

/** Every specifier `source` imports or re-exports, static or dynamic
 *  (type-only imports included: a rule about pages reads them too). */
function importedSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) out.push(match[1]!);
  }
  return out;
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
    expect(EDITOR_ONLY.test("gps-plus-slam-osm/tiles")).toBe(false);
    expect(EDITOR_ONLY.test("gps-plus-slam-globetrotter")).toBe(false);
  });
});
