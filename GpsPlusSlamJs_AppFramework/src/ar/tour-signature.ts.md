# tour-signature.ts

**Purpose:** `manifest.sig.json` - an Ed25519 signature over the EXACT
bytes of a tour's `manifest.json` by the key its `author` names as a
`did:key`, verified with WebCrypto (tour kit plan K1, §4.1, K-D2;
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`).
Key creation, signing and export for creators are K2's.

## Public API

- `TOUR_SIGNATURE_CONTEXT = "tour-kit manifest.json signature v1\n"` - a
  format constant: what is signed is these UTF-8 bytes followed by the
  manifest file's bytes as stored (`signedMessage(manifestBytes)`).
- `parseManifestSignature(text): ManifestSignature` - `{ alg: "Ed25519",
author: <Ed25519 did:key>, sig: <64 bytes, unpadded base64url> }`;
  unknown fields ignored; throws `TourIntegrityError("malformed-signature")`.
- `verifyManifestSignature(manifestBytes, signatureText, subtle?)` ->
  `{ kind: "valid", author }` or `{ kind: "unsupported", author, reason }`;
  throws `TourIntegrityError` `malformed-signature` or `bad-signature`.
- `signedMessage(manifestBytes)` - the bytes a signature covers.
- `keyFingerprint(author): Promise<string>` - `"3f2a 91c0 77de"`: the
  first 48 bits of the SHA-256 of the raw key, three groups of four hex
  digits, for people to compare (K2 adds a nickname). Rejects for a string
  that is not an Ed25519 did:key.

## Invariants & assumptions

- **Exact bytes, a context prefix.** No JSON canonicalisation has to agree
  between writer and reader; the prefix keeps a tour signature from being
  valid for anything else the same key might sign (domain separation).
  A signature made without it does not verify (tested).
- **Three outcomes, never confused.** `valid` only after
  `crypto.subtle.verify` returned true for the key the `author` line names.
  A forged author line (a valid signature by another key) is
  `bad-signature`. `unsupported` - "cannot check the signature on this
  browser" - only when the browser has no Ed25519 (`NotSupportedError`) or
  no WebCrypto at all (an insecure context); it is never treated as valid.
  Any other failure (a key that does not import) is `bad-signature`.
- **Browser support (verified 2026-10-04).** MDN browser-compat-data
  (`api/SubtleCrypto.json`, entries `sign/verify/importKey/generateKey
.ed25519`): Chrome 137, Firefox 129, Safari 17; Chrome Android, Edge,
  Opera, Samsung Internet, WebView Android, Firefox Android and Safari iOS
  are listed as "mirror" of their engine, so `verify` works on Chrome
  Android from 137. caniuse (`mdn-api_subtlecrypto_verify_ed25519`)
  shows the current releases as supported (Chrome Android 154, Samsung
  Internet 30, Firefox Android 157, Safari iOS 17.0+); it lists only the
  latest Android version. Safari signs with randomised (not RFC 8032
  deterministic) signatures - irrelevant to verification. The plan's §2
  research named the same three versions.
  - Where Ed25519 is missing (an older browser), `importKey` rejects with
    `NotSupportedError`; that is the `unsupported` path.
- **The core library's license key** (`GpsPlusSlamJs/src/licensing`) also
  verifies Ed25519, through a bundled library; the tour kit uses WebCrypto
  as the plan decided (K-D2) and adds no dependency.

## Sources

- MDN browser-compat-data, `api/SubtleCrypto.json`:
  https://github.com/mdn/browser-compat-data/blob/main/api/SubtleCrypto.json
- MDN, SubtleCrypto.verify():
  https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify
- caniuse, SubtleCrypto verify Ed25519:
  https://caniuse.com/mdn-api_subtlecrypto_verify_ed25519
- W3C CCG did:key v0.9: https://w3c-ccg.github.io/did-key-spec/ (see
  `utils/did-key.ts.md`).

## Examples

```ts
const verdict = await verifyManifestSignature(manifestBytes, sigText);
if (verdict.kind === 'valid') show(await keyFingerprint(verdict.author));
```

## Tests

`tour-signature.test.ts` (real WebCrypto Ed25519 in Node): a valid
signature; other bytes, a forged author line and a signature without the
context prefix are bad; any single flipped byte of the manifest or of the
signature fails (properties); a browser without Ed25519 and a page
without WebCrypto read `unsupported`, a `DataError` reads bad; the parser's
refusals; the fingerprint's shape and stability.
