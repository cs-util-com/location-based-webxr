# sha256-hex.ts

**Purpose:** lowercase hex, and the SHA-256 of bytes as lowercase hex via
WebCrypto - one copy for the package (DEC-H3): the printed code's
identity (`qr-payload/qr-code-id.ts`), a tour's file hashes and a signing
key's fingerprint (tour kit plan K1).

## Public API

- `bytesToHex(bytes: Uint8Array): string` - two lowercase digits a byte.
- `sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string>` - 64 hex
  digits. Hashes only the bytes a view covers (it copies the view into a
  plain `ArrayBuffer`, which WebCrypto requires). Rejects where WebCrypto
  is missing (an insecure origin).

## Invariants & assumptions

- WebCrypto has no streaming digest, so the whole input is in memory: the
  callers hash one archive entry at a time, bounded by the K0 per-entry
  cap (256 MiB; the largest real entry is 7.9 MB). A K4 video above that
  would need a streaming hash (revisited with K4, as the K0 sweep note
  already says for the entry cap).

## Examples

```ts
await sha256Hex(new TextEncoder().encode('abc')); // "ba7816bf..."
bytesToHex(Uint8Array.of(0, 255)); // "00ff"
```

## Tests

- `sha256-hex.test.ts` - the FIPS 180-2 vectors, a sub-view hashed alone,
  an ArrayBuffer input, and the hex padding. `qr-code-id.test.ts` covers
  the printed-code identity built on it.
