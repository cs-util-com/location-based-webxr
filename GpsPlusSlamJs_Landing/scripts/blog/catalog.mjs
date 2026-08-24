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
 *
 * A slug collision **withholds every colliding post** rather than throwing.
 * Blast radius is the reason: this runs inside the site build, after eight
 * Vite builds, so throwing on a content mistake typed into the wiki's browser
 * UI would fail the whole deploy and take `/recorder/`, `/osm/` and every
 * other app down with it — blocking an unrelated hotfix over a blog typo.
 * Withholding is also the consistent choice: an unrecognised status already
 * means "draft", and "I cannot tell which of these two owns this URL" is the
 * same kind of not-understanding. Publishing an arbitrary winner would be a
 * coin flip that silently drops the other article.
 */
export function buildCatalog(posts) {
  const candidates = posts.filter((post) => post.status === "published");

  /** @type {Map<string, Post[]>} */
  const bySlug = new Map();
  for (const post of candidates) {
    bySlug.set(post.slug, [...(bySlug.get(post.slug) ?? []), post]);
  }

  /** @type {Post[]} */
  const withheld = [];
  for (const [slug, claimants] of bySlug) {
    if (claimants.length < 2) {
      continue;
    }
    const titles = claimants.map((post) => post.title).join(", ");
    for (const post of claimants) {
      withheld.push({
        ...post,
        status: "draft",
        draftReason:
          `slug ${JSON.stringify(slug)} is claimed by ${claimants.length} posts ` +
          `(${titles}) — give all but one a different \`slug:\``,
      });
    }
  }

  const withheldSlugs = new Set(withheld.map((post) => post.slug));
  const published = candidates
    .filter((post) => !withheldSlugs.has(post.slug))
    .sort((a, b) => b.date.localeCompare(a.date));
  const drafts = [
    ...posts.filter((post) => post.status !== "published"),
    ...withheld,
  ];

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
  const draft = published.find((post) => post.status !== "published");
  if (draft) {
    throw new Error(
      `buildSitemap: refusing to list draft ${JSON.stringify(draft.slug)}`,
    );
  }
  const entries = [
    `  <url>\n    <loc>${origin}/blog/</loc>\n  </url>`,
    ...published.map(
      (post) =>
        `  <url>\n    <loc>${origin}/blog/${post.slug}/</loc>\n` +
        `    <lastmod>${post.date}</lastmod>\n  </url>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
}
