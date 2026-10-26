/**
 * Why this test matters: `tour-arbitraries` is built and shipped so the
 * Tour Viewer's tests can generate tours with the framework's own
 * generators. fast-check is only a dev dependency here, and the bundler
 * inlines a dev dependency unless told not to - which would ship a private
 * copy of fast-check in `dist/`, a second fast-check in every consumer's
 * test run (two `fc.Arbitrary` classes that do not mix with the consumer's
 * own) and tens of kilobytes nobody asked for. This builds that one entry
 * with the package's real dependency settings and asserts the output
 * imports fast-check by name and carries none of its code.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build, type UserConfig } from 'tsdown';
import { afterAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = mkdtempSync(join(tmpdir(), 'tour-arbitraries-bundle-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function builtCode(): string {
  return readdirSync(outDir, { recursive: true })
    .map(String)
    .filter((f) => /\.m?js$/.test(f))
    .map((f) => readFileSync(join(outDir, f), 'utf8'))
    .join('\n');
}

describe('the built tour arbitraries', () => {
  it('import fast-check from the consumer and inline no copy of it', async () => {
    // Loaded by path: the build config is outside the test project's
    // type-checked files.
    const loaded = (await import(
      pathToFileURL(resolve(projectRoot, 'config/tsdown.config.ts')).href
    )) as { default: UserConfig };
    const shared = loaded.default;
    // The package's own settings, with only this one entry, no type
    // declarations (slow, and not what is checked) and a scratch folder.
    await build({
      ...shared,
      config: false,
      cwd: projectRoot,
      entry: [resolve(projectRoot, 'src/test-utils/tour-arbitraries.ts')],
      dts: false,
      outDir,
      logLevel: 'silent',
    });
    const code = builtCode();
    expect(code).toMatch(/from\s*["']fast-check["']/);
    // Strings from fast-check's own sources: present only when inlined.
    // (Both are in fast-check 4's built output, checked against a build
    // that inlined it.)
    expect(code).not.toContain('Property failed after');
    expect(code).not.toContain('not an instance of Arbitrary');
    expect(code.length).toBeLessThan(100_000);
  });
});
