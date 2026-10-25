/**
 * Error-reporting configuration tests.
 *
 * Why these tests matter: the recorder's error reports are described on the
 * site's privacy page, and that description is only true while this
 * configuration stays reduced: no default personal data (so the service is
 * told not to store the IP address), traces from a sample of page loads
 * rather than all of them, no forwarding of console output as logs, and every
 * report and breadcrumb passed through the scrubber before it leaves. A
 * change to any of these values must fail here, so that it is a decision
 * made together with the privacy text rather than a silent drift.
 */

import { describe, it, expect } from 'vitest';
import type { Breadcrumb, BrowserOptions, ErrorEvent } from '@sentry/browser';
import { TRACES_SAMPLE_RATE, sentryOptions } from './sentry';

type TransactionEvent = Parameters<
  NonNullable<BrowserOptions['beforeSendTransaction']>
>[0];

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

  it('samples traces well below every page load', () => {
    expect(TRACES_SAMPLE_RATE).toBe(0.1);
    expect(options.tracesSampleRate).toBe(TRACES_SAMPLE_RATE);
  });

  it('forwards no console output as logs', () => {
    const names = (
      Array.isArray(options.integrations) ? options.integrations : []
    ).map((integration) => integration.name);
    expect(names).toContain('BrowserTracing');
    expect(names).not.toContain('ConsoleLogs');
    expect(options.enableLogs).not.toBe(true);
    expect(
      (options as { _experiments?: { enableLogs?: boolean } })._experiments
        ?.enableLogs
    ).not.toBe(true);
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
          data: {},
          description: `GET https://gps.csutil.com/api/drive-proxy?id=${DRIVE_ID}`,
        },
      ],
    };
    const out = options.beforeSendTransaction?.(transaction, {});
    expect(JSON.stringify(out)).not.toContain(DRIVE_ID);
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
