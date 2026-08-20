# `scripts/build-site.mjs` — combined multi-app deploy build

## Purpose

Builds the public surfaces of the `gps.csutil.com` deployment into one
output directory (`dist-site/`) that Cloudflare serves as static assets:

- `dist-site/index.html` + `dist-site/assets/` — the Landing app
  (`GpsPlusSlamJs_Landing`, a Vite build at `base=/`).
- `dist-site/recorder/` — `GpsPlusSlamJs_RecorderApp`, built with `base=/recorder/`.
- `dist-site/starter/` — `GpsPlusSlamJs_AnchorStarter`, built with `base=/starter/`.
- `dist-site/minimal/` — `GpsPlusSlamJs_MinimalExample`, built with `base=/minimal/`.
- `dist-site/qr-demo/` — `GpsPlusSlamJs_QrTrackingDemo`, built with `base=/qr-demo/`.

Invoked via the root script `pnpm run build:site`. This is the command the
Cloudflare Git integration runs. See
[2026-06-01-0424-multi-app-subpath-deployment-plan.md](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-01-0424-multi-app-subpath-deployment-plan.md)
and the landing redesign plan
[2026-07-12-2046-landing-page-3d-scroll-redesign-plan.md](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-12-2046-landing-page-3d-scroll-redesign-plan.md).

## Public API

CLI only: `node scripts/build-site.mjs` (no arguments). Exits non-zero if any
sub-build fails or any post-build assertion fails.

## Behaviour / steps

1. Wipe and recreate `dist-site/`.
2. Typecheck + `vite build` the **Landing app FIRST** with `--base=/
   --outDir <dist-site>` (no `--emptyOutDir`: the root was just cleaned).
3. Build the framework once (`pnpm run build:framework`).
4. Typecheck + `vite build` each subpath app (recorder, starter, minimal,
   qr-demo) with `--base=/<sub>/ --outDir <dist-site/sub> --emptyOutDir`,
   asserting no bare root-absolute URLs after each.
5. Build `blog/` from the project **wiki repository** (not a Vite app — see
   `GpsPlusSlamJs_Landing/scripts/blog/`). Last, because it depends on nothing
   else in the tree.
6. Assert the landing HTML still links all four demo apps and that every
   local asset URL it references exists (`assertLandingHtml`).
7. Assert the combined tree contains the required files (`assertSiteTree`).

`base` and `outDir` are passed as **CLI flags**, so the committed app vite
configs stay at their `/` + `dist` defaults — local `vite dev` and the USB
debugging workflow are unchanged.

## Invariants & assumptions

- **The landing build must stay FIRST.** It writes into the shared
  `dist-site/` root; building it after the apps would risk clobbering their
  subdirs (and must never use `--emptyOutDir` on the shared root).
- **Each subpath app writes into its own subdir**, so `--emptyOutDir` only
  clears that app's folder; the builds cannot wipe each other.
- **`assertNoBareAbsoluteUrls`** is the executable guard for the deployment
  plan's Steps 1-3: it fails the build if any built `href`/`src` points at a
  bare `/...` path not under the app's base. Vite rewrites root-absolute URLs
  inside processed `index.html`, but **not** `<a href>` cross-page links —
  this is exactly how the recorder's `ar-hittest-test.html` link was caught.
  External (`http(s)://`), protocol-relative (`//`), and `data:` URLs are
  ignored. This guard is **vacuous for the landing** (every root-absolute URL
  starts with its base `/`), which is why the landing has its own
  `assertLandingHtml` instead: demo-link presence (the "demos remain
  launchable" requirement) + referenced-asset existence.
- **The blog step must fail the build when the wiki is missing or
  unreachable.** It is deliberately not wrapped in a `try`/`catch`: emitting an
  empty `/blog/` and deploying it over a working one would unpublish every
  article at once, behind a green build. `assertSiteTree` therefore also
  requires `blog/index.html` and `blog/sitemap.xml` — the index renders even
  with nothing published, so its absence means the step did not run at all.
- **The blog's markdown comes from a second repository.** On a developer
  machine it is the sibling checkout `../location-based-webxr.wiki`; on a build
  host with no checkout it is a shallow clone of the public wiki repo, which
  needs no credentials. Precedence lives in `scripts/blog/wiki-source.mjs`.
- **`dist-site/` is gitignored** and only produced in CI / locally on demand.
- Runs identically on Windows/Linux/CI (pure Node, no shell-specific logic; a
  shell is only used to resolve `pnpm`/`pnpm.cmd` on Windows).

## Examples

```bash
cd location-based-webxr
pnpm run build:site
# Serve and click through landing -> /starter/ -> /recorder/:
npx serve dist-site   # or any static server
```

## Tests

No standalone unit test — the script *is* the verification harness for the
deployment. Its `assertNoBareAbsoluteUrls`, `assertLandingHtml` and
`assertSiteTree` checks run on every `build:site` invocation (and therefore
on every Cloudflare deploy), failing fast on regressions. The
storage-isolation invariant of the deployed apps is covered separately by
`anchor-storage.test.ts` and `recording-options.test.ts` (plan Step 6).
