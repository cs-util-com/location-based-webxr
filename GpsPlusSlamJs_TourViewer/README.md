# GpsPlusSlamJs_TourViewer

The QR-scan landing experience for gps.csutil.com, and the reference example
for reading zips hosted on cloud storage (Google Drive, Dropbox, GitHub,
OneDrive) via **HTTP range streaming** — the archive's table of contents and
individual entries are fetched as byte ranges instead of downloading the
whole file first.

## What it does

- Accepts a pasted share link or direct URL to a hosted `.zip`, or a
  `?qr=<payload>` launch parameter (the full dispatch contract of the
  framework's `buildQrLaunchUrl` — raw, dictionary, GitHub-template, and
  bare-name forms).
- Normalizes provider share links to their raw-download forms
  (framework `storage/share-link`).
- Opens the archive with `openRemoteArchive`: range streaming where the host
  supports it, graceful fallback where it does not, a Cache API copy warmed
  in the background (LRU-bounded, revalidated by ETag/Last-Modified/size on
  the next visit), and offline serving from that copy.
- Renders a progressive gallery — the entry list appears as soon as the
  central directory streams in, images pop in as their bytes arrive — plus a
  live stats panel (bytes fetched vs archive size, request count,
  cache vs network).

## Provider support (verified 2026-08-25)

- **GitHub (raw.githubusercontent.com)** — Range + CORS anonymously: works.
- **Dropbox / OneDrive** — the rewritten content-host URLs serve Range; see
  `../GpsPlusSlamJs_AppFramework/src/storage/share-link.ts.md` for forms and
  caveats.
- **Google Drive, key-less** — the host 403s browser fetches
  (`Sec-Fetch-Site`); Drive needs an API key
  (`googleDriveApiKey`) or a CORS proxy. The app states this in its error
  message rather than implying Drive "just works".

## Development

```bash
pnpm install
pnpm dev          # http://localhost:5187 (port registry: ../docs/dev-server-ports.md)
pnpm test         # full gate (format, lint, checks, typecheck, unit, e2e)
pnpm run test:unit
pnpm run test:e2e
```

## Where this is heading

This app is the seed of the printed-QR user story: scan a code on the street,
land here, and (in a later iteration) jump straight into the AR scene — the
zip will then carry a metadata JSON with the QR code's measured pose so the
viewer can place the visitor in GPS space instantly. See
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-25-0544-zip-streaming-transport-production-plan.md`
(§6) for the recorded plan.
