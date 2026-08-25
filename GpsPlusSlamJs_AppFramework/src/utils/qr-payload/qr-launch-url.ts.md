# qr-launch-url.ts

## Purpose

One-call answer to "I have the app's base URL and an asset URL — give me
the launch URL whose printed QR code scans from the furthest away."
Generates every strategy the 2026-07-05 payload benchmark validated, costs
each with the oracle-locked [qr-size-estimator](qr-size-estimator.ts.md),
and returns the sparsest (fewest QR bits at the chosen EC level; ties go
to the more human-readable form). Results doc:
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-05-2027-qr-payload-compression-benchmark-results.md`.

## Public API

- `buildQrLaunchUrl(baseUrl, dataUrl, options?) → Promise<QrLaunchPlan>`
  - `baseUrl` — app origin (`https://gps.csutil.com`; scheme-less and
    trailing-slash inputs are normalised).
  - `dataUrl` — absolute http(s) asset URL ("map to load").
  - `options.ecLevel` — default `'Q'` (print-robust, decision D2).
  - `options.defaultAssetPrefix` — enables the bare-`name` strategy for
    asset URLs under the app's conventional home (include trailing `/`).
  - `options.allowPathForm` — also generate `HTTPS://<HOST>/S/<BASE32>`;
    OFF by default until the `/S/*` Cloudflare rewrite exists.
  - Returns `{ strategy, url, estimate: {bits, version, modules},
candidates }` — `candidates` holds every form that fit ≤ v25 so
    callers/tools can show the comparison.
  - **Throws `TypeError`** on invalid base/data URLs or when nothing fits
    a QR ≤ v25 (tooling-time API — fails loudly, unlike the scan-time
    decoders which are total).

## Invariants & assumptions

- Strategies and their decode-side dispatch contract (for the future
  launch handler): payload starts `http…` → `raw`; starts `~` →
  `dictionary` blob (marker prevents collision with bare names, which can
  be valid base64url); contains `/` → `template`
  (`user/repo/path` on raw-GitHub main); else → `name` under
  `defaultAssetPrefix`. `path-base32` payloads are strict-uppercase
  base32 after `/S/`.
- Every emitted `?qr=` value is query-legal (no literal `& # + %` or
  whitespace) — property-tested; `+`/`%`-bearing URLs fall back to
  `encodeURIComponent` in the `raw` strategy.
- The `template` strategy only fires for
  `raw.githubusercontent.com/<user>/<repo>/(refs/heads/)?main/<path>` —
  the branch is app convention; other branches ship as `raw`/`dictionary`.
- The path form requires a host-only base URL (uppercasing a path would
  change its meaning) and inherits `DecompressionStream` availability on
  the DECODE side (see [compression.ts](compression.ts.md)).
- Winner selection is measurement, not heuristics — adding a strategy is
  just adding a candidate.

## Examples

```ts
const plan = await buildQrLaunchUrl(
  'https://gps.csutil.com',
  'https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/MyMap123.zip'
);
plan.url; // 'https://gps.csutil.com/?qr=cs-util-com/GeoTales/MyMap123.zip'
plan.strategy; // 'template'
plan.estimate.version; // 5  (raw URL form: 9)
// Printable QR (qrcode / soldair-node-qrcode):
const svg = await QRCode.toString(plan.url, {
  type: 'svg',
  errorCorrectionLevel: 'Q',
});
```

## extraQuery (QR-pose plan 2026-08-25)

- `options.extraQuery` prints extra query params (e.g. the per-code
  discriminator `{ c: '2' }`) into every candidate BEFORE size estimation,
  so the estimate and the fits-a-QR guarantee hold for the printed string.
  The all-caps `/S/` form cannot carry `&`/`=`/lowercase and is dropped
  whenever extra params are present (an EMPTY extraQuery keeps it) — a
  payload that only fits via /S/ therefore throws the fits-no-QR TypeError
  the moment extras are used, by design.

## Tests

`qr-launch-url.test.ts` — the developer walkthrough (template win,
`qrcode` render + exact version agreement, bare-name prefix, non-GitHub
hosts, opt-in path form, `~` dispatch marker + round-trip, normalisation,
TypeError boundaries). `qr-launch-url.property.test.ts` — minimum-bit
selection, dictionary round-trip, query-legality of every candidate over
arbitrary web URLs.
