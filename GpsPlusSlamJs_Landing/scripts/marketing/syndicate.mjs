// @ts-check
/**
 * syndicate.mjs — builds the per-platform payloads for a piece of content.
 *
 * Pure builders only: every function turns a post plus an origin into the
 * request body, record or URL that platform expects. Nothing here performs a
 * request, which is deliberate — it means the shape of every payload, and
 * every length limit, is a unit test rather than something discovered when a
 * real post comes out truncated.
 *
 * Two rules run through all of it:
 *
 * - **The canonical link is not optional.** Syndicated copies exist to send
 *   readers and crawlers back to `gps.csutil.com`; a copy that loses its
 *   canonical link competes with the original instead (plan decision D6).
 * - **Refuse rather than truncate.** A marketing post silently cut mid-
 *   sentence is worse than one that failed to send, because the failure is
 *   visible and the truncation is not.
 *
 * Platform facts that shaped this (verified 2026-08-20, see the plan's §2b):
 * Medium stopped issuing API tokens to new integrations, so it is a manual
 * import; dev.to accepts `canonical_url` on article creation; X has no free
 * API tier for new developers, so the composer is prefilled and a human
 * presses Post.
 *
 * Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-0555-marketing-content-automation-plan.md
 */

/**
 * @typedef {object} Post
 * @property {string} slug
 * @property {string} title
 * @property {string} [description]
 * @property {string[]} [tags]
 * @property {string} [body] markdown
 */

/** X's limit for a standard account, with a link costing a fixed allowance. */
const X_LIMIT = 280;
const X_LINK_COST = 23;
/** Bluesky's cap is on UTF-8 BYTES, not characters. */
const BLUESKY_BYTE_LIMIT = 300;
const MASTODON_LIMIT = 500;
const DEVTO_MAX_TAGS = 4;

/**
 * @param {Post} post
 * @param {string} origin
 * @returns {string} the canonical article URL
 */
function canonicalUrlFor(post, origin) {
  if (!post.slug) {
    throw new Error(
      "syndicate: post has no slug, so it has no canonical URL. Refusing to " +
        "syndicate a copy that points at the site root.",
    );
  }
  return `${origin}/blog/${post.slug}/`;
}

/**
 * dev.to article payload. Tags are normalised to the alphanumeric form the
 * API accepts (`three.js` → `threejs`) rather than rejected, because the
 * project's own tag vocabulary contains dots and hyphens.
 *
 * @param {Post} post
 * @param {{ origin: string }} options
 * @returns {{ article: { title: string, body_markdown: string, canonical_url: string, tags: string[], published: boolean, description?: string } }}
 */
export function devToArticle(post, { origin }) {
  const canonical = canonicalUrlFor(post, origin);
  const rawTags = post.tags ?? [];
  if (rawTags.length > DEVTO_MAX_TAGS) {
    throw new Error(
      `syndicate: dev.to accepts at most four tags, got ${rawTags.length} ` +
        `(${rawTags.join(", ")}). Choose which four matter.`,
    );
  }
  // Normalisation is lossy, so it can COLLIDE: "three.js" and "threejs" both
  // become "threejs", and Forem rejects an article carrying a duplicate tag.
  // Silently de-duplicating would be quiet in the wrong direction for a module
  // whose stance is refuse-rather-than-truncate, so this names the pair and
  // stops — the same shape as the four-tag check above.
  /** @type {string[]} */
  const tags = [];
  /** @type {Map<string, string>} */
  const firstSeenAs = new Map();
  for (const raw of rawTags) {
    const tag = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!tag) {
      continue;
    }
    const collidesWith = firstSeenAs.get(tag);
    if (collidesWith !== undefined) {
      throw new Error(
        `syndicate: dev.to tags "${collidesWith}" and "${raw}" both normalise ` +
          `to "${tag}", and Forem rejects duplicate tags. Drop one.`,
      );
    }
    firstSeenAs.set(tag, raw);
    tags.push(tag);
  }

  return {
    article: {
      title: post.title,
      body_markdown: post.body ?? "",
      canonical_url: canonical,
      tags,
      published: true,
      ...(post.description ? { description: post.description } : {}),
    },
  };
}

