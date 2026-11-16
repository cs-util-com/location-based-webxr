/**
 * Error-report scrubber properties.
 *
 * Why these tests matter: the example tests pin the lines the app writes
 * today; these hold the scrubber to its rules for every input, because a
 * log line written next month will not be in the examples. A coordinate pair
 * at any precision the scrubber claims to catch (one number with 3 to 8
 * decimals) never survives, a labelled coordinate never keeps its value, a
 * link to another host never keeps its path (not even after a `{n}`
 * placeholder, and not when its host or path reads like a labelled number:
 * those shapes are generated on purpose, because a random host hits one only
 * once in very many runs), scrubbing twice changes nothing more than scrubbing once
 * (Sentry may run the breadcrumb and the event hook over the same text), and
 * text with nothing to scrub comes back unchanged.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { REDACTED, scrubDeep, scrubText } from './sentry-scrub';

const OWN = 'gps.csutil.com';

/**
 * Prose with no digits, slashes, `=`, `:`, `?` or `#`, so it cannot itself
 * look sensitive (a string that is only `?x` or `#x` is a query or a
 * fragment, which the scrubber removes).
 */
const plainText = fc
  .string({ maxLength: 40 })
  .map((s) => s.replace(/[\d/=:?#]/g, ''));

/** A decimal number in [-max, max] with `minDecimals` to `maxDecimals` decimals. */
const coordinate = (max: number, minDecimals = 3, maxDecimals = 8) =>
  fc
    .tuple(
      fc.integer({ min: -max, max }),
      fc.integer({ min: minDecimals, max: maxDecimals }),
      fc.nat()
    )
    .map(([whole, decimals, frac]) => {
      if (decimals === 0) return String(whole);
      const digits = String(frac).padStart(decimals, '1').slice(0, decimals);
      return `${whole}.${digits}`;
    });

const pairSeparator = fc.constantFrom(
  ', ',
  ',',
  ' ',
  ';',
  ':',
  ' | ',
  '|',
  ' - '
);

const label = fc.constantFrom(
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'Lat',
  'LON',
  'originLat'
);

/** A name that reads like a labelled number: `lon5`, `cdn-lat1a`, `a0lng0`. */
const labelledName = fc
  .tuple(
    fc.constantFrom('', 'a', 'a0', 'cdn-', 'sa', 'x_', '7'),
    label,
    fc.nat({ max: 999 }),
    fc.constantFrom('', 'a', '-1', '0b', '-x')
  )
  .map((parts) => parts.join(''));

/** A host of such a name, with or without a subdomain under it and a port. */
const labelledHost = fc
  .tuple(
    labelledName,
    fc.constantFrom('.example.org', '.tiles.example.org', '.aa'),
    fc.constantFrom('', ':8080')
  )
  .map((parts) => parts.join(''));

const foreignHost = fc.oneof(fc.domain(), labelledHost);

/** A link reduced to its host, however much of the host a label cost it. */
const HOST_ONLY = /^https:\/\/[^/?#]*\/\[redacted\]$/;

/**
 * Pieces of the text an error report really carries: links to this site and
 * to others (with `{n}` placeholders, queries and fragments), relative calls
 * with a file id, bare queries and fragments, coordinate pairs, labelled
 * coordinates, the punctuation around them, and random noise. Joined, they
 * build the inputs where the rules meet and overlap, which plain random
 * strings almost never do.
 */
const reportFragment = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.constantFrom(' ', ',', '"', "'", '=', ':', '?', '#', '/', '{n}', '[', ']'),
  fc.constant(REDACTED),
  fc
    .tuple(foreignHost, fc.stringMatching(/^[A-Za-z0-9_/{}.?#=-]{0,30}$/))
    .map(([host, rest]) => `https://${host}/${rest}`),
  labelledName,
  fc
    .tuple(
      fc.stringMatching(/^[A-Za-z0-9_-]{25,40}$/),
      fc.constantFrom("'", ')', ']', ',', ';')
    )
    .map(([id, end]) => `https://${OWN}/files/${id}${end}`),
  fc
    .tuple(foreignHost, labelledName)
    .map(([host, name]) => `https://${host}/${name}?k=v`),
  fc
    .tuple(labelledName, labelledName)
    .map(([name, other]) => `/api/${name}?${other}=1&k=v`),
  fc
    .stringMatching(/^[A-Za-z0-9_/{}.?#=-]{0,40}$/)
    .map((rest) => `https://${OWN}/${rest}`),
  fc
    .stringMatching(/^[A-Za-z0-9_-]{20,40}$/)
    .map((id) => `/api/drive-proxy?id=${id}`),
  fc.stringMatching(/^[A-Za-z0-9_-]{1,40}$/).map((id) => `?id=${id}`),
  fc.stringMatching(/^[a-z0-9-]{1,12}$/).map((frag) => `#${frag}`),
  fc
    .tuple(coordinate(90, 1), pairSeparator, coordinate(180, 1))
    .map(([lat, sep, lon]) => `${lat}${sep}${lon}`),
  fc
    .tuple(
      fc.constantFrom(
        'lat=',
        'lon: ',
        '"latitude":',
        'originLat=',
        'start_lng:',
        'lat',
        'lon',
        'lat1=',
        'latDeg=',
        'originLonDeg:',
        'long=',
        "lat: '"
      ),
      coordinate(180, 0)
    )
    .map(([label, value]) => `${label}${value}`)
);

const reportText = fc
  .array(reportFragment, { maxLength: 8 })
  .map((parts) => parts.join(''));

describe('scrubText properties', () => {
  it('never lets a latitude/longitude pair through', () => {
    fc.assert(
      fc.property(
        plainText,
        coordinate(90),
        coordinate(180),
        pairSeparator,
        plainText,
        (before, lat, lon, sep, after) => {
          const out = scrubText(`${before} ${lat}${sep}${lon} ${after}`, OWN);
          expect(out).not.toContain(`${lat}${sep}${lon}`);
          expect(out).toContain(REDACTED);
        }
      )
    );
  });

  it('never lets a pair through when only one number has three or more decimals', () => {
    fc.assert(
      fc.property(
        coordinate(90, 1, 2),
        coordinate(180),
        pairSeparator,
        fc.boolean(),
        (short, long, sep, shortFirst) => {
          const pair = shortFirst
            ? `${short}${sep}${long}`
            : `${long}${sep}${short}`;
          const out = scrubText(`at ${pair} now`, OWN);
          expect(out).toBe(`at ${REDACTED} now`);
        }
      )
    );
  });

  it('never keeps the value of a coordinate under a camelCase label', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
        fc.constantFrom('Lat', 'Lon', 'Lng', 'Latitude', 'Longitude'),
        fc.constantFrom('=', ': ', '":'),
        coordinate(180, 0),
        (prefix, label, sep, value) => {
          const out = scrubText(`{${prefix}${label}${sep}${value}}`, OWN);
          expect(out).toBe(`{${prefix}${label}${sep}${REDACTED}}`);
        }
      )
    );
  });

  it("never keeps the path of another host's link", () => {
    fc.assert(
      fc.property(
        foreignHost.filter((d) => d !== OWN),
        fc.oneof(fc.stringMatching(/^[A-Za-z0-9_-]{1,30}$/), labelledName),
        fc.constantFrom('/x/', '/x/{n}/', '/{n}/', '/x/{n}-'),
        (host, segment, path) => {
          const out = scrubText(
            `see https://${host}${path}${segment}?k=v`,
            OWN
          );
          expect(out.slice('see '.length)).toMatch(HOST_ONLY);
        }
      )
    );
  });

  it("never keeps what follows a coordinate in a link's query", () => {
    fc.assert(
      fc.property(
        foreignHost.filter((d) => d !== OWN),
        fc.constantFrom('lat=', 'lon=', 'originLat=', 'latitude:'),
        coordinate(180, 0),
        (host, key, value) => {
          const tail = `?${key}${value}&key=abc`;
          expect(scrubText(`https://${host}/t${tail}`, OWN)).toMatch(HOST_ONLY);
          expect(scrubText(`https://${OWN}/t${tail}`, OWN)).toBe(
            `https://${OWN}/t?${REDACTED}`
          );
          expect(scrubText(`GET /t${tail} 200`, OWN)).toBe(
            `GET /t?${REDACTED} 200`
          );
        }
      )
    );
  });

  it('never keeps the path of a link with URL punctuation in it', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9_()[\]'{}.,;!*~-]{1,30}$/),
        (segment) => {
          const out = scrubText(`https://example.org/${segment}/s?k=v`, OWN);
          expect(out).toMatch(HOST_ONLY);
          expect(scrubText(`/t?${segment}&k=v`, OWN)).toBe(`/t?${REDACTED}`);
        }
      )
    );
  });

  it('never keeps an id of this site, whatever follows it', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9_-]{25,44}$/),
        fc.constantFrom('', "'", ')', ']', ',', ';', ':1:2)', '/x', '?k=v'),
        (id, end) => {
          const link = `https://${OWN}/files/${id}${end}`;
          expect(scrubText(`see ${link}`, OWN)).not.toContain(id);
          expect(scrubText(`GET /files/${id}${end} 200`, OWN)).not.toContain(
            id
          );
        }
      )
    );
  });

  it('never keeps a number of a pair behind a label', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('lat=', 'lon: ', 'latLng: ', 'origin_lat='),
        coordinate(90),
        coordinate(180),
        pairSeparator,
        (key, lat, lon, sep) => {
          expect(scrubText(`${key}${lat}${sep}${lon}`, OWN)).toBe(
            `${key}${REDACTED}`
          );
        }
      )
    );
  });

  it('is idempotent on random text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (text) => {
        const once = scrubText(text, OWN);
        expect(scrubText(once, OWN)).toBe(once);
      })
    );
  });

  it('is idempotent on text built from what reports carry', () => {
    fc.assert(
      fc.property(reportText, (text) => {
        const once = scrubText(text, OWN);
        expect(scrubText(once, OWN)).toBe(once);
      }),
      { numRuns: 2000 }
    );
  });

  it('returns text with nothing to scrub unchanged', () => {
    fc.assert(
      fc.property(plainText, (text) => {
        expect(scrubText(text, OWN)).toBe(text);
      })
    );
  });
});

