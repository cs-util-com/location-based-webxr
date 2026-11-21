# `scripts/splat-csp-deploy.mjs` - the splat page's policy as deployed

## Purpose

The splat trainer page (`GpsPlusSlamJs_TourViewer/splat/index.html`) runs
Splat.js from one pinned commit on another host, in a worker, under a
content security policy given as a `<meta>` tag (the site sends no policy
header). A meta policy governs only what the parser meets after it, and
the unit tests read the source page, so only the build shows what is
deployed. `scripts/build-site.mjs` calls this check right after the Tour
Viewer build, so a deploy whose page lost, changed or misplaced its
policy, or whose worker names a Splat.js address the policy does not
allow, fails instead of going out.

## Public API

- `SPLAT_PAGE` - `'tour/splat/index.html'`, the page's place in
  `dist-site`; `SPLAT_BASE` - `'/tour/'`.
- `policyMeta(html) -> { policy, at } | null` - the content of the page's
  `Content-Security-Policy` meta, whitespace collapsed, and where it
  starts.
- `assertSplatPolicyShipped({ siteDir, sourceHtml })` - throws, naming
  every problem, unless:
  - the built page exists, and its policy equals the one in `sourceHtml`
    (the source page's text);
  - the policy comes before every `<script>` and `<link>`;
  - there is no inline script, and every script and module preload is
    under `/tour/` (this site, `'self'`);
  - `tour/assets/` holds at least one trainer worker chunk
    (`splat-trainer.worker-*.js`), and every Splat.js address those
    chunks name starts with one of `script-src`'s `https://` sources.

## Invariants & assumptions

- A check of nothing must not pass: a missing page, no policy, no worker
  chunk, or a worker that names no Splat.js address are all failures.
- Only the trainer worker's chunks are read for addresses: other pages of
  the Tour Viewer may name Splat.js files too, but they run under no
  such policy.
- The worker chunk's name comes from Vite's naming of
  `src/splat-trainer/splat-trainer.worker.ts`; a rename there makes this
  check fail with "no trainer worker chunk", which is the signal to
  update the pattern.
- The page is parsed with regular expressions, which is enough for
  Vite's own output; it is not a general HTML parser.
- Not checked: that the meta sits inside `<head>` (a meta policy in the
  body is ignored). Vite keeps the source page's head, where the policy
  is written; a transform that moved it into the body would pass here.
- The Splat.js address is read from the built chunk as one string. The
  source builds it from a template literal over the pinned commit; a
  local `pnpm run build:site` with Vite 8.2.2 folds it into one literal
  (the chunk names `.../splat.js@<commit>/src/index.js` whole), and the
  check passed on that build. A bundler that left it split would fail
  this check ("name no Splat.js address" or a refused address), closed
  rather than open.

## Example

```js
assertSplatPolicyShipped({
  siteDir: distSite,
  sourceHtml: readFileSync('GpsPlusSlamJs_TourViewer/splat/index.html', 'utf8'),
});
```

## Tests

`scripts/splat-csp-deploy.test.mjs` (the root vitest config's
`scripts/*.test.mjs`), on synthetic pages in temp folders: green for a
page built as declared; red for a missing page, a missing or changed
policy, a script before the policy, an inline script, a script or module
preload from elsewhere, a worker naming an address `script-src` does not
allow, and no worker chunk or no address in it. CI does not run the site
build, so the check itself fires at the deploy's build.
