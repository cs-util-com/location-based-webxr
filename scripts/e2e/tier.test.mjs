// Why these tests matter: the per-PR browser tier runs only the tests tagged
// `@pr`, so every way it could select the wrong set is a silent loss of
// checks: a tier value nobody meant (a typo that runs the full set, or one
// that runs nothing), a changed spec that does not run whole, a developer's
// own file filter that the tier quietly narrows, a tier run recording a
// timing row as if it were the suite, and above all an empty selection that
// passes. The last one is proven against Playwright itself, because the
// "No tests found" failure is Playwright's behaviour, not this module's.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  DEVELOPER_FILTER_ENV,
  TIER_BASE_ENV,
  TIER_ENV,
  changedSpecNames,
  developerSelected,
  e2eTier,
  passesEmpty,
  playwrightGrep,
  tierGrep,
  tierRetries,
  tierStageRun,
} from './tier.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** @param {RegExp[] | undefined} grep @param {string} line */
const selects = (grep, line) => grep === undefined || grep.some((re) => re.test(line));

describe('e2eTier', () => {
  it('defaults to the per-PR tier and accepts the two names', () => {
    expect(e2eTier({})).toBe('pr');
    expect(e2eTier({ [TIER_ENV]: '' })).toBe('pr');
    expect(e2eTier({ [TIER_ENV]: 'pr' })).toBe('pr');
    expect(e2eTier({ [TIER_ENV]: 'full' })).toBe('full');
  });

  it('refuses any other value, so a typo never picks a tier by accident', () => {
    for (const value of ['Full', 'all', 'pr ', '1']) {
      expect(() => e2eTier({ [TIER_ENV]: value }), value).toThrow(RangeError);
    }
  });
});

describe('tierRetries', () => {
  it('retries once in the tier and twice in the full set on CI, and keeps the local count', () => {
    expect(tierRetries({ CI: '1' })).toBe(1);
    expect(tierRetries({ CI: '1', [TIER_ENV]: 'full' })).toBe(2);
    expect(tierRetries({})).toBe(0);
    expect(tierRetries({ [TIER_ENV]: 'full' }, 1)).toBe(1);
  });
});

describe('tierGrep', () => {
  // The string Playwright greps: project, file, describe titles, title, tags.
  const line = (file, title) => `webgl ${file} ${title}`;

  it('selects the tagged tests in the tier and everything in the full set', () => {
    const grep = tierGrep({}, []);
    expect(selects(grep, line('a.spec.js', 'opens @pr'))).toBe(true);
    expect(selects(grep, line('a.spec.js', 'opens'))).toBe(false);
    expect(selects(grep, line('a.spec.js', 'about @prices'))).toBe(false);
    expect(tierGrep({ [TIER_ENV]: 'full' }, ['a.spec.js'])).toBeUndefined();
  });

  it('runs a changed spec whole, and only that file (not one it is a suffix of)', () => {
    const grep = tierGrep({}, ['stations.spec.js']);
    expect(selects(grep, line('stations.spec.js', 'untagged'))).toBe(true);
    expect(selects(grep, line('sub\\stations.spec.js', 'untagged'))).toBe(true);
    expect(selects(grep, line('labs/x/stations.spec.js', 'untagged'))).toBe(true);
    expect(selects(grep, line('creator-stations.spec.js', 'untagged'))).toBe(false);
    expect(selects(grep, line('stations.spec.jsx', 'untagged'))).toBe(false);
  });
});

describe('changedSpecNames', () => {
  it("keeps the package's own spec files, by name", () => {
    const paths = [
      'GpsPlusSlamJs_TourViewer/playwright-tests/editor.spec.js',
      'GpsPlusSlamJs_TourViewer/src/editor/x.ts',
      'GpsPlusSlamJs_OsmDemo/playwright-tests/scene-3d.spec.js',
      'GpsPlusSlamJs_DesignSystem/labs/globe/globe-city.smoke.spec.mjs',
      'GpsPlusSlamJs_TourViewer\\playwright-tests\\stations.spec.js',
    ];
    expect(changedSpecNames(paths, 'GpsPlusSlamJs_TourViewer')).toEqual([
      'editor.spec.js',
      'stations.spec.js',
    ]);
    expect(changedSpecNames(paths, 'GpsPlusSlamJs_DesignSystem')).toEqual([
      'globe-city.smoke.spec.mjs',
    ]);
  });
});

describe('developerSelected', () => {
  const argv = (...args) => ['node', 'cli.js', 'test', ...args];

  it('reads a file filter or a grep on the command line as a developer selection', () => {
    expect(developerSelected(argv('editor.spec.js'), {})).toBe(true);
    expect(developerSelected(argv('--config', 'x.config.js', 'editor.spec.js'), {})).toBe(true);
    expect(developerSelected(argv('-g', 'saves'), {})).toBe(true);
    expect(developerSelected(argv('--grep=saves'), {})).toBe(true);
    expect(developerSelected(argv('--last-failed'), {})).toBe(true);
  });

  it('does not read option values or the gate flags as a selection', () => {
    expect(developerSelected(argv('--config', 'x.config.js'), {})).toBe(false);
    expect(
      developerSelected(
        argv('--config=x.js', '--reporter=list,json', '--workers', '1', '--project', 'dom'),
        {},
      ),
    ).toBe(false);
    expect(developerSelected(['node', 'worker.js'], {})).toBe(false);
  });

  it("trusts the runner's own word over the command line it built", () => {
    const specs = argv('--config', 'x.js', '[\\\\/]editor\\.spec\\.js$');
    expect(developerSelected(specs, { [DEVELOPER_FILTER_ENV]: '0' })).toBe(false);
    expect(developerSelected(argv('--config', 'x.js'), { [DEVELOPER_FILTER_ENV]: '1' })).toBe(true);
  });
});

