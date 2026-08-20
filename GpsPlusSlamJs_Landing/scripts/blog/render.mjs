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
 * nothing ships to the visitor's browser. Metadata lands in HTML attributes and
 * is always escaped.
 *
 * POST BODIES ARE TREATED AS UNTRUSTED. An earlier version of this file passed
 * raw HTML through, justified by "a repository only the owner can push to". The
 * source is the project's **GitHub wiki**, and a wiki on a public repo is
 * world-writable unless *Restrict edits to collaborators only* is ticked — a
 * setting this build cannot see, that the REST API does not expose, and that
 * anyone with admin access can untick later without touching this code. Betting
 * the security of a public site on a checkbox in another product's settings page
 * is not a decision this module gets to make quietly, so it does not make it.
 *
 * Two rules, both enforced here rather than assumed:
 *
 * 1. **Raw HTML in a post body is dropped**, block and inline alike. Posts get
 *    markdown formatting only. This costs the `<video>`/diagram embeds the old
 *    comment anticipated; none exist yet, and when one is wanted the honest way
 *    to add it is an explicit allowlist, not a hole.
 * 2. **Link and image URLs are scheme-allowlisted** — `http`, `https`, `mailto`,
 *    fragments, and site-relative paths. Markdown alone can carry
 *    `[text](javascript:…)`, so dropping HTML without this would close one door
 *    and leave the other open.
 *
 * Deliberately NOT a general-purpose HTML sanitiser: hand-rolling one is a
 * well-known way to ship a subtly broken allowlist, and adding a dependency for
 * a capability nothing currently uses is the worse trade. Dropping is total, and
 * total is auditable.
 *
 * Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-0555-marketing-content-automation-plan.md
 */

import { Marked } from "marked";

/** @typedef {import('./post-meta.mjs').Post} Post */

const SITE_NAME = "Location-Based WebXR";

// The landing page's existing social card, served from the site root
// (GpsPlusSlamJs_Landing/public/og-card.png -> dist-site/og-card.png). Declaring
// `summary_large_image` without one made every shared blog link render as a bare
// text card, which is worse than declaring `summary` would have been — on the
// channels this blog exists to feed.
const OG_IMAGE_PATH = "/og-card.png";

/**
 * @param {string} value
 * @returns {string} safe inside both an HTML attribute and element text
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Schemes a post body may link to. Anything else renders as inert text.
 *
 * `#…` is a same-page fragment and `/…`, `./…`, `../…` are site-relative; both
 * are safe by construction. A bare `www.example.com` is intentionally NOT here —
 * it is scheme-less and a browser would resolve it as a relative path anyway.
 */
const SAFE_URL = /^(?:https?:|mailto:|#|\.{0,2}\/)/i;

/**
 * @param {unknown} href raw URL from the markdown source
 * @returns {string | null} the URL if it is safe to emit, else null
 */
function safeUrl(href) {
  if (typeof href !== "string") return null;
  // Strip C0 controls and whitespace BEFORE testing. `java\tscript:` and
  // `java\nscript:` are both resolved as `javascript:` by browsers, so a naive
  // prefix test on the raw string is bypassable in one keystroke.
  //
  // Done by code point rather than by a regex character class, because a class
  // covering this range trips `no-control-regex`, and the rule-compliant regex
  // spellings are either an eslint-disable or unreadable escape soup. The
  // predicate simply says what it means.
  //
  // The STRIPPED form is what gets returned, not the original: a URL carrying a
  // raw control character is malformed whatever it points at, and emitting the
  // original after testing the stripped one would hand back precisely the
  // string the test just rejected.
  const collapsed = Array.from(href)
    .filter((character) => character.charCodeAt(0) > 0x20)
    .join("");
  if (collapsed === "") return null;
  return SAFE_URL.test(collapsed) ? collapsed : null;
}

/**
 * The renderer that enforces the two rules in this module's header.
 *
 * A LOCAL `Marked` INSTANCE, not `marked.use(...)`: the latter mutates a shared
 * global, so any other importer of `marked` in this process would silently
 * inherit (or, worse, later override) this policy.
 */
const safeMarked = new Marked({
  renderer: {
    /** Raw HTML — block and inline both arrive here — is dropped entirely. */
    html() {
      return "";
    },
    /**
     * @param {{ href?: string, title?: string | null, tokens: unknown[] }} token
     */
    link(token) {
      // @ts-expect-error marked's renderer `this` is the parser context
      const text = this.parser.parseInline(token.tokens);
      const href = safeUrl(token.href);
      if (href === null) {
        // Keep the words, lose the link. Deleting the text would silently
        // rewrite the author's sentence.
        return text;
      }
      const title =
        typeof token.title === "string" && token.title !== ""
          ? ` title="${escapeHtml(token.title)}"`
          : "";
      return `<a href="${escapeHtml(href)}"${title}>${text}</a>`;
    },
    /**
     * @param {{ href?: string, title?: string | null, text?: string }} token
     */
    image(token) {
      const href = safeUrl(token.href);
      const alt = escapeHtml(token.text ?? "");
      if (href === null) {
        return alt;
      }
      const title =
        typeof token.title === "string" && token.title !== ""
          ? ` title="${escapeHtml(token.title)}"`
          : "";
      return `<img src="${escapeHtml(href)}" alt="${alt}"${title}>`;
    },
  },
});

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
 * @param {string} input.origin deployment origin, for the absolute card image
 * @param {string} input.body already-rendered HTML for the <main>
 * @returns {string}
 */
function page({ title, description, canonical, origin, body }) {
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
    <meta property="og:image" content="${escapeHtml(origin)}${OG_IMAGE_PATH}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${escapeHtml(origin)}${OG_IMAGE_PATH}" />
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
  if (post.status !== "published") {
    throw new Error(
      `renderPost: refusing to render draft ${JSON.stringify(post.slug)} ` +
        `(${post.draftReason ?? "no reason recorded"})`,
    );
  }
  const canonical = `${origin}/blog/${post.slug}/`;
  const tags =
    post.tags.length > 0
      ? `      <p class="meta">${post.tags.map((tag) => escapeHtml(tag)).join(" · ")}</p>\n`
      : "";
  const body =
    `      <article>\n` +
    `        <h1>${escapeHtml(post.title)}</h1>\n` +
    `        <time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time>\n` +
    tags +
    `${safeMarked.parse(post.body, { async: false })}\n` +
    `      </article>`;
  return page({
    title: post.title,
    description: post.description,
    canonical,
    origin,
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
        `        </li>`,
    )
    .join("\n");
  const body =
    `      <h1>Blog</h1>\n` +
    `      <p class="meta">Notes on outdoor AR in the browser — GPS, WebXR, and what actually holds still.</p>\n` +
    (sorted.length === 0
      ? `      <p>No posts published yet.</p>`
      : `      <ul class="posts">\n${items}\n      </ul>`);
  return page({
    title: `Blog — ${SITE_NAME}`,
    description:
      "Notes on building location-based AR on the open web: GPS and WebXR sensor fusion, outdoor tracking stability, and install-free AR.",
    canonical: `${origin}/blog/`,
    origin,
    body,
  });
}
