# `catalog.mjs`

**Purpose:** decide what the blog build emits (ordering, slug collisions) and
produce the sitemap that makes the canonical copies discoverable.

## Public API

- `buildCatalog(posts: readonly Post[]): { published: Post[], drafts: Post[] }`
  — `published` is newest-first. **Throws** when two _published_ posts resolve
  to the same slug, naming each colliding title.
- `buildSitemap(published: readonly Post[], { origin: string }): string` —
  `sitemap.xml` body including the `/blog/` index plus a `<lastmod>` per post.
  **Throws** if handed a draft.

## Invariants & assumptions

- **A slug collision is a hard error, not a warning.** The second page would
  overwrite the first in `dist-site` with no symptom other than an article
  vanishing from the live site.
- Drafts may share a slug freely — only published posts occupy URLs.
- Ordering is plain string comparison on `date`, which is correct because the
  parser guarantees a real `YYYY-MM-DD` for anything published.
- Every layer that could leak a draft refuses one independently (parser,
  renderer, sitemap, build script) rather than trusting the layer above it.

## Examples

```js
const { published, drafts } = buildCatalog(posts);
const xml = buildSitemap(published, { origin: 'https://gps.csutil.com' });
```

## Tests

`catalog.test.mjs` — publish/draft separation and ordering, the collision
error, drafts allowed to collide, sitemap contents and shape, the empty case,
and the draft refusal.