/** A pair, written the ways the scrubber claims to catch. */
const coordinatePair = fc
  .tuple(coordinate(90), pairSeparator, coordinate(180), fc.boolean())
  .map(([lat, sep, lon, latFirst]) =>
    latFirst ? `${lat}${sep}${lon}` : `${lon}${sep}${lat}`
  );

/**
 * What "looks like a coordinate pair" means to the check below: two decimal
 * numbers next to each other, one of them with three or more decimals.
 */
const LOOKS_LIKE_PAIR =
  /-?\d{1,3}\.\d{3,}\s*(?:,|;|\/|:|\||\s-\s|\s)\s*-?\d{1,3}\.\d+|-?\d{1,3}\.\d+\s*(?:,|;|\/|:|\||\s-\s|\s)\s*-?\d{1,3}\.\d{3,}/;

/** Every string anywhere in `value`, keys included. */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, out));
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      stringsIn(item, out);
    }
  }
  return out;
}

/** A string leaf carrying a coordinate pair among plain words. */
const leafWithPair = fc
  .tuple(plainText, coordinatePair, plainText)
  .map(([before, pair, after]) => `${before} ${pair} ${after}`);

/** A coordinate pair held as two numbers, the way a serialised object does. */
const numericPair = fc
  .tuple(coordinate(90), coordinate(180), fc.boolean())
  .map(([lat, lon, latFirst]) =>
    latFirst ? [Number(lat), Number(lon)] : [Number(lon), Number(lat)]
  );

