// Why these tests matter: the per-PR browser tier runs only the tests tagged
// `@pr`, so every way it could select the wrong set is a silent loss of
// checks: a tier value nobody meant (a typo that runs the full set, or one
// that runs nothing), a changed spec that does not run whole, a developer's
// own file filter that the tier quietly narrows, a tier run recording a
// timing row as if it were the suite, and above all an empty selection that
// passes. The last one is proven against Playwright itself, because the
// "No tests found" failure is Playwright's behaviour, not this module's.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  DEVELOPER_FILTER_ENV,
  GLOBAL_TIMEOUT_ENV,
  TIER_BASE_ENV,
  TIER_ENV,
  changedSpecNames,
  developerSelected,
  e2eTier,
  emptyTierWarning,
  failedProbeWarning,
  listedTotal,
  passesEmpty,
  playwrightGrep,
  specsImporting,
  tierGlobalTimeout,
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

  // Why: the root cascade recorded each package gate's row, and its total,
  // for a run whose browser stages ran only the tier, so partial runs
  // entered the medians the full runs are compared against.
  it("marks a root stage running a package's gate in the tier, unless that gate skips its browser stages", () => {
    expect(tierStageRun({ counts: null, nestedGate: true }, {})).toBe(true);
    expect(tierStageRun({ counts: null, nestedGate: true }, { [TIER_ENV]: 'full' })).toBe(false);
    expect(tierStageRun({ counts: null, nestedGate: true }, {}, { skipBrowser: true })).toBe(false);
    expect(tierStageRun({ counts: 'playwright' }, {}, { skipBrowser: true })).toBe(true);
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

describe('specsImporting', () => {
  // Why: a changed spec helper or fixture breaks the specs that import it,
  // and before this only the tagged tests of those specs ran in the tier.
  const pkg = 'P/playwright-tests';
  const sources = {
    [`${pkg}/a.spec.js`]: 'import { open } from "./fixture.js";\nimport x from "../src/x.js";',
    [`${pkg}/b.spec.js`]: "import { menus } from './menus.js';",
    [`${pkg}/c.spec.js`]: 'import { test } from "@playwright/test";',
    [`${pkg}/menus.js`]: "export * from './fixture.js';",
    [`${pkg}/fixture.js`]: '',
  };

  it('selects every spec whose relative imports reach a changed file, directly or through a helper', () => {
    expect(specsImporting([`${pkg}/fixture.js`], sources)).toEqual(['a.spec.js', 'b.spec.js']);
    expect(specsImporting([`${pkg}/menus.js`], sources)).toEqual(['b.spec.js']);
    expect(specsImporting(['P\\src\\x.js'], sources)).toEqual(['a.spec.js']);
  });

  // Why: a cycle once left a cached "no" for a helper first met while its
  // importer was still being walked, so a spec importing only that helper
  // was dropped from running whole.
  it('selects a spec that reaches the change only through an import cycle', () => {
    const cyclic = {
      [`${pkg}/a.spec.js`]: 'import "./h1.js";',
      [`${pkg}/b.spec.js`]: 'import "./h2.js";',
      [`${pkg}/h1.js`]: 'import "./h2.js";\nimport "./h3.js";',
      [`${pkg}/h2.js`]: 'import "./h1.js";',
      [`${pkg}/h3.js`]: '',
    };
    expect(specsImporting([`${pkg}/h3.js`], cyclic)).toEqual(['a.spec.js', 'b.spec.js']);
  });

  it('selects nothing for a file no spec imports, or for a changed spec itself', () => {
    expect(specsImporting(['P/other.js'], sources)).toEqual([]);
    expect(specsImporting([`${pkg}/c.spec.js`], sources)).toEqual([]);
    expect(specsImporting([], sources)).toEqual([]);
  });
});

describe('failedProbeWarning', () => {
  // Why: a failing --list probe gave no count, so its project ran with
  // --pass-with-no-tests and could pass having run nothing, unsaid.
  it('warns when the probe failed or printed no count, and only then', () => {
    expect(failedProbeWarning({ project: 'dom', status: 0, total: 3 })).toBeNull();
    expect(failedProbeWarning({ project: 'dom', status: 0, total: 0 })).toBeNull();
    expect(failedProbeWarning({ project: 'dom', status: 1, total: null })).toMatch(
      /^WARNING e2e project dom: the --list probe exited 1, .*may pass with 0 tests/,
    );
    expect(failedProbeWarning({ project: 'webgl', status: 0, total: null })).toMatch(
      /probe printed no test count/,
    );
    expect(failedProbeWarning({ project: 'webgl', status: null, total: null })).toMatch(
      /exited by a signal/,
    );
  });
});

describe('listedTotal and emptyTierWarning', () => {
  // Why: a test:changed run cut to an area whose specs hold no tagged test
  // passes with zero tests (the tier allows it), which must not read as a
  // green browser run: it is said loudly, with the area and the count.
  it("reads the count of Playwright's --list output, 0 for no tests, null when unreadable", () => {
    expect(listedTotal('...\nTotal: 12 tests in 3 files\n')).toBe(12);
    expect(listedTotal('Total: 1 test in 1 file')).toBe(1);
    expect(listedTotal('Error: No tests found')).toBe(0);
    expect(listedTotal('Total: 0 tests in 0 files')).toBe(0);
    expect(listedTotal('something else')).toBeNull();
  });

  it('warns, naming the area, the ref and the count 0, only when nothing runs', () => {
    const warning = emptyTierWarning({ project: 'webgl', areas: ['editor'], ref: 'r1', total: 0 });
    expect(warning).toMatch(/WARNING/);
    expect(warning).toContain('webgl');
    expect(warning).toContain('editor');
    expect(warning).toContain('r1');
    expect(warning).toContain('0 tests');
    expect(emptyTierWarning({ project: 'dom', areas: [], ref: 'r1', total: 0 })).toContain('none');
    expect(emptyTierWarning({ project: 'dom', areas: ['viewer'], ref: 'r1', total: 3 })).toBeNull();
    expect(emptyTierWarning({ project: 'dom', areas: ['viewer'], ref: 'r1', total: null })).toBeNull();
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

  it('runs whole every spec that imports a changed helper', () => {
    /** @type {string[]} */
    const asked = [];
    const io = {
      root: () => ROOT,
      changed: () => ['GpsPlusSlamJs_TourViewer/playwright-tests/fixture.js'],
      sources: (/** @type {string} */ dir) => {
        asked.push(dir);
        return {
          'GpsPlusSlamJs_TourViewer/playwright-tests/editor.spec.js': "import './fixture.js';",
          'GpsPlusSlamJs_TourViewer/playwright-tests/fixture.js': '',
        };
      },
    };
    const grep = playwrightGrep(configUrl, { env: { [TIER_BASE_ENV]: 'base' }, argv, io });
    expect(selects(grep, 'dom editor.spec.js untagged')).toBe(true);
    expect(selects(grep, 'dom stations.spec.js untagged')).toBe(false);
    expect(asked).toHaveLength(1);
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

describe('tierGlobalTimeout', () => {
  it('is off without a limit, which is every run outside the CI browser jobs', () => {
    expect(tierGlobalTimeout({})).toBe(0);
    expect(tierGlobalTimeout({ [GLOBAL_TIMEOUT_ENV]: '' })).toBe(0);
  });

  it('reads minutes', () => {
    expect(tierGlobalTimeout({ [GLOBAL_TIMEOUT_ENV]: '30' })).toBe(1_800_000);
    expect(tierGlobalTimeout({ [GLOBAL_TIMEOUT_ENV]: '0.5' })).toBe(30_000);
  });

  it('refuses anything else, so a typo in the matrix never switches the limit off', () => {
    for (const value of ['0', '-1', 'abc', '30m', 'Infinity']) {
      expect(() => tierGlobalTimeout({ [GLOBAL_TIMEOUT_ENV]: value }), value).toThrow(RangeError);
    }
  });
});

describe('a hung run under the limit, in Playwright itself', () => {
  // A throwaway suite with a test that never ends and no browser: the run must
  // end red by itself, name the limit in its log, and tell the hung test from
  // the rest in its JSON report, which is what a CI job uploads. Why: a job
  // cancelled at its own time limit leaves none of these.
  // Playwright reports a test interrupted this way as "skipped" with a
  // worker's start time, and a test it never reached with no result at all.
  const fromTourViewer = createRequire(path.join(ROOT, 'GpsPlusSlamJs_TourViewer', 'package.json'));
  const cli = fromTourViewer.resolve('@playwright/test/cli');
  const playwright = pathToFileURL(path.join(path.dirname(cli), 'index.mjs')).href;
  const tier = pathToFileURL(path.join(HERE, 'tier.mjs')).href;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'e2e-hang-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, 'pw.config.mjs'),
    `import { defineConfig } from ${JSON.stringify(playwright)};\n` +
      `import { tierGlobalTimeout } from ${JSON.stringify(tier)};\n` +
      'export default defineConfig({ testDir: ".", timeout: 0, workers: 1,\n' +
      '  globalTimeout: tierGlobalTimeout(process.env),\n' +
      '  reporter: [["github"], ["json", { outputFile: "results.json" }]] });\n',
  );
  writeFileSync(
    path.join(dir, 'hang.spec.mjs'),
    `import { test } from ${JSON.stringify(playwright)};\n` +
      'test("never ends", () => new Promise(() => {}));\n' +
      'test("not reached", () => {});\n',
  );

  // The limit counts from the start of the run, worker start included: at 6 s
  // and at 15 s a loaded machine reached it before the test began, and nothing
  // had hung.
  it('fails, says why, and reports the test that hung', () => {
    const run = spawnSync(
      process.execPath,
      [cli, 'test', '--config', path.join(dir, 'pw.config.mjs')],
      {
        cwd: dir,
        env: { ...process.env, CI: '1', [TIER_ENV]: 'full', [GLOBAL_TIMEOUT_ENV]: '0.5' },
        encoding: 'utf8',
        timeout: 80_000,
      },
    );
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain('Timed out waiting 30s');
    const report = JSON.parse(readFileSync(path.join(dir, 'results.json'), 'utf8'));
    expect(report.errors[0].message).toContain('Timed out waiting 30s');
    const [hung, unreached] = report.suites[0].specs;
    expect(hung.title).toBe('never ends');
    expect(hung.tests[0].results[0].workerIndex).toBe(0);
    expect(unreached.tests[0].results).toEqual([]);
  }, 100_000);
});

describe('an empty tier selection fails in Playwright itself', () => {
  // A throwaway suite outside the repo, whose config greps with tierGrep:
  // Playwright must refuse a run that selects no test (no
  // --pass-with-no-tests).
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
});
