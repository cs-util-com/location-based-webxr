import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { normalizeShareUrl } from './share-link.js';

/**
 * Why these tests matter: the passthrough half of the contract — anything not
 * positively recognized as a provider share page returns BYTE-IDENTICAL — is
 * what makes this function safe to call unconditionally on every URL a user
 * pastes. A regression here silently corrupts direct URLs and proxy URLs
 * that already work (exactly what the unconditional-OneDrive-wrap defect D5
 * did). The never-throws property covers arbitrary garbage input.
 */

/** Hostnames the normalizer claims for itself. */
const PROVIDER_HOSTS = new Set([
  'dropbox.com',
  'www.dropbox.com',
  'github.com',
  'drive.google.com',
  '1drv.ms',
  'onedrive.live.com',
]);

function isProviderUrl(url: string): boolean {
  try {
    return PROVIDER_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

describe('normalizeShareUrl — properties', () => {
  it('returns any non-provider web URL byte-identical', () => {
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ['http', 'https'], size: 'medium' }),
        (url) => {
          fc.pre(!isProviderUrl(url));
          expect(normalizeShareUrl(url)).toBe(url);
        }
      )
    );
  });

  it('never throws and always returns a string, for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        expect(typeof normalizeShareUrl(raw)).toBe('string');
      })
    );
  });
});
