/**
 * Error-reporting configuration tests.
 *
 * Why these tests matter: the recorder's error reports are described on the
 * site's privacy page, and that description is only true while this
 * configuration stays reduced: no default personal data (so the service is
 * told not to store the IP address), traces from a sample of page loads
 * rather than all of them, no forwarding of console output as logs, no
 * session sent on every page load and no locale or timezone added to every
 * report, and every report, span and breadcrumb passed through the scrubber
 * before it leaves. A change to any of these values must fail here, so that
 * it is a decision made together with the privacy text rather than a silent
 * drift.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import * as Sentry from '@sentry/browser';
import {
  defaultStackParser,
  eventFromException,
  getDefaultIntegrations,
} from '@sentry/browser';
import type { Breadcrumb, BrowserOptions, ErrorEvent } from '@sentry/browser';
import type * as SentryModule from '@sentry/browser';
import {
  SENTRY_TEST_MESSAGE,
  TRACES_SAMPLE_RATE,
  sentryOptions,
  startErrorReporting,
  startWorkerErrorReporting,
  strictSentryOptions,
  wantsTestReport,
  workerSentryOptions,
} from './sentry-options';

// Only the two calls that would start the SDK or send a report are replaced;
// the integration list is still resolved by the real SDK.
vi.mock('@sentry/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof SentryModule>();
  return { ...actual, init: vi.fn(), captureException: vi.fn() };
});

type TransactionEvent = Parameters<
  NonNullable<BrowserOptions['beforeSendTransaction']>
>[0];
type SpanJson = Parameters<NonNullable<BrowserOptions['beforeSendSpan']>>[0];

/**
 * The names of the integrations the SDK will actually run with these
 * options, resolved the way `Sentry.init` resolves them: an array is ADDED
 * to the SDK's defaults, a function receives the defaults and returns the
 * final list. Reading only the array would miss every default integration.
 */
function runningIntegrationNames(options: BrowserOptions): string[] {
  const defaults = getDefaultIntegrations(options);
  const { integrations } = options;
  const list =
    typeof integrations === 'function'
      ? integrations(defaults)
      : [...defaults, ...(integrations ?? [])];
  return (Array.isArray(list) ? list : [list]).map((i) => i.name);
}

