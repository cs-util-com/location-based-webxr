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

  it('keeps nothing of a foreign link after a template placeholder in its path', () => {
    // The framework logger writes `{n}` in place of digits in a message's
    // fingerprint; a brace must not end the link, or the rest of its path
    // would survive.
    expect(
      scrubText(`Failed https://drive.example.org/{n}/${DRIVE_ID}/view`, OWN)
    ).toBe(`Failed https://drive.example.org/${REDACTED}`);
  });

  it('redacts a value that is only a query or only a fragment', () => {
    // The SDK's fetch and XHR spans store a request's query and fragment as
    // attributes of their own (`http.query: "?id=..."`), with no path in
    // front that would mark them as a link.
    expect(scrubText(`?id=${DRIVE_ID}`, OWN)).toBe(REDACTED);
    expect(scrubText('#station-2', OWN)).toBe(REDACTED);
    expect(scrubText('?', OWN)).toBe('?');
    expect(scrubText('? not a query', OWN)).toBe('? not a query');
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

  it('removes coordinates under a camelCase or snake_case label', () => {
    // Objects the app logs name their fields `originLat`, `originLon`,
    // `start_lat` and so on; a label with a prefix is still a coordinate.
    expect(scrubText('originLat=48.1 originLon=11.5', OWN)).toBe(
      `originLat=${REDACTED} originLon=${REDACTED}`
    );
    expect(scrubText('{"anchorLatitude":48.13,"x":1}', OWN)).toBe(
      `{"anchorLatitude":${REDACTED},"x":1}`
    );
    expect(scrubText('start_lng: 11.57', OWN)).toBe(`start_lng: ${REDACTED}`);
  });

  it('does not take a word that merely ends in a label for a coordinate', () => {
    expect(scrubText('flat=5 salon=3 isLatest=1', OWN)).toBe(
      'flat=5 salon=3 isLatest=1'
    );
  });

  it('removes a pair when only one of its numbers has three or more decimals', () => {
    expect(scrubText('at 48.1, 11.576124', OWN)).toBe(`at ${REDACTED}`);
    expect(scrubText('at 48.137154 11.5', OWN)).toBe(`at ${REDACTED}`);
    // Two short decimals stay: ordinary pairs of measurements.
    expect(scrubText('scale 1.50, 2.25', OWN)).toBe('scale 1.50, 2.25');
  });

  it('removes the path and query when a host reads like a labelled number', () => {
    // A number glued to `lat` or `lon` counts as a coordinate, and a host can
    // read that way. Which part of the host survives is cosmetic; what the
    // link rule must still do is remove everything behind it.
    for (const [host, kept] of [
      ['lon5.tiles.example.org', `lon${REDACTED}.tiles.example.org`],
      ['cdn-lat1.example.org', `cdn-lat${REDACTED}.example.org`],
      ['eu-lng2.example.org', `eu-lng${REDACTED}.example.org`],
      ['myLat5.example.org', `myLat${REDACTED}.example.org`],
      ['lat:8080', `lat:${REDACTED}`],
      ['a0lon0a.example.org', 'a0lon0a.example.org'],
      ['salon1.example.org', 'salon1.example.org'],
      ['babylon5.example.org', 'babylon5.example.org'],
    ] as const) {
      expect(scrubText(`see https://${host}/x/7?k=v`, OWN)).toBe(
        `see https://${kept}/${REDACTED}`
      );
    }
  });

  it('keeps removing a whole coordinate written as a host', () => {
    expect(scrubText('https://lat48.1371', OWN)).toBe(`https://lat${REDACTED}`);
  });

  it('removes a whole foreign link when a coordinate sits inside it', () => {
    // A tile or geocoding call carries the position beside a key: removing
    // the position alone must not leave the rest of the query behind.
    const out = scrubText(
      'GET https://tiles.example.org/t?lat=48.1&lon=11.5&key=abc 200',
      OWN
    );
    expect(out).toBe(`GET https://tiles.example.org/${REDACTED} 200`);
    expect(scrubText('https://a.example.org/x/lon5/y?k=v', OWN)).toBe(
      `https://a.example.org/${REDACTED}`
    );
    expect(scrubText('https://a.example.org/48.1371,11.5761/y', OWN)).toBe(
      `https://a.example.org/${REDACTED}`
    );
  });

  it('removes the whole query of an own or a relative link around a coordinate', () => {
    expect(scrubText('https://gps.csutil.com/t/?lat=48.1&id=abc', OWN)).toBe(
      `https://gps.csutil.com/t/?${REDACTED}`
    );
    expect(scrubText('GET /api/tile?lat=48.1&key=abc 200', OWN)).toBe(
      `GET /api/tile?${REDACTED} 200`
    );
    expect(scrubText('GET /api/lon5/tile?key=abc 200', OWN)).toBe(
      `GET /api/lon${REDACTED}/tile?${REDACTED} 200`
    );
  });

  it('still removes a coordinate written where a host would be', () => {
    expect(scrubText('https://lat=48.1/x', OWN)).toBe(
      `https://lat=${REDACTED}/${REDACTED}`
    );
    expect(scrubText('https://48.1371,11.5761/x', OWN)).toBe(
      `https://${REDACTED}/${REDACTED}`
    );
  });

  it('does not take a label inside a word for a coordinate', () => {
    // A hashed asset name can hold `3lat2`: cutting it would break the path
    // a stack trace needs to find its source map.
    const frame = 'https://gps.csutil.com/assets/index-Bx3lat2a9Q.js';
    expect(scrubText(frame, OWN)).toBe(frame);
    expect(scrubText('see a0lon0a.aa', OWN)).toBe('see a0lon0a.aa');
  });

  it('still removes labelled numbers in plain text, with or without a separator', () => {
    expect(scrubText('at lat48.137 lon11', OWN)).toBe(
      `at lat${REDACTED} lon${REDACTED}`
    );
    expect(scrubText('lat48.1lon11.5', OWN)).toBe(
      `lat${REDACTED}lon${REDACTED}`
    );
    expect(scrubText('0lat=5 lat=48N originLat48.1', OWN)).toBe(
      `0lat=${REDACTED} lat=${REDACTED}N originLat${REDACTED}`
    );
  });

  it('removes a glued number of more than three digits, or one split by an underscore', () => {
    // One to three digits are at best a degree (about 111 km) and can be part
    // of a word. From four digits on the value names a place.
    expect(scrubText('lat48_137154', OWN)).toBe(`lat${REDACTED}_137154`);
    expect(scrubText('lat48137154N', OWN)).toBe(`lat${REDACTED}N`);
    expect(scrubText('lat4813a', OWN)).toBe(`lat${REDACTED}a`);
    expect(scrubText('lat48N', OWN)).toBe('lat48N');
  });

  it('removes a link past a bracket, parenthesis or quote in it', () => {
    // These characters are legal in a real URL, so none of them can end one:
    // a query like `a[0]=s` is what a form library sends.
    expect(scrubText('https://[2001:db8::1]/secret?k=v', OWN)).toBe(
      `https://[2001:db8::1]/${REDACTED}`
    );
    for (const path of ['[x]/secret', '(x)/secret', "o'x/secret"]) {
      expect(scrubText(`https://example.org/${path}?k=v`, OWN)).toBe(
        `https://example.org/${REDACTED}`
      );
    }
    expect(scrubText('GET /t?a[0]=s&key=abc 200', OWN)).toBe(
      `GET /t?${REDACTED} 200`
    );
    expect(scrubText('https://gps.csutil.com/t?a[0]=s&key=abc', OWN)).toBe(
      `https://gps.csutil.com/t?${REDACTED}`
    );
  });

  it('still reads a link inside a stack frame or a bracketed list', () => {
    const frame = 'at f (https://gps.csutil.com/recorder/assets/a.js:1:2)';
    expect(scrubText(frame, OWN)).toBe(frame);
    expect(scrubText('[https://example.org/secret, 2]', OWN)).toBe(
      `[https://example.org/${REDACTED} 2]`
    );
  });

  it('removes another link written against the path of an own link', () => {
    expect(
      scrubText("'https://gps.csutil.com/a','https://example.org/secret'", OWN)
    ).toBe(`'https://gps.csutil.com/${REDACTED}`);
  });

  it('removes the user name and password of a link', () => {
    // The browser quotes such a URL in the error it throws for it.
    expect(scrubText('https://user:pw@example.org/x', OWN)).toBe(
      `https://${REDACTED}@example.org/${REDACTED}`
    );
    expect(scrubText('https://user:pw@example.org', OWN)).toBe(
      `https://${REDACTED}@example.org`
    );
    expect(scrubText('https://user:pw@gps.csutil.com/a.js?x=1', OWN)).toBe(
      `https://${REDACTED}@gps.csutil.com/a.js?${REDACTED}`
    );
  });

  it('removes the query of a link relative to the current folder', () => {
    expect(scrubText('GET ./t?key=abc 200', OWN)).toBe(
      `GET ./t?${REDACTED} 200`
    );
    expect(scrubText('GET ../a/t?key=abc 200', OWN)).toBe(
      `GET ../a/t?${REDACTED} 200`
    );
  });

  it('treats a host with no scheme as a link', () => {
    expect(scrubText('see www.example.org/secret?k=v now', OWN)).toBe(
      `see www.example.org/${REDACTED} now`
    );
    expect(scrubText('see //cdn.example.org/secret?k=v now', OWN)).toBe(
      `see //cdn.example.org/${REDACTED} now`
    );
    expect(scrubText('see gps.csutil.com/recorder/a.js?x=1', OWN)).toBe(
      `see gps.csutil.com/recorder/a.js?${REDACTED}`
    );
    // A file path stays: its first part has no dot and top-level name.
    expect(scrubText('src/utils/sentry.ts', OWN)).toBe('src/utils/sentry.ts');
  });

  it('removes a pair written as a path or percent-encoded', () => {
    expect(scrubText('GET /tiles/48.1371/11.5761/z.png 200', OWN)).toBe(
      `GET /tiles/${REDACTED}/z.png 200`
    );
    for (const sep of ['%2C', '%2c', '%20', '+']) {
      expect(scrubText(`at=48.1371${sep}11.5761`, OWN)).toBe(`at=${REDACTED}`);
    }
  });

  it('removes a pair at the end of a sentence or split by a semicolon', () => {
    expect(scrubText('at 48.137154, 11.576124.', OWN)).toBe(`at ${REDACTED}.`);
    expect(scrubText('at 48.1371;11.5761', OWN)).toBe(`at ${REDACTED}`);
    // A dot with a digit behind it is still a longer number, not an end.
    expect(scrubText('v 1.234 5.6.7', OWN)).toBe('v 1.234 5.6.7');
  });

  it('removes the value behind a label with an index or a unit', () => {
    expect(scrubText('lat1=48.1371 lon12: 11.5761', OWN)).toBe(
      `lat1=${REDACTED} lon12: ${REDACTED}`
    );
    expect(scrubText('latDeg=48.1371 {lon_deg:11.5761}', OWN)).toBe(
      `latDeg=${REDACTED} {lon_deg:${REDACTED}}`
    );
    expect(scrubText('originLatDeg=48.1371 aLonDegrees: 11.5', OWN)).toBe(
      `originLatDeg=${REDACTED} aLonDegrees: ${REDACTED}`
    );
  });

  it('reads `long` as a label only with a separator', () => {
    expect(scrubText('long=11.5761 "long":11.5', OWN)).toBe(
      `long=${REDACTED} "long":${REDACTED}`
    );
    // The ordinary word stays.
    expect(scrubText('too long 5 ms, isLong=1', OWN)).toBe(
      'too long 5 ms, isLong=1'
    );
  });

  it('removes a value in single quotes', () => {
    expect(scrubText("{lat: '48.1371', 'lon': '11.5761'}", OWN)).toBe(
      `{lat: ${REDACTED}, 'lon': ${REDACTED}}`
    );
  });

  // Why this test matters: a closing quote or bracket is part of the link
  // (URLs may hold them), so an id right in front of one must still count as
  // a whole path segment. This is how an error message quotes a failed link.
  it.each(["'", ')', ']', ',', ';'])(
    'removes an id of this site in front of %s',
    (end) => {
      expect(
        scrubText(`Failed https://gps.csutil.com/files/${DRIVE_ID}${end}`, OWN)
      ).toBe(`Failed https://gps.csutil.com/files/${REDACTED}${end}`);
      expect(scrubText(`GET /files/${DRIVE_ID}${end} 200`, OWN)).toBe(
        `GET /files/${REDACTED}${end} 200`
      );
    }
  );

  it('removes a quoted id, and one in a stack frame, as the app writes them', () => {
    expect(
      scrubText(`Failed to load 'https://gps.csutil.com/files/${DRIVE_ID}'`, OWN)
    ).toBe(`Failed to load 'https://gps.csutil.com/files/${REDACTED}'`);
    expect(
      scrubText(`at load (https://gps.csutil.com/files/${DRIVE_ID})`, OWN)
    ).toBe(`at load (https://gps.csutil.com/files/${REDACTED})`);
  });

  it('keeps a long hashed asset name, which has a dot behind it', () => {
    const asset = `https://gps.csutil.com/assets/index-${'a'.repeat(30)}.js`;
    expect(scrubText(asset, OWN)).toBe(asset);
  });

  it('removes both numbers of a pair behind a label', () => {
    expect(scrubText('lat=48.137154,11.576124', OWN)).toBe(`lat=${REDACTED}`);
    expect(scrubText('latLng: 48.1371, 11.5761', OWN)).toBe(
      `latLng: ${REDACTED}`
    );
  });

  it('reads a host with no scheme in square brackets as a link', () => {
    expect(scrubText('[www.example.org/x?q=Hauptstrasse+12]', OWN)).toBe(
      `[www.example.org/${REDACTED}`
    );
  });

  it('removes an id from a relative link with no query', () => {
    expect(scrubText(`GET /files/${DRIVE_ID} 200`, OWN)).toBe(
      `GET /files/${REDACTED} 200`
    );
  });

  // Why this test matters: this code runs on the phone inside the error path,
  // on text it does not control. Each input is sized so that a rule that
  // rescans (quadratic) would run for minutes and fail on the test timeout,
  // while a linear one takes a blink, so no clock is read and no load margin
  // is needed.
  it.each([
    ['labels glued to digits', 'lat5.'],
    ['camelCase prefixes', 'a0'],
    ['a scheme that never ends', 'a'],
    ['labels before spaces', 'lat  '],
    ['spaces after a label', ' '],
    ['relative links with no query', '=/a'],
    ['numbers with no partner', '1.234 '],
    ['dotted names', 'a.b'],
  ])('stays linear on %s', (_name, unit) => {
    const text = `lat${unit.repeat(Math.ceil(2_000_000 / unit.length))}`;
    expect(typeof scrubText(text, OWN)).toBe('string');
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
  it('removes everything under a coordinate key, an array or an object too', () => {
    // A position is often held as `[lat, lon]` or `{ value }`: the field name
    // is what says so, whatever shape the value has.
    expect(
      scrubDeep(
        {
          latLng: [48.137154, 11.576124],
          lat: { value: 48.137154 },
          lon: undefined,
          name: { value: 1 },
        },
        OWN
      )
    ).toEqual({
      latLng: REDACTED,
      lat: REDACTED,
      lon: undefined,
      name: { value: 1 },
    });
  });

  it('removes a coordinate held as a number under a labelled key', () => {
    // An object the app logs, or an error's own fields, carry numbers rather
    // than text, and the text rules never see those.
    const out = scrubDeep(
      {
        lat: 48.1371,
        longitude: '11.5761',
        originLat: 48.1,
        start_lng: 11.5,
        flat: 5,
        isLatest: 1,
        lat_note: 'ok',
        latDeg: 48.1371,
        long: 11.5761,
        nested: [{ LON: 11.5 }],
        unset: { lat: null },
      },
      OWN
    );
    expect(out).toEqual({
      lat: REDACTED,
      longitude: REDACTED,
      originLat: REDACTED,
      start_lng: REDACTED,
      flat: 5,
      isLatest: 1,
      lat_note: 'ok',
      latDeg: REDACTED,
      long: REDACTED,
      nested: [{ LON: REDACTED }],
      unset: { lat: null },
    });
  });

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
