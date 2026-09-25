# qr-render.ts

## Purpose

Turn an arbitrary URL into a scannable SVG QR code and put it on the page.
Unrelated to `qr-payload/` (which only shrinks a URL's _text_, never renders
an image) — this is the missing "make it visible" step.

## Public API

- `generateQr(url: string): Promise<string>` — encodes `url` as SVG markup.
  Throws whatever the `qrcode` encoder throws (e.g. payload too long) rather
  than ever resolving to a blank/empty SVG.
- `renderQrSvg(host: HTMLElement, svg: string): void` — replaces `host`'s
  contents with `svg`.
- `QR_OPTIONS: QRCodeToStringOptions` — the pinned encoder options
  (`type: 'svg'`, `errorCorrectionLevel: 'M'`, `margin: 2`, `width: 512`).

## Invariants & assumptions

- `generateQr` does no URL work of its own (no trimming, no re-encoding) — the
  string reaches the encoder byte-identical, since callers often pass a
  presigned URL where any mutation silently breaks the link.
- `renderQrSvg`'s `innerHTML` use is safe only because the markup always
  comes from `generateQr`'s own encoder output, never from an
  author- or network-supplied string.
- Encoder options are pinned, not caller-configurable: the right trade-off
  depends on the payload shape (a long URL), which is constant across callers.

## Examples

```ts
const svg = await generateQr(viewingUrl);
renderQrSvg(document.querySelector('#qr')!, svg);
```

## Tests

`qr-render.test.ts` — the encoder is mocked (its own project's correctness is
out of scope); asserts the URL reaches it unchanged, the SVG result is
returned as-is, an encoder failure propagates instead of resolving to empty
markup, and `renderQrSvg` replaces existing host content.