const OWN = 'gps.csutil.com';
const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const TOUR_LINK = `https://gps.csutil.com/tour/?qr=${encodeURIComponent(
  `https://drive.google.com/file/d/${DRIVE_ID}/view`
)}`;

describe('sentryOptions', () => {
  const options = sentryOptions(OWN);

  it('sends no default personal data', () => {
    expect(options.sendDefaultPii).toBe(false);
  });

  it("labels every report with the page's environment", () => {
    // Branch previews are production builds and send reports too; the
    // label keeps them, and local runs of a production build, apart from
    // the live site's (error-report-environment.ts).
    expect(sentryOptions(OWN, 'gps.csutil.com').environment).toBe('production');
    expect(
      sentryOptions(OWN, 'r943-gps-plus-slam.csutil.workers.dev').environment
    ).toBe('preview');
    expect(sentryOptions(OWN, 'localhost').environment).toBe('development');
  });

  it('samples traces well below every page load', () => {
    expect(TRACES_SAMPLE_RATE).toBe(0.1);
    expect(options.tracesSampleRate).toBe(TRACES_SAMPLE_RATE);
  });

  it('forwards no console output as logs', () => {
    const names = runningIntegrationNames(options);
    expect(names).toContain('BrowserTracing');
    expect(names).not.toContain('ConsoleLogs');
    expect(options.enableLogs).not.toBe(true);
    expect(
      (options as { _experiments?: { enableLogs?: boolean } })._experiments
        ?.enableLogs
    ).not.toBe(true);
  });

  it('sends no session on page load and adds no locale or timezone to reports', () => {
    // The SDK's defaults include a session integration that contacts the
    // service on EVERY page load, error or not, and a culture integration
    // that adds the browser's locale and timezone to every report. Neither
    // helps to fix an error.
    const names = runningIntegrationNames(options);
    expect(names).not.toContain('BrowserSession');
    expect(names).not.toContain('CultureContext');
    // The defaults that catch and describe errors stay.
    expect(names).toEqual(
      expect.arrayContaining([
        'GlobalHandlers',
        'BrowserApiErrors',
        'Breadcrumbs',
        'LinkedErrors',
        'Dedupe',
        'BrowserTracing',
      ])
    );
  });

  it('removes a tour link, a file id and a coordinate pair from an error report', () => {
    const event: ErrorEvent = {
      type: undefined,
      event_id: 'a3f2504e04f8911d39a0c0305e82c330',
      message: '[GpsEvents] Set zero reference: 48.137154, 11.576124',
      request: { url: TOUR_LINK },
      exception: {
        values: [{ type: 'TypeError', value: `Failed to fetch ${TOUR_LINK}` }],
      },
      breadcrumbs: [
        {
          category: 'fetch',
          data: { url: `/api/drive-proxy?id=${DRIVE_ID}` },
        },
      ],
    };
    const out = options.beforeSend?.(event, {});
    const text = JSON.stringify(out);
    expect(text).not.toContain(DRIVE_ID);
    expect(text).not.toContain('qr=');
    expect(text).not.toContain('48.137154');
    expect(text).not.toContain('11.576124');
    expect(text).toContain('a3f2504e04f8911d39a0c0305e82c330');
  });

  it("tags every report with the Recorder's app name", () => {
    // The three apps share one project: the tag is what tells the
    // Recorder's reports apart from the Tour Viewer's and the map demo's.
    expect(options.initialScope).toEqual({ tags: { app: 'recorder' } });
  });

  it('removes a pair of numbers from a rejected object the SDK serialised', async () => {
    const event = (await eventFromException(
      defaultStackParser,
      { center: [48.137, 11.575] },
      undefined,
      false
    )) as ErrorEvent;
    // The SDK puts the object itself into `extra`, so the test is real.
    expect(JSON.stringify(event.extra)).toContain('48.137');
    const text = JSON.stringify(options.beforeSend?.(event, {}));
    expect(text).not.toContain('48.137');
    expect(text).not.toContain('11.575');
  });

  it('scrubs the spans of a sampled trace', () => {
    const transaction: TransactionEvent = {
      type: 'transaction',
      transaction: '/recorder/',
      spans: [
        {
          span_id: 'b7ad6b7169203331',
          trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
          start_timestamp: 1,
          // The SDK's fetch and XHR spans carry the query and the fragment
          // as attributes of their own, besides the description.
          data: {
            'http.query': `?id=${DRIVE_ID}`,
            'http.fragment': `#${DRIVE_ID}`,
          },
          description: `GET https://gps.csutil.com/api/drive-proxy?id=${DRIVE_ID}`,
        },
      ],
    };
    const out = options.beforeSendTransaction?.(transaction, {});
    expect(JSON.stringify(out)).not.toContain(DRIVE_ID);
  });

  it('scrubs a span sent on its own, outside any trace', () => {
    // Web-vital measurements (layout shift, interaction delay) are sent as
    // standalone spans, which pass neither beforeSend nor
    // beforeSendTransaction.
    expect(options.beforeSendSpan).toBeTypeOf('function');
    const span: SpanJson = {
      span_id: 'b7ad6b7169203331',
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      start_timestamp: 1,
      data: { 'http.query': `?id=${DRIVE_ID}` },
      description: TOUR_LINK,
    };
    const out = options.beforeSendSpan?.(span);
    expect(JSON.stringify(out)).not.toContain(DRIVE_ID);
    expect(out?.span_id).toBe('b7ad6b7169203331');
  });

  it('drops console breadcrumbs and scrubs the others', () => {
    const consoleCrumb: Breadcrumb = {
      category: 'console',
      message: 'anything at all',
    };
    expect(options.beforeBreadcrumb?.(consoleCrumb)).toBeNull();

    const navigation: Breadcrumb = {
      category: 'navigation',
      data: { from: '/recorder/', to: TOUR_LINK },
    };
    const kept = options.beforeBreadcrumb?.(navigation);
    expect(JSON.stringify(kept)).not.toContain(DRIVE_ID);

    const logLine: Breadcrumb = {
      category: 'log',
      message: '[GpsEvents] Set zero reference: 48.137154, 11.576124',
    };
    expect(options.beforeBreadcrumb?.(logLine)?.message).not.toContain(
      '48.137154'
    );
  });

  it("sends to the error service's US data region, as the privacy page says", () => {
    // Moving the project to another region changes this host; the privacy
    // page names the region, so the two have to change together.
    expect(options.dsn).toContain('.ingest.us.sentry.io/');
  });
});

