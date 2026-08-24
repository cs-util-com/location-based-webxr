# `render.mjs`

**Purpose:** turn parsed posts into the static HTML served at
`gps.csutil.com/blog/` — the **canonical** copies of every article (D6).

## Public API

- `renderPost(post: Post, { origin: string }): string` — one complete HTML
  document. **Throws** if handed a draft (defence in depth behind the D14
  gate).
- `renderIndex(posts: readonly Post[], { origin: string }): string` — the
  `/blog/` listing, sorted newest first; renders an explicit "No posts
  published yet." when empty.

Escaping is module-private: every string that reaches an HTML attribute goes
through it on the way out, so there is nothing for a caller to do.

## Invariants & assumptions

- **The head is the load-bearing part**, not the styling: `<title>`,
  `<meta name="description">`, `<link rel="canonical">` and the `og:` tags. If
  the canonical link is wrong, the dev.to copy or the indexable GitHub wiki
  copy wins the search result — the exact failure D6 exists to avoid.
- Canonical URLs are `{origin}/blog/{slug}/`, always absolute.
- **The card image is not optional.** The head declares
  `twitter:card: summary_large_image`, and that with no image renders _worse_
  than `summary` would — a bare text card, on exactly the channels this blog
  exists to feed. `og:image`/`twitter:image` point at the landing page's
  existing `{origin}/og-card.png`.
- **Metadata is always escaped; post bodies are sanitised by construction.**
  This bullet used to say bodies were "passed through deliberately" on the
  strength of "a repository only the owner can push to" — a claim the code
  retracted (PR #330 review): wiki push access is a repo _setting_, not a
  default, so raw HTML in an already-published page could ship straight into
  the site. `render.mjs` now DROPS raw HTML blocks/inlines and
  scheme-allowlists link and image URLs; anything that needs `<video>` or a
  diagram gets an explicit allowlist entry, never a hole. Deliberately not a
  general-purpose sanitiser — see the module header.
- CSS is inlined and self-contained — no external requests, no asset pipeline,
  light/dark via `prefers-color-scheme`.
- `marked` is a **devDependency** used at build time only; nothing extra ships
  to the visitor's browser.

## Examples

```js
const html = renderPost(post, { origin: "https://gps.csutil.com" });
// → '<!doctype html>…<link rel="canonical" href="https://gps.csutil.com/blog/slug/" />…'
```

## Tests

`render.test.mjs` — canonical/og URLs, title and description, markdown
rendering, attribute escaping (a quote in a title must not break the head), the
machine-readable date, the link back to the site, index ordering, the empty
index, and the draft refusal.
