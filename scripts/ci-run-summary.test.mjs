// Why these tests matter: a branch without a pull request has no checks page
// and no bot comment, so this one line IS how a builder learns its CI result.
// A run still going or a job that was cancelled must never read as green.
import { describe, expect, it } from 'vitest';

import { summarizeRun } from './ci-run-summary.mjs';

const job = (name, status, conclusion) => ({ name, status, conclusion });
const run = {
  url: 'https://example.test/run/1',
  headBranch: 'r1',
  headSha: '0123456789abcdef',
  status: 'completed',
  conclusion: 'success',
  jobs: [job('libraries', 'completed', 'success'), job('osm-demo', 'completed', 'success')],
};

describe('summarizeRun', () => {
  it('says green with the job count, the commit and the link', () => {
    expect(summarizeRun(run)).toBe(
      'r1 @ 01234567: success, 2 of 2 jobs green - https://example.test/run/1',
    );
  });

  it('names every job that did not succeed, a cancelled one included', () => {
    const red = {
      ...run,
      conclusion: 'failure',
      jobs: [
        job('libraries', 'completed', 'failure'),
        job('osm-demo', 'completed', 'cancelled'),
        job('tour-dom-1', 'completed', 'success'),
      ],
    };
    expect(summarizeRun(red)).toBe(
      'r1 @ 01234567: failure, 1 of 3 jobs green, not green: libraries (failure), osm-demo (cancelled) - https://example.test/run/1',
    );
  });

  it('says a run is still going, and names a job already red', () => {
    const going = {
      ...run,
      status: 'in_progress',
      conclusion: '',
      jobs: [
        job('libraries', 'completed', 'failure'),
        job('osm-demo', 'in_progress', ''),
        job('tour-dom-1', 'queued', ''),
      ],
    };
    expect(summarizeRun(going)).toBe(
      'r1 @ 01234567: in_progress, 1 of 3 jobs done, not green: libraries (failure) - https://example.test/run/1',
    );
  });

  it('refuses a run without a jobs list rather than print a green line', () => {
    expect(() => summarizeRun({ ...run, jobs: undefined })).toThrow(TypeError);
  });
});
