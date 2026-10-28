// Why this test matters: the framework's package.json advertises wildcard
// subpaths (`./utils/*` → `./dist/utils/*.js`), but tsdown builds only the
// files listed as entries in `config/tsdown.config.ts`. A deep import of a
// module that is not an entry therefore resolves under `tsc` and `vitest`
// (both read the TypeScript source through the workspace link) and FAILS in
// the browser, where Vite looks for the dist file. That split is invisible to
// every cheap stage of the gate: on 2026-09-04 the recorder's new import of
// `gps-plus-slam-app-framework/utils/median` passed typecheck, lint and 2 131
// unit tests, and broke every recorder e2e 26 minutes into the cascade. This
// guard fails in seconds instead.
//
// Scope: every `*/src/**.ts` tracked by git (tests included — a test that
// deep-imports a non-entry passes today and misleads the next reader into
// copying the import into production). The import must be an entry, OR the
// barrel of a directory whose `index.ts` is an entry.
import { describe, expect, it } from 'vitest';

import { readTracked, trackedFiles } from './tracked-tree.js';

const PACKAGE = 'gps-plus-slam-app-framework';
const CONFIG = 'GpsPlusSlamJs_AppFramework/config/tsdown.config.ts';

/** Subpaths the build produces: `src/utils/median.ts` → `utils/median`, `src/ar/index.ts` → `ar`. */
function builtSubpaths() {
  const config = readTracked(CONFIG)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const out = new Set();
  for (const [, entry] of config.matchAll(/'src\/([^']+)\.ts'/g)) {
    out.add(entry.replace(/\/index$/, ''));
  }
  return out;
}

function sourceFiles() {
  return trackedFiles('*/src/**.ts')
    .filter((file) => !file.startsWith('GpsPlusSlamJs_AppFramework/'));
}

/**
 * Every `from '<pkg>/<subpath>'` / `import('<pkg>/<subpath>')` /
 * `vi.mock('<pkg>/<subpath>')` in `source`, comments stripped — a comment
 * naming a retired path is history, not an import (one test file records the
 * stale mock this guard would otherwise flag it for).
 */
function deepImports(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  const re = new RegExp(`['"]${PACKAGE}(?:/([^'"]+))?['"]`, 'g');
  const out = new Set();
  for (const [, sub] of code.matchAll(re)) {
    out.add(sub ?? 'index');
  }
  return out;
}

