# character-exchange.ts

**Purpose:** the character file people send each other: the four-pose PNG sheet with the record in a `tEXt` chunk, and the checks that refuse a file in words before anything is added.

## Public API

- `TEXT_KEY`: the chunk key.
- `ImportRefusal { title, words }`: what the page shows when a file is refused.
- `inspectExchange(bytes, mime)`: `{ name, steady, describedAs, note }`, or throws `ImportRefusal`, checked in this order: a JPEG (sent as a photo), not a PNG, a damaged PNG, no transparency, the wrong size or shape (four 512 x 1024 cells), a newer format. A record that does not read gives an empty name and the note "Its name could not be read."
- `checkSheetPixels(img)`: throws `ImportRefusal` when the decoded sheet lost its transparency, or when a cell holds no figure or a figure that touches the cell's sides.
- `exchangeBytes(sheetPng, record)`: the file's bytes; `libraryId` is left out, it belongs to one device.
- `exchangeFileName(name)`: a safe file name for the character.

## Invariants

- The header checks run on the bytes, before decoding; the pixel checks sample every fourth pixel.

## Tests

`character-exchange.test.ts` (each refusal and their order, the round trip with a non-ASCII name, the note for a missing name).
