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
- `escapeHtml(value: string): string` — attribute/text-safe escaping.

## Invariants & assumptions

- **The head is the load-bearing part**, not the styling: `<title>`,
  `<meta name="description">`, `<link rel="canonical">` and the `og:` tags. If
  the canonical link is wrong, the dev.to copy or the indexable GitHub wiki
  copy wins the search result — the exact failure D6 exists to avoid.
- Canonical URLs are `{origin}/blog/{slug}/`, always absolute.
- **Metadata is always escaped; post bodies are not sanitised.** Bodies come
  from a repository only the owner can push to, so raw HTML in markdown
  (diagrams, `<video>`) is passed through deliberately. If authorship ever
  widens beyond the owner, this assumption must be revisited.
- CSS is inlined and self-contained — no external requests, no asset pipeline,
  light/dark via `prefers-color-scheme`.
- `marked` is a **devDependency** used at build time only; nothing extra ships
  to the visitor's browser.

## Examples

```js
const html = renderPost(post, { origin: 'https://gps.csutil.com' });
// → '<!doctype html>…<link rel="canonical" href="https://gps.csutil.com/blog/slug/" />…'
```

## Tests

`render.test.mjs` — canonical/og URLs, title and description, markdown
rendering, attribute escaping (a quote in a title must not break the head), the
machine-readable date, the link back to the site, index ordering, the empty
index, and the draft refusal.
