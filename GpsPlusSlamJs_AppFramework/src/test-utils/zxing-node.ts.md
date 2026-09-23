# zxing-node (test-only)

## Purpose

Loads [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) in Node as an **independent, real QR decoder** for unit tests: the oracle that lets tests decode rendered images instead of injecting hand-made corners.

## Public API

- **`loadZxingReaderForNode(): Promise<void>`** - instantiates the reader module once per test process from the installed `zxing-wasm/reader/zxing_reader.wasm` (via `overrides.wasmBinary`). Idempotent.
- **`readQrCodes(image: RgbaImage, options?: ReaderOptions): Promise<ReadResult[]>`** - decodes an RGBA buffer. Defaults `formats` to `['QRCode']` (an empty list means every format and is 3-7x slower); other options pass through. Throws `RangeError` when `data.length !== width * height * 4`.

## Invariants & assumptions

- **Never touches the network.** The library's default `locateFile` fetches the binary from jsDelivr; `wasmBinary` bypasses it. Pinned by `zxing-node.test.ts` with a throwing `fetch` stub.
- **Exact-pinned devDependency (`3.1.4`).** Upstream releases have shifted reported corner positions by 1-2 px (v3.0.3 notes), and the tolerances in `ar/qr/qr-zxing-oracle.test.ts` depend on them. Bump deliberately and re-run the sweep.
- `ImageData` is duck-typed by the library (`data`, `width`, `height`), so no DOM is needed.
- zxing reports **integer** corners (`QuadrilateralI`) on the **outer symbol edge**, in symbol order (TL, TR, BR, BL).
- Test-only: lives in `src/test-utils/`, is not a tsdown entry, and must never be imported by production code. The framework ships no zxing (plan DEC-Q1); the only runtime use is the QR demo's lazily loaded `?qrperf=zxing` probe (DEC-Q6, `GpsPlusSlamJs_QrTrackingDemo/src/qrperf/zxing-probe.ts`).

## Examples

```ts
const results = await readQrCodes(frame.image);
const first = results[0]; // { text, position: { topLeft, ... }, isValid, ... }
```

## Tests

`zxing-node.test.ts` (no-network load, malformed buffer); exercised end to end by `../ar/qr/qr-zxing-oracle.test.ts` and the opt-in `../ar/qr/qr-zxing.sweep.test.ts`.

## Related

- Plan: `GpsPlusSlamJs_Docs/docs/2026-09-23-0034-qr-capture-decode-perf-and-zxing-oracle-plan.md` (M1).
- [synthetic-qr-frame.ts.md](synthetic-qr-frame.ts.md), [qr-zxing-pipeline.ts.md](qr-zxing-pipeline.ts.md).
