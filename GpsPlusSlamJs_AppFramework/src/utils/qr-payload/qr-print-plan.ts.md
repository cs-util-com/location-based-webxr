# qr-print-plan.ts

## Purpose

One-line: plan a printable QR code — the launch URL to encode, and the
physical size to print it at.

The printed code is the anchor between two apps: one authors the level behind
it, another consumes it. The printed string also decides the code's identity
(`qrCodeId`). Keeping the print rule in one app and the read rule in another
is how the two drift, and the failure is silent — a code that scans fine and
resolves to nothing. Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-A (DEC-2b, DEC-6).

## Public API

- `DEFAULT_QR_LAUNCH_BASE_URL: string` — where a scan lands by default.
- `MAX_HOME_PRINTABLE_SIDE_M: number` — the A4/Letter width budget.
- `homePrintWarning(sizeM: number): string | null` — plain-words warning, or
  `null` when the size fits a home printer.
- `printedSideCss(sizeM: number): string` — metres → exact CSS centimetres.
  **Throws `RangeError`** for a non-positive or non-finite size.
- `planPrintCode(dataUrl, options?): Promise<QrPrintPlan>` → `{ url,
qrVersion }`.
  - `options.baseUrl` — override where a scan lands.
  - `options.codeIndex` — 1-based; which code of a set this is.
  - `options.defaultAssetPrefix` — passed through to the URL builder.
  - **Throws `RangeError`** when `codeIndex` is not a positive integer, and
    `TypeError` (from the builder) when no launch form fits a scannable QR.

## Invariants & assumptions

- **The size contract is the SYMBOL, not the page.** The printed side length
  is the dark module area **without** the quiet zone, because that is what the
  detector's corners outline and what the PnP solve scales by. A renderer must
  draw the canvas with `margin: 0` and add the quiet zone as CSS padding.
- **The base URL is a bare host, never a path** (ZD-9). The landing page owns
  `/` and forwards `?qr=` untouched; a path in the printed base would forfeit
  the densest encodings forever.
- **The default base URL is shared, not duplicated per app.** Every app that
  prints a code prints one that opens the same viewer, so the value belongs to
  the product rather than to the printing app.
- **The per-code token is omitted for code 1 and present from code 2 on.** Its
  only job is to make several codes for one archive textually distinct so
  their ids differ; nothing reads its value. Spending its bytes on the
  single-code tour — the common case — would shrink the payload budget for
  nothing.
- **The token is appended BEFORE size estimation**, so the fits-a-QR guarantee
  covers the string actually printed. A suffix added after the estimate would
  void that guarantee silently.
- `printedSideCss` rounds to 0.1 mm. Rounding to a whole millimetre is inert
  for step-aligned inputs but puts a ~0.3 % scale bias into a hand-typed
  off-step size — a depth error on the least-constrained axis of the solve.

## Examples

```ts
// the only code of a tour
const plan = await planPrintCode(hostingUrl);

// the third of four posters sharing one archive
const third = await planPrintCode(hostingUrl, { codeIndex: 3 });
const id = await qrCodeId(third.url); // → its own qr/<id>.json

// render at true physical size: symbol only, quiet zone as CSS padding
canvasStyle.setProperty('--print-side', printedSideCss(0.16));
```

## Tests

`qr-print-plan.test.ts` — the launch URL decodes back to the hosting URL
through the real dispatcher; the bare-host invariant; a caller-supplied base;
the token omitted for code 1 and present from code 2; **four codes for one
archive yielding four distinct `qrCodeId`s** (the DEC-2b case); the scannable
ceiling holding for codes 1, 2, 10 and 99 with the token included; the printed
URL passing `qrCodeIsOurs` (so the printer and the safety gate cannot drift
apart); and the rejection cases for both the hosting URL and the code index.
Plus the size-budget warning and the centimetre mapping, including the
off-step rounding case.

No fixtures required.
