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
- **Google Drive** — the keyless host 403s browser fetches
  (`Sec-Fetch-Site`), so the viewer routes Drive links through the site
  worker's CORS proxy (`/api/drive-proxy`, see `../GpsPlusSlamJs_SiteWorker/`)
  automatically — public files stream with Range support, no key needed.
  An API key (`googleDriveApiKey`) remains a supported alternative for
  consumers without the proxy.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:5187 (port registry: ../docs/dev-server-ports.md)
pnpm test         # full gate (format, lint, checks, typecheck, unit, e2e)
pnpm run test:unit
pnpm run test:e2e
```

## The flows (creator, visitor, tester)

Written down in the flows plan
(`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-07-2259-tour-viewer-creator-and-visitor-flows-plan.md`,
§1) after the first on-phone session, and shipped as its M1-M4:

- **Creator** — upload the recorder zip to Drive/Dropbox/GitHub/OneDrive,
  paste the share link, press **Open**, then **print the QR code** from the
  "Print a QR code for this tour" section (on the page for everyone,
  prefilled with the open link; usable before any upload for the "print
  first, hang, then author" loop). Scanning that code opens the tour - no
  authored level needed. Optionally hang it and **author** it under
  `?author=1` (measure the poster's pose in AR, mint `qr/<id>.json`,
  re-upload) so the code also places visitors at the poster.
- **Visitor** — scan the printed code with the phone camera; the viewer
  opens with the tour. Press **Start AR view**: while the phone's tracking
  warms up the status line carries the framework's coaching hint, and once
  the tracking-quality phase reports **ready** the tour's photos appear at
  their capture spots (the capture-time geo join, from the zip's own
  recording). A printed code, where one hangs and is authored, sharpens the
  placement afterwards; it is a refinement, not a gate. A tour with neither
  a recording nor codes says "nothing to place".
- **Tester** — paste a link, Open, Start AR view: the visitor path minus
  the poster.

The "Storage" section (collapsed) explains the local copies the viewer
keeps (up to five opened tours, revalidated automatically) and holds the
clear-cache control, which no longer waits for a background download.

Origin of the printed-QR story:
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-25-0544-zip-streaming-transport-production-plan.md`
(§6).