/** Two numbers within ±180 that, written as text, read as a pair. */
function readsAsPair(value: unknown[]): value is [number, number] {
  const [a, b] = value;
  return (
    value.length === 2 &&
    typeof a === 'number' &&
    typeof b === 'number' &&
    Math.abs(a) <= 180 &&
    Math.abs(b) <= 180 &&
    LOOKS_LIKE_PAIR.test(`${a}, ${b}`)
  );
}

/**
 * Every array of two numbers anywhere in `value` that reads as a pair: both
 * within ±180 (the range the scrubber claims) and, written as text, a pair by
 * {@link LOOKS_LIKE_PAIR}.
 */
function numericPairsIn(value: unknown, out: number[][] = []): number[][] {
  if (Array.isArray(value)) {
    if (readsAsPair(value)) out.push(value);
    value.forEach((item) => numericPairsIn(item, out));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => numericPairsIn(item, out));
  }
  return out;
}

/**
 * An event-shaped value: nested objects and arrays, pairs in its leaves and
 * in its keys (a serialised object can be keyed by anything), plain floats
 * and pairs held as numbers.
 */
const eventWithPairs = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leafWithPair,
    plainText,
    fc.integer(),
    fc.double({ min: -1000, max: 1000, noNaN: true }),
    numericPair,
    fc.array(tie('node'), { maxLength: 4 }),
    fc.dictionary(
      fc.oneof(
        fc.constantFrom('message', 'value', 'data', 'url', 'extra', 'title'),
        leafWithPair
      ),
      tie('node'),
      { maxKeys: 4 }
    )
  ),
})).node;

