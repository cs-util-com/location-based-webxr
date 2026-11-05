/**
 * The framework's licence activation (`src/test-setup.ts`) is no vitest
 * setup file for its unit tests: each test file that needs it imports it.
 *
 * Why this test matters: two ways of getting that wrong stay silent. A bench
 * without the activation is not red at all, because tinybench swallows the
 * licence error and reports empty samples, so the bench config must keep
 * listing it. And a test file that imports it after a module under test
 * passes until that module starts calling a licensed export while it loads,
 * so the import stays the file's first. A test file that forgets the import
 * altogether needs no guard: the library's own error fails it, and the
 * package's vitest config isolates files, so no earlier file can hide that.
 *
 * What it cannot see: a licensed export reached inside a test that expects a
 * throw. The licence error satisfies a bare `toThrow()`.
 */
import { describe, expect, it } from 'vitest';

import { readTracked, trackedFiles } from './tracked-tree.js';

const PACKAGE = 'GpsPlusSlamJs_AppFramework';
const SETUP = /^test-setup(\.[jt]s)?$/;
const IMPORT = /^\s*import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

/** The specifiers of a file's static imports, in source order. */
function importsOf(text) {
  return [...text.matchAll(IMPORT)].map((match) => match[1]);
}

function importsSetup(specifier) {
  return SETUP.test(specifier.split('/').at(-1) ?? '');
}

describe('importsOf', () => {
  // Why: the guard below reads every file through this; a regex that missed
  // a multi-line import would call a late setup import the first.
  it('reads side-effect, named and multi-line imports in order', () => {
    const text = [
      "import '../test-setup';",
      "import { a,\n  b } from './b.js';",
      "import type { C } from './c.js';",
    ].join('\n');
    expect(importsOf(text)).toEqual(['../test-setup', './b.js', './c.js']);
  });
});

describe('the framework licence setup', () => {
  it('is the first import of every test file that imports it', () => {
    const files = trackedFiles(`${PACKAGE}/src`).filter((f) => f.endsWith('.test.ts'));
    const users = files.filter((f) => importsOf(readTracked(f)).some(importsSetup));
    expect(users.length, 'the guard found the files it is about').toBeGreaterThan(0);
    const late = users.filter((f) => !importsSetup(importsOf(readTracked(f))[0] ?? ''));
    expect(late).toEqual([]);
  });

  it('stays a setup file of the bench config', () => {
    const config = readTracked(`${PACKAGE}/config/vitest.bench.config.ts`);
    expect(config).toMatch(/setupFiles:\s*\[[^\]]*src\/test-setup\.ts/);
  });
});
