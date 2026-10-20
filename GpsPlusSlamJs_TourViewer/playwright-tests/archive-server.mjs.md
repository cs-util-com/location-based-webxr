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
`/no-cors/tour.zip` serves the archive WITHOUT CORS headers - a host that
blocks browsers, for the "download the file and open it here" spec (tour
kit plan K0). `/ranges-ok/sample-tour.zip` serves the committed sample tour
(`public/samples/marienplatz-tour.zip`, owner decision S-D9) for
`sample-tour.spec.js`. `/ranges-ok/no-gps-tour.zip` is the standard zip with
its `tour.json` marked `needsNoGps` (owner decision Q-QF-1), for the ar-mode spec whose visitor is never asked for the location.
`/ranges-ok/stations-tour.zip` is a tour
with three stations in fixed order (tour kit plan K4, `stations.spec.js`):
"The gate" on the fixture's printed code (a knight with a voice and a scene
choice; the level's geo is where the fakes' armed pose puts the code under
the seeded alignment, so its votes agree with the walk), "The well" 30 m
north (a minimal `.glb` built here), "The tower" 300 m east (skipped).
The gate and the well each hold one pin, so the suite sees which station's
content stands in the scene (only the present one's). And
`/api/drive-proxy?id=…` - the standard zip with ranges, on the Drive
proxy's own path so the app treats it as a Drive tour without a Google host
(Drive replace plan §5 #12): `id=e2e-drive` sends `content-disposition`
with the file name "My tour.zip", any other id sends none (the fallback).
`content-disposition` is in the exposed headers, because the app (port 5187) reads this server (port 5197) cross-origin.

Every `tour.json` it writes is version 3 (tour editor plan 2026-10-17-1816,
W3): stations at geo poses, the pins and photos as their items. The station shapes come from
`v3-fixture.mjs` (`stationAt`, `inOwnStation`: anchored exactly at the
element, turned like north, so its local pose is a zero offset), which the
editor spec uses too.

## Public API

`node archive-server.mjs <port>` (default 5197 — registered in
`../../docs/dev-server-ports.md` under auxiliary e2e servers). Routes:
`/health` (readiness for the playwright `webServer` gate), the four archive
routes, `/ranges-ok/recording-tour.zip` (a recording without `tour.json`:
era-5 session.json + an action stream; a creator opens it as an empty tour,
a visitor reads that the tour is not finished yet), `/ranges-ok/baked-tour.zip`
(a `tour.json` carrying debug camera captures - the deprecated
`captureSpots`, 7 fixes, two frames in stations of their own, one of which
holds a pin - and a walk: `session.json`, an action, a third frame. A
visitor draws the pin and none of the frames, and takes no cover from one), `/ranges-ok/plain-tour.zip`
(images only - no `tour.json`, no level, no recording: a tour not finished
yet), `/ranges-ok/unfinished-tour.zip` (a `tour.json` with a name and a
contact but no station, and the fixture's code: a tour not finished yet
whose visitor is told whom to ask and never asked for the code), `/ranges-ok/details-tour.zip` (a `tour.json` at minor 3 carrying
its details - name, description, contact - and a cover that is its SECOND
photo, 3 px wide against the first's 1 px, so a page that took the first
photo is told apart: tour editor plan 2026-10-17-1816 W2), `/flip`, `/warm-gate`, and a CORS preflight handler.

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
