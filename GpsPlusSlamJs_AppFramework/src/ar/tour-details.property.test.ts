/**
 * Why these properties matter: the detail checks run on a file anyone can
 * edit by hand and on whatever a creator types, and a later format version
 * reuses them unchanged. For any input they must never throw, a kept value
 * must pass its own check again unchanged (so a written tour reads back
 * the same), and a kept contact must only ever lead to `mailto:` or an
 * http(s) page - never a script.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  checkTourContact,
  checkTourCover,
  checkTourDescription,
  checkTourTitle,
  parseTourDetails,
  tourContactHref,
} from './tour-details';

const anything = fc.oneof(
  fc.string(),
  fc.emailAddress(),
  fc.webUrl({ validSchemes: ['https', 'http', 'ftp', 'javascript'] }),
  fc.constantFrom('mailto:', 'javascript:alert(1)', ' ', '\n'),
  fc.anything()
);

describe('tour details (properties)', () => {
  it('never throws, and a kept value passes its own check again unchanged', () => {
    const images = new Set(['a', 'b']);
    fc.assert(
      fc.property(anything, anything, anything, (d, c, k) => {
        const { details, dropped } = parseTourDetails(
          { description: d, cover: c, contact: k },
          { imageIds: images }
        );
        // Every field given is kept or dropped; an undefined one is absent.
        const given = [d, c, k].filter((v) => v !== undefined).length;
        expect(Object.keys(details).length + dropped.length).toBe(given);
        for (const [field, value] of Object.entries(details)) {
          const again =
            field === 'description'
              ? checkTourDescription(value)
              : field === 'cover'
                ? checkTourCover(value, images)
                : checkTourContact(value);
          expect(again).toEqual({ ok: true, value });
        }
      }),
      { numRuns: 500 }
    );
  });

  it('a kept contact leads only to mailto: or an http(s) page', () => {
    fc.assert(
      fc.property(anything, (value) => {
        const checked = checkTourContact(value);
        const href = checked.ok
          ? tourContactHref(checked.value)
          : typeof value === 'string'
            ? tourContactHref(value)
            : null;
        // Kept: a mailto: or http(s) href. Refused: no href at all.
        expect(
          checked.ok ? /^(mailto:|https?:\/\/)/.test(href ?? '') : href === null
        ).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('every e-mail address and https link the generators make is kept', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.emailAddress(), fc.webUrl({ validSchemes: ['https'] })),
        (value) => {
          // Long generated addresses can exceed the cap; that is the cap's
          // job, not a refusal of the form.
          fc.pre([...value].length <= 320);
          expect(checkTourContact(value)).toEqual({ ok: true, value });
        }
      ),
      { numRuns: 300 }
    );
  });

  it('keeps a name exactly when its trimmed text says something in at most 80 characters, and a kept name passes again unchanged', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: 'grapheme', maxLength: 90 }),
          fc.string({ maxLength: 90 }),
          fc.anything()
        ),
        (value) => {
          const checked = checkTourTitle(value);
          const trimmed = typeof value === 'string' ? value.trim() : null;
          const fits =
            trimmed !== null && trimmed !== '' && [...trimmed].length <= 80;
          expect(checked.ok).toBe(fits);
          expect(checked.ok ? checked.value : null).toBe(fits ? trimmed : null);
          // A kept name passes again unchanged.
          expect(checkTourTitle(checked.ok ? checked.value : value)).toEqual(
            checked
          );
        }
      ),
      { numRuns: 500 }
    );
  });
});
