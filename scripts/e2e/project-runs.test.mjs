// Why these tests matter: run-projects.mjs replaces one Playwright run with
// one run per project, so three things can silently lose checks: a report
// merge that drops a project's failures or counts (the gate's timing row and
// CI's artifact read the merged file), a filter that matches the wrong spec
// (`stations.spec.js` is a suffix of `creator-stations.spec.js`), and an area
// narrowing that leaks onto the GitHub runner, which must run everything.
import { describe, expect, it } from 'vitest';

import {
  CHANGED_REF_ENV,
  DOM_WORKERS_ENV,
  domWorkers,
  mayNarrow,
  mergeReports,
  projectArgs,
  projectReportName,
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

describe('projectArgs', () => {
  it('runs one project at its workers, passing with no tests, then the specs', () => {
    expect(
      projectArgs({ base: ['test', '--config', 'c.js'], project: 'webgl', workers: 1, specs: ['a.spec.js'] })
    ).toEqual(['test', '--config', 'c.js', '--project', 'webgl', '--workers', '1', '--pass-with-no-tests', specFilter('a.spec.js')]);
  });

  it('adds no file filter when every spec runs', () => {
    expect(projectArgs({ base: ['test'], project: 'dom', workers: 3 })).toEqual([
      'test', '--project', 'dom', '--workers', '3', '--pass-with-no-tests',
    ]);
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
