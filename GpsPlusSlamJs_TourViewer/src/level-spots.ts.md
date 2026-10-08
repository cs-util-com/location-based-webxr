# level-spots.ts

**Purpose.** A code's automatic-move memory, kept on its level file (code
book plan, M6 v5.1). It records two things:

- the spot an automatic move left (`previous`);
- the spots that hold a second print (`copies`).

Both are stored as the optional `qr.spots`, next to the level's own pose.

## Public API

- `interface StoredSpot { geo: QrGeoPose; mintQuality?: QrMintQuality }`.
- `readCodeSpots(json)` returns a `CodeSpotMemory<StoredSpot>` (see
  `code-spots.ts`):
  - the level's own pose and quality are the current spot;
  - `qr.spots.previous` and `qr.spots.copies` are the rest;
  - it returns null when the level has no saved pose or does not parse.
- `writeCodeSpots(json, memory)` writes the memory into a level:
  - the current spot becomes the level's `qr.geo` and `qr.mintQuality`
    (a quality the spot lacks is removed);
  - `previous` and `copies` become `qr.spots`, which is removed when empty;
  - the printed size, the content and every other field stay as they were;
  - it throws `SyntaxError` when `json` is not a level object.
- `carryCodeSpots(fromJson, toJson)` puts the memory of the replaced level
  onto a freshly minted one. It returns `toJson` itself when there is
  nothing to carry.

## Invariants and defensive measures

- **Lenient by design** (M6 v2 review #9).
  - Visitors' parser (`parseQrLevel`) drops `qr.spots`, so a damaged entry
    must never reject a level.
  - A spot is validated by the level's own rules: a one-spot level is
    parsed with `parseQrLevel`.
  - A broken quality drops only the quality, because the pose is what
    recognises a print.
  - A broken pose drops the entry.
  - A `spots` field of the wrong shape reads as empty.
- **One seam.** `remintedLevel` (`visit-settle.ts`) is the only re-mint of
  a stored code, and it calls `carryCodeSpots`. `creator-measuring.ts`
  mints only new codes or codes measured in the visit.
- **No re-serialization.** The framework's `serializeQrLevel` goes through
  the parser and would drop the field. It is used only by the framework
  mint, which builds a fresh level, and the carry runs after it.
- **Older builds and other devices.** A build without this module re-mints
  without the field, and the memory is lost. Nothing else breaks.
- **Public.** The level file is published, so a former location and its
  mint date become public.

## Example

```ts
const memory = readCodeSpots(level.json); // { current, previous, copies }
const next = applyCodeSpotDecision(memory!, { kind: "undo" }, unused);
const json = writeCodeSpots(level.json, next);
```

## Tests

- `level-spots.test.ts`:
  - an older level reads as its current spot alone;
  - the remembered spots are read back;
  - damaged entries are dropped one by one;
  - a `spots` field of the wrong shape reads as empty;
  - a write round-trips, and visitors' parser still reads the level;
  - nothing is written when there is nothing to remember;
  - the carry, and a no-op carry.
- `visit-settle.test.ts`: "carries the code's remembered spots onto the
  re-minted level".
