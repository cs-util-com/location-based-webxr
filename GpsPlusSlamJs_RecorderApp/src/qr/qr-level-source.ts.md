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
- **Everything is abortable, with a timeout.** The controller awaits this
  INSIDE its detect step, so a hung request would stall detection itself, and
  work that outlived a session would stall the next one.

## Tests

`qr-level-source.test.ts` — the opener never called for a WiFi code, a foreign
host, a bare `user/repo/path`, a raw-GitHub URL, or our own host without a
payload; a placeholder rather than a rejection when the archive cannot open;
one open for many concurrent frames; a transport failure retried only after
its backoff; an absent level never re-asked; and nothing opened after dispose.
