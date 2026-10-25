/**
 * Error-report scrubber tests.
 *
 * Why these tests matter: the recorder's error reports leave the device, and
 * three kinds of text in them would say more than an error report needs to:
 * a tour or file link (it names a file someone shared), a file id (the site's
 * file service is called with one in its query), and a latitude/longitude pair
 * (the framework logger writes the session's zero reference as one). Each
 * case below is a line the app can really produce; the scrubber must remove
 * the sensitive part and keep what makes the report useful (the host, the
 * app's own script paths for stack traces, the event ids Sentry needs).
 */

import { describe, it, expect } from 'vitest';
import { REDACTED, scrubDeep, scrubText } from './sentry-scrub';

const OWN = 'gps.csutil.com';
const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('scrubText', () => {
  it('drops the query and fragment of a link to this site, keeping its path', () => {
    const tourLink =
      'https://gps.csutil.com/tour/?qr=https%3A%2F%2Fexample.org%2Ft.zip#station-2';
    expect(scrubText(`opened ${tourLink} ok`, OWN)).toBe(
      `opened https://gps.csutil.com/tour/?${REDACTED} ok`
    );
  });

  it("keeps this site's script paths whole, so stack traces still resolve", () => {
    const frame = 'https://gps.csutil.com/recorder/assets/index-Bx3k2a9Q.js';
    expect(scrubText(frame, OWN)).toBe(frame);
  });

  it('reduces a link to another host to the host alone', () => {
    const shared = `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`;
    const out = scrubText(`Failed to fetch ${shared}`, OWN);
    expect(out).toBe(`Failed to fetch https://drive.google.com/${REDACTED}`);
    expect(out).not.toContain(DRIVE_ID);
  });

  it('removes the file id from a relative call to the file service', () => {
    const out = scrubText(`GET /api/drive-proxy?id=${DRIVE_ID} 200`, OWN);
    expect(out).toBe(`GET /api/drive-proxy?${REDACTED} 200`);
  });

  it('redacts an id-like path segment of this site', () => {
    const out = scrubText(`https://gps.csutil.com/files/${DRIVE_ID}/x`, OWN);
    expect(out).toBe(`https://gps.csutil.com/files/${REDACTED}/x`);
  });

  it('treats every host as foreign when the own host is unknown', () => {
    expect(scrubText('https://gps.csutil.com/recorder/a.js', undefined)).toBe(
      `https://gps.csutil.com/${REDACTED}`
    );
  });

  it('removes a latitude/longitude pair as the zero-reference log line writes it', () => {
    const out = scrubText(
      '[GpsEvents] Set zero reference: 48.137154, 11.576124',
      OWN
    );
    expect(out).toBe(`[GpsEvents] Set zero reference: ${REDACTED}`);
  });

  it('removes a pair written without a space and a negative pair', () => {
    expect(scrubText('raw=[48.1371,11.5761,512.3]', OWN)).toBe(
      `raw=[${REDACTED},512.3]`
    );
    expect(scrubText('at -33.86882 151.20929', OWN)).toBe(`at ${REDACTED}`);
  });

  it('removes keyed coordinates, quoted or not', () => {
    const json = '{"latitude":48.13,"longitude":"11.57","name":"x"}';
    expect(scrubText(json, OWN)).toBe(
      `{"latitude":${REDACTED},"longitude":${REDACTED},"name":"x"}`
    );
    expect(scrubText('lat=48.1 lon=11.5', OWN)).toBe(
      `lat=${REDACTED} lon=${REDACTED}`
    );
  });

  it('leaves ordinary log text alone', () => {
    const line = '[Recorder] Session started: 3 frames, 1.5x speed, rate 0.25';
    expect(scrubText(line, OWN)).toBe(line);
    expect(scrubText('lacks finite latitude/longitude', OWN)).toBe(
      'lacks finite latitude/longitude'
    );
  });
});

describe('scrubDeep', () => {
  it('scrubs every string in a nested event and keeps ids and numbers', () => {
    const event = {
      event_id: 'a3f2504e04f8911d39a0c0305e82c330',
      timestamp: 1767225600.123,
      message: 'Set zero reference: 48.137154, 11.576124',
      request: { url: 'https://gps.csutil.com/recorder/?debug=1' },
      breadcrumbs: [
        {
          category: 'fetch',
          data: { url: `/api/drive-proxy?id=${DRIVE_ID}`, status_code: 200 },
        },
      ],
      contexts: { trace: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736' } },
    };
    const out = scrubDeep(event, OWN);
    const text = JSON.stringify(out);
    expect(text).not.toContain(DRIVE_ID);
    expect(text).not.toContain('48.137154');
    expect(text).not.toContain('debug=1');
    expect(out.event_id).toBe(event.event_id);
    expect(out.timestamp).toBe(event.timestamp);
    expect(out.contexts.trace.trace_id).toBe(event.contexts.trace.trace_id);
    expect(out.breadcrumbs[0]?.data.status_code).toBe(200);
  });

  it('does not change its input', () => {
    const event = { message: 'at 48.137154, 11.576124' };
    scrubDeep(event, OWN);
    expect(event.message).toBe('at 48.137154, 11.576124');
  });

  it('survives a cycle', () => {
    const a: { self?: unknown; text: string } = { text: 'lat=1.5' };
    a.self = a;
    const out = scrubDeep(a, OWN);
    expect(out.text).toBe(`lat=${REDACTED}`);
    expect(out.self).toBe(out);
  });

  it('replaces a subtree deeper than the limit rather than sending it unread', () => {
    let deep: Record<string, unknown> = { text: 'lat=1.5' };
    for (let i = 0; i < 40; i++) deep = { next: deep };
    expect(JSON.stringify(scrubDeep(deep, OWN))).not.toContain('1.5');
  });
});
