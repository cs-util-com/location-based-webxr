/**
 * Structure guard for the AR-space correction and the anchors.
 *
 * Why this test matters: two layers move scene objects and each must read
 * only its own input, or a jump is applied twice. The correction registry
 * reads the correction track and never the GPS alignment; the anchors read
 * the alignment (through their parent binding) and never the correction.
 * Neither dispatches: every corrected value stays out of the recording.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = (file: string): string =>
  readFileSync(resolve(here, file), 'utf8');
const importsOf = (code: string): string[] =>
  [...code.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);

describe('AR-space correction: module structure', () => {
  const registry = source('ar-space-correction-registry.ts');
  const pure = source('ar-space-correction.ts');

  it('the registry never reads the GPS alignment and never dispatches', () => {
    expect(registry).not.toMatch(
      /selectAlignmentMatrix|selectArSpaceToWorld|arSpaceWorldPose|gpsData|app-selectors/
    );
    expect(registry).not.toMatch(/\bdispatch\s*\(/);
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
