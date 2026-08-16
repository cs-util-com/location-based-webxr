# `dev-server-freshness.mjs`

**Purpose:** stop an e2e suite from running against a `vite` dev server that was
started before the last build of a linked workspace library, and rebuild that
library first if its `dist` is stale.

## Why it exists

On 2026-08-16 `GpsPlusSlamJs_OsmDemo`'s suite went red at **45 of 56**. Every
failure looked identical — the app never booted, so `#status` never left
`starting…` and each spec timed out after 60 s waiting for it. The change under
test (an AR building shader) was blamed; two hypotheses were investigated and
both were wrong; the branch was published with `[KNOWN RED: demo e2e failing]`
in its commit subject. The suite was then re-run against a fresh server and
passed **56 of 56** with no code change at all.

The actual cause: a dev server started at **10:44** was still listening on 5186
at **22:40**, while `GpsPlusSlamJs_Osm/dist` had been rebuilt at **19:45**.
Consumers resolve that package through its built output, whose chunk filenames
carry a content hash, so the rebuild renamed `mesh-CZafImwM.js` →
`mesh-BLZDYwaf.js`. The old server's module graph kept rewriting imports to the
gone name:

```
404  /@fs/C:/gps/location-based-webxr/GpsPlusSlamJs_Osm/dist/mesh-CZafImwM.js
```

Playwright reused that server because `reuseExistingServer: !process.env.CI`
asks only whether the URL responds.

**This is not the first time this family has bitten** — see the header of
`scripts/build-workspace-package-if-stale.mjs`, where a stale `dist` broke the
Cloudflare deploy of `/osm/` while every local run passed.

## Public API

- `assertDevServerFresh({ baseUrl, packageDir, fetchImpl?, log? })` →
  `Promise<{ checked, reason?, missing? }>`. **Throws** with a remedial message
  when the running server references a file, inside a linked library's own
  directory, that is not on disk. Every other outcome resolves.
- `devServerUrlOf(config)` → the dev-server URL from a Playwright `FullConfig`
  (`webServer.url` first, then a project `baseURL`).
- `linkedWorkspaceDeps(packageDir)` → `{ name, dir, entries }[]` for pnpm
  workspace links only.
- `entryFilesOf(packageRealDir)` → every existing file the manifest's `exports`
  (all subpaths, all conditions, **including the bare-string shorthand**) and
  `main` point at.
- `extractFsSpecifiers(servedText)` / `fsUrlToPath(specifier)` → the parsing
  primitives.
- `findMissingModules({ servedText, libraryDirs, exists? })` → the pure core.
- `BYPASS_ENV` — `E2E_SKIP_FRESHNESS=1` disables the guard entirely.

## How it runs

Wired as Playwright's `globalSetup` in all seven packages that have a
`playwright.config.js`, via `playwright-global-setup.mjs`, which supplies
`packageDir: process.cwd()` (pnpm runs package scripts from the package
directory).

**Ordering is verified, not assumed.** In playwright 1.60 the webServer is a
plugin, and plugin setup tasks are created before global-setup tasks
(`lib/runner/index.js`) — so the webServer has already been started or reused by
the time this runs. That is the useful order: the guard inspects the server the
suite will actually use. It also means "nothing is listening" is *not* the
ordinary no-server case; it means the webServer wedged, which is why that path
logs rather than passing silently.

Two steps, in order:

1. **Rebuild each linked library if stale**, delegating to
   `build-workspace-package-if-stale.mjs`. Reuse means Playwright never runs the
   `dev` script, so `build:deps` never executes — without this a developer who
   edits the library and runs e2e against an open `pnpm dev` silently asserts the
   *previous* build.
2. **Probe the running server** for each library entry and check every `/@fs/…`
   specifier it returns still exists. A rebuild in step 1 is precisely what makes
   a reused server fail this.

## Invariants & assumptions

- **Vite rewrites relative imports in a served module into absolute `/@fs/…`
  specifiers.** This is the load-bearing assumption, and it is pinned by a test
  against text captured verbatim from a real running server on 2026-08-16 rather
  than against a hand-written sample.
- **Only paths inside a linked library's own directory are judged.** Virtual
  modules, app source and registry packages may legitimately not exist as files;
  judging them would block every e2e run in the workspace.
- **Specifiers are matched inside quotes only**, so sourcemap comments and prose
  cannot trigger a false positive.
- **Path comparison is separator- and case-insensitive.** `realpathSync` returns
  `C:\gps\…` while the URL carries `c:/gps/…`; compared raw, the prefix never
  matches and the guard would silently check nothing.
- **Fail open on ambiguity, loudly.** Unreadable manifest, unreachable server, no
  specifiers → log and allow. The one exception is a linked library for which
  *no entry file could be resolved*: that warns explicitly, because it is the
  precise way this guard dies quietly.
- **Not covered:** a library whose output filenames are stable across rebuilds
  goes stale without any file disappearing. Today's libraries are `tsdown`-built
  with hashed chunk names — a property of their build config, not a guarantee.
- **Also not covered:** a dist that is broken *on disk* rather than stale in a
  server's memory. If vite cannot transform an entry it answers non-200, which
  this treats as "not a vite path" and skips. That is deliberate fail-open — the
  case it exists for is a server whose cached rewrite outlived the file, and there
  the server answers 200 with the dead specifier intact (verified live).
- **Cost:** it fetches every resolved entry — 22 for `GpsPlusSlamJs_OsmDemo`
  (13 framework + 9 osm) — through the dev server once per run. Transformed
  modules are large (the osm root entry is ~400 KB), so this both costs a moment
  and incidentally warms vite's transform cache.

## Example

```js
import { assertDevServerFresh } from '../../scripts/e2e/dev-server-freshness.mjs';

await assertDevServerFresh({
  baseUrl: 'http://127.0.0.1:5186',
  packageDir: process.cwd(),
});
```

## Tests

`dev-server-freshness.test.mjs`, run by the **root** vitest config — which needed
`'scripts/e2e/**/*.test.mjs'` adding to its `include`, since `scripts/*.test.mjs`
is not recursive and no package gate covers the root `scripts/` tree.

Covered: the real-vite-output extraction, quoted-only matching, the Windows
drive-letter path form, query/hash stripping, the incident reduced to one
assertion, out-of-library paths never being judged, mixed separator/case
matching, the `exports` string shorthand and subpath/condition walking, the
bypass, and each fail-open path.

Additionally verified live on 2026-08-16 against a running dev server whose
library was rebuilt underneath it — see the plan doc
`GpsPlusSlamJs_Docs/docs/2026-08-16-2255-stale-dev-server-guard-plan.md`.
