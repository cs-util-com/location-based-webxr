# qrperf-params

## Purpose

Parses the `?qrperf` URL switch that turns on the QR pipeline performance instrument (plan `GpsPlusSlamJs_Docs/docs/2026-09-23-0034-qr-capture-decode-perf-and-zxing-oracle-plan.md`, M2).

## Public API

- **`parseQrPerfParams(search: string): QrPerfParams`** - `{ mode: 'off' | 'native' | 'zxing', baseline: boolean }`.
  - `qrperf=1` or `qrperf=native` -> `native`; `qrperf=zxing` -> `zxing`; anything else (missing, empty, `0`, typos) -> `off`.
  - `baseline=1` -> `true`, but only while `mode !== 'off'`.

## Invariants & assumptions

- **Default is off**, and off changes nothing in the demo (every hook is skipped in `main.ts`).
- Unknown values never guess: a typo cannot start a ~400 KB zxing download.
- `baseline` marks the same-build pre-fix A/B run (plan DEC-Q7); the pre-fix behaviour it selects arrives with M3.

## Examples

```ts
parseQrPerfParams("?qrperf=zxing"); // { mode: "zxing", baseline: false }
parseQrPerfParams("?qrperf=1&baseline=1"); // { mode: "native", baseline: true }
```

## Tests

`qrperf-params.test.ts`.