/**
 * A prefilled X composer URL. The human presses Post — X sanctions API
 * posting and prohibits browser automation, so this is the free route that
 * does not risk the account (plan decision D17).
 *
 * @param {{ text: string, url: string }} input
 * @returns {string}
 */
export function xComposerUrl({ text, url }) {
  const cost = text.length + (url ? X_LINK_COST + 1 : 0);
  if (cost > X_LIMIT) {
    throw new Error(
      `syndicate: X text is too long — ${cost} of ${X_LIMIT} once the link is ` +
        `counted (a link costs a fixed ${X_LINK_COST} regardless of length).`,
    );
  }
  const params = new URLSearchParams({ text });
  if (url) {
    params.set("url", url);
  }
  return `https://x.com/intent/post?${params.toString()}`;
}

/**
 * A Bluesky post record, with the link marked as a facet so it renders as a
 * link rather than as plain text.
 *
 * `createdAt` is REQUIRED by the `app.bsky.feed.post` lexicon — a record
 * without it is rejected by `com.atproto.repo.createRecord`. This module is
 * deliberately clock-free, so the caller's clock has to supply it rather than
 * this function reading one; it is validated here so the omission surfaces at
 * the seam instead of at the API.
 *
 * @param {{ text: string, url: string, createdAt: string }} input
 * @returns {{ $type: string, text: string, createdAt: string, facets: Array<{ index: { byteStart: number, byteEnd: number }, features: Array<{ $type: string, uri: string }> }> }}
 */
export function blueskyRecord({ text, url, createdAt }) {
  if (typeof createdAt !== "string" || createdAt === "") {
    throw new Error(
      "syndicate: blueskyRecord needs an ISO 8601 createdAt — " +
        "app.bsky.feed.post requires it, and this module has no clock of its " +
        "own by design, so the caller must pass one.",
    );
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text).length;
  if (bytes > BLUESKY_BYTE_LIMIT) {
    throw new Error(
      `syndicate: Bluesky text is too long — ${bytes} of ` +
        `${BLUESKY_BYTE_LIMIT} BYTES (not characters; emoji cost four each).`,
    );
  }

  /** @type {ReturnType<typeof blueskyRecord>['facets']} */
  const facets = [];
  const at = text.indexOf(url);
  if (at !== -1) {
    facets.push({
      index: {
        byteStart: encoder.encode(text.slice(0, at)).length,
        byteEnd: encoder.encode(text.slice(0, at + url.length)).length,
      },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
    });
  }

  return { $type: "app.bsky.feed.post", text, createdAt, facets };
}

/**
 * A Mastodon status. The link is appended only if the text does not already
 * contain it — a duplicated URL looks like a bot.
 *
 * @param {{ text: string, url: string }} input
 * @returns {{ status: string }}
 */
export function mastodonStatus({ text, url }) {
  const status = text.includes(url) ? text : `${text}\n\n${url}`;
  if (status.length > MASTODON_LIMIT) {
    throw new Error(
      `syndicate: Mastodon status is too long — ${status.length} of ` +
        `${MASTODON_LIMIT} characters.`,
    );
  }
  return { status };
}

/**
 * Medium is manual: its API stopped issuing tokens to new integrations on
 * 2025-01-01. The browser Import Story tool remains, and it sets the canonical
 * link to the source URL by itself — which is the behaviour that makes this
 * route acceptable rather than merely tolerable.
 *
 * @param {Post} post
 * @param {{ origin: string }} options
 * @returns {{ canonicalUrl: string, steps: string[] }}
 */
export function mediumImportSteps(post, { origin }) {
  const canonicalUrl = canonicalUrlFor(post, origin);
  return {
    canonicalUrl,
    steps: [
      "Open https://medium.com/p/import",
      `Paste the canonical URL: ${canonicalUrl}`,
      "Let Medium fetch it — the import tool sets the canonical link back to " +
        "this URL automatically, so the original keeps the search value",
      "Review the imported formatting (code blocks and tables need a look)",
      "Publish",
    ],
  };
}
