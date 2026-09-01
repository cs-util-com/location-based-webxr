# archive-server.mjs

## Purpose

The e2e suite's local cloud stand-in: builds one test zip in memory at
startup (session.json + eight 1×1 PNGs + a 200 KB padding entry — no
committed fixture, so nothing can rot out of sync with the specs or trip the
2 MiB tracked-file cap) — including an authored `qr/1.json` geo level the M4 viewer spec
relocalizes against — and serves it on two routes: `/ranges-ok/tour.zip`
(honors `Range` with 206 slices) and `/no-ranges/tour.zip` (ignores `Range`,
streams 200 — the fallback host), plus `/flippable/tour.zip` whose ETag is
settable via `/flip?etag=<v>` — the "author overwrote the archive at the
same URL" host the revalidation spec drives — and `/slow-warm/tour.zip`,
which serves ranges normally but HOLDS a range-less GET (the background warm
download) while the warm gate is closed (`/warm-gate?state=hold` /
`?state=release`), the deterministic in-flight-warm window the
clear-cache-during-warm spec needs. `release` is idempotent and answers
already-queued requests, so call ordering cannot deadlock.

## Public API

`node archive-server.mjs <port>` (default 5197 — registered in
`../../docs/dev-server-ports.md` under auxiliary e2e servers). Routes:
`/health` (readiness for the playwright `webServer` gate), the four archive
routes, `/flip`, `/warm-gate`, and a CORS preflight handler.

## Invariants & assumptions

- CORS: the app origin (vite, 5187) differs from this server's, and `Range`
  is not a CORS-safelisted request header — the OPTIONS preflight must allow
  it, and `Content-Range`/`ETag` are exposed explicitly.
- Responses carry a fixed `ETag`/`Last-Modified`, which is what makes the
  cached-revisit spec's revalidation deterministic.
- Traffic is NOT counted here — the specs do per-page accounting
  (`streaming.spec.js`), because a shared server counter would tally
  sibling tests running in parallel.

## Tests

Consumed by `streaming.spec.js` and `launch-and-errors.spec.js`; started by
`playwright.config.js`'s second `webServer` entry.
