# qr-launch-dispatch.ts

## Purpose

The decode side of the framework's `?qr=` launch contract (documented in
`gps-plus-slam-app-framework`'s `utils/qr-payload/qr-launch-url.ts` header):
turns a scanned QR's payload into the archive URL it names. The encoder picks
whichever of its forms yields the sparsest printable QR, so a viewer decoding
only some forms silently breaks a subset of printed codes — this implements
all four.

## Public API

- `resolveQrPayload(payload: string, defaultAssetPrefix: string): Promise<string | null>`
  — `http…` → raw URL; `~…` → dictionary decode; contains `/` → GitHub
  template `user/repo/path` → `raw.githubusercontent.com/...`; else bare name
  under the prefix. Null for empty/undecodable payloads; never throws.

## Invariants & assumptions

- The payload arrives already URL-decoded (from `URLSearchParams.get`).
- The GitHub template is lossy by design on the encoder side
  (`/refs/heads/main/` and `/main/` collapse to one payload); decode emits
  the `refs/heads/main` form — both serve identical bytes.
- The opt-in fifth form (`HTTPS://<HOST>/S/<base32>`) is a PATH, not a `?qr=`
  payload; it needs the still-undeployed `/S/*` rewrite and is intentionally
  not decoded here yet.

## Examples

```ts
await resolveQrPayload("user/repo/city.zip", PREFIX);
// → 'https://raw.githubusercontent.com/user/repo/refs/heads/main/city.zip'
```

## Tests

`qr-launch-dispatch.test.ts` — the four forms, null cases, and a round-trip
suite that runs the REAL encoder and requires every candidate it emits to
resolve back to the input URL.
