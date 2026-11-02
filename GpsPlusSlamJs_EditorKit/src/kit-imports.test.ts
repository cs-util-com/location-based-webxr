/**
 * The kit's own import rule: its four entries stack, each reaching only
 * those below it.
 *
 * Why this test matters: an app's page loads a kit entry and everything it
 * imports. `./touch` is shared with a visitor's page, `./chrome` loads at
 * once on the editor's page, `./scene` and `./globe` bring three and the
 * globe and load only by `import()`. One import from a lower entry into a
 * higher one would put the higher entry's weight on every page of the
 * lower, and the apps' guards (the Tour Viewer's
 * `editor-only-packages.test.ts`, `editor3d-lazy.test.ts`) would catch it
 * only in an app that happens to use that path. So every module's relative
 * AND package imports are read here: package names alone would let a
 * relative `../globe/` import through, and the kit's own name would let a
 * module reach any entry without a relative path at all.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/** The kit's entry folders, lowest first: each may import only from its
 *  own folder and those before it. */
const ENTRIES = ["touch", "chrome", "scene", "globe"] as const;

/** The packages only `src/globe/` may name. */
const GLOBE_ONLY =
  /^(?:gps-plus-slam-globe|3d-tiles-renderer|gps-plus-slam-osm)(?:\/|$)/;

/** three, which neither `touch` nor `chrome` may name. */
const THREE = /^three(?:\/|$)/;

/** The kit's own name: its modules import each other by relative path. */
const SELF = /^gps-plus-slam-editor-kit(?:\/|$)/;

/** Every specifier `source` imports or re-exports, static or dynamic
 *  (type-only imports included: a type import still names the module). */
function importedSpecifiers(source: string): string[] {
  const patterns = [
    /^\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return patterns.flatMap((re) =>
    [...source.matchAll(re)].map((match) => match[1]!),
  );
}

/** The production modules under `dir`, as `src/`-relative paths with `/`
 *  (tests, declarations and test helpers left out). */
function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "test-utils" ? [] : productionFiles(path);
    }
    return name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".d.ts")
      ? [relative(SRC, path).replaceAll("\\", "/")]
      : [];
  });
}

/** The entry folder a `src/`-relative path belongs to, or null. */
function entryOf(file: string): string | null {
  const top = file.split("/")[0];
  return top !== undefined && (ENTRIES as readonly string[]).includes(top)
    ? top
    : null;
}

/** What is wrong with `file` (in entry `from`) importing the relative
 *  `spec`, or null. */
function relativeViolation(
  file: string,
  from: string,
  spec: string,
): string | null {
  const target = posix.normalize(posix.join(posix.dirname(file), spec));
  const to = entryOf(target);
  if (to === null) return `${file} imports ${spec}, outside the entries`;
  if (ENTRIES.indexOf(to as never) > ENTRIES.indexOf(from as never)) {
    return `${file} (${from}) imports ${spec} (${to})`;
  }
  return null;
}

/** What is wrong with `file` (`src/`-relative) importing `spec`, or null. */
function violation(file: string, spec: string): string | null {
  const from = entryOf(file);
  if (from === null) return `${file} sits in no entry folder`;
  if (SELF.test(spec)) return `${file} imports the kit by name (${spec})`;
  if (spec.startsWith(".")) return relativeViolation(file, from, spec);
  if (GLOBE_ONLY.test(spec) && from !== "globe") {
    return `${file} (${from}) imports ${spec}`;
  }
  if (THREE.test(spec) && (from === "touch" || from === "chrome")) {
    return `${file} (${from}) imports ${spec}`;
  }
  return null;
}

describe("the kit's import rule", () => {
  it("holds for every production module", () => {
    const files = productionFiles(SRC);
    // The rule can see the kit's modules at all.
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) => {
      const specs = importedSpecifiers(readFileSync(join(SRC, file), "utf8"));
      const found = specs.map((spec) => violation(file, spec));
      const placed = entryOf(file) === null ? [violation(file, "")] : [];
      return [...placed, ...found].filter((v): v is string => v !== null);
    });
    expect([...new Set(offenders)]).toEqual([]);
  });

  // Why: the rule is only as good as these cases; each is a way a module
  // could break the stacking, read in every import form.
  it("tells each way of breaking it", () => {
    const bad: [string, string][] = [
      ["touch/a.ts", "../chrome/menu.js"],
      ["touch/a.ts", "../scene/b.js"],
      ["chrome/a.ts", "../scene/b.js"],
      ["chrome/a.ts", "../globe/b.js"],
      ["chrome/a.ts", "three"],
      ["touch/a.ts", "three/examples/jsm/x.js"],
      ["scene/a.ts", "../globe/b.js"],
      ["scene/a.ts", "gps-plus-slam-globe/editor"],
      ["chrome/a.ts", "3d-tiles-renderer"],
      ["scene/a.ts", "gps-plus-slam-osm/elevation/egm96"],
      ["chrome/a.ts", "gps-plus-slam-editor-kit/touch"],
      ["chrome/a.ts", "../kit-imports.js"],
      ["a.ts", "./b.js"],
    ];
    for (const [file, spec] of bad) {
      expect(violation(file, spec), `${file} -> ${spec}`).not.toBeNull();
    }
    const good: [string, string][] = [
      ["chrome/a.ts", "./b.js"],
      ["chrome/a.ts", "../touch/b.js"],
      ["scene/a.ts", "three"],
      ["scene/a.ts", "../chrome/b.js"],
      ["globe/a.ts", "../scene/b.js"],
      ["globe/a.ts", "gps-plus-slam-globe/editor"],
      ["globe/a.ts", "3d-tiles-renderer/plugins"],
      ["chrome/a.ts", "gps-plus-slam-app-framework/storage"],
      ["chrome/a.ts", "threejs-like-name"],
    ];
    for (const [file, spec] of good) {
      expect(violation(file, spec), `${file} -> ${spec}`).toBeNull();
    }
    expect(
      importedSpecifiers(
        [
          'import { a } from "../scene/a.js";',
          'import type { B } from "three";',
          'export * from "../globe/b.js";',
          'import "./side-effect.js";',
          'const m = await import("../globe/c.js");',
        ].join("\n"),
      ),
    ).toHaveLength(5);
  });
});
