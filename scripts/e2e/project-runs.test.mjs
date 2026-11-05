// Why these tests matter: run-projects.mjs replaces one Playwright run with
// one run per project, so three things can silently lose checks: a report
// merge that drops a project's failures or counts (the gate's timing row
// reads the merged file), a filter that matches the wrong spec
// (`stations.spec.js` is a suffix of `creator-stations.spec.js`), and an area
// narrowing that leaks onto the GitHub runner, which must run everything.
import { describe, expect, it } from 'vitest';

import {
  CHANGED_REF_ENV,
  LANE_ENV,
  intersectSelections,
  laneSpecs,
  DOM_WORKERS_ENV,
  developerFiltered,
  domWorkers,
  mayNarrow,
  mergeReports,
  namedProjects,
  narrowedStageRun,
  projectArgs,
  projectReportName,
  readReport,
  specFilter,
} from './project-runs.mjs';

/** @param {Partial<Record<string, number>>} stats @param {string} title */
const report = (stats, title) => ({
  config: { title },
  suites: [{ title }],
  errors: [],
  stats: { startTime: title, expected: 0, unexpected: 0, flaky: 0, skipped: 0, duration: 0, ...stats },
});

describe('domWorkers', () => {
  it('is one on the GitHub runner, whatever the override says', () => {
    expect(domWorkers({ GITHUB_ACTIONS: 'true', [DOM_WORKERS_ENV]: '3' }, 3)).toBe(1);
  });

  it("is the plan's default in a local run, a local CI=1 gate included", () => {
    expect(domWorkers({}, 3)).toBe(3);
    expect(domWorkers({ CI: '1' }, 2)).toBe(2);
  });

  it('takes a whole-number override from 1 to 16', () => {
    expect(domWorkers({ [DOM_WORKERS_ENV]: '2' }, 3)).toBe(2);
    expect(domWorkers({ [DOM_WORKERS_ENV]: '' }, 3)).toBe(3);
  });

  it('refuses an override that is not a whole number from 1 to 16', () => {
    // A typo must fail loudly: a silent fallback would publish a measurement
    // taken at a worker count nobody asked for.
    for (const bad of ['0', '17', '2.5', 'two', '-1']) {
      expect(() => domWorkers({ [DOM_WORKERS_ENV]: bad }, 3)).toThrow(RangeError);
    }
  });
});

describe('mayNarrow', () => {
  const inGate = { [CHANGED_REF_ENV]: 'HEAD' };

  it('narrows inside a test:changed run with no forwarded filter', () => {
    expect(mayNarrow(inGate, [])).toBe(true);
    // The gate's own recording flag is not a developer filter.
    expect(mayNarrow(inGate, ['--reporter=list,json'])).toBe(true);
  });

  it('never narrows on the GitHub runner', () => {
    expect(mayNarrow({ ...inGate, GITHUB_ACTIONS: 'true' }, [])).toBe(false);
  });

  it('never narrows outside a test:changed run (the full cascade, a plain pnpm test)', () => {
    expect(mayNarrow({}, [])).toBe(false);
    expect(mayNarrow({ [CHANGED_REF_ENV]: '' }, [])).toBe(false);
  });

  it("leaves a developer's own filter alone", () => {
    expect(mayNarrow(inGate, ['editor3d.spec.js'])).toBe(false);
    expect(mayNarrow(inGate, ['--grep', 'credits'])).toBe(false);
  });
});

describe('specFilter', () => {
  /** @param {string} name @param {string} file */
  const matches = (name, file) => new RegExp(specFilter(name), 'gi').test(file);

  it('matches the spec by its whole file name, in either slash style', () => {
    expect(matches('stations.spec.js', 'C:\\x\\playwright-tests\\stations.spec.js')).toBe(true);
    expect(matches('stations.spec.js', '/x/playwright-tests/stations.spec.js')).toBe(true);
  });

  it('does not match a spec whose name merely ends in it, or a look-alike', () => {
    expect(matches('stations.spec.js', '/x/creator-stations.spec.js')).toBe(false);
    expect(matches('editor.spec.js', '/x/editor3d.spec.js')).toBe(false);
    expect(matches('landing.spec.js', '/x/landingXspec.js')).toBe(false);
  });

  it('holds no colon, which the CLI would read as a line number', () => {
    expect(specFilter('editor3d-globe-approach.spec.js')).not.toContain(':');
  });
});

describe('developerFiltered', () => {
  it("is false for nothing forwarded and for the gate's own reporter flag", () => {
    expect(developerFiltered([])).toBe(false);
    expect(developerFiltered(['--reporter=list,json'])).toBe(false);
  });

  it('is true for a file filter or any other flag a developer typed', () => {
    expect(developerFiltered(['editor3d.spec.js'])).toBe(true);
    expect(developerFiltered(['--reporter=list', '--grep', 'credits'])).toBe(true);
  });
});

