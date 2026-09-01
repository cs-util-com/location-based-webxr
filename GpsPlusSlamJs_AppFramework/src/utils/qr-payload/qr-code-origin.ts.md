# qr-code-origin.ts

## Purpose

One-line: decide whether a decoded QR text is one of **our** launch URLs —
the safety gate that must pass before anything fetches a scanned code or mints
an anchor for it.

This is a security boundary, not a convenience. Decoding a QR turns a printed
sticker into a URL; without this check, pointing a camera at a stranger's
sticker would be enough to start an outbound byte-range request from the AR
frame path, to an address the stranger chose. The same predicate gates
minting, because an app that anchors every code it sees would write real
coordinates for a shop's WiFi code into a zip the author later publishes.

Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-A and §6 (cold-review findings 7 and 14).

## Public API

- `qrCodeIsOurs(text: string, allowedHosts: readonly string[]): boolean`
  - **Input:** the decoded QR payload; the exact host names we own.
  - **Output:** `true` only when the text is an absolute `http:`/`https:` URL
    whose hostname exactly matches an allowed host and which carries a
    non-empty `qr` query parameter.
  - **Never throws** — and that is now checked rather than asserted: the
    allowlist is validated as an array of strings, not just read. It runs on
    the frame path, where a malformed input must be a `false`.

## Invariants & assumptions

- **Fails closed.** Anything not positively recognised is not ours: an empty
  allowlist, a non-string, an unparseable text, an unknown scheme.
- **Host matching is EXACT on the parsed hostname**, case-insensitive — never
  a prefix, suffix or substring test. Three attacks depend on this and each
  has its own test:
  - `evil.ours.example` and `ours.example.evil.test` must not match by
    suffix/prefix;
  - `https://ours.example@evil.example/` must resolve to `evil.example` — the
    URL parser puts the allowed-looking part in `username`, which is exactly
    why the check reads `hostname` and not the raw string.
- **Scheme is restricted to http/https**, so `javascript:`, `data:`, `file:`
  and `ftp:` are refused even when the rest of the string looks like ours.
- **A non-empty `qr` parameter is required**, so our own home page is not
  treated as a code.
- Port is ignored: `localhost` in the allowlist matches `localhost:5173`. Dev
  origins therefore need one entry, not one per port.
- **A trailing dot is stripped before comparing.** `https://ours.example./` is
  the same host to a resolver but the URL parser keeps the dot; without this
  the gate quietly declines a code that IS ours — fail-closed, but wrong, and
  invisible in the field.
- **The payload is trimmed before the emptiness test**, so `?qr=%20` is not a
  code.
- **Probed, not assumed** (M-A review): IDN homographs punycode and are
  refused; percent-encoded hosts normalise and are accepted; `blob:`,
  `filesystem:`, `javascript:`, `data:`, `file:` and `ftp:` are refused;
  backslash forms and embedded credentials resolve to the real host. No bypass
  was found; the defects were over-refusal and the unchecked allowlist, both
  fixed above.
- It answers "is this ours", **not** "is this safe to render". Callers still
  resolve the payload through the normal decoder afterwards.

## Examples

```ts
const HOSTS = ['gps.csutil.com', 'localhost'];

qrCodeIsOurs('https://gps.csutil.com/?qr=tour&n=2', HOSTS); // true
qrCodeIsOurs('WIFI:S:CoffeeShop;T:WPA;P:hunter2;;', HOSTS); // false
qrCodeIsOurs('https://evil.gps.csutil.com/?qr=tour', HOSTS); // false
qrCodeIsOurs('https://gps.csutil.com/', HOSTS); // false — no payload
```

Intended use on both gated paths:

```ts
if (!qrCodeIsOurs(detection.text, allowedHosts)) return; // no fetch, no mint
```

## Tests

`qr-code-origin.test.ts` — our own launch URLs (including an uppercase one and
a dev-port one); real non-URL codes a camera actually sees (WiFi, `mailto:`,
`tel:`, vCard, plain text); foreign hosts including `raw.githubusercontent.com`
and Drive; the substring/suffix confusions; the userinfo confusion; non-http
schemes; the missing/empty payload cases; and the fail-closed cases.

No fixtures or test data required.
