/**
 * The page must not fetch its stylesheets or scripts from someone else's host.
 *
 * WHY THIS GUARD EXISTS, and it is not hypothetical. Until 2026-08-19
 * `index.html` loaded Tailwind from `cdn.tailwindcss.com` and Leaflet's CSS
 * from `unpkg.com`. On that day the Tailwind host answered `302` in ~13 s
 * twice and not at all on a third attempt — and because `page.goto` waits for
 * `load`, **every single e2e spec failed with a 30 s timeout**. The whole
 * session-end cascade went red, pointing at the app.
 *
 * That failure mode is the expensive one: it looks exactly like a code defect.
 * `playwright-tests/playwright.config.js` carries a comment at the top saying
 * the same thing about a different cause, which had already cost a session and
 * a mislabelled commit on 2026-08-16.
 *
 * Removing the two links also made the suite roughly twice as fast — 204 specs
 * in 1.8 min against ~4 min — because every page load had been paying a network
 * round trip it did not need.
 *
 * WHAT THIS DOES NOT CLAIM. It says nothing about runtime `fetch` calls, which
 * legitimately reach the network (map tiles, the rule sheet). It is only about
 * assets the DOCUMENT blocks on, which is the set that turns a slow third party
 * into a failed page load.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const markup = readFileSync(resolve(appRoot, 'index.html'), 'utf8');

/** `href`/`src` values on elements the document blocks on. */
function blockingAssetUrls(html: string): string[] {
  const urls: string[] = [];
  for (const tag of html.matchAll(/<(link|script)\b[^>]*>/gi)) {
    const el = tag[0];
    // A `link` only blocks rendering when it is a stylesheet; `icon`,
    // `manifest` and friends are not this test's business.
    if (/^<link/i.test(el) && !/rel\s*=\s*["']?stylesheet/i.test(el)) continue;
    const attr = /(?:href|src)\s*=\s*["']([^"']+)["']/i.exec(el);
    if (attr?.[1] !== undefined) urls.push(attr[1]);
  }
  return urls;
}

describe("index.html's blocking assets", () => {
  it('names no third-party host', () => {
    const external = blockingAssetUrls(markup).filter((url) =>
      /^(https?:)?\/\//i.test(url)
    );

    expect(
      external,
      'a stylesheet or script served from another origin makes every page load ' +
        '— including every e2e `page.goto` — wait on a host we do not control. ' +
        'Bundle it instead: both of the previous ones were already available ' +
        'locally (`tailwindcss`, `leaflet`).'
    ).toEqual([]);
  });

  it('still loads the two stylesheets it needs, from local paths', () => {
    // THE GUARD ON THE GUARD. The assertion above is satisfied just as well by
    // deleting the stylesheets entirely — which would make the app render
    // unstyled and this file green. Naming them keeps the test about
    // "locally", not about "absent".
    const urls = blockingAssetUrls(markup);
    expect(urls).toContain('/styles/tailwind.css');
    expect(urls).toContain('/styles/leaflet.css');
  });
});
