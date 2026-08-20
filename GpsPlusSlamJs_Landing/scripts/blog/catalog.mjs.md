# `catalog.mjs`

**Purpose:** decide what the blog build emits (ordering, slug collisions) and
produce the sitemap that makes the canonical copies discoverable.

## Public API

- `buildCatalog(posts: readonly Post[]): { published: Post[], drafts: Post[] }`
  — `published` is newest-first. When two _published_ posts resolve to the same
  slug, **both are moved to `drafts`** with a `draftReason` naming every
  claimant. It does not throw.
- `buildSitemap(published: readonly Post[], { origin: string }): string` —
  `sitemap.xml` body including the `/blog/` index plus a `<lastmod>` per post.
  **Throws** if handed a draft.

## Invariants & assumptions

- **A slug collision withholds every colliding post — it does not throw, and it
  does not pick a winner.** Blast radius decides this: `buildCatalog` runs
  inside the site build after eight Vite builds, so throwing on a typo made in
  the wiki's browser UI would fail the whole deploy and take `/recorder/`,
  `/osm/` and every other app down with it. Picking a winner is worse than
  either: the loser vanishes from the site while its author believes it is
  published. Withholding both is also consistent with the parser — an
  unrecognised status already means "draft", and "I cannot tell which of these
  owns this URL" is the same kind of not-understanding.
- **The genuinely loud failures stay loud** and live in `build-blog.mjs`: a
  missing wiki checkout, a wiki with no markdown at all, and a failed clone.
  Those mean "no content", which would deploy an empty `/blog/` over a working
  one; a single malformed post does not.
- Drafts may share a slug freely — only published posts occupy URLs.
- Ordering is plain string comparison on `date`, which is correct because the
  parser guarantees a real `YYYY-MM-DD` for anything published.
- Every layer that could leak a draft refuses one independently (parser,
  renderer, sitemap, build script) rather than trusting the layer above it.

## Examples

```js
const { published, drafts } = buildCatalog(posts);
const xml = buildSitemap(published, { origin: "https://gps.csutil.com" });
```

## Tests

`catalog.test.mjs` — publish/draft separation and ordering, the collision
error, drafts allowed to collide, sitemap contents and shape, the empty case,
and the draft refusal.
