# qr-level-source.ts

## Purpose

One-line: resolve a scanned QR code to the level file behind it, during a
recording — the recorder's first network call on a session path.

Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-E (DEC-7).

## Public API

- `createQrLevelSource(deps): QrLevelSource`
  - `fetchLevel(text)` — wire into the tracking controller's `fetchLevel`.
    **Never rejects.**
  - `stateFor(text)` — the last thing that happened, for the status line.
  - `dispose()` — abort in-flight work and stop answering.
- `QrLevelLookupState` — `level | absent | not-ours | failed`.
- Injectable `openArchive` / `readLevels` / `fetchImpl` / `now`, so every path
  here is testable without a network.

## Invariants & assumptions

- **Nothing is fetched until `qrCodeIsOurs` passes.** Feeding raw decoded text
  to `resolveQrPayload` would send any text containing a `/` to
  `raw.githubusercontent.com` and any `http…` text to itself — an
  attacker-chosen address, reached from the frame path, by pointing a phone at
  a sticker. The allowlist runs first, always, and a test asserts the opener
  is never called for a foreign code.
- **It takes the `?qr=` PAYLOAD, not the raw text.** The URL is parsed and the
  parameter read before the decoder ever sees anything.
- **It never rejects.** A rejected `fetchLevel` drives the tracking controller
  into an error↔scanning flap at the detection cadence; every failure resolves
  to a geo-less placeholder that never solves and never votes — the honest
  "no".
- **"Absent" and "broken" are cached differently.** A code that genuinely has
  no level in its archive is cached forever: asking again cannot change the
  answer. A transport failure is retried with exponential backoff (4 s → 60 s)
  because one DNS hiccup at the first sighting must not poison that code for
  the rest of the recording — but retrying on every frame would hammer.
- **One request per code at a time.** The detector fires at ~8 Hz; without the
  in-flight map every frame would open another archive read while the first
  was still going.
- **The WAIT is bounded — the request is not.** `openRemoteArchive` has no
  abort seam (no `signal` option), so an underlying fetch cannot be cancelled
  from here; an `AbortController` nothing listens to would have been a claim,
  not a guarantee. What matters for correctness is that the tracking
  controller awaits this **inside** its detect step: an unbounded wait stalls
  QR detection for the rest of the session, and a session-end wait outlives
  the session. Racing a deadline fixes both, and the orphaned request finishes
  into nothing. A real abort needs a signal threaded through the storage
  layer — **filed, not faked**.
- **The retry only works because the controller is told not to cache.** The
  tracking controller keeps its own per-text level cache; without
  `shouldCacheLevel`, the first failure would be cached for the session and
  the backoff here would never be asked for.
- **The fetch guard is TWO checks, not one.** `qrCodeIsOurs` says the launch
  URL is ours; it does **not** say the payload inside it is. A payload may be
  a full URL, returned verbatim by the decoder, so
  `https://ours.example/?qr=https://evil.example/x.zip` passes the first
  check. The RESOLVED archive URL's host is therefore checked too, against the
  asset prefix, the proxy, and the storage hosts our own encoder can name.

## Tests

`qr-level-source.test.ts` — the opener never called for a WiFi code, a foreign
host, a bare `user/repo/path`, a raw-GitHub URL, or our own host without a
payload; a placeholder rather than a rejection when the archive cannot open;
one open for many concurrent frames; a transport failure retried only after
its backoff; an absent level never re-asked; and nothing opened after dispose.
