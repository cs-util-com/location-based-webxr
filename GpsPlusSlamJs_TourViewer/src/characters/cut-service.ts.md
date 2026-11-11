# cut-service.ts

**Purpose:** the cut Worker's logic without the Worker, so it is tested in Node with a fake decoder.

## Public API

- `PictureDecoder(picture, settings) => Promise<RgbaImage>`: throws a `CutError` (phase read) for a refused file.
- `AnswerPoster(answer, transfer)`.
- `createCutService(decode, post)`: returns the message handler.

## Invariants

- Every request is answered exactly once with `done` or `failed`; phase messages come before it, in order.
- A new picture is decoded and kept; a request without a picture re-cuts the kept one, without decoding again. Before any picture, or after a picture failed to decode, a re-cut answers "Choose a picture first." (never the previous picture, silently).
- A `CutError` keeps its phase and code; any other error becomes `failed` in the phase that was running.
- The frames are transferred, not copied.
- A message that is no request is ignored.

## Tests

`cut-service.test.ts` (with synthetic sheets from `test-support/synthetic-sheet.ts`).
