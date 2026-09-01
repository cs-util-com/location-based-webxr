# codec-dictionary.ts

## Purpose

Benchmark codec **A4** (plan §4): versioned static substitution dictionary —
known long substrings (URL prefixes, `?show=` JSON envelope keys) collapse
to single reserved bytes before transport encoding. Hypothesis H2: beats
generic deflate on short URL pointers (no header to amortise, domain
knowledge deflate lacks). Also exports the **A4+A2 chain** (dictionary →
`deflate-raw` → base64url).

## Public API

- `packDictionaryBytes(payload: string) → Uint8Array` — byte-level core
  (version byte + substituted body), exposed for chaining (the benchmark's
  `/S/<BASE32>` candidate and [qr-launch-url.ts](qr-launch-url.ts.md)'s
  path form feed it into deflate). The matching `unpackDictionaryBytes` is
  module-internal.
- `encodeDictionaryPayload` / `decodeDictionaryPayload` — A4 standalone
  (base64url transport), async by codec convention.
- `encodeDictionaryDeflatePayload` / `decodeDictionaryDeflatePayload` —
  A4+A2 chain.
- All decoders are total: unknown version byte, unassigned token byte,
  dangling escape or invalid UTF-8 → `null`, never a throw.

## Invariants & assumptions

- Wire: `[versionByte 0x01][body…]`. Token bytes 0x01–0x1F (23 of 31
  assigned); 0x00 escapes a literal control byte so payload bytes < 0x20
  can never be misread as tokens.
- **Printed QR codes are immutable**: the v1 byte↔string assignments are
  frozen forever. Evolving the table means a NEW version byte with its own
  table, and decode must keep supporting every version ever printed.
- Greedy longest-match substitution at each position (table sorted by
  length at module load; entry order in source is cosmetic).

- The provider-host knowledge here overlaps storage/share-link.ts, which runs the INVERSE transform (share page -> direct URL). A provider changing its URL scheme needs both checked.

## Examples

```ts
await encodeDictionaryPayload(
  'https://raw.githubusercontent.com/u/r/main/qr/x.json'
);
// → base64url of [0x01, 0x01, 'u/r'…, 0x08, 'qr/x', 0x09] — 34-char prefix = 1 byte
```

## Tests

`codec-dictionary.test.ts` (round-trips, substitution effectiveness,
version byte + unknown-version rejection, control-char escaping,
truncation nulls) and `codecs.property.test.ts` (arbitrary-unicode
round-trip, decode totality) for both A4 and the A4+A2 chain.
