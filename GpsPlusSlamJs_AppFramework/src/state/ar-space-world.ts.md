# ar-space-world.ts

## Purpose

The composed AR-space selectors: the AR-space correction followed by the GPS alignment (`A * Delta(e)`), and the world pose of a raw local matrix. Kept apart from `ar-space-correction-slice.ts` and the registry so that their import closure never reaches the GPS alignment.

## Public API

- `selectArSpaceToWorld(state, epoch)`: `A * Delta(epoch)`, column-major; `null` before an alignment exists; `RangeError` for an epoch that is not an integer in `0..n`. Memoised on the correction track and the alignment, so the result is reference-stable per epoch while neither changes.
- `arSpaceWorldPose(state, xRaw, epoch, parentToGroup = I)`: `A * Delta(epoch) * P * X_raw`; `null` and `RangeError` as above.

## Invariants & assumptions

- **Not for world or map consumers yet.** Until the GPS alignment is fitted on the corrected odometry, `A` is fitted across the frames before and after a jump, so pairing it with a corrected `Delta` misplaces content by about the jump size. Both JSDoc blocks and the CHANGELOG say so. Read these for inspection and tests only until then.
- **Order:** the correction inside O first, then `P` and the raw local matrix on the right, the alignment last on the left. Any other order is wrong for non-commuting transforms (tests show two wrong orders fail).
- **Layering:** this is the only module that combines the two layers; `ar-space-correction.structure.test.ts` pins that the slice's and the registry's import closures stay free of it and of `app-selectors.ts`.

## Examples

```ts
const toWorld = selectArSpaceToWorld(store.getState(), epoch); // A * Delta(e)
const world = arSpaceWorldPose(store.getState(), xRaw, epoch, parentToGroup);
```

## Tests

- `ar-space-world.test.ts`: the composed selector equals `A * Delta`, reference-stable, the identity at the current epoch; `null` before an alignment and `RangeError` outside `0..n`; `arSpaceWorldPose` against three.js with two wrong orders failing, and `P` defaulting to the identity.
- `ar-space-world.property.test.ts`: `A * Delta(e) * P * X_raw` over random non-commuting `A`, jumps, `P` and epochs (three.js as the oracle).
- `ar-space-correction.structure.test.ts`: the import closures.
