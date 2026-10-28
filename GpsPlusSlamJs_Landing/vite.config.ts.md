# `vite.config.ts` - dev-server and build config

- **Purpose:** Dev server on a distinct port (5182) so the landing runs
  alongside the minimal example (5180) and the anchor starter (5181);
  `host: true` so IPv4 `127.0.0.1` responds on Windows (mirrors the
  sibling apps). Two build entries: `index.html` (the landing page) and
  `legal/index.html` (the site-wide legal notice and privacy page, see
  `legal/index.html.md`), so the site build emits `dist-site/legal/` next
  to the landing page, and the dev server serves it at `/legal/`.
- **Invariants:** no aliases and no base-path logic here — the production
  build's `--base=/ --outDir <dist-site>` flags come from
  `scripts/build-site.mjs` so this committed config stays at the `/` +
  `dist` defaults for local dev. The legal page belongs to this package
  because this is the one app built at the site root, where `/legal/` lives.
- **Tests:** `tests/repo-config/legal-page.test.js` checks that the legal
  entry is here; `playwright-tests/legal.spec.js` opens the page on the dev
  server; the build itself is exercised by `pnpm build` and the site build.
