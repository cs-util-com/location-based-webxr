// Repo-meta test: every package a PUBLISHED file of the app framework
// imports at run time is declared to the consumer - as a dependency or a
// peer dependency - never only as a dev dependency.
//
// WHY THIS EXISTS. The framework publishes its `dist/` whole, including the
// `test-utils/*` subpath that consumers' tests import. Its
// `test-utils/tour-arbitraries.js` imports `fast-check`, which was declared
// only under `devDependencies`: a consumer importing that subpath without
// fast-check installed failed at import (PR-bot finding 10 on webxr r954,
// 2026-10-27). A dev dependency is invisible to whoever installs the
// package, so nothing but a check like this one sees the gap. Writing this
// check found the same gap for `vitest` (`test-utils/browser-mocks.js`).
//
// WHY THEY ARE OPTIONAL PEERS, NOT DEPENDENCIES. Only the test-utils
// subpath uses them; an app that never imports test helpers must not get a
// test runner in its install. That is the shape of `leaflet` and
// `@sentry/browser`: optional peers, needed only by the subpaths that use
// them. The last test pins that fast-check stays confined to
// `src/test-utils/`, which is what makes "optional" true.
//
// WHAT IT CANNOT SEE. It reads static `import ... from "x"` and
// `import("x")` in the published `src/` files, not `dist/`; a dependency
// the bundler inlines or a `require` would pass. Type-only imports are
// skipped (erased at run time). A test helper counts as published only
// when the build config names it as an entry.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(here, '../../GpsPlusSlamJs_AppFramework');
const SRC = path.join(PKG_DIR, 'src');
const TSDOWN = readFileSync(path.join(PKG_DIR, 'config/tsdown.config.ts'), 'utf8');

/** Every published `.ts` file under `dir`, as paths relative to `src/`
 *  with forward slashes: tests, benches and declarations left out, and a
 *  test helper only when the build names it as an entry (`TSDOWN`). */
function publishedFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...publishedFiles(full));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !/\.(test|spec|bench)\.ts$/.test(entry.name)
    ) {
      const rel = path.relative(SRC, full).split(path.sep).join('/');
      if (!rel.startsWith('test-utils/') || TSDOWN.includes(`'src/${rel}'`)) {
        out.push(rel);
      }
    }
  }
  return out;
}

/** The package names `source` imports at run time (bare specifiers only). */
function runtimePackages(source) {
  const names = new Set();
  // Comments out first: a doc comment may say "import ... from".
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const specifier =
    /(?:^|\n)\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(specifier)) {
    const spec = match[1] ?? match[2];
    if (spec === undefined || spec.startsWith('.') || spec.startsWith('node:')) {
      continue;
    }
    const parts = spec.split('/');
    names.add(spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
  return names;
}

const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  pkg.name,
]);
const importers = new Map();
for (const file of publishedFiles(SRC)) {
  for (const name of runtimePackages(readFileSync(path.join(SRC, file), 'utf8'))) {
    importers.set(name, [...(importers.get(name) ?? []), file]);
  }
}

describe("the app framework's published imports", () => {
  it('reads the imports it checks (the scan is not vacuous)', () => {
    expect(importers.get('three')?.length ?? 0).toBeGreaterThan(0);
    expect(importers.get('fast-check')).toEqual(['test-utils/tour-arbitraries.ts']);
  });

  it('declares every package a published file imports as a dependency or a peer', () => {
    const undeclared = [...importers]
      .filter(([name]) => !declared.has(name))
      .map(([name, files]) => `${name} (imported by ${files.join(', ')})`);
    expect(undeclared).toEqual([]);
  });

  it('keeps fast-check and vitest optional peers, fast-check used only under src/test-utils/', () => {
    for (const name of ['fast-check', 'vitest']) {
      expect(pkg.peerDependencies?.[name], name).toBeDefined();
      expect(pkg.peerDependenciesMeta?.[name]?.optional, name).toBe(true);
    }
    expect(
      (importers.get('fast-check') ?? []).filter((f) => !f.startsWith('test-utils/')),
    ).toEqual([]);
  });

  // Why: a peer's floor is a promise that the test helpers work with that
  // version, and the only version the framework's own suite runs is its
  // dev dependency. A floor below it (vitest ">=3.0.0" while every test ran
  // on 5) promised versions nothing ever checked.
  it('promises the test peers only from the version its own tests run on', () => {
    const floor = (range) =>
      /^(?:>=|\^)(\d+)\.(\d+)\.(\d+)$/.exec(range ?? '')?.slice(1).map(Number);
    for (const name of ['fast-check', 'vitest']) {
      const peer = floor(pkg.peerDependencies?.[name]);
      const dev = floor(pkg.devDependencies?.[name]);
      expect(peer, `${name} peer range reads as a floor`).toBeDefined();
      expect(dev, `${name} dev range reads as a floor`).toBeDefined();
      expect(peer, `${name}: the peer floor is the dev dependency's floor`).toEqual(dev);
    }
  });
});
