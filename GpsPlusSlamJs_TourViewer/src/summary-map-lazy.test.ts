/**
 * Visitors never load Leaflet (authoring plan 2026-09-28-0953 §3.3 and §7
 * #18, milestone M3b).
 *
 * Why this test matters: the summary map is the only thing in the Tour
 * Viewer that needs Leaflet, and only a creator reaches it, after a
 * Finish. A visitor scanning a printed code on a phone must not pay for a
 * map library they never see. One static import anywhere on the page's
 * module graph - of Leaflet, of the framework's map modules, of the
 * visualization barrel, or of the map view itself - would put it into the
 * main bundle silently, and every test would still pass. So the graph is
 * read here: `summary-map-view.ts` is the only Tour Viewer module that
 * imports any of it, it is reached only through `import()`, and no
 * framework module the page imports statically reaches Leaflet either,
 * however deep. The Playwright suite checks the same from the network
 * side (no Leaflet request in the visitor flow).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_SRC = resolve(SRC, "../../GpsPlusSlamJs_AppFramework/src");
const LAZY = "summary-map-view.ts";
const FRAMEWORK = "gps-plus-slam-app-framework";

/** Static, value imports of `source` (type-only imports are erased; a
 *  dynamic `import()` is not static). */
function staticImports(source: string): string[] {
  const out: string[] = [];
  const re =
    /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const match of source.matchAll(re)) out.push(match[1]!);
  return out;
}

function productionFiles(): string[] {
  return readdirSync(SRC).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
  );
}

/** A framework subpath (`visualization/map-data`) as its source file. */
function frameworkFile(subpath: string): string | null {
  for (const candidate of [
    join(FRAMEWORK_SRC, `${subpath}.ts`),
    join(FRAMEWORK_SRC, subpath, "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Whether `file` (a framework source) reaches Leaflet through static
 *  imports; the path that does, for the message. */
function reachesLeaflet(
  file: string,
  seen = new Set<string>(),
): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  for (const spec of staticImports(readFileSync(file, "utf8"))) {
    if (spec === "leaflet" || spec.startsWith("leaflet/")) return [file];
    if (!spec.startsWith(".")) continue;
    const next = resolve(dirname(file), spec.replace(/\.js$/, ".ts"));
    const target = existsSync(next)
      ? next
      : existsSync(join(next.replace(/\.ts$/, ""), "index.ts"))
        ? join(next.replace(/\.ts$/, ""), "index.ts")
        : null;
    if (target === null) continue;
    const path = reachesLeaflet(target, seen);
    if (path !== null) return [file, ...path];
  }
  return null;
}

describe("the Tour Viewer's page never statically loads Leaflet", () => {
  it("imports Leaflet and the map modules only in the map view", () => {
    const offenders = productionFiles()
      .filter((f) => f !== LAZY)
      .flatMap((f) =>
        staticImports(readFileSync(join(SRC, f), "utf8"))
          .filter(
            (spec) =>
              spec === "leaflet" ||
              spec.startsWith("leaflet/") ||
              spec === "./summary-map-view.js",
          )
          .map((spec) => `${f} -> ${spec}`),
      );
    expect(offenders).toEqual([]);
  });

  it("reaches the map view through a dynamic import", () => {
    const dynamic = productionFiles().filter((f) =>
      /import\(\s*["']\.\/summary-map-view\.js["']\s*\)/.test(
        readFileSync(join(SRC, f), "utf8"),
      ),
    );
    expect(dynamic).toEqual(["main.ts"]);
    // The guard must be able to see a static import at all.
    expect(staticImports(`import L from "leaflet";`)).toEqual(["leaflet"]);
    expect(staticImports(`import type { Map } from "leaflet";`)).toEqual([]);
    expect(staticImports(`import "leaflet/dist/leaflet.css";`)).toEqual([
      "leaflet/dist/leaflet.css",
    ]);
  });

  it("imports no framework module that reaches Leaflet, however deep", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const f of productionFiles()) {
      if (f === LAZY) continue;
      for (const spec of staticImports(readFileSync(join(SRC, f), "utf8"))) {
        if (!spec.startsWith(`${FRAMEWORK}/`)) {
          if (spec === FRAMEWORK) offenders.push(`${f} -> the package root`);
          continue;
        }
        const file = frameworkFile(spec.slice(FRAMEWORK.length + 1));
        if (file === null) continue;
        checked += 1;
        const path = reachesLeaflet(file);
        if (path !== null) offenders.push(`${f} -> ${path.join(" -> ")}`);
      }
    }
    expect(offenders).toEqual([]);
    // The walk must have run over real files, or it proves nothing.
    expect(checked).toBeGreaterThan(20);
    // And it must catch what it is for: the shell does reach Leaflet.
    expect(
      reachesLeaflet(frameworkFile("visualization/summary-map-shell")!),
    ).not.toBeNull();
  });
});
