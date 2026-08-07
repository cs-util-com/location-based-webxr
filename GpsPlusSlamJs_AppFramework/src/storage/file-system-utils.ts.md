# file-system-utils.ts

## Purpose

The naming rules for everything a recording writes to disk: session folder
timestamps, action/frame filenames, and the images subdirectory. Split out of
`file-system.ts` so these can be tested without mocking any browser API — they
are pure string functions and two constants, with no I/O.

Small, but load-bearing: writers and readers on both sides of the repo boundary
must agree on these names or a recording stops round-tripping.

## Public API

### `formatTimestamp(date: Date): string`

`"2025-02-28_14-30-11utc"` — **UTC** fields throughout (`getUTC*`), zero-padded.
Used for session folder and ZIP names. The matching parser lives in the
recorder's `storage/session-zip-naming.ts`; the two must stay in lockstep.

### `formatActionFilename(index: number): string`

`42 → "000042.json"`. Six-digit zero pad, so lexical sort equals numeric sort
for the first million actions — that is what lets readers enumerate a session's
`actions/` directory and replay it in order without parsing indices.

### `formatFrameFilename(index: number): string`

`42 → "frame-000042.jpg"`. Same padding rationale.

### `SESSION_IMAGES_DIR` / `LEGACY_SESSION_IMAGES_DIR`

`'images'` and `'frames'`. `images/` is canonical since 2026-06 — chosen so an
exported ZIP is a textbook COLMAP tree (`images/frame-NNNNNN.jpg` beside
`sparse/0/`). See the COLMAP export plan, Q5.

## Invariants & assumptions

- **The OPFS write path and the recorder's persisted `imageFile` value must use
  the SAME constant**, or a recording is internally inconsistent — the manifest
  points at a directory the frames are not in.
- **Readers must fall back to `LEGACY_SESSION_IMAGES_DIR`.** Recordings made
  before the rename store frames under `frames/` in both the directory and the
  persisted `imageFile`, and must still replay.
- Padding widths are part of the on-disk format. Widening one silently breaks
  lexical ordering for existing sessions; treat a change as a format migration.
- `formatTimestamp` is UTC-only by design — local time would make session names
  non-monotonic across a DST boundary.

## Example

```ts
import {
  formatTimestamp,
  formatActionFilename,
  SESSION_IMAGES_DIR,
} from 'gps-plus-slam-app-framework/storage/file-system-utils';

const folder = `session-${formatTimestamp(new Date())}`; // session-2026-07-30_18-04-02utc
const path = `${folder}/actions/${formatActionFilename(7)}`; // .../actions/000007.json
const img = `${folder}/${SESSION_IMAGES_DIR}/frame-000007.jpg`;
```

## Tests

No dedicated test file. The behaviour is covered through its consumers:
`opfs-storage.ts` and `null-storage-backend.ts` in this package, and the
recorder's `scenario-storage.ts` and `zip-frame-blob-source.ts` — plus the
recorder's `action-schema` and zip round-trip suites, which assert the produced
names. The legacy-`frames/` fallback is exercised by the replay path over old
fixtures.

**Gap worth closing:** these are pure, trivially testable functions with an
on-disk-format contract and no direct tests of their own — the padding-width and
UTC invariants above are currently only implied by consumer assertions.
