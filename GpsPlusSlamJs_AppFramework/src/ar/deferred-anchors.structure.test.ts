/**
 * Structure guard for the deferred anchors.
 *
 * Why this test matters: the deferral works on scene objects only. Raw
 * tracking poses and every other value in the store stay untouched, so the
 * modules that move anchors must neither dispatch nor reach into the store's
 * slices; they read T through the parent binding alone. The release channel
 * is a plain signal between the code-lock path and the anchors, so it must
 * not pull in three.js either (the controller that raises it runs in tests
 * without a scene).
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

const ANCHOR_MOVERS = [
  'deferred-anchors.ts',
  'anchor-release.ts',
  'anchor-visibility.ts',
];

describe('deferred anchors: module structure', () => {
  for (const file of ANCHOR_MOVERS) {
    it(`${file} never dispatches and imports nothing from state/`, () => {
      const code = source(file);
      expect(code).not.toMatch(/\bdispatch\s*\(/);
      expect(importsOf(code).filter((p) => /(^|\/)state\//.test(p))).toEqual(
        []
      );
    });
  }

  it('anchor-release.ts does not import three', () => {
    expect(importsOf(source('anchor-release.ts'))).not.toContain('three');
  });

  // Control: the import reader finds imports at all.
  it('reads the imports of deferred-anchors.ts', () => {
    expect(importsOf(source('deferred-anchors.ts'))).toContain('three');
  });
});
