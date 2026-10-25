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

import { describe, it, expect } from 'vitest';
import { getDefaultIntegrations } from '@sentry/browser';
import type { Breadcrumb, BrowserOptions, ErrorEvent } from '@sentry/browser';
import { TRACES_SAMPLE_RATE, sentryOptions } from './sentry';

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
