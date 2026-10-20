# GpsPlusSlamJs_TourViewer

The page behind a printed tour code at gps.csutil.com, and the reference
example for reading zips hosted on cloud storage (Google Drive, Dropbox,
GitHub, OneDrive) via **HTTP range streaming** - the archive's table of
contents and individual entries are fetched as byte ranges instead of
downloading the whole file first.

## Two pages in one

- **The plain page is the creator's guided setup.** Four steps, one open
  at a time: host a zip and paste its link, print the code, hang it, and
  measure it in AR and place content - after Finish the same step saves
  the rebuilt zip to the phone by itself (a button saves it again) and
  shows the recipe for replacing the hosted file. The link last opened and the step reached with it are
  remembered on the device: after a reload (the AR session, the print
  dialog) the link is prefilled and Open returns to that step.
- **A `?qr=` launch is the visitor's screen.** Scanning the printed code
  opens a start page with the tour's name and one round button ("Start
  the tour"; a browser that has not decided on the location asks for it
  first, so the button counts "1 of 2" and "2 of 2"), enters AR, and
  places nothing until the phone has recognised the hung code. After 10 s
  without a lock the page offers "Continue with GPS only (less accurate)".
  A tour that is not finished yet - a zip without `tour.json` (the
  starter zip, a recording) or a tour without stations, hosted before
  its first Finish - opens to a start page that says "This tour is not
  finished yet." (with the tour's contact, when it names one) and offers
  no Start: no location is asked for, no AR session opens, and the page
  stops downloading the file, of which a visitor reads nothing.

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
   map, and the panel shows the accuracy). At the spots you choose,
   "Place a pin here" (a text label on the surface under the ring; the
   ring follows a mesh the phone builds of the surroundings from its depth
   sensor, easing over the surface and lying flat to it, and falls back to
   the phone's own surface detection where there is no mesh - a phone
   without depth, the first seconds, gaps; a troubleshooting recording
   samples depth more sparsely, so its mesh is thinner; `?mesh=0` turns
   the mesh off) and
   "Capture a photo" (the camera frame, placed where you stood). Placing
   needs only the GPS alignment, never the code: it works anywhere along
   the walk, also before the code is measured or after its print size
   changed. Each new pin or photo joins the nearest station within 25 m
   of where it lands, else starts a new one there; "New station here" makes
   the next one start its own station even within that radius (for places
   closer together than any radius can separate; a second tap cancels it).
   "Finish"
   ends the session, and the same step then saves and shows:
   - **the rebuilt zip** - the page rebuilds the archive in the browser:
     the original entries byte for byte, plus `qr/<id>.json` (the measured
     code's pose) and `tour.json` (the placed objects, with GPS positions
     and rotations against north) and the captured photos under
     `content/`. Large archives take a while; the panel shows the progress.
   - **replacing the hosted zip** - overwrite the file at the same link
     (the page shows the per-provider recipe). The printed code does not
     change.

A "Storage" section below the steps explains the local copies the viewer
keeps (up to five opened tours, revalidated automatically) and holds the
clear-cache control.

## The visitor's screen

The start page (the owner's chosen prototype V4, `public/prototypes/visitor-4-one-tap/`)
leads with the tour's name - the manifest's `title`, which the creator's
poster title becomes at the Finish - a line counting its places, one of
its photos when it has one, and the round button low on the screen, with
one line under it saying what the next tap does. What the tour needs
(camera, location, nothing uploaded, no account) is behind "What
happens?", and "Make your own tour" opens the setup in a new tab. A phone
that cannot run AR gets a "Copy link" button instead, to open the tour on
one that can. The page is paper-coloured on every device; held sideways,
the name and the button sit side by side.

The tour's archive streams in while the start page shows (a visitor
gets no thumbnails; the tour appears in AR). Inside AR a card in the
middle of the camera view asks for the printed code (the owner's S1,
`public/prototypes/scan-1-centre-card/`), with the visitor's status
sentence on it and the GPS-only skip at the bottom after 10 s; it closes
by itself once the code is read. Once it locks and its votes have
corrected the placement, the tour's
`tour.json` content appears (pins as labels, photos as planes at their
capture spots). The frames a recording captured by itself are debug data:
a visitor never sees them. A tour whose zip carries no measured code is
placed by GPS at once, and says so.

A sample station tour ships with the app: `/tour/samples/marienplatz-tour.zip`
(three stations at Marienplatz in Munich, a knight, a choice, an arch).
Open it with `/tour/?qr=<that URL>&relocate=here` to try it anywhere: the
test switch moves its stations to your first GPS fix, in memory only
(`scripts/build-sample-tour.mjs`, `src/tour-relocation.ts`).

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

The workspace's globe package (`gps-plus-slam-globe`) is a dependency, for
the 3D editor's building blocks (`import ... from
"gps-plus-slam-globe/editor"`; nothing in the app imports it yet).
`src/globe-dependency.test.ts` builds those blocks with Vite and fails if
the build holds two copies of three.

The app ships the licence of every third-party package it bundles,
verbatim, in `public/third-party-licenses/` (copied into the site as
`third-party-licenses/`): `<name>-LICENSE.txt`, and `<name>-NOTICE.txt`
for a package that has a NOTICE, the name being the npm name with `@`
dropped and `/` written as `-`. `src/third-party-licenses.test.ts` derives
the list from the module ids of two builds (the app's own, and an entry
importing the globe's editor blocks; `src/test-support/bundled-packages.ts`),
never from `package.json`, and fails when a bundled package has no licence
file of its own, when a licence or NOTICE file is not shipped verbatim,
when a shipped file belongs to no bundled package, when `NOTICE` does not
name a bundled package, or when it does not say that a patched package
(`patchedDependencies` in `pnpm-workspace.yaml`) is modified and by which
patch (Apache License 2.0, sections 4(a), 4(b) and 4(d)). The app's own
`NOTICE` ships too, as `third-party-licenses/NOTICE.txt`, and the test
fails when that copy differs from it. A build's virtual modules (the
build tools' runtime glue) belong to no package: the known ones are
listed in `bundled-packages.ts` with the reason no licence ships for
them, and an unknown one fails the test until someone decides.

## Where the design lives

The guided setup and the mandatory code are the guided-setup plan
(`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-08-tour-viewer-improvements/2026-09-08-1459-tour-viewer-guided-setup-and-mandatory-code-plan.md`),
which superseded the flows plan
(`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-07-2259-tour-viewer-creator-and-visitor-flows-plan.md`)
after the first on-phone session. Origin of the printed-QR story:
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-25-0544-zip-streaming-transport-production-plan.md`
(§6).
