# base58btc.ts

**Purpose:** base58 with the Bitcoin alphabet, the encoding inside an
Ed25519 `did:key` (`did-key.ts`, tour kit plan K1). Pure.

## Public API

- `encodeBase58btc(bytes: Uint8Array): string` - no multibase prefix.
- `decodeBase58btc(text: string): Uint8Array | null` - null for any
  character outside the alphabet (`0`, `O`, `I`, `l` are not in it). Never
  throws.

## Invariants & assumptions

- Leading zero bytes map to leading `1`s and back, so
  `decode(encode(b))` is the identity for every byte array.
- Quadratic big-number conversion: fine for the 34-byte keys it serves,
  not meant for megabytes.
- Searched both roots 2026-10-04: no base58 existed (the core library's
  license key uses base64url, not base58).

## Examples

```ts
encodeBase58btc(Uint8Array.of(0x61)); // "2g"
decodeBase58btc('2g'); // Uint8Array [0x61]
```

## Tests

- `base58btc.test.ts` - the Bitcoin Core base58 test vectors (checked
  against an independent BigInt encoder first), refusal of look-alike
  characters, and a decode-of-encode property with leading zeros.
