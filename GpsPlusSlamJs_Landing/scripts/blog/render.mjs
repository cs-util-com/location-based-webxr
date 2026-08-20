// @ts-check
/**
 * render.mjs — turns parsed wiki posts into the static HTML served at
 * `gps.csutil.com/blog/`.
 *
 * These pages are the CANONICAL copies (plan decision D6). The syndicated
 * copies on dev.to and the indexable GitHub wiki copy both point here, so the
 * head of every page — title, description, canonical link — is the load
 * bearing part of this module, not the styling.
 *
 * Markdown is rendered with `marked` at BUILD time; it is a devDependency and
 * nothing ships to the visitor's browser. Post bodies are written by the
 * project's own pipeline into a repository only the owner can push to, so the
 * markdown is trusted and raw HTML inside it is passed through deliberately
 * (diagrams, `<video>` embeds). Metadata is a different matter — it lands in
 * HTML attributes, so it is always escaped.
 *
 * Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-0555-marketing-content-automation-plan.md
 */

import { marked } from 'marked';

/** @typedef {import('./post-meta.mjs').Post} Post */

const SITE_NAME = 'Location-Based WebXR';

/**
 * @param {string} value
 * @returns {string} safe inside both an HTML attribute and element text
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Minimal, self-contained, theme-aware styling. No external requests. */
const STYLE = `
:root {
  color-scheme: dark light;
  --bg: #0f1216;
  --fg: #e8eaed;
  --muted: #9aa4b2;
  --accent: #ef4444;
  --rule: #232a33;
}
@media (prefers-color-scheme: light) {
  :root { --bg: #fbfbfd; --fg: #1a1d21; --muted: #5c6672; --rule: #e3e6ea; }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.7 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.wrap { max-width: 44rem; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
a { color: var(--accent); }
header.site { border-bottom: 1px solid var(--rule); }
header.site .wrap { padding-block: 1rem; display: flex; gap: 1rem; align-items: baseline; }
header.site a { color: var(--fg); text-decoration: none; font-weight: 600; }
header.site span { color: var(--muted); font-size: 0.9rem; }
h1 { font-size: clamp(1.7rem, 4vw, 2.4rem); line-height: 1.2; margin: 0 0 0.5rem; }
h2 { margin-top: 2.5rem; line-height: 1.3; }
time, .meta { color: var(--muted); font-size: 0.9rem; }
pre {
  background: color-mix(in srgb, var(--fg) 7%, transparent);
  padding: 1rem; border-radius: 8px; overflow-x: auto;
}
code { font-size: 0.92em; }
img, video { max-width: 100%; height: auto; }
ul.posts { list-style: none; padding: 0; }
ul.posts li { padding: 1.25rem 0; border-bottom: 1px solid var(--rule); }
ul.posts h2 { margin: 0 0 0.25rem; font-size: 1.15rem; }
ul.posts a { text-decoration: none; }
ul.posts p { margin: 0.35rem 0 0; color: var(--muted); }
footer.site { border-top: 1px solid var(--rule); color: var(--muted); font-size: 0.9rem; }
`.trim();

/**
 * @param {object} input
 * @param {string} input.title
 * @param {string} input.description
 * @param {string} input.canonical absolute URL of this page
 * @param {string} input.body already-rendered HTML for the <main>
 * @returns {string}
 */
function page({ title, description, canonical, body }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <style>${STYLE}</style>
  </head>
  <body>
    <header class="site">
      <div class="wrap">
        <a href="/">${SITE_NAME}</a>
        <span><a href="/blog/">Blog</a></span>
      </div>
    </header>
    <main class="wrap">
${body}
    </main>
    <footer class="site">
      <div class="wrap">
        Built with the open-source
        <a href="https://github.com/cs-util-com/location-based-webxr"
          >location-based-webxr</a
        >
        framework. <a href="/">Try the demos →</a>
      </div>
    </footer>
  </body>
</html>
`;
}

/**
 * Render one article page.
 *
 * @param {Post} post must be `published` — rendering a draft is a caller bug,
 *   and the last line of the D14 gate, so it throws rather than emits.
 * @param {{ origin: string }} options deployment origin, e.g.
 *   `https://gps.csutil.com`
 * @returns {string} complete HTML document
 */
export function renderPost(post, { origin }) {
  if (post.status !== 'published') {
    throw new Error(
      `renderPost: refusing to render draft ${JSON.stringify(post.slug)} ` +
        `(${post.draftReason ?? 'no reason recorded'})`
    );
  }
  const canonical = `${origin}/blog/${post.slug}/`;
  const tags =
    post.tags.length > 0
      ? `      <p class="meta">${post.tags.map((tag) => escapeHtml(tag)).join(' · ')}</p>\n`
      : '';
  const body =
    `      <article>\n` +
    `        <h1>${escapeHtml(post.title)}</h1>\n` +
    `        <time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time>\n` +
    tags +
    `${marked.parse(post.body, { async: false })}\n` +
    `      </article>`;
  return page({
    title: post.title,
    description: post.description,
    canonical,
    body,
  });
}

/**
 * Render the `/blog/` listing.
 *
 * @param {readonly Post[]} posts published posts, any order — sorted here
 * @param {{ origin: string }} options
 * @returns {string} complete HTML document
 */
export function renderIndex(posts, { origin }) {
  const sorted = [...posts].sort((a, b) => b.date.localeCompare(a.date));
  const items = sorted
    .map(
      (post) =>
        `        <li>\n` +
        `          <h2><a href="/blog/${escapeHtml(post.slug)}/">${escapeHtml(post.title)}</a></h2>\n` +
        `          <time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time>\n` +
        `          <p>${escapeHtml(post.description)}</p>\n` +
        `        </li>`
    )
    .join('\n');
  const body =
    `      <h1>Blog</h1>\n` +
    `      <p class="meta">Notes on outdoor AR in the browser — GPS, WebXR, and what actually holds still.</p>\n` +
    (sorted.length === 0
      ? `      <p>No posts published yet.</p>`
      : `      <ul class="posts">\n${items}\n      </ul>`);
  return page({
    title: `Blog — ${SITE_NAME}`,
    description:
      'Notes on building location-based AR on the open web: GPS and WebXR sensor fusion, outdoor tracking stability, and install-free AR.',
    canonical: `${origin}/blog/`,
    body,
  });
}
