# `syndicate.mjs`

**Purpose:** build the per-platform payloads for one piece of content. Pure
builders only — nothing here performs a request.

## Public API

- `devToArticle(post, { origin })` — Forem payload with `canonical_url`.
  Throws above four tags; normalises `three.js` → `threejs`.
- `xComposerUrl({ text, url })` — prefilled composer URL. Throws when the text
  plus the link's fixed allowance exceeds the limit.
- `blueskyRecord({ text, url })` — post record with the link as a facet.
  Throws above the **byte** limit.
- `mastodonStatus({ text, url })` — appends the link only if absent.
- `mediumImportSteps(post, { origin })` — manual steps; Medium has no API for
  new integrations.

## Invariants & assumptions

- **The canonical link is not optional.** A syndicated copy without one
  competes with the original instead of feeding it (D6). A post with no slug
  is an error rather than a link to the site root.
- **Refuse rather than truncate.** A marketing post cut mid-sentence is worse
  than one that failed to send, because the failure is visible.
- **Bluesky's limit is UTF-8 bytes, not characters** — an emoji-heavy post that
  looks short can exceed it, and that is the post nobody tests.
- **X's link allowance is fixed** regardless of the URL's real length.

## Tests

`syndicate.test.mjs` — canonical URLs on every builder, tag normalisation and
the four-tag limit, composer prefill and its length refusal, Bluesky facets and
the byte-vs-character limit, Mastodon's no-duplicate-link rule, and that the
Medium path is steps rather than a payload.
