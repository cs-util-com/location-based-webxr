/**
 * Error-report scrubber properties.
 *
 * Why these tests matter: the example tests pin the lines the app writes
 * today; these hold the scrubber to its rules for every input, because a
 * log line written next month will not be in the examples. A coordinate pair
 * at any precision the scrubber claims to catch (3 to 8 decimals) never
 * survives, a link to another host never keeps its path, scrubbing twice
 * changes nothing more than scrubbing once (Sentry may run the breadcrumb
 * and the event hook over the same text), and text with nothing to scrub
 * comes back unchanged.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { REDACTED, scrubText } from './sentry-scrub';

const OWN = 'gps.csutil.com';

/** Prose with no digits, slashes or `=`, so it cannot itself look sensitive. */
const plainText = fc
  .string({ maxLength: 40 })
  .map((s) => s.replace(/[\d/=:]/g, ''));

const coordinate = (max: number) =>
  fc
    .tuple(
      fc.integer({ min: -max, max }),
      fc.integer({ min: 3, max: 8 }),
      fc.nat()
    )
    .map(([whole, decimals, frac]) => {
      const digits = String(frac).padStart(decimals, '1').slice(0, decimals);
      return `${whole}.${digits}`;
    });

describe('scrubText properties', () => {
  it('never lets a latitude/longitude pair through', () => {
    fc.assert(
      fc.property(
        plainText,
        coordinate(90),
        coordinate(180),
        fc.constantFrom(', ', ',', ' '),
        plainText,
        (before, lat, lon, sep, after) => {
          const out = scrubText(`${before} ${lat}${sep}${lon} ${after}`, OWN);
          expect(out).not.toContain(`${lat}${sep}${lon}`);
          expect(out).toContain(REDACTED);
        }
      )
    );
  });

  it("never keeps the path of another host's link", () => {
    fc.assert(
      fc.property(
        fc.domain().filter((d) => d !== OWN),
        fc.stringMatching(/^[A-Za-z0-9_-]{1,30}$/),
        (host, segment) => {
          const out = scrubText(`see https://${host}/x/${segment}?k=v`, OWN);
          expect(out).toBe(`see https://${host}/${REDACTED}`);
        }
      )
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (text) => {
        const once = scrubText(text, OWN);
        expect(scrubText(once, OWN)).toBe(once);
      })
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
