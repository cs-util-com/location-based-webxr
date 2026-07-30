# zip-round-trip-helpers

## Purpose

Shared test helper that produces realistic recording zip files programmatically using the real OPFS mock + export pipeline. Eliminates the dependency on static pre-recorded zip files that go stale as the app format evolves.

## Public API

### `produceTestZip(opts?: Partial<ProduceTestZipOptions>): Promise<TestZipResult>`

Produces a recording zip by:

1. Installing OPFS mocks (scoped to the function call)
2. Writing actions via `writeAction()` — startSession, add2dImage, setZeroPos, recordGpsEvent
3. Writing frame files via `writeFrame()`
4. Writing `session.json` via `writeSessionMetadata()`
5. Exporting via `exportSessionAsZip()`
6. Cleaning up mocks and returning the zip as `Uint8Array`

**Options** (all have defaults):

- `scenarioName` — `'TestScenario'`
- `sessionTimestamp` — `2026-03-01T09:00:00Z`
- `gpsEventCount` — `10`
- `imagesBeforeSetZero` — `2` (dropped during replay)
- `imagesAfterSetZero` — `5` (kept during replay)
- `frameCount` — `2`
- `deviceInfo` — `'TestDevice Android 14'`
- `zeroPos` — `{ lat: 50.0, lon: 8.0 }`

**Returns** `TestZipResult` with:

- `zipData` — the zip as `Uint8Array`
- All metadata needed for assertions: counts, names, timestamps, actions array

### `TestZipResult` / `ProduceTestZipOptions`

TypeScript interfaces — see source for full field documentation.

## Invariants & Assumptions

- OPFS mocks are installed and cleaned up within the function — no side effects leak.
- The action sequence is deterministic: startSession → add2dImage (before) → setZeroPos → recordGpsEvent → add2dImage (after).
- GPS data uses varied odom/GPS positions to produce a non-identity alignment matrix.
- The produced zip always includes `session.json` (post-F2-fix format).

## Design Boundary — Valid Zips Only

This helper intentionally produces only **valid, realistic zips** via the real production pipeline. It should **not** be extended with options to generate broken/incomplete zips (e.g., missing `session.json`, malformed JSON, missing actions). Two reasons:

1. **Purpose clarity:** `produceTestZip()` proves the producer↔consumer contract — that what the app writes, the app can read back. Adding "intentionally broken" options dilutes that guarantee.
2. **Better tool exists:** For error-handling and robustness tests, use hand-crafted zips via `ZipWriter` directly — this gives precise byte-level control over exactly what's broken. See the `createZipWithActions()` helper in `zip-reader.test.ts` for the established pattern:

```typescript
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';

async function createBrokenZip(): Promise<Uint8Array> {
  const zipWriter = new ZipWriter(new Uint8ArrayWriter());
  await zipWriter.add('session.json', new TextReader('{malformed'));
  return new Uint8Array(await zipWriter.close());
}
```

**Rule of thumb:** Two concerns → two tools.

- **Contract tests** (does produce↔consume round-trip work?) → `produceTestZip()`
- **Robustness tests** (does the consumer handle garbage gracefully?) → hand-crafted `ZipWriter`

## Examples

```typescript
import { produceTestZip } from '../test-utils/zip-round-trip-helpers';

// In a test's beforeAll:
const testZip = await produceTestZip();
const actions = await loadActionsFromZip(testZip.zipData);
expect(actions).toHaveLength(testZip.totalActionCount);

// With custom options:
const customZip = await produceTestZip({
  gpsEventCount: 20,
  scenarioName: 'MyScenario',
});
```

## Tests

- Indirectly tested by all consumers: `zip-reader.test.ts`, `recording-replay.integration.test.ts`, `recording-replayer.test.ts`
- If the helper itself is broken, those tests will fail with clear errors in `beforeAll`
