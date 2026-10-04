# tour-trust-copy.ts

## Purpose

What the page says about a tour's signature, in plain words (tour kit
plan K1, K-D2): signed by a key's short fingerprint, not signed, or - on a
browser without Ed25519 - signed but NOT checked; then the trust-on-first-
use warnings (`tour-trust.ts`) and the links to other series. Pure:
fingerprints come in already computed.

## Public API

- `trustLines({ signature, warnings, links, fingerprintOf }): string[]` -
  the signature line, one line per warning, then one links line when a
  SIGNED tour links other series (an unsigned or unchecked tour shows none,
  K1 milestone review R12: nobody vouches for its list).
- `type SignatureState` - `none | listed | signed(author) |
unsupported(author)`.

## The wording

- signed: "Signed by key 3f2a 91c0 77de: the tour has not been changed
  since this key signed it. A key is not a verified person - trust it as
  far as you trust where the link came from."
- unsupported: "Signed by key ..., but this browser cannot check
  signatures, so the signature was NOT checked. Update the browser to check
  it." Never anything that reads as valid.
- listed (a manifest, no signature): "Not signed: its files match its own
  list of contents, but nobody vouches for who made it."
- none: "Not signed: there is no way to check who made this tour or
  whether it was changed."
- warnings name the key expected and the key found, by fingerprint, and
  the source ("this link" / "this printed code").
- links: "Links to 2 other tours: K7fQ2mX9 (same key), Z9yX8wV7 (key ...)."
  - "same key" only when the tour is SIGNED by that key and the signature
    was checked.

## Invariants & assumptions

- A key is never called a person; K2 adds the nickname a player gives a
  key.
- A linked series is named by the first 8 characters of its id: the
  manifest carries no title or link for it (plan §4.1), so it cannot be
  opened from here yet.

## Tests

`tour-trust-copy.test.ts`: the signed line names the fingerprint and says
a key is not a person; unsupported never reads as checked; both unsigned
lines; each warning with both keys; links with "same key"; no links line
for an unsigned tour or one whose signature was not checked (R12); no
links line without links.
