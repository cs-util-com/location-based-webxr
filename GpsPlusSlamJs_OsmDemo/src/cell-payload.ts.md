# `src/cell-payload.ts`

## Purpose

Packs the scored-cell array into typed arrays so the worker can **transfer** it
to the page instead of having it structured-cloned, and unpacks it on the other
side.

## Why it exists

Measured in `refresh-payload.test.ts`: structured-cloning the plain-object cell
array costs **3.2 ms at 931 cells and 35.1 ms at the 24 206** the 488-chunk
cache holds — and a move runs three progressive rings, so ~105 ms against a
16 ms frame budget. The cost grows with session length, because retained chunks
accumulate as the user explores.

A worker does not share memory with the page. `postMessage` deep-copies the
object graph into the page's heap; immutability does not change that, because no
JavaScript object reference can cross a thread. The two escapes are transferable
buffers and `SharedArrayBuffer` (which needs cross-origin isolation). The demo
already transfers mesh geometry; this brings the cell array to the same footing.

**Nothing is dropped to achieve it.** An earlier plan proposed sending less — no
`contributors`, one category only — which would have made the cell popup
asynchronous and moved provenance out of a click that answers "why is this
hexagon warm?". Packing keeps every field, so that trade is never needed.

## The design rule measurement forced

At 24 206 cells: **structuredClone 27.1 ms, pack 17.3 ms, unpack 10.8 ms.**

Packing alone beats the clone. Packing **plus** unpacking does not — 28.1 ms
against 27.1 — so a packed payload that the page immediately expands back into
plain objects is **slower than the copy it replaces**. The first version of this
module did exactly that, and only the measurement caught it.

**So `unpackCells` must never be on the render path.** It exists for tests and
for a resync. The win requires consumers to read the columns directly, at which
point the main thread pays ~nothing and the worker pays 17.3 ms instead of its
share of 27.1. `refresh-payload.test.ts` asserts both halves so this cannot be
reintroduced quietly.

## Public API

- `packCells(cells) -> PackedCells` — builds the wire form. Freshly allocated
  every call.
- `unpackCells(packed, idWidth = 15) -> CellScore[]` — the exact inverse.
- `cellPayloadBuffers(packed) -> ArrayBuffer[]` — every buffer, for
  `postMessage`'s transfer list.

`PackedCells` is: `ids` (`BigUint64Array`), `categories` + `scores`
(`Float32Array`, `cells × categories` row-major), and a compressed-row
contributor block — `contributorOffsets` (`cells + 1`), `contributorCategories`,
`contributorKeys` (indices into `featureKeys`) and `contributorFactors`.

## Invariants & assumptions

- **The arrays MUST be freshly allocated, and this is load-bearing.**
  Transferring **detaches** the buffer on the sender's side. Nothing here
  aliases the retained store, so handing the payload over cannot leave the
  worker holding a zero-length array — the exact failure `transferablesOf` in
  `demo-worker.ts` documents for the terrain field, which must never be
  transferred for that reason.
- **H3 ids are padded back to width on unpack.** An H3 index is a 64-bit integer
  written as hex, and `BigInt.prototype.toString(16)` drops leading zeros. An id
  that returns one character short is a _different cell_: the map would colour a
  hexagon that does not exist, and nothing would throw. `idWidth` defaults to 15
  (res 13) and is a parameter rather than a constant because the width is a
  property of the resolution.
- **A zero in the score matrix means ABSENT, not "scored zero".** The matrix is
  dense, so a cell with no entry for a category simply never writes to that
  column. This is safe because the rule table's factors are multiplicative and
  the identity is 1 — a genuine score of exactly 0 cannot occur. **If scoring
  ever becomes additive, this encoding breaks silently** and needs a presence
  mask.
- **`categories` and `featureKeys` stay plain string arrays.** They are
  per-payload dictionaries of a few dozen short strings; encoding them into
  buffers would add a decoder for no measurable gain.
- **`cellPayloadBuffers` is derived, not enumerated.** A buffer left out of the
  transfer list is silently _copied_ rather than moved — invisible except as the
  cost this module removes. A hand-written list would go stale the first time a
  field is added.

## Examples

```ts
const packed = packCells(snapshot.cells);
postMessage({ cells: packed }, cellPayloadBuffers(packed));
// ...on the page:
const cells = unpackCells(message.cells);
```

## Tests

`cell-payload.test.ts`. The round trip is the whole correctness burden, so it is
tested both by hand-written fixtures and by a fast-check property — a packer
that loses a category, truncates an id or misaligns the offsets produces a map
that is subtly wrong rather than obviously broken.

Specifically pinned: an H3 id whose hex form has a leading zero; an empty cell
list (no phantom row); a cell with **no** contributors between two that have
them, which is where a mis-built offset array credits one cell with its
neighbour's features; and that every typed-array field appears in the transfer
list.

`refresh-payload.test.ts` holds the measurements this module exists to move.
