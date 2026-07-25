// Why this test matters: exact test counts come from the runners' JSON
// reporters, not stdout scraping (plan §2). The fixtures are REAL captured
// output — vitest 4 json reporter (coverageMap stripped for size only) and
// playwright 1.60 json reporter from this repo's own suites — so a runner
// upgrade that changes the schema shows up here as a red test, not as
// silently-wrong counts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseVitestCounts, parsePlaywrightCounts } from './reporter-parse.mjs';

const vitestFixture = readFileSync(
  new URL('./__test-fixtures__/vitest-json-reporter.json', import.meta.url),
  'utf8'
);
const playwrightFixture = readFileSync(
  new URL('./__test-fixtures__/playwright-json-reporter.json', import.meta.url),
  'utf8'
);

describe('parseVitestCounts', () => {
  it('extracts counts from real vitest json-reporter output', () => {
    expect(parseVitestCounts(vitestFixture)).toEqual({
      passed: 12,
      failed: 0,
      skipped: 0,
      todo: 0,
    });
  });

  it('maps numPendingTests to skipped', () => {
    const json = JSON.stringify({
      numPassedTests: 5,
      numFailedTests: 1,
      numPendingTests: 2,
      numTodoTests: 3,
    });
    expect(parseVitestCounts(json)).toEqual({
      passed: 5,
      failed: 1,
      skipped: 2,
      todo: 3,
    });
  });

  it('throws a TypeError on malformed JSON', () => {
    expect(() => parseVitestCounts('{oops')).toThrow(TypeError);
  });

  it('throws a TypeError when count fields are missing (schema drift guard)', () => {
    expect(() => parseVitestCounts('{"numPassedTests": "many"}')).toThrow(
      TypeError
    );
  });
});

describe('parsePlaywrightCounts', () => {
  it('extracts counts from real playwright json-reporter output', () => {
    expect(parsePlaywrightCounts(playwrightFixture)).toEqual({
      passed: 1,
      failed: 0,
      skipped: 0,
      todo: 0,
    });
  });

  it('counts flaky tests as passed (they passed on retry)', () => {
    const json = JSON.stringify({
      stats: { expected: 4, unexpected: 0, skipped: 1, flaky: 2 },
    });
    expect(parsePlaywrightCounts(json)).toEqual({
      passed: 6,
      failed: 0,
      skipped: 1,
      todo: 0,
    });
  });

  it('throws a TypeError on malformed JSON', () => {
    expect(() => parsePlaywrightCounts('nope')).toThrow(TypeError);
  });

  it('throws a TypeError when stats are missing (schema drift guard)', () => {
    expect(() => parsePlaywrightCounts('{"suites": []}')).toThrow(TypeError);
  });
});