// Why these tests matter: `--pass-with-no-tests` turns "this filter matched
// nothing" into green. That is right for a developer's filter (it may match
// only the other project's specs) and wrong for the runner's own choice of
// specs or a full run: a stale spec list or an empty project would then pass
// with 0 tests run.
describe('projectArgs', () => {
  it('runs one project at its workers, then the specs, failing when they match nothing', () => {
    expect(
      projectArgs({ base: ['test', '--config', 'c.js'], project: 'webgl', workers: 1, specs: ['a.spec.js'] })
    ).toEqual(['test', '--config', 'c.js', '--project', 'webgl', '--workers', '1', specFilter('a.spec.js')]);
  });

  it('adds no file filter and no pass-with-no-tests when every spec runs', () => {
    expect(projectArgs({ base: ['test'], project: 'dom', workers: 3 })).toEqual([
      'test', '--project', 'dom', '--workers', '3',
    ]);
  });

  it("passes with no tests only behind a developer's filter", () => {
    expect(
      projectArgs({ base: ['test', 'x.spec.js'], project: 'dom', workers: 3, passWithNoTests: true })
    ).toEqual(['test', 'x.spec.js', '--project', 'dom', '--workers', '3', '--pass-with-no-tests']);
  });
});

// Why these tests matter: a narrowed run (an editor-only change runs only the
// editor's specs) is not the full suite, and an empty selection runs nothing.
// Recording either as a timing row puts a part-suite or a 1-second duration
// into the history that every later comparison reads as the full suite.
describe('narrowedStageRun', () => {
  const stage = { name: 'test:e2e', narrowable: true };

  it('is true for a narrowable stage inside a test:changed run', () => {
    expect(narrowedStageRun(stage, { [CHANGED_REF_ENV]: 'abc123' })).toBe(true);
  });

  it('is false outside test:changed, on the GitHub runner, or for any other stage', () => {
    expect(narrowedStageRun(stage, {})).toBe(false);
    expect(narrowedStageRun(stage, { [CHANGED_REF_ENV]: '' })).toBe(false);
    expect(narrowedStageRun(stage, { [CHANGED_REF_ENV]: 'abc', GITHUB_ACTIONS: 'true' })).toBe(false);
    expect(narrowedStageRun({ name: 'test:e2e' }, { [CHANGED_REF_ENV]: 'abc' })).toBe(false);
    expect(narrowedStageRun({ name: 'test:e2e', narrowable: false }, { [CHANGED_REF_ENV]: 'abc' })).toBe(false);
  });
});

// Why these tests matter: the runner reads each project's report after its
// run. A missing one used to be skipped in silence, and a truncated one threw,
// which aborted the runner before the next project ran a single spec.
describe('readReport', () => {
  /** @param {Record<string, string>} files */
  const io = (files) => ({
    exists: (/** @type {string} */ f) => Object.hasOwn(files, f),
    read: (/** @type {string} */ f) => files[f],
  });
  const good = JSON.stringify(report({ expected: 3 }, 'dom'));

  it('returns a readable report', () => {
    const r = readReport('a.json', true, io({ 'a.json': good }));
    expect(r.failed).toBe(false);
    expect(r.warning).toBe(null);
    expect(r.report?.stats.expected).toBe(3);
  });

  it('warns about an expected report that is missing, without failing the run', () => {
    const r = readReport('a.json', true, io({}));
    expect(r).toMatchObject({ report: null, failed: false });
    expect(r.warning).toContain('a.json');
  });

  it('says nothing about a report nobody asked for', () => {
    expect(readReport('a.json', false, io({}))).toEqual({ report: null, warning: null, failed: false });
  });

  it('warns and fails on a truncated report or one without stats, instead of throwing', () => {
    for (const text of [good.slice(0, 20), '{"suites": []}', 'null']) {
      const r = readReport('a.json', true, io({ 'a.json': text }));
      expect(r.report, text).toBe(null);
      expect(r.failed, text).toBe(true);
      expect(r.warning, text).toContain('a.json');
    }
  });
});

describe('mergeReports', () => {
  it('keeps every suite and error and sums the counts and the duration', () => {
    const a = report({ expected: 10, unexpected: 1, flaky: 2, skipped: 3, duration: 1000 }, 'dom');
    a.errors = [{ message: 'one' }];
    const b = report({ expected: 5, unexpected: 0, flaky: 1, skipped: 0, duration: 500 }, 'webgl');
    const merged = mergeReports([a, b]);
    expect(merged.suites).toEqual([{ title: 'dom' }, { title: 'webgl' }]);
    expect(merged.errors).toEqual([{ message: 'one' }]);
    expect(merged.stats).toEqual({ startTime: 'dom', expected: 15, unexpected: 1, flaky: 3, skipped: 3, duration: 1500 });
    expect(merged.config).toEqual({ title: 'dom' });
  });

  it('returns one report unchanged in its counts', () => {
    const only = report({ expected: 4, duration: 7 }, 'dom');
    expect(mergeReports([only]).stats).toEqual(only.stats);
  });

  it('refuses an empty list and a report without stats', () => {
    expect(() => mergeReports([])).toThrow(TypeError);
    expect(() => mergeReports([{ suites: [] }])).toThrow(TypeError);
  });
});