// Why these tests matter: the Tour Viewer and the map demo are used by
// visitors, and the privacy page says what their reports carry: errors only,
// no traces, the app's name, and nothing of the tour or the place. These
// values are that promise; changing one must be a decision made together with
// the privacy text.
describe('strictSentryOptions', () => {
  const options = strictSentryOptions('tour-viewer', OWN, 'gps.csutil.com');

  it('sends errors only: no tracing, no session, no locale', () => {
    const names = runningIntegrationNames(options);
    expect(names).not.toContain('BrowserTracing');
    expect(names).not.toContain('BrowserSession');
    expect(names).not.toContain('CultureContext');
    expect(names).toEqual(
      expect.arrayContaining(['GlobalHandlers', 'LinkedErrors', 'Dedupe'])
    );
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.sendDefaultPii).toBe(false);
  });

  it("tags every report with the app's name, in the Recorder's project", () => {
    expect(options.initialScope).toEqual({ tags: { app: 'tour-viewer' } });
    expect(options.dsn).toBe(sentryOptions(OWN).dsn);
    expect(options.environment).toBe('production');
  });

  it('keeps only the log lines that are warnings or errors', () => {
    const line = (level: Breadcrumb['level']): Breadcrumb => ({
      category: 'log',
      level,
      message: '[Tour] opened station 3',
    });
    expect(options.beforeBreadcrumb?.(line('info'))).toBeNull();
    expect(options.beforeBreadcrumb?.(line('debug'))).toBeNull();
    expect(options.beforeBreadcrumb?.(line('warning'))).not.toBeNull();
    expect(options.beforeBreadcrumb?.(line('error'))).not.toBeNull();
    expect(
      options.beforeBreadcrumb?.({ category: 'console', message: 'x' })
    ).toBeNull();
  });

  it('removes a camera target, an H3 cell, an OSM id and a file name from a report', () => {
    const event: ErrorEvent = {
      type: undefined,
      event_id: 'a3f2504e04f8911d39a0c0305e82c330',
      request: {
        url: 'https://gps.csutil.com/osm/?clat=48.137154&clng=11.576124',
      },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'build failed for cell 8d1f8d3a1c3a43f, way/123456789',
          },
        ],
      },
      breadcrumbs: [
        {
          category: 'log',
          level: 'warning',
          message: '[Shelf] Skipping "Altstadt Rundgang.zip"',
        },
      ],
    };
    const text = JSON.stringify(options.beforeSend?.(event, {}));
    for (const secret of [
      '48.137154',
      '11.576124',
      '8d1f8d3a1c3a43f',
      '123456789',
      'Altstadt',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('a3f2504e04f8911d39a0c0305e82c330');
  });
});

// Why these tests matter: the SDK fills `debug_meta` with each bundle's debug
// id before `beforeSend` runs, and the error service finds a bundle's source
// map by that id. A UUID can hold a group of six or more digits, which the
// strict long-number rule removes, and that frame then loses its readable
// stack without any error. The service's own ids must reach it as they were,
// while everything else in the report is still scrubbed.
describe("strictSentryOptions, the error service's own ids", () => {
  const options = strictSentryOptions('tour-viewer', OWN, 'gps.csutil.com');
  // Real ids can be all digits in a group of 8 or 12 (about 1 in 40 debug
  // ids), and a 16-digit span id is all digits about 1 in 2,000 times.
  const DEBUG_ID = '12345678-9abc-4def-8123-456789012345';
  const SPAN_ID = '1234567890123456';
  const PARENT_SPAN_ID = '9876543210987654';
  const TRACE_ID = '12345678901234567890123456789012';
  const EVENT_ID = '98765432109876543210987654321098';
  const BUNDLE = 'https://gps.csutil.com/tour/assets/index-Bx1.js?v=123456789';

  function eventWithIds(): ErrorEvent {
    return {
      type: undefined,
      event_id: EVENT_ID,
      contexts: {
        trace: {
          trace_id: TRACE_ID,
          span_id: SPAN_ID,
          parent_span_id: PARENT_SPAN_ID,
        },
      },
      debug_meta: {
        images: [{ type: 'sourcemap', code_file: BUNDLE, debug_id: DEBUG_ID }],
      },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'build failed for way/123456789',
            stacktrace: { frames: [{ filename: BUNDLE, lineno: 1, colno: 2 }] },
          },
        ],
      },
    };
  }

  it('keeps the debug id, the event id and the trace ids unchanged', () => {
    const out = options.beforeSend?.(eventWithIds(), {}) as ErrorEvent;
    expect(out.debug_meta?.images?.[0]?.debug_id).toBe(DEBUG_ID);
    expect(out.event_id).toBe(EVENT_ID);
    expect(out.contexts?.trace).toEqual({
      trace_id: TRACE_ID,
      span_id: SPAN_ID,
      parent_span_id: PARENT_SPAN_ID,
    });
  });

  it("still scrubs the rest, and a bundle's file the same way as its frame", () => {
    const out = options.beforeSend?.(eventWithIds(), {}) as ErrorEvent;
    expect(out.exception?.values?.[0]?.value).not.toContain('123456789');
    // The service pairs a frame with its bundle by this file name, so the
    // two must read the same after the scrub.
    const frame = out.exception?.values?.[0]?.stacktrace?.frames?.[0];
    const image = out.debug_meta?.images?.[0];
    expect(image && 'code_file' in image ? image.code_file : undefined).toBe(
      frame?.filename
    );
    expect(frame?.filename).not.toContain('123456789');
  });
});

