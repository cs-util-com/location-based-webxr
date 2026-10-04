# zxing-probe

## Purpose

Lazy, self-hosted zxing-wasm reader for the `?qrperf=zxing` comparison: the only place the demo touches zxing at runtime.

## Public API

- **`createZxingProbe({ load?, now? })`** returns a `ZxingProbe` plus `warmUp()`:
  - `decode(image, 'default' | 'fast')` -> `{ ms, result: { corners: [TL, TR, BR, BL], rotationDeg } | null }`. Malformed buffers (`data.length !== w*h*4`) return `{ ms: 0, result: null, skipped: true }` without loading anything; the instrument does not count them.
  - `loadMs()` - one-off load + instantiate time, `null` until loaded.
  - `warmUp()` - starts the load early (called when the flag is set, so the first frames are compared).
- **`ZxingReaderLike`** - the one zxing function used (`readBarcodes`), injectable for tests.

## Invariants & assumptions

- **Never fetched from jsDelivr.** The default loader dynamic-imports `zxing-wasm/reader` and `zxing-wasm/reader/zxing_reader.wasm?url` (Vite emits the binary as an asset under the app's base, e.g. `/qr-demo/assets/zxing_reader-<hash>.wasm`) and passes that URL to `locateFile`. Pinned by the e2e "zxing mode loads the self-hosted WASM and never the CDN".
- Nothing zxing-related is in the main chunk: the reader glue (~36 KB) and the `.wasm` (~953 KB, 416 KB gzip) load only in `zxing` mode.
- Option sets: `default` = `formats: ['QRCode'], maxNumberOfSymbols: 1`; `fast` additionally turns off `tryHarder / tryRotate / tryInvert / tryDownscale`.
- Loads once per page. Exact-pinned `zxing-wasm` 3.1.4 (upstream releases shift corners by 1-2 px).
- **Licences:** the npm package ships only its own MIT licence; the zxing-cpp code compiled into the `.wasm` is Apache-2.0. The attribution for the shipped binary is in the package root's `THIRD_PARTY_NOTICES.md` (owner decision 2026-09-23, closing interview).

## Tests

`zxing-probe.test.ts` (fake reader: corner order, option sets, invalid reads, malformed buffer, single load); `playwright-tests/qrperf.spec.js` (real WASM, same origin, no CDN).
