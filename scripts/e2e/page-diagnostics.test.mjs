// WHY THESE TESTS MATTER. The incident this module exists for was diagnosed
// only after unzipping a trace; the whole value here is that the browser's own
// account reaches the failure report instead. Two things can silently destroy
// that value: reporting so much noise that nobody reads it (the suite aborts
// third-party requests on nearly every test), or filtering so hard that the one
// line naming the cause is dropped. Both directions are pinned below.

import { describe, expect, it } from 'vitest';

import { attachOnFailure, createPageDiagnostics, MAX_ENTRIES } from './page-diagnostics.mjs';

/** Minimal stand-in for playwright's `page` event surface. */
function fakePage() {
  const handlers = new Map();
  return {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
}

const APP = 'http://127.0.0.1:5186';

const consoleMessage = (type, text, url) => ({
  type: () => type,
  text: () => text,
  location: () => (url ? { url } : undefined),
});

const response = (status, url) => ({ status: () => status, url: () => url });

const failedRequest = (url, errorText) => ({
  url: () => url,
  failure: () => ({ errorText }),
});

describe('createPageDiagnostics', () => {
  it('captures the exact line that would have solved the 2026-08-16 incident', () => {
    // The regression this module was written for: a 404 on a content-hashed
    // chunk of a linked library, logged by the browser and reported by nothing.
    const page = fakePage();
    const diagnostics = createPageDiagnostics(page, { baseUrl: APP });
    page.emit(
      'console',
      consoleMessage(
        'error',
        'Failed to load resource: the server responded with a status of 404 (Not Found)',
        `${APP}/@fs/C:/gps/location-based-webxr/GpsPlusSlamJs_Osm/dist/mesh-CZafImwM.js`
      )
    );
    expect(diagnostics.summary()).toContain('mesh-CZafImwM.js');
    expect(diagnostics.summary()).toContain('404');
  });

  it('drops the third-party requests the suite aborts on purpose', () => {
    // fixtures.js aborts the rule sheet and stubs Overpass/DEM failures on
    // nearly every test. Without this filter every attachment starts with noise
    // that is the fixture working as designed.
    const page = fakePage();
    const diagnostics = createPageDiagnostics(page, { baseUrl: APP });
    page.emit('requestfailed', failedRequest('https://docs.google.com/sheet', 'net::ERR_FAILED'));
    page.emit('response', response(503, 'https://s3.amazonaws.com/elevation-tiles/1/2/3.png'));
    page.emit('response', response(400, 'https://overpass-api.de/api/interpreter'));
    expect(diagnostics.entries).toEqual([]);
  });

  it('keeps same-origin failures, which are the app’s own', () => {
    const page = fakePage();
    const diagnostics = createPageDiagnostics(page, { baseUrl: APP });
    page.emit('response', response(404, `${APP}/src/missing.js`));
    expect(diagnostics.entries).toEqual([`HTTP 404: ${APP}/src/missing.js`]);
  });

  it('always keeps an uncaught exception, which carries no URL to filter on', () => {
    const page = fakePage();
    const diagnostics = createPageDiagnostics(page, { baseUrl: APP });
    page.emit('pageerror', new Error('boom'));
    expect(diagnostics.entries).toEqual(['uncaught: boom']);
  });

  it('ignores non-error console output', () => {
    const page = fakePage();
    const diagnostics = createPageDiagnostics(page, { baseUrl: APP });
    page.emit('console', consoleMessage('log', 'hello', APP));
    page.emit('console', consoleMessage('warning', 'careful', APP));
    expect(diagnostics.entries).toEqual([]);
  });

  it('de-duplicates one failing module requested by many importers', () => {
    const page = fakePage();
    const diagnostics = createPageDiagnostics(page, { baseUrl: APP });
    for (let i = 0; i < 5; i += 1) page.emit('response', response(404, `${APP}/a.js`));
    expect(diagnostics.entries).toHaveLength(1);
  });

  it('caps the report and says how much it withheld', () => {
    const page = fakePage();
    const diagnostics = createPageDiagnostics(page, { baseUrl: APP });
    for (let i = 0; i < MAX_ENTRIES + 3; i += 1) {
      page.emit('response', response(404, `${APP}/a${i}.js`));
    }
    const summary = diagnostics.summary();
    expect(summary).toContain('…and 3 more');
    expect(summary.split('\n').filter((l) => l.includes('HTTP 404'))).toHaveLength(MAX_ENTRIES);
  });

  it('says nothing when the browser said nothing', () => {
    const diagnostics = createPageDiagnostics(fakePage(), { baseUrl: APP });
    expect(diagnostics.summary()).toBe('');
  });

  it('forgets on reset, so a shared page does not replay earlier tests', () => {
    // The largest spec file in the OsmDemo suite runs every test against one
    // page created in `beforeAll`. Without this, the third failure's attachment
    // would carry the first two tests' errors and read as three separate faults.
    const page = fakePage();
    const diagnostics = createPageDiagnostics(page, { baseUrl: APP });
    page.emit('response', response(404, `${APP}/a.js`));
    diagnostics.reset();
    expect(diagnostics.entries).toEqual([]);
    // The de-duplication set is cleared too, or the same failure in a later test
    // would be swallowed as "already seen".
    page.emit('response', response(404, `${APP}/a.js`));
    expect(diagnostics.entries).toHaveLength(1);
  });

  it('keeps everything when no app origin is given', () => {
    const page = fakePage();
    const diagnostics = createPageDiagnostics(page);
    page.emit('response', response(500, 'https://elsewhere.example/x'));
    expect(diagnostics.entries).toHaveLength(1);
  });
});

describe('attachOnFailure', () => {
  it('attaches nothing when the test passed', async () => {
    const calls = [];
    await attachOnFailure(
      { summary: () => 'something' },
      { status: 'passed', expectedStatus: 'passed', attach: (...a) => calls.push(a) }
    );
    expect(calls).toEqual([]);
  });

  it('attaches nothing when a failed test produced no output', async () => {
    // No empty attachments: an attachment that is always present stops being a
    // signal that anything happened.
    const calls = [];
    await attachOnFailure(
      { summary: () => '' },
      { status: 'failed', expectedStatus: 'passed', attach: (...a) => calls.push(a) }
    );
    expect(calls).toEqual([]);
  });

  it('attaches on failure', async () => {
    const calls = [];
    await attachOnFailure(
      { summary: () => 'the 404' },
      { status: 'failed', expectedStatus: 'passed', attach: (...a) => calls.push(a) }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('browser-console');
    expect(calls[0][1].body).toBe('the 404');
  });

  it('respects an expected failure', async () => {
    const calls = [];
    await attachOnFailure(
      { summary: () => 'x' },
      { status: 'failed', expectedStatus: 'failed', attach: (...a) => calls.push(a) }
    );
    expect(calls).toEqual([]);
  });
});