// Why this matters: the Tour Viewer and the map demo hand the scrubber whole
// events of any shape (breadcrumb data, exception values, contexts, the
// object a promise was rejected with). Whatever string field or key a place
// lands in, or as two numbers under whatever key, in either profile, no pair
// may come out. Keys are drawn from the pair leaves too: with fixed keys the
// check on keys could never fail.
describe('scrubDeep properties', () => {
  it('lets no coordinate pair through in any string field or key', () => {
    fc.assert(
      fc.property(eventWithPairs, fc.boolean(), (event, strict) => {
        const out = scrubDeep(event, OWN, { strict });
        for (const text of stringsIn(out)) {
          expect(text).not.toMatch(LOOKS_LIKE_PAIR);
        }
        expect(numericPairsIn(out)).toEqual([]);
      }),
      { numRuns: 300 }
    );
  });
});

/** Report text with quotes of every kind mixed in. */
const quotedReportText = fc
  .array(
    fc.oneof(
      reportFragment,
      fc.constantFrom('"', "'", '`', '"x y"', "can't", '8d1f8d3a1c3a43f'),
      fc.bigInt({ min: 100000n, max: 99999999999n }).map(String)
    ),
    { maxLength: 10 }
  )
  .map((parts) => parts.join(''));

// Why this matters: the strict profile adds rules for quoted text and long
// digit runs; Sentry may run the breadcrumb hook and the event hook over the
// same text, so a second pass must change nothing, and no H3 cell or OSM id
// may survive whatever surrounds it.
describe('scrubText properties, strict', () => {
  const strict = { strict: true } as const;

  it('is idempotent on text built from what reports carry, with quotes', () => {
    fc.assert(
      fc.property(quotedReportText, (text) => {
        const once = scrubText(text, OWN, strict);
        expect(scrubText(once, OWN, strict)).toBe(once);
      }),
      { numRuns: 2000 }
    );
  });

  it('is idempotent on random text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (text) => {
        const once = scrubText(text, OWN, strict);
        expect(scrubText(once, OWN, strict)).toBe(once);
      })
    );
  });

  it('never keeps an H3 cell or an OSM id', () => {
    fc.assert(
      fc.property(
        plainText,
        fc.stringMatching(/^8[0-9a-f]{14}$/),
        fc.constantFrom('way/', 'node ', 'relation=', 'id: ', ''),
        fc.bigInt({ min: 100000n, max: 99999999999n }),
        plainText,
        (before, cell, kind, id, after) => {
          const out = scrubText(
            `${before} ${cell} ${kind}${id} ${after}`,
            OWN,
            strict
          );
          expect(out).not.toContain(cell);
          expect(out).not.toContain(String(id));
        }
      )
    );
  });
});
