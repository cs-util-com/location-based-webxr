# Component 6 — Cloud-storage tour source + asset-provider

Turns a plain shared link (`?tour=<zipUrl>`) into a running tour — including a
share _page_ link pasted straight from Dropbox / Google Drive / OneDrive /
GitHub, which a pure normalization layer rewrites to the provider's raw
download URL first. Opens the
uncompressed `tour.zip` (produced by component 5) over the network **by byte
range** — reading the central directory + the small `tour.json` first so the tour
starts almost instantly — parses it into a `Tour`, and implements the §2.2
`AssetProvider` so the scene can request assets by id and get a Blob URL on
demand, without ever downloading the whole archive up front. On top of that it
warms a local copy in the background and switches the byte-source remote → local,
and falls back to a plain full download when a host serves the whole file but
refuses ranges, or ranges without exposing any readable size (a CORS-blocked
link stays fatal — nothing can be read at all).

Implements the contract in `plans/Shared-Contract.md` (§3, D14) and the plan in
`plans/2026-07-24-cloud-loader-plan.md` (decisions C1–C20).

## Entry point

```ts
import { openRemoteTour } from "./view/open-remote-tour.js";

const { tour, assetProvider, cacheWarming } = await openRemoteTour(zipUrl);
// composition: dispatch loadTour(tour) + initZones(...), inject assetProvider
// into the scene. This component owns no store and no ?tour= parsing (C3).
```

## Layout

- **`core/`** — pure policy, unit-tested in Node against fakes: the swappable
  `ByteSource`, the range-vs-fallback decision, the ref-counted retrying
  `RefCountedAssetProvider`, the share-link→download-URL normalization, the
  filename→MIME mapping, the error types. See `core/README.md`.
- **`view/`** — I/O transport + orchestration: `openRemoteTour`, the remote Range
  source + probe, the local Cache-API source, the zip.js Reader adapter, and the
  toggleable fixture server. Exercised by the integration test + the demo. See
  `view/README.md`.
- **`demo.ts` + `index.html`** — paste a hosted `tour.zip` URL _or a provider
  share link_ (auto-normalized; known no-CORS hosts auto-routed through the dev
  proxy) and watch the four beats (instant POIs → 206 range fetch →
  remote→local switch → range-refused fallback).
- **`RECIPE.md`** — how to upload a tour and get a Range + CORS-capable link
  (Dropbox for the demo, GitHub raw as the zero-friction alternative).

## Two-tier memory (contract §3)

This component owns **tier 1 only** — the Blob / Blob URL, freed by `release()` at
ref-count 0. Tier 2 (parsed THREE.js GPU resources + the parsed-model LRU) belongs
to the scene (component 8), which reacts to `zones` edges and calls
`getAssetUrl`/`release` as waypoints move between IDLE / PREFETCHING / ACTIVE.

## Tests & gate

- 40 core unit tests (no network) + 16 view tests (12 integration scenarios
  against a real local fixture server with real 206/Range behaviour, plus the
  remote-source unit tests; CORS + Cache API approximated in Node, demo-proven
  per Option B, C19).
- Run: `pnpm exec vitest run components/cloud-loader/` (fast loop) or `pnpm test`
  (full gate: format, lint, jscpd, cycles, boundaries, deadcode, typecheck).
