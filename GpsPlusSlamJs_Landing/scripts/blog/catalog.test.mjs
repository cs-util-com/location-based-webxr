import { describe, expect, it } from 'vitest';

import { buildCatalog, buildSitemap } from './catalog.mjs';

// Why this test matters: two wiki pages can quietly resolve to the same slug
// (a rename plus a `slug:` override, say), and the second would overwrite the
// first in dist-site with no error anywhere — a published article silently
// disappearing. The build must stop instead. The sitemap half matters because
// it is how the canonical copies get discovered at all (plan decision D6).

/** @param {Partial<import('./post-meta.mjs').Post>} overrides */
const post = (overrides) => ({
  slug: 'a-post',
  title: 'A post',
  status: /** @type {const} */ ('published'),
  date: '2026-08-20',
  description: 'Something.',
  tags: [],
  body: 'Body.',
  ...overrides,
});

describe('buildCatalog', () => {
  it('separates published posts from drafts, newest first', () => {
    const catalog = buildCatalog([
      post({ slug: 'old', date: '2026-01-01' }),
      post({ slug: 'hidden', status: 'draft', draftReason: 'no date' }),
      post({ slug: 'new', date: '2026-08-19' }),
    ]);

    expect(catalog.published.map((p) => p.slug)).toEqual(['new', 'old']);
    expect(catalog.drafts.map((p) => p.slug)).toEqual(['hidden']);
  });

  it('fails loudly when two published posts claim the same URL', () => {
    expect(() =>
      buildCatalog([
        post({ slug: 'same', title: 'First' }),
        post({ slug: 'same', title: 'Second' }),
      ])
    ).toThrow(/same/);
  });

  it('allows a draft to share a slug with nothing yet published', () => {
    expect(() =>
      buildCatalog([
        post({ slug: 'same', status: 'draft', draftReason: 'no date' }),
        post({ slug: 'same', status: 'draft', draftReason: 'no date' }),
      ])
    ).not.toThrow();
  });
});

describe('buildSitemap', () => {
  const ORIGIN = 'https://gps.csutil.com';

  it('lists the index and every published post with its date', () => {
    const xml = buildSitemap(
      [post({ slug: 'first', date: '2026-08-01' }), post({ slug: 'second' })],
      { origin: ORIGIN }
    );

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    expect(xml).toContain(`<loc>${ORIGIN}/blog/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/blog/first/</loc>`);
    expect(xml).toContain('<lastmod>2026-08-01</lastmod>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('stays valid when nothing is published yet', () => {
    const xml = buildSitemap([], { origin: ORIGIN });

    expect(xml).toContain(`<loc>${ORIGIN}/blog/</loc>`);
    expect(xml).not.toContain('undefined');
  });

  it('refuses a draft, so an unpublished URL can never be submitted', () => {
    expect(() =>
      buildSitemap([post({ status: 'draft', draftReason: 'no date' })], {
        origin: ORIGIN,
      })
    ).toThrow(/draft/i);
  });
});
