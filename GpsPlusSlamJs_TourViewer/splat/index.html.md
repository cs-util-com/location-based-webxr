# `splat/index.html` - make a splat from a recording

## Purpose

The splat trainer page: a desktop page that turns a recording from the
recorder app into a splat, on this computer, nothing uploaded. It trains
on the graphics card in a worker; `?trainer=practice` runs the whole flow
with a scripted practice trainer that draws pictures instead.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/splat/`; nothing links to it yet.
The page logic lives in `src/splat-trainer/` (`splat-main.ts`,
`trainer-page.ts`).

## Head

- A Content-Security-Policy meta, allowing only what the page needs:
  - `script-src 'self' blob:` and the one pinned Splat.js commit on
    jsDelivr (`https://cdn.jsdelivr.net/gh/arrival-space/splat.js@<commit>/`,
    the commit of `SPLAT_JS_COMMIT` in `src/splat-trainer/splat-js.ts`);
  - `worker-src blob: 'self'`: the trainer's `blob:` start module and
    Splat.js's own `blob:` tick worker, plus `'self'` because a module
    worker's static imports are fetched as worker scripts (the start
    module statically imports the built worker script; without `'self'`
    the worker fails to start, measured in the browser);
  - `connect-src 'self'` (which also covers the dev server's live-reload
    socket): what the page or its workers run can send requests only to
    this site, whose one relay is the Drive download proxy;
  - `default-src 'self'`, `img-src 'self' data: blob:`, `style-src 'self'
'unsafe-inline'` (the page's own `<style>` block needs it in production,
    and the dev server injects styles), `font-src 'self' data:`,
    `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
  - A pin changed in the code but not here fails `splat-js.test.ts`; the
    built page's policy, its place before every script and its script
    addresses are checked at the site build
    (`scripts/splat-csp-deploy.mjs`).
- `referrer: no-referrer`, load-bearing: the policy limits where requests
  go, not what they carry; this keeps the page's address out of the CDN's
  request for Splat.js.
- `robots: noindex`, `color-scheme: light dark`, an empty icon (no
  favicon request), title "Make a splat".

## Tests

`playwright-tests/splat-trainer.spec.js` and
`playwright-tests/splat-trainer-gpu.spec.js` (the trainer loading under
the policy with a stand-in library and no refusal in the page or a
worker, and a worker's fetch to another host refused as `connect-src`
before it reaches the network); the policy's directives in
`src/splat-trainer/splat-js.test.ts`; the built page in
`scripts/splat-csp-deploy.test.mjs`.
