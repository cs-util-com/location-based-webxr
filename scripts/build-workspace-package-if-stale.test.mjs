// Why this test matters: build-workspace-package-if-stale.mjs SKIPS a build the e2e
// suites depend on. A wrong "fresh" verdict means Playwright tests run
// against a stale framework dist — the documented "consumers resolve through
// built dist" footgun — so the decision function must fail open in every
// ambiguous case.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildInputs,
  decideBuild,
  isBuildRequired,
} from './build-workspace-package-if-stale.mjs';

describe('isBuildRequired', () => {
  it('builds when dist is missing/empty (null output mtime)', () => {
    expect(isBuildRequired(1000, null)).toBe(true);
  });

  it('builds when inputs could not be determined (null input mtime)', () => {
    expect(isBuildRequired(null, 1000)).toBe(true);
    expect(isBuildRequired(null, null)).toBe(true);
  });

  it('builds when the newest input is newer than the oldest dist file', () => {
    expect(isBuildRequired(2000, 1000)).toBe(true);
  });

  it('builds on exact mtime ties (partial-build ambiguity fails open)', () => {
    expect(isBuildRequired(1000, 1000)).toBe(true);
  });

  it('skips only when every dist file is strictly newer than every input', () => {
    expect(isBuildRequired(1000, 1001)).toBe(false);
  });

  it('property: never skips unless both mtimes exist and dist is strictly newer', () => {
    fc.assert(
      fc.property(
        fc.option(fc.nat(), { nil: null }),
        fc.option(fc.nat(), { nil: null }),
        (input, output) => {
          const required = isBuildRequired(input, output);
          if (!required) {
            expect(input).not.toBeNull();
            expect(output).not.toBeNull();
            expect(/** @type {number} */ (output)).toBeGreaterThan(
              /** @type {number} */ (input)
            );
          }
        }
      )
    );
  });
});

// Why this test matters (gate-speed plan 2026-10-04, milestone review R8):
// tsdown builds with the package's `tsconfig.app.json` and its own config,
// so a change there changes `dist` as surely as a source edit. The check
// watched only `src/`, `config/` and `package.json`, so an edited
// `tsconfig.app.json` left a stale `dist` in place, the false green G2 exists
// to prevent. Real temp packages with fixed mtimes; no clock.
describe('decideBuild (the inputs it watches)', () => {
  const OLD = new Date(1_700_000_000_000);
  const MID = new Date(1_700_000_100_000);
  const NEW = new Date(1_700_000_200_000);

  /** A package whose inputs are OLD and whose dist is MID: fresh. */
  function freshPackage() {
    const dir = mkdtempSync(path.join(tmpdir(), 'build-if-stale-'));
    const files = {
      'src/index.ts': 'export const a = 1;\n',
      'config/tsdown.config.ts': 'export default {};\n',
      'package.json': '{}\n',
      'tsconfig.app.json': '{}\n',
      'tsconfig.json': '{}\n',
      'dist/index.mjs': 'export const a = 1;\n',
    };
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
      const at = rel.startsWith('dist/') ? MID : OLD;
      utimesSync(path.join(dir, rel), at, at);
    }
    return dir;
  }

  it('skips a package whose dist is newer than every input', () => {
    expect(decideBuild(freshPackage()).required).toBe(false);
  });

  it('builds when tsconfig.app.json changed after the last build', () => {
    const dir = freshPackage();
    utimesSync(path.join(dir, 'tsconfig.app.json'), NEW, NEW);
    expect(decideBuild(dir).required).toBe(true);
  });

  it('builds when any root tsconfig*.json changed', () => {
    const dir = freshPackage();
    utimesSync(path.join(dir, 'tsconfig.json'), NEW, NEW);
    expect(decideBuild(dir).required).toBe(true);
  });

  it('builds when a root tsdown config changed', () => {
    const dir = freshPackage();
    writeFileSync(path.join(dir, 'tsdown.config.ts'), 'export default {};\n');
    utimesSync(path.join(dir, 'tsdown.config.ts'), NEW, NEW);
    expect(decideBuild(dir).required).toBe(true);
  });

  it('still builds on a source change (the original inputs)', () => {
    const dir = freshPackage();
    utimesSync(path.join(dir, 'src/index.ts'), NEW, NEW);
    expect(decideBuild(dir).required).toBe(true);
  });

  it('lists the inputs it watches', () => {
    const inputs = buildInputs(freshPackage()).map((p) => path.basename(p));
    expect(inputs).toEqual(
      expect.arrayContaining(['src', 'config', 'package.json', 'tsconfig.app.json', 'tsconfig.json'])
    );
  });
});
