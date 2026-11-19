# serve-zip.js

## Purpose

An e2e helper: serves a tour archive the editor saved (a download's bytes) on the page's own origin, as a host that honours byte ranges does, so a visitor page opens it with `?qr=<url>` without a file server.

## Public API

- `serveZip(page, path, zip, etag)` routes `**<path>` on `page`:
  - `HEAD` answers 200 with the length;
  - a `Range: bytes=a-b` GET answers 206 with that slice and its `content-range`;
  - any other GET answers 200 with the whole archive.
  - Every answer carries `accept-ranges: bytes`, `content-type: application/zip` and the quoted `etag`.

## Invariants

- Only closed ranges (`bytes=a-b`) are sliced, as the visitor's archive reader asks; an open or suffix range gets the whole file.
- The route is the page's: a second page needs its own call.

## Users

`editor3d-characters.spec.js` (a character saved and visited), `editor3d-narration.spec.js` (a narration's synthetic mark and credit saved and seen by the visitor).