describe('tierStageRun', () => {
  it('marks a Playwright stage in the tier as one that records no timing row', () => {
    expect(tierStageRun({ counts: 'playwright' }, {})).toBe(true);
    expect(tierStageRun({ counts: 'playwright' }, { [TIER_ENV]: 'full' })).toBe(false);
    expect(tierStageRun({ counts: 'vitest' }, {})).toBe(false);
    expect(tierStageRun({ counts: null }, {})).toBe(false);
  });
});

describe('passesEmpty', () => {
  it('lets only a developer filter or an area-narrowed tier run select nothing', () => {
    expect(passesEmpty({ developerFiltered: true, narrowed: false, env: {} })).toBe(true);
    expect(passesEmpty({ developerFiltered: false, narrowed: true, env: {} })).toBe(true);
    expect(passesEmpty({ developerFiltered: false, narrowed: false, env: {} })).toBe(false);
    expect(
      passesEmpty({ developerFiltered: false, narrowed: true, env: { [TIER_ENV]: 'full' } }),
    ).toBe(false);
  });
});

describe('playwrightGrep', () => {
  const configUrl = pathToFileURL(
    path.join(ROOT, 'GpsPlusSlamJs_TourViewer/playwright-tests/x.config.js'),
  ).href;
  const argv = ['node', 'cli.js', 'test'];

  it("adds the changed specs against the gate's ref, else the CI base, and caches the answer", () => {
    /** @type {string[]} */
    const refs = [];
    const io = {
      root: () => ROOT,
      changed: (/** @type {string} */ ref) => {
        refs.push(ref);
        return ['GpsPlusSlamJs_TourViewer/playwright-tests/editor.spec.js'];
      },
    };
    /** @type {Record<string, string | undefined>} */
    const env = { GATE_CHANGED_REF: 'r1', [TIER_BASE_ENV]: 'base' };
    const grep = playwrightGrep(configUrl, { env, argv, io });
    expect(selects(grep, 'dom editor.spec.js untagged')).toBe(true);
    expect(refs).toEqual(['r1']);
    // A worker loads the config again: the cached answer, no second git call.
    const again = playwrightGrep(configUrl, { env, argv: ['node', 'worker.js'], io });
    expect(again?.map(String)).toEqual(grep?.map(String));
    expect(refs).toEqual(['r1']);

    playwrightGrep(configUrl, { env: { [TIER_BASE_ENV]: 'base' }, argv, io });
    expect(refs).toEqual(['r1', 'base']);
  });

  it('runs only the tier without a base, and nothing narrower than the named files for a developer', () => {
    const io = {
      root: () => ROOT,
      changed: () => {
        throw new Error('no git call expected');
      },
    };
    const grep = playwrightGrep(configUrl, { env: {}, argv, io });
    expect(grep?.map(String)).toEqual(tierGrep({}, [])?.map(String));
    expect(
      playwrightGrep(configUrl, { env: {}, argv: [...argv, 'editor.spec.js'], io }),
    ).toBeUndefined();
  });

  it('fails loudly when the base cannot be read, rather than skip the changed specs', () => {
    const io = {
      root: () => ROOT,
      changed: () => {
        throw new Error('unknown revision');
      },
    };
    expect(() => playwrightGrep(configUrl, { env: { [TIER_BASE_ENV]: 'nope' }, argv, io })).toThrow(
      /E2E_TIER_BASE "nope"/,
    );
  });
});

describe('an empty tier selection fails in Playwright itself', () => {
  // A throwaway suite outside the repo, whose config greps with tierGrep:
  // Playwright must refuse a run that selects no test (no
  // --pass-with-no-tests), and run a changed spec whole.
  const fromTourViewer = createRequire(path.join(ROOT, 'GpsPlusSlamJs_TourViewer', 'package.json'));
  const cli = fromTourViewer.resolve('@playwright/test/cli');
  const playwright = pathToFileURL(path.join(path.dirname(cli), 'index.mjs')).href;
  const tier = pathToFileURL(path.join(HERE, 'tier.mjs')).href;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'e2e-tier-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, 'pw.config.mjs'),
    `import { defineConfig } from ${JSON.stringify(playwright)};\n` +
      `import { tierGrep } from ${JSON.stringify(tier)};\n` +
      `export default defineConfig({ testDir: ".", grep: tierGrep(process.env, JSON.parse(process.env.PROBE_SPECS ?? "[]")) });\n`,
  );
  writeFileSync(
    path.join(dir, 'a.spec.mjs'),
    `import { test } from ${JSON.stringify(playwright)};\ntest("untagged", () => {});\ntest("another", () => {});\n`,
  );
  /** @param {Record<string, string>} extra */
  const list = (extra) =>
    spawnSync(
      process.execPath,
      [cli, 'test', '--config', path.join(dir, 'pw.config.mjs'), '--list'],
      {
        cwd: dir,
        env: { ...process.env, CI: '', [TIER_ENV]: '', ...extra },
        encoding: 'utf8',
      },
    );

  it('fails a run whose tier holds no test', () => {
    const run = list({});
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain('No tests found');
  }, 60_000);

  it('runs every test of a changed spec, and every test in the full set', () => {
    expect(list({ PROBE_SPECS: '["a.spec.mjs"]' }).stdout).toContain('Total: 2 tests in 1 file');
    expect(list({ [TIER_ENV]: 'full' }).stdout).toContain('Total: 2 tests in 1 file');
  }, 60_000);
});
