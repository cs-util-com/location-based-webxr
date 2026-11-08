# optimizer-settings.ts

**Purpose:** the "smaller files" values in one place, so they can be retuned after a listening and viewing check.

## Public API

- `OPTIMIZER_SETTINGS: OptimizerSettings`:
  - `picture`: longest side 1600 px, `image/webp`, quality 0.75 (never enlarged);
  - `speech`: Opus 24 kbps mono; `music`: Opus 64 kbps stereo (music and ambience);
  - `modelTextureMaxSidePx`: 1024;
  - `keepAbove`: 0.9 - a result larger than this share of the original keeps the original ("at least 10 % smaller").
- `OPTIMIZER_SLOTS`: jobs at once, `{ phone: 1, desktop: 2 }`, provisional until measured on a phone.
- Type `OptimizerSettings` (its picture and sound parts are module-private shapes).

## Invariants

- Nothing else hard-codes a size, quality or bitrate: optimizers read their part from the `settings` of their context (`asset-optimizers.ts`), and the Worker receives them with each run (`optimizer-protocol.ts`).

## Tests

Values only; read by `asset-shelf.test.ts` (the 10 % rule).
