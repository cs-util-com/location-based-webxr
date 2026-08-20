import { describe, expect, it } from 'vitest';

import { renderIndex, renderPost } from './render.mjs';

// Why this test matters: these pages are the canonical copies of every
// article (plan decision D6). If the canonical link, the title or the
// description is wrong, the syndicated copies on dev.to and the indexable
// GitHub wiki copy win the search result instead — which is the specific
// failure the whole canonical-home decision exists to avoid.

const ORIGIN = 'https://gps.csutil.com';

/** @param {Partial<import('./post-meta.mjs').Post>} [overrides] */
const post = (overrides = {}) => ({
  slug: 'why-outdoor-webxr-drifts',
  title: 'Why outdoor WebXR drifts',
  status: /** @type {const} */ ('published'),
  date: '2026-08-20',
  description: 'Sparse features, and what actually fixes them.',
  tags: ['webxr', 'gps'],
  body: '## The short answer\n\nGPS is noisy.\n',
  ...overrides,
});

describe('renderPost', () => {
  it('points the canonical link at the blog URL for this slug', () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toContain(
      `<link rel="canonical" href="${ORIGIN}/blog/why-outdoor-webxr-drifts/" />`
    );
    expect(html).toContain(
      `<meta property="og:url" content="${ORIGIN}/blog/why-outdoor-webxr-drifts/" />`
    );
  });

  it('carries the title and description search engines will show', () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toContain('<title>Why outdoor WebXR drifts</title>');
    expect(html).toContain(
      '<meta name="description" content="Sparse features, and what actually fixes them." />'
    );
  });

  it('renders the markdown body to HTML', () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toContain('The short answer');
    expect(html).toContain('<h2');
    expect(html).toContain('<p>GPS is noisy.</p>');
  });

  it('escapes metadata so a quote in a title cannot break the head', () => {
    const html = renderPost(
      post({
        title: 'The "sub-meter" claim & what it means',
        description: 'Quotes " and ampersands & in a description.',
      }),
      { origin: ORIGIN }
    );

    expect(html).toContain(
      '<title>The &quot;sub-meter&quot; claim &amp; what it means</title>'
    );
    expect(html).toContain(
      'content="Quotes &quot; and ampersands &amp; in a description."'
    );
    // The raw quote would have terminated the attribute early.
    expect(html).not.toContain('content="Quotes " and');
  });

  it('states the publication date in a machine-readable form', () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toContain('datetime="2026-08-20"');
  });

  it('links back to the site so a search visitor can reach the project', () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toMatch(/href="\/"/);
  });

  it('refuses to render a draft, which is the D14 gate’s last line', () => {
    // Defence in depth: selection filters drafts, but a future caller that
    // forgets must fail loudly rather than publish.
    expect(() =>
      renderPost(post({ status: 'draft', draftReason: 'no date' }), {
        origin: ORIGIN,
      })
    ).toThrow(/draft/i);
  });
});

describe('renderIndex', () => {
  it('lists posts newest first and links each one', () => {
    const html = renderIndex(
      [
        post({ slug: 'older', title: 'Older', date: '2026-08-01' }),
        post({ slug: 'newer', title: 'Newer', date: '2026-08-19' }),
      ],
      { origin: ORIGIN }
    );

    expect(html.indexOf('Newer')).toBeLessThan(html.indexOf('Older'));
    expect(html).toContain('href="/blog/newer/"');
    expect(html).toContain('href="/blog/older/"');
  });

  it('says so plainly when there is nothing published yet', () => {
    const html = renderIndex([], { origin: ORIGIN });

    expect(html).toContain('<title>');
    expect(html).toMatch(/no posts|nothing published|coming soon/i);
  });

  it('gives the index its own canonical link', () => {
    const html = renderIndex([post()], { origin: ORIGIN });

    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/blog/" />`);
  });
});
