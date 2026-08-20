# `wiki-source.mjs`

**Purpose:** decide where the blog's markdown comes from, with explicit
precedence rather than best-effort fallback.

## Public API

- `WIKI_REPO_URL` — the public wiki repo
  (`https://github.com/cs-util-com/location-based-webxr.wiki.git`), cloneable
  without credentials.
- `resolveWikiDir({ envDir, siblingDir, cloneDir, exists, clone }): string`
  - Precedence: **explicit `envDir`** → **sibling checkout** → **shallow
    clone**.
  - **Throws** when `envDir` is set but absent, and propagates clone failures.
    It never returns a directory it has not established.
  - `exists` and `clone` are injected seams, so the whole decision is testable
    without a filesystem or a network.

## Invariants & assumptions

- **An explicitly configured directory that does not exist is an error, not a
  cue to look elsewhere.** Falling through would hide a typo in `BLOG_WIKI_DIR`
  and publish from a different source than the operator intended.
- **A clone failure stops the build.** Continuing would emit an empty `/blog/`
  and deploy it over a working one — the D19 corollary.
- The two environments this exists for: a developer machine with the wiki
  checked out beside the repo, and a CDN build host that must fetch it.
- The clone is `--depth 1`; history is irrelevant to rendering.

## Examples

```js
const wikiDir = resolveWikiDir({
  envDir: process.env.BLOG_WIKI_DIR,
  siblingDir: resolve(repoRoot, '..', 'location-based-webxr.wiki'),
  cloneDir: resolve(repoRoot, 'node_modules', '.cache', 'blog-wiki'),
  exists: existsSync,
  clone: (url, dir) => execFileSync('git', ['clone', '--depth', '1', url, dir]),
});
```

## Tests

`wiki-source.test.mjs` — each precedence step, the missing-explicit-directory
error, clone-failure propagation, and that the URL is the public wiki (a
credentialed URL here would break every build host).