describe('projectReportName', () => {
  it('puts the project before the .json extension', () => {
    expect(projectReportName('results.json', 'dom')).toBe('results.dom.json');
    expect(projectReportName('C:\\t\\report.json', 'webgl')).toBe('C:\\t\\report.webgl.json');
    expect(projectReportName('report', 'dom')).toBe('report.dom.json');
  });
});

// Why these tests matter: the runner adds `--project <name>` to each
// project's run itself. A developer's own `--project webgl` was forwarded
// as well, and Playwright runs every project named, so the first (DOM)
// pass ran the WebGL specs at the DOM worker count - several software
// renderers at once - and then the WebGL pass ran them all again.
describe('namedProjects', () => {
  it('runs every project when none is named, the arguments untouched', () => {
    expect(namedProjects(['a.spec.js', '--retries', '0'], ['dom', 'webgl'])).toEqual({
      projects: ['dom', 'webgl'],
      rest: ['a.spec.js', '--retries', '0'],
    });
  });

  it('takes a named project out of the arguments, in either spelling', () => {
    expect(namedProjects(['a.spec.js', '--project', 'webgl', '--retries', '0'], ['dom', 'webgl'])).toEqual({
      projects: ['webgl'],
      rest: ['a.spec.js', '--retries', '0'],
    });
    expect(namedProjects(['--project=dom'], ['dom', 'webgl'])).toEqual({ projects: ['dom'], rest: [] });
  });

  it("keeps the plan's order for several named projects", () => {
    expect(namedProjects(['--project', 'webgl', '--project', 'dom'], ['dom', 'webgl']).projects).toEqual([
      'dom',
      'webgl',
    ]);
  });

  it('refuses a project the plan does not have, and a flag without a name', () => {
    expect(() => namedProjects(['--project', 'chromium'], ['dom', 'webgl'])).toThrow(RangeError);
    expect(() => namedProjects(['--project'], ['dom', 'webgl'])).toThrow(RangeError);
  });
});

// Why this test matters (test-suite pruning plan 2026-11-04, T-M1): a CI
// lane is chosen by an environment variable, never by forwarded arguments,
// because a forwarded argument sets `passWithNoTests` and a stale lane would
// then pass with no test run. An unknown or empty lane must fail the job.
describe('laneSpecs', () => {
  const plan = {
    LANES: ['dom', 'webgl-1'],
    specsOfLane: (/** @type {string} */ lane) => {
      if (lane === 'dom') return ['a.spec.js'];
      if (lane === 'webgl-1') return ['b.spec.js'];
      throw new RangeError(`no lane ${lane}`);
    },
  };

  it('is null (every spec) when no lane is set', () => {
    expect(laneSpecs({}, plan)).toBeNull();
    expect(laneSpecs({ [LANE_ENV]: '' }, plan)).toBeNull();
  });

  it('is the lane\'s spec list when one is set', () => {
    expect(laneSpecs({ [LANE_ENV]: 'webgl-1' }, plan)).toEqual(['b.spec.js']);
  });

  it('throws on a lane the plan does not name', () => {
    expect(() => laneSpecs({ [LANE_ENV]: 'webgl-9' }, plan)).toThrow(RangeError);
  });

  it('throws on a lane that holds no spec (a job that runs no tests fails)', () => {
    const empty = { LANES: ['dom'], specsOfLane: () => [] };
    expect(() => laneSpecs({ [LANE_ENV]: 'dom' }, empty)).toThrow(RangeError);
  });

  it('throws on a plan without lanes, rather than running everything', () => {
    expect(() => laneSpecs({ [LANE_ENV]: 'dom' }, {})).toThrow(RangeError);
  });
});

describe('intersectSelections', () => {
  it('keeps the other side when one is null (all)', () => {
    expect(intersectSelections(null, null)).toBeNull();
    expect(intersectSelections(['a'], null)).toEqual(['a']);
    expect(intersectSelections(null, ['b'])).toEqual(['b']);
  });

  it('keeps only the specs in both, in the first list\'s order', () => {
    expect(intersectSelections(['c', 'a', 'b'], ['b', 'c'])).toEqual(['c', 'b']);
  });
});
