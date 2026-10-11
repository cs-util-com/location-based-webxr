# tour-trust-view.ts

## Purpose

Composes what the page shows about an opened tour's signature (tour kit
plan K1): the tier-1 signature state (`tour-integrity.ts`), judged against
the phone's memory (`tour-trust.ts`, trust on first use keyed by source),
worded by `tour-trust-copy.ts`, every key named by its fingerprint
(`keyFingerprint`). DOM-free; `archive-open.ts` renders the strings.

## Public API

- `describeTourTrust({ integrity, sources, storage, nowMs, audience? }):
Promise<string[]>` - judges, records the sight, and returns the lines;
  `audience` (`"creator"` by default) is `trustLines`' (a visitor gets no
  line for an unsigned tour without a warning, UI round 1, U1).
- (module-private) `signatureStateOf(integrity)` - the tier-1 result as
  the copy's `SignatureState`.

## Invariants & assumptions

- A signature the browser could not check (`unsupported`) is neither
  recorded nor judged: an unchecked key must not become the reference, and
  must not raise a warning it cannot back up.
- A tour without a manifest is observed as unsigned with no series (a
  source that was signed and now serves it warns).
- Fingerprints are computed once per distinct key named (signer, warning
  keys, link authors).

## Tests

`tour-trust-view.test.ts`: the signer named by fingerprint and the source
recorded; another key on the same link warns with both fingerprints; an
unsigned tour's line; an unsupported signature neither learned nor judged;
the links line. `archive-open-file.test.ts` pins that an opened tour shows
its line on the page.
