import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parsePost } from './post-meta.mjs';

// Why this test matters: the example tests cover the pages we thought of. The
// gate's real job is to hold for the page nobody thought of — a half-pasted
// draft, a page whose name is punctuation, a meta block with the keyword in a
// value rather than the status. These properties state the invariants that
// must survive ANY input, because "published" is the one outcome that cannot
// be taken back.

describe('parsePost — invariants under arbitrary input', () => {
  it('never throws on arbitrary content, whatever the page contains', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (fileName, source) => {
        expect(() => parsePost(`${fileName}.md`, source)).not.toThrow();
      })
    );
  });

  it('only ever publishes a post that is safe to put on a URL', () => {
    // The page must be BUILT rather than generated free-form: a random string
    // never contains a valid meta block, so a free-form generator would only
    // ever exercise the draft branch and assert nothing about publication.
    fc.assert(
      fc.property(fc.string(), fc.string(), (fileName, bodyText) => {
        const post = parsePost(
          `${fileName}.md`,
          `<!--\nblog-meta\nstatus: published\ndate: 2026-08-20\n-->\n${bodyText}`
        );
        if (post.status !== 'published') {
          return;
        }
        // A published post is linked, listed and put in the sitemap; each of
        // these would produce a broken URL or a malformed sitemap entry.
        expect(post.slug).not.toBe('');
        expect(post.slug).toMatch(/^[a-z0-9-]+$/);
        expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      })
    );
  });

  it('publishes only on the exact keyword, never on something containing it', () => {
    fc.assert(
      fc.property(fc.string(), (status) => {
        const post = parsePost(
          'A-page.md',
          `<!--\nblog-meta\nstatus: ${status.replace(/[\n\r]/g, ' ')}\ndate: 2026-08-20\n-->\n# A page\n\nBody.\n`
        );
        const isKeyword = status.trim().toLowerCase() === 'published';
        expect(post.status === 'published').toBe(isKeyword);
      })
    );
  });

  it('always reports a reason when it withholds publication', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (fileName, source) => {
        const post = parsePost(`${fileName}.md`, source);
        // A silent draft is unactionable: the author sees nothing on the site
        // and has nothing in the build log explaining why.
        expect(typeof post.draftReason === 'string').toBe(
          post.status === 'draft'
        );
      })
    );
  });
});
