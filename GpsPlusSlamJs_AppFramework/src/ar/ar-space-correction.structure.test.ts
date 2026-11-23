/**
 * Structure guard for the AR-space correction and the anchors.
 *
 * Why this test matters: two layers move scene objects and each must read
 * only its own input, or a jump is applied twice. The correction registry
 * reads the correction track and never the GPS alignment; the anchors read
 * the alignment (through their parent binding) and never the correction.
 * Neither dispatches: every corrected value stays out of the recording.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..');
const source = (file: string): string =>
  readFileSync(resolve(here, file), 'utf8');
const importsOf = (code: string): string[] =>
  [...code.matchAll(/^\s*(?:import|export)[^'"]*['"]([^'"]+)['"]/gm)].map(
    (m) => m[1]!
  );

/**
 * Every source file reachable from `entry` through relative imports and
 * re-exports, as `src`-relative paths with forward slashes.
 */
function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (absolute: string): void => {
    if (seen.has(absolute)) return;
    seen.add(absolute);
    for (const spec of importsOf(readFileSync(absolute, 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      const base = resolve(dirname(absolute), spec.replace(/\.js$/, ''));
      const file = [`${base}.ts`, resolve(base, 'index.ts')].find(existsSync);
      if (file !== undefined) visit(file);
    }
  };
  visit(resolve(here, entry));
  return new Set([...seen].map((p) => relative(src, p).replace(/\\/g, '/')));
}

const ALIGNMENT_MODULES = /^state\/(app-selectors|ar-space-world)\.ts$/;

describe('AR-space correction: module structure', () => {
  const registry = source('ar-space-correction-registry.ts');
  const pure = source('ar-space-correction.ts');

  it('the registry never reads the GPS alignment and never dispatches', () => {
    expect(registry).not.toMatch(
      /selectAlignmentMatrix|selectArSpaceToWorld|arSpaceWorldPose|gpsData|app-selectors/
    );
    expect(registry).not.toMatch(/\bdispatch\s*\(/);
  });

  it('the content watcher never dispatches to the store', () => {
    // Why this test matters: the watcher reacts to scene events inside the
    // store notification; a dispatch from there would re-enter the bake.
    expect(source('ar-content-watcher.ts')).not.toMatch(/\bdispatch\s*\(/);
  });

  for (const entry of [
    'ar-space-correction-registry.ts',
    'ar-content-watcher.ts',
    '../state/ar-space-correction-slice.ts',
  ]) {
    it(`${entry} reaches neither the GPS alignment nor the composed selectors through any import`, () => {
      // A direct-import check misses a helper that imports the alignment in
      // turn; the whole relative-import closure must stay free of it.
      const closure = [...importClosure(entry)];
      expect(closure.length).toBeGreaterThan(1);
      expect(closure.filter((p) => ALIGNMENT_MODULES.test(p))).toEqual([]);
    });
  }

  // Control: the closure walker finds the alignment where it is used.
  it('the composed selectors module does reach the alignment', () => {
    expect(
      [...importClosure('../state/ar-space-world.ts')].filter((p) =>
        ALIGNMENT_MODULES.test(p)
      )
    ).toEqual(['state/ar-space-world.ts', 'state/app-selectors.ts']);
  });

  it('the pure math imports neither three.js nor the store', () => {
    const imports = importsOf(pure);
    expect(imports).not.toContain('three');
    expect(imports.filter((p) => /(^|\/)state\//.test(p))).toEqual([]);
  });

  for (const file of [
    'deferred-anchors.ts',
    '../visualization/gps-anchor.ts',
  ]) {
    it(`${file} never reads the correction`, () => {
      expect(
        importsOf(source(file)).filter((p) => /ar-space-correction/.test(p))
      ).toEqual([]);
    });
  }

  // Control: the import reader finds imports at all.
  it('reads the imports of the registry', () => {
    expect(importsOf(registry)).toContain('three');
  });
});
