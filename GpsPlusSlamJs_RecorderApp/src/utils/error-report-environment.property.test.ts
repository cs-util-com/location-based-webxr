/**
 * Error-report environment label properties.
 *
 * Why these tests matter: the examples pin the known addresses; these hold
 * the rule for every host. The label is total (any input, one of three
 * labels, never a throw); "production" is given to the listed live
 * addresses and nothing else, so no preview or stranger can ever be
 * counted as the live site; every branch label in front of the worker's
 * address is a preview; and letter case never changes the answer.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  errorReportEnvironment,
  PRODUCTION_HOSTS,
} from './error-report-environment';

const LABELS = ['production', 'preview', 'development'];

/** A host-like string: labels of letters, digits and hyphens, dot-joined. */
const hostLike = fc
  .array(fc.stringMatching(/^[a-zA-Z0-9-]{1,12}$/), {
    minLength: 1,
    maxLength: 4,
  })
  .map((labels) => labels.join('.'));

/** A live address in any letter case, with or without a trailing dot. */
const liveHost = fc
  .tuple(
    fc.constantFrom(...PRODUCTION_HOSTS),
    fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
    fc.boolean()
  )
  .map(
    ([host, upper, dot]) =>
      [...host].map((c, i) => (upper[i] ? c.toUpperCase() : c)).join('') +
      (dot ? '.' : '')
  );

const anyHost = fc.oneof(fc.string({ maxLength: 60 }), hostLike, liveHost);

describe('errorReportEnvironment properties', () => {
  it('gives one of the three labels for any input', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(LABELS).toContain(errorReportEnvironment(value as string));
      })
    );
  });

  it('gives "production" only to a listed live address', () => {
    fc.assert(
      fc.property(anyHost, (host) => {
        const live = PRODUCTION_HOSTS.includes(
          host.toLowerCase().replace(/\.$/, '')
        );
        expect(errorReportEnvironment(host) === 'production').toBe(live);
      })
    );
    // The generator does reach the live addresses, so the property is
    // tested on both sides.
    const sample = fc.sample(anyHost, { numRuns: 300, seed: 1 });
    expect(
      sample.filter((h) => errorReportEnvironment(h) === 'production').length
    ).toBeGreaterThan(20);
  });

  it('labels every branch label in front of the worker address a preview', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,40}$/), (branch) => {
        expect(
          errorReportEnvironment(`${branch}-gps-plus-slam.csutil.workers.dev`)
        ).toBe('preview');
      })
    );
  });

  it('does not depend on letter case', () => {
    fc.assert(
      fc.property(anyHost, (host) => {
        expect(errorReportEnvironment(host.toUpperCase())).toBe(
          errorReportEnvironment(host.toLowerCase())
        );
      })
    );
  });
});
