# `build-blog.mjs`

**Purpose:** render the project wiki into `dist-site/blog/`. This is the step
between "the owner flipped a wiki page to published" and "it is on the site".

## Public API

- `buildBlog({ wikiDir, outDir, origin, log? }): { published: number, drafts: number }`
- CLI: `node scripts/blog/build-blog.mjs [--wiki <dir>] [--out <dir>] [--origin <url>]`
  - Wiki location resolves from `--wiki`, else `BLOG_WIKI_DIR`, else the
    sibling checkout `../location-based-webxr.wiki`, else a shallow clone of
    the public wiki repo into `node_modules/.cache/blog-wiki` — the build-host
    path. Precedence and its failure modes live in
    [`wiki-source.mjs`](./wiki-source.mjs.md).
  - Output defaults to the repo's `dist-site/`; origin to
    `https://gps.csutil.com`.
- Invoked by the root `scripts/build-site.mjs` as the last step of the site
  build, which is what puts `/blog/` into the deploy tree.

## Output layout

```
dist-site/blog/
  index.html            ← listing
  sitemap.xml
  <slug>/index.html     ← one per published post
```

## Invariants & assumptions

- **A missing or empty wiki is a hard error.** Emitting an empty `/blog/` would
  deploy over a working one and unpublish every article at once, with a green
  build — the D19 corollary.
- **Drafts are never written**, and each is logged with its reason so the owner
  can see why a page stayed hidden.
- **Non-post wiki pages are excluded by name, not left to the draft gate.**
  `Home.md` and anything starting with `_` (`_Sidebar`, `_Footer`, `_Header`)
  are navigation, not content. Having no `blog-meta` block would make them
  drafts anyway, but then every build would log a withheld-draft reason for
  each — permanent noise in the one log that exists so a person can confirm
  nothing leaked. The exclusion runs **before** the emptiness check, so a wiki
  containing only a Home page still trips the hard error above.
- The wiki repository is **public**, so a build host clones it without
  credentials.

## Examples

```bash
node GpsPlusSlamJs_Landing/scripts/blog/build-blog.mjs \
  --wiki ../location-based-webxr.wiki --out dist-site
```

## Tests

`build-blog.test.mjs` — the emitted tree (index, per-post pages, sitemap),
drafts absent from both output and sitemap, the missing-wiki and no-markdown
hard errors, draft reasons reaching the log, meta-pages producing neither
output nor a draft-log line, and a meta-pages-only wiki still tripping the
emptiness guard. Tests write into a `mkdtemp`
directory; no fixtures are checked in.
