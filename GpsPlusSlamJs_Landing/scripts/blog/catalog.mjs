// @ts-check
/**
 * catalog.mjs — decides what the blog build actually emits, and produces the
 * sitemap that makes the canonical copies discoverable.
 *
 * Split from the renderer because this is where the *set* of posts is
 * reasoned about (ordering, slug collisions) rather than any single page.
 * Both functions refuse drafts: the D14 gate is enforced at every layer that
 * could leak one, not only at the parser.
 *
 * Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-0555-marketing-content-automation-plan.md
 */

/** @typedef {import('./post-meta.mjs').Post} Post */

/**
 * @typedef {object} Catalog
 * @property {Post[]} published newest first — what gets rendered
 * @property {Post[]} drafts withheld posts, kept for the build log
 */

/**
 * @param {readonly Post[]} posts every parsed wiki page
 * @returns {Catalog}
 * @throws {Error} when two published posts resolve to the same slug — the
 *   second would overwrite the first in `dist-site` with no other symptom
 *   than an article vanishing from the site.
 */
export function buildCatalog(posts) {
  const published = posts
    .filter((post) => post.status === 'published')
    .sort((a, b) => b.date.localeCompare(a.date));
  const drafts = posts.filter((post) => post.status !== 'published');

  /** @type {Map<string, string[]>} */
  const bySlug = new Map();
  for (const post of published) {
    bySlug.set(post.slug, [...(bySlug.get(post.slug) ?? []), post.title]);
  }
  const collisions = [...bySlug.entries()].filter(
    ([, titles]) => titles.length > 1
  );
  if (collisions.length > 0) {
    const detail = collisions
      .map(([slug, titles]) => `${slug} (${titles.join(', ')})`)
      .join('; ')
      .replace(/^/, '');
    throw new Error(
      `blog: ${collisions.length} slug collision(s) among published posts: ${detail}. ` +
        `Give one of them a different \`slug:\` in its blog-meta block.`
    );
  }

  return { published, drafts };
}

/**
 * @param {readonly Post[]} published
 * @param {{ origin: string }} options
 * @returns {string} sitemap.xml body
 * @throws {Error} if handed a draft — an unpublished URL must never be
 *   submitted to a search engine.
 */
export function buildSitemap(published, { origin }) {
  const draft = published.find((post) => post.status !== 'published');
  if (draft) {
    throw new Error(
      `buildSitemap: refusing to list draft ${JSON.stringify(draft.slug)}`
    );
  }
  const entries = [
    `  <url>\n    <loc>${origin}/blog/</loc>\n  </url>`,
    ...published.map(
      (post) =>
        `  <url>\n    <loc>${origin}/blog/${post.slug}/</loc>\n` +
        `    <lastmod>${post.date}</lastmod>\n  </url>`
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}
