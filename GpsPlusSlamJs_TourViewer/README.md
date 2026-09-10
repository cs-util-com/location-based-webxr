# GpsPlusSlamJs_TourViewer

The page behind a printed tour code at gps.csutil.com, and the reference
example for reading zips hosted on cloud storage (Google Drive, Dropbox,
GitHub, OneDrive) via **HTTP range streaming** - the archive's table of
contents and individual entries are fetched as byte ranges instead of
downloading the whole file first.

## Two pages in one

- **The plain page is the creator's guided setup.** Six steps, one open
  at a time: host a zip and paste its link, print the code, hang it,
  measure it in AR and place content, download the rebuilt zip, replace
  the hosted file. The link last opened and the step reached with it are
  remembered on the device: after a reload (the AR session, the print
  dialog) the link is prefilled and Open returns to that step.
- **A `?qr=` launch is the visitor's screen.** Scanning the printed code
  opens the tour behind a consent tap ("Start the tour"; a browser that
  has not decided on the location asks for it first), enters AR, and places
  nothing until the phone has recognised the hung code. After 45 s
  without a lock the page offers "Continue with GPS only (less accurate)".

The mode is the launch parameter's presence and nothing else; there is no
author flag.

## The creator's setup, step by step

1. **Host your tour** - upload the recorder zip (or the empty starter zip
   the page offers) to Drive, Dropbox, GitHub or OneDrive, paste the share
   link, press Open. The link is the tour's identity: the printed code
   encodes it, and replacing the file behind it later keeps the code valid.
2. **Print the code** - the print panel is prefilled with the link;
   generate, print at true size (the declared size is what the AR
   measurement solves against).
3. **Hang the code** - flat, at about chest height, where the tour
   starts.
4. **Measure the code and place content** - "Start AR setup" opens the
   camera; keep the code in view until the panel says it is measured
   (walking a few metres with GPS reception lets the phone align to the
   map, and the panel shows the accuracy). Then, at the spots you choose,
   "Place a pin here" (a text label on the surface under the ring) and
   "Capture a photo" (the camera frame, placed where you stood). "Finish"
   ends the session.
5. **Download the rebuilt zip** - the page rebuilds the archive in the
   browser: the original entries byte for byte, plus `qr/<id>.json` (the
   measured code's pose) and `tour.json` (the placed objects, with GPS
   positions and rotations against north) and the captured photos under
   `content/`. Large archives take a while; the panel shows the progress.
6. **Replace the hosted zip** - overwrite the file at the same link (the
   page shows the per-provider recipe). The printed code does not change.

A "Storage" section below the steps explains the local copies the viewer
keeps (up to five opened tours, revalidated automatically) and holds the
clear-cache control.

## The visitor's screen

The tour's archive streams in while the consent screen shows (a visitor
gets no thumbnails; the tour appears in AR). Inside AR the status line
asks for the printed code; once it locks, the tour's
`tour.json` content appears (pins as labels, photos as planes at their
capture spots), and a tour that carries a recording also places its
photos at the spots they were taken. A tour whose zip carries no measured
code is placed by GPS at once, and says so.

## What the transport does

- Accepts a pasted share link or direct URL to a hosted `.zip`, or a
  `?qr=<payload>` launch parameter (the full dispatch contract of the
  framework's `buildQrLaunchUrl` - raw, dictionary, GitHub-template, and
  bare-name forms).
- Normalizes provider share links to their raw-download forms
  (framework `storage/share-link`).
- Opens the archive with `openRemoteArchive`: range streaming where the host
  supports it, graceful fallback where it does not, a Cache API copy warmed
  in the background (LRU-bounded, revalidated by ETag/Last-Modified/size on
  the next visit), and offline serving from that copy.
- Renders a progressive gallery - the entry list appears as soon as the
  central directory streams in, images pop in as their bytes arrive - plus a
  live stats panel (bytes fetched vs archive size, request count,
  cache vs network).

## Provider support (verified 2026-08-25)

- **GitHub (raw.githubusercontent.com)** - Range + CORS anonymously: works.
- **Dropbox / OneDrive** - the rewritten content-host URLs serve Range; see
  `../GpsPlusSlamJs_AppFramework/src/storage/share-link.ts.md` for forms and
  caveats.
- **Google Drive** - the keyless host 403s browser fetches
  (`Sec-Fetch-Site`), so the viewer routes Drive links through the site
  worker's CORS proxy (`/api/drive-proxy`, see `../GpsPlusSlamJs_SiteWorker/`)
  automatically - public files stream with Range support, no key needed.
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

Module map: `src/main.ts` is the composition root; `mode.ts` (the split),
`wizard.ts` (the steps), `visitor-screen.ts` (the consent screen),
`creator-setup.ts` (measure, place, finish), `content-placement.ts` (the
`tour.json` records and their rendering), `scan-gate.ts` and
`viewer-placement.ts` (the visitor's gate and placement), `tour-flow.ts`
(the status line). Every module has a sidecar `.md` next to it.

## Where the design lives

The guided setup and the mandatory code are the guided-setup plan
(`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-08-tour-viewer-improvements/2026-09-08-1459-tour-viewer-guided-setup-and-mandatory-code-plan.md`),
which superseded the flows plan
(`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-07-2259-tour-viewer-creator-and-visitor-flows-plan.md`)
after the first on-phone session. Origin of the printed-QR story:
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-25-0544-zip-streaming-transport-production-plan.md`
(§6).
