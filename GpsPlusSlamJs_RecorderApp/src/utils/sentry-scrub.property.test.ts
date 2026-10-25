/**
 * Error-report scrubber properties.
 *
 * Why these tests matter: the example tests pin the lines the app writes
 * today; these hold the scrubber to its rules for every input, because a
 * log line written next month will not be in the examples. A coordinate pair
 * at any precision the scrubber claims to catch (one number with 3 to 8
 * decimals) never survives, a labelled coordinate never keeps its value, a
 * link to another host never keeps its path (not even after a `{n}`
 * placeholder), scrubbing twice changes nothing more than scrubbing once
 * (Sentry may run the breadcrumb and the event hook over the same text), and
 * text with nothing to scrub comes back unchanged.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { REDACTED, scrubText } from './sentry-scrub';

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

const pairSeparator = fc.constantFrom(', ', ',', ' ');

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
    .tuple(fc.domain(), fc.stringMatching(/^[A-Za-z0-9_/{}.?#=-]{0,30}$/))
    .map(([host, rest]) => `https://${host}/${rest}`),
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
        'start_lng:'
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
        fc.domain().filter((d) => d !== OWN),
        fc.stringMatching(/^[A-Za-z0-9_-]{1,30}$/),
        fc.constantFrom('/x/', '/x/{n}/', '/{n}/', '/x/{n}-'),
        (host, segment, path) => {
          const out = scrubText(
            `see https://${host}${path}${segment}?k=v`,
            OWN
          );
          expect(out).toBe(`see https://${host}/${REDACTED}`);
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
