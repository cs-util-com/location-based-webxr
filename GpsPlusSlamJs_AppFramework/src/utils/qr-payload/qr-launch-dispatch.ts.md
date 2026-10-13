# qr-launch-dispatch.ts

## Purpose

The decode side of the `?qr=` launch contract whose encoder is
`qr-launch-url.ts`: turns a scanned QR's payload into the archive URL it
names. The encoder picks whichever of its forms yields the sparsest printable
QR, so a consumer decoding only some forms silently breaks a subset of printed
codes — this implements all four, and the Drive short form `D/<id>`.

It lived in the tour viewer until 2026-08-28 while the encoder lived here,
which is how the two halves of one contract end up drifting. The recorder is
the second consumer, and it moved next to its encoder rather than being
copied (plan §3 M-A).

## Public API

- `resolveQrPayload(payload: string, defaultAssetPrefix: string): Promise<string | null>`
  — `http…` → raw URL; `~…` → dictionary decode; `D/<id>` → the Drive
  file `https://drive.google.com/file/d/<id>` (Tour Viewer r820 feedback
  R5, checked before the template, which needs three parts); contains `/` → GitHub
  template `user/repo/path` → `raw.githubusercontent.com/...`; else bare name
  under the prefix. Null for empty/undecodable payloads; never throws.

## Invariants & assumptions

- The payload arrives already URL-decoded (from `URLSearchParams.get`).
- **A reader ships before its writer.** Every printed code opens
  gps.csutil.com, i.e. `main`, so a form is decoded on `main` before any
  code may carry it. The Drive short form's reader shipped on r821 with
  its writer off (`allowDriveShortForm`).
- The GitHub template is lossy by design on the encoder side
  (`/refs/heads/main/` and `/main/` collapse to one payload); decode emits
  the `refs/heads/main` form — both serve identical bytes.
- The opt-in fifth form (`HTTPS://<HOST>/S/<base32>`) is a PATH, not a `?qr=`
  payload; it needs the still-undeployed `/S/*` rewrite and is intentionally
  not decoded here yet.
- **It takes the `?qr=` PAYLOAD, not a decoded QR text and not a URL.** A
  caller holding raw scanned text must parse the URL and read the `qr`
  parameter first. Feeding it raw text is actively unsafe: any text containing
  a `/` resolves to a `raw.githubusercontent.com` URL and any `http…` text
  resolves to itself, so a stranger's sticker would name the address the app
  then fetches. `qrCodeIsOurs` is the gate that must pass first.

## Examples

```ts
await resolveQrPayload('user/repo/city.zip', PREFIX);
// → 'https://raw.githubusercontent.com/user/repo/refs/heads/main/city.zip'
```

## Tests

`qr-launch-dispatch.test.ts` — the four forms, the Drive short form (and a
round-trip of every candidate for three Drive spellings to the same file), null cases, and a round-trip
suite that runs the REAL encoder and requires every candidate it emits to
resolve back to the input URL.
