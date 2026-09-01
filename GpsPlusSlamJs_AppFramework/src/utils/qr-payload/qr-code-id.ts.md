# qr-code-id.ts

## Purpose

One-line: derive a printed QR code's stable identity — the name of its level
file inside a tour zip — from the code's own decoded text.

A tour zip can serve several printed codes at once. Each needs its own
`qr/<id>.json`, and the id comes from the code rather than from a number the
author has to track. Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-A (DEC-2, DEC-2b).

## Public API

- `QR_CODE_ID_LENGTH: number` — hex characters kept from the digest (12).
- `qrCodeId(text: string): Promise<string>`
  - **Input:** the decoded QR payload, exactly as printed.
  - **Output:** lowercase hex, `QR_CODE_ID_LENGTH` characters.
  - **Throws `TypeError`** when `text` is not a string.
  - **Throws `Error`** when `crypto.subtle` is absent — i.e. an insecure
    context. It is async for this reason alone: Web Crypto has no sync digest.

## Invariants & assumptions

- **The digest is over the decoded text exactly as printed**, UTF-8 encoded
  (via the package's own `utf8Encode`, not a second encoder). It is **never**
  derived from `location.href`: the landing page redirects, so the address a
  viewer ends up on is not the printed string, and a re-encoded parameter or
  an added trailing slash would change the id and orphan a published level.
- **Truncation to 48 bits is deliberate.** A collision needs two distinct
  printed URLs; an author prints a handful per tour, and even at 1 000 codes
  the birthday probability is under 2e-9. The trade buys a file name that is
  readable in a zip listing.
- **Lowercase hex is load-bearing** — the id is interpolated into
  `qr/<id>.json` and must satisfy the archive reader's entry pattern.
  Switching to base64url would break reading silently.
- Empty string is a valid input and hashes normally; only a non-string is
  rejected. A decoder never emits an empty text, so guarding it would add a
  branch nothing exercises.

## Examples

```ts
const id = await qrCodeId('https://gps.csutil.com/?qr=tour&n=2');
// → 'de9174304b82' (12 lowercase hex chars)
const entry = `qr/${id}.json`;
```

Four codes for one zip differ only by the per-code token the print panel
appends, and therefore get four different ids:

```ts
await qrCodeId('https://gps.csutil.com/?qr=tour'); // code 1
await qrCodeId('https://gps.csutil.com/?qr=tour&n=2'); // code 2 — different id
// (the values above are real digests, checked against Node's SHA-256 —
//  a hand-written one here would contradict this file's own Tests note)
```

## Tests

- `qr-code-id.test.ts` — cross-checks every case against **Node's own
  SHA-256** rather than against hand-written constants (the repo's
  never-write-a-spec-constant-from-memory rule): realistic launch URLs,
  non-ASCII and emoji text, determinism, the four-codes-one-zip distinctness
  case, the filename-safe format, and the non-string rejection.
- `qr-code-id.property.test.ts` — the same oracle over arbitrary strings, the
  format invariant, and distinct-input-distinct-id. Its generator is
  deliberately NOT a bare `fc.string()`: that draws short ASCII only, so a
  property claiming to cover surrogates, control characters and long payloads
  over it would cover none of them. It unions ASCII, full-Unicode and binary
  units.

No fixtures or test data required.