// Why these tests matter: an unhandled rejection with a plain object carries
// that object, whole, in `extra.__serialized__`: numbers under any key, keys
// of any text. The apps visitors use set no `extra` of their own, so the
// strict profile drops it rather than trusting the scrubber with free-form
// data; the exception text the SDK writes from it is still scrubbed.
describe('strictSentryOptions, data the SDK serialises', () => {
  const options = strictSentryOptions('tour-viewer', OWN, 'gps.csutil.com');

  it('drops the extra data of an unhandled rejection with a plain object', async () => {
    const event = (await eventFromException(
      defaultStackParser,
      { center: [48.137, 11.575], 'at 48.1371, 11.5761': 1 },
      undefined,
      false
    )) as ErrorEvent;
    expect(event.extra).toBeDefined();
    // The strict beforeSend is synchronous; the type allows a promise.
    const out = options.beforeSend?.(event, {}) as ErrorEvent | null;
    expect(out).not.toBeNull();
    expect(out?.extra).toBeUndefined();
    const text = JSON.stringify(out);
    expect(text).not.toContain('48.137');
    expect(text).not.toContain('11.575');
    expect(out?.exception?.values?.length).toBe(1);
  });

  it('does not change the event it was given', () => {
    const event: ErrorEvent = { type: undefined, extra: { a: 1 } };
    options.beforeSend?.(event, {});
    expect(event.extra).toEqual({ a: 1 });
  });
});

describe('workerSentryOptions', () => {
  it("tags a worker's reports with the app and the thread", () => {
    const options = workerSentryOptions('osm-demo', OWN, 'gps.csutil.com');
    expect(options.initialScope).toEqual({
      tags: { app: 'osm-demo', thread: 'worker' },
    });
    expect(runningIntegrationNames(options)).not.toContain('BrowserTracing');
  });
});

// Why these tests matter: a dev server must send nothing, and the test flag
// is how a deployed build is checked end to end; it must send exactly one
// report and nothing else.
describe('startErrorReporting', () => {
  beforeEach(() => {
    vi.mocked(Sentry.init).mockClear();
    vi.mocked(Sentry.captureException).mockClear();
  });

  it('does nothing outside a production build', () => {
    expect(
      startErrorReporting({
        app: 'osm-demo',
        prod: false,
        search: '?sentry-test',
      })
    ).toBe(false);
    expect(startWorkerErrorReporting({ app: 'osm-demo', prod: false })).toBe(
      false
    );
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('starts the strict profile and sends no report without the flag', () => {
    expect(
      startErrorReporting({ app: 'osm-demo', prod: true, search: '' })
    ).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.init).mock.calls[0]?.[0]?.initialScope).toEqual({
      tags: { app: 'osm-demo' },
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('sends one test report when the page address carries the flag', () => {
    startErrorReporting({
      app: 'tour-viewer',
      prod: true,
      search: '?lat=1&sentry-test',
    });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(Sentry.captureException).mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(Error);
    expect((sent as Error).message).toBe(SENTRY_TEST_MESSAGE);
  });

  it('starts the worker profile in a worker', () => {
    expect(startWorkerErrorReporting({ app: 'tour-viewer', prod: true })).toBe(
      true
    );
    expect(vi.mocked(Sentry.init).mock.calls[0]?.[0]?.initialScope).toEqual({
      tags: { app: 'tour-viewer', thread: 'worker' },
    });
  });

  it('reads the flag only as a query parameter', () => {
    expect(wantsTestReport('?sentry-test')).toBe(true);
    expect(wantsTestReport('?a=1&sentry-test=1')).toBe(true);
    expect(wantsTestReport('?sentry-testing')).toBe(false);
    expect(wantsTestReport('')).toBe(false);
    expect(wantsTestReport(undefined)).toBe(false);
  });
});