describe('framework deep imports are built entrypoints', () => {
  const built = builtSubpaths();

  it('finds the entry list AND the consumer imports (so the guard is not vacuous)', () => {
    expect(built.has('index')).toBe(true);
    expect(built.has('utils/bearing-degrees')).toBe(true);
    // The other half (PR #411 review): if the git pathspec ever stops
    // matching, the offenders check below passes with nothing examined.
    // Pin that the scan sees a real number of files and of deep imports.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    const imports = files.flatMap((f) => {
      try {
        return [...deepImports(readTracked(f))];
      } catch {
        return [];
      }
    });
    expect(imports.length).toBeGreaterThan(50);
  });

  it('every module the framework CHANGELOG advertises as a deep import is a built subpath', () => {
    // The consumer scan above cannot see an advertised module that no in-repo
    // app imports yet: `visualization/wayfinding-targets` shipped in the
    // CHANGELOG's Added list with no tsdown entry and no consumer, so the
    // guard was green while a consumer following the CHANGELOG would have
    // hit a resolution failure (PR #412 review). The CHANGELOG marks such
    // modules "(deep import)"; each must be an entry.
    const changelog = readTracked('GpsPlusSlamJs_AppFramework/CHANGELOG.md');
    const advertised = [
      ...changelog.matchAll(/\*\*`([A-Za-z0-9_./-]+)`\*\* \(deep import/g),
    ].map(([, sub]) => sub);
    // Every mention of a deep import in the file must have been captured, or
    // an entry written in other words ("is now a built deep-import entry",
    // PR #417 review) would silently leave its module unguarded while the
    // marker-form entries keep this green (milestone review, 2026-09-05).
    // Anchored on a word boundary: "deep-importable", "deep-imported",
    // "deep-imports", "deep-importing" are prose about a family or a
    // consumer, not an entry, and an exclusion list that grew one suffix per
    // review round (#420, #421) could never be complete. A mismatch names
    // every mention with its context (60 characters each side: the longest
    // marker-form path is 40, and a window of exactly 40 cut off the
    // leading `**` — PR #421 review), so the offending line is in the
    // failure rather than a bare "expected 3 to be 4".
    const mentioned = [...changelog.matchAll(/deep[ -]import\b/gi)].map((m) =>
      changelog
        .slice(Math.max(0, m.index - 60), m.index + 60)
        .replace(/\s+/g, ' ')
    );
    expect(
      mentioned.length,
      `every deep-import mention must be a marker-form entry (**\`path\`** (deep import)); mentions:\n  ${mentioned.join('\n  ')}`
    ).toBe(advertised.length);
    expect(advertised.length).toBeGreaterThan(0);
    const missing = advertised.filter((sub) => !built.has(sub));
    expect(
      missing,
      `advertised as deep imports in CHANGELOG.md but not entries in ${CONFIG}: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('every module the framework CHANGELOG introduces as "new `dir/module`" is a built subpath', () => {
    // The marker form above is opt-in: an entry that named its module as
    // "new `ar/xr-select-listener`" without the marker escaped it, and that
    // module shipped with no tsdown entry - a consumer following the
    // CHANGELOG's own words would have hit a resolution failure in the
    // browser while every check stayed green. A new module named with its
    // directory is a subpath a consumer will import, so it must be built.
    // Every phrasing the CHANGELOG uses: "new `x/y`", "New: `x/y`" and
    // "(new, `x/y`)".
    const changelog = readTracked('GpsPlusSlamJs_AppFramework/CHANGELOG.md');
    const introduced = [
      ...changelog.matchAll(/\bnew\b[,:]?\s+`([a-z0-9_-]+\/[A-Za-z0-9_./-]+)`/gi),
    ].map(([, sub]) => sub);
    // Five when this pattern was set (2026-10-28): fewer means the scan
    // lost a phrasing, not that the CHANGELOG lost entries.
    expect(introduced.length, "the scan must see the CHANGELOG's new modules").toBeGreaterThanOrEqual(5);
    const missing = introduced.filter((sub) => !built.has(sub));
    expect(
      missing,
      `introduced as new modules in CHANGELOG.md but not entries in ${CONFIG}: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('every framework module the globe lab loads by page path is a built subpath', () => {
    // The globe lab is a no-build page: it loads framework modules by page
    // path (`/fw/visualization/atmosphere/cloud-layer.js`, served from the
    // framework's source), so the consumer scan below never sees them. Its
    // code is moving into the typed Globe package, which a Vite app bundles
    // through the PUBLISHED framework, where only built entries resolve: a
    // lab module that is not an entry would break that app in the browser
    // the day it moves (15 of them did on 2026-10-27). Lab tests count too,
    // for the reason the consumer scan includes tests.
    const PAGE_PATH = /["']\/fw\/([A-Za-z0-9_./-]+)\.js["']/g;
    const files = trackedFiles(
      'GpsPlusSlamJs_DesignSystem/labs/globe/',
      'GpsPlusSlamJs_Globe/src/'
    ).filter((file) => /\.(m?js|ts|html)$/.test(file));
    const loaded = new Set();
    for (const file of files) {
      let source;
      try {
        source = readTracked(file);
      } catch {
        continue; // deleted but not yet staged - defines no imports
      }
      for (const [, sub] of source.matchAll(PAGE_PATH)) {
        loaded.add(sub.replace(/\/index$/, ''));
      }
    }
    // Twenty-two distinct modules when this was set (2026-10-28): far
    // fewer means the scan lost the lab, not that the lab lost imports.
    expect(loaded.size, "the scan must see the globe lab's framework modules").toBeGreaterThanOrEqual(15);
    const missing = [...loaded].filter((sub) => !built.has(sub)).sort();
    expect(
      missing,
      `the globe lab loads these framework modules, but they are not entries in ${CONFIG}:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('every consumer import of the framework names a built subpath', () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      let source;
      try {
        source = readTracked(file);
      } catch {
        continue; // deleted but not yet staged — defines no imports
      }
      for (const sub of deepImports(source)) {
        if (!built.has(sub)) offenders.push(`${file} → ${PACKAGE}/${sub}`);
      }
    }
    expect(
      offenders,
      `these imports resolve under tsc/vitest but NOT in the browser — add the module to ${CONFIG}:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
