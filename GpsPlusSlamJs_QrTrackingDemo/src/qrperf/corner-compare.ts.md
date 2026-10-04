# corner-compare

## Purpose

Compares the native `BarcodeDetector` corners with zxing's on the same frame, to answer "Cause A" on a phone: are native corners in SYMBOL order (like zxing's) or sorted by IMAGE position? See `GpsPlusSlamJs_Docs/docs/2026-06-20-0030-qr-axis-jump-step0-findings-and-next.md`.

## Public API

- **`cornerPermutation(native, zxing): string`** - for each native corner, the index of the nearest zxing corner, joined (`"0123"` = same order).
- **`maxCornerDistance(native, zxing): number`** - largest native-to-nearest-zxing distance, px (order-independent position agreement).
- **`rollBin(rotationDeg): 0 | 90 | 180 | 270`** - the code's in-image rotation rounded to a quarter turn.
- **`createCornerOrderTally()`** - `add(bin, permutation)`, `summary()` -> `{ [bin]: { identity, other, permutations[] } }`, `reset()`.

## Invariants & assumptions

- zxing reports symbol-relative corners (proven by the framework's `qr-zxing-oracle.test.ts`), so identity in every roll bin means native is symbol-relative too; a permutation that rotates with the bin means native sorts by image position.
- The permutation is meaningful only while the phone ROLLS through the bins - an upright-only run cannot tell the two cases apart (cold review finding 2); the field-test protocol asks for the roll.
- zxing's `rotation` sign convention is not relied on; bins are labels.

## Tests

`corner-compare.test.ts`.
