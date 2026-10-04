# did-key.ts

**Purpose:** `did:key` identifiers for Ed25519 public keys - how a tour's
author and the authors of linked series are named (tour kit plan K1,
K-D2). Pure.

## Public API

- `ed25519PublicKeyToDidKey(publicKey: Uint8Array): string` - throws
  `TypeError` unless the key is 32 bytes.
- `didKeyToEd25519PublicKey(did: unknown): Uint8Array | null` - the raw
  32-byte key, or null for any other DID method, key type, length or
  alphabet. Never throws.
- `isDidKeyEd25519(value: unknown): value is string`.

## The encoding (verified 2026-10-04)

`did:key:` + `z` (multibase prefix for base58btc) + base58btc of
`0xed 0x01` (the unsigned-varint of multicodec `ed25519-pub`, code `0xed`)
followed by the 32 raw key bytes - 34 bytes, so every Ed25519 did:key
starts `did:key:z6Mk`.

Sources:

- W3C CCG, "The did:key Method v0.9" (draft community group report):
  https://w3c-ccg.github.io/did-key-spec/ - the format, the `z` prefix and
  the Ed25519 examples `did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP`
  and `did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`.
- Multiformats multicodec table
  (https://github.com/multiformats/multicodec/blob/master/table.csv):
  `ed25519-pub, key, 0xed`.
- Both spec examples were decoded with an independent BigInt base58
  decoder: 34 bytes each, starting `ed01`; the 32 key bytes are the test
  vectors.

## Invariants & assumptions

- Only Ed25519: that is the one curve WebCrypto verifies in every target
  browser (secp256k1, used by Nostr, is not in WebCrypto; plan §2).
- The spec is a draft community report; the Ed25519 encoding has been
  stable since its first versions and is what every did:key library emits.

## Examples

```ts
const did = ed25519PublicKeyToDidKey(raw32); // "did:key:z6Mk..."
didKeyToEd25519PublicKey(did); // raw32
```

## Tests

- `did-key.test.ts` - both spec vectors both ways, refusals (another
  method, another multibase, a secp256k1 did:key, a truncated key, a
  look-alike character, a non-string), the length guard, and a
  round-trip property over random keys.
