# cut-protocol.ts

**Purpose:** the messages between the character maker's page and the cut Worker, and one check of what arrives on each side.

## Public API

- `CutRequest { type: "cut", job, picture?, settings }`: with a picture the Worker decodes and keeps it; without, it re-cuts the kept one (a slider moved). `settings` is read with `cutSettingsOf` on the Worker side.
- `requestOf(data)`: a request, or null for anything else.
- `CutAnswer`: a phase message (`phase`, `state`, `note?`), `done` with the `SheetAnalysis`, or `failed` with phase, code, words and detail.
- `answerOf(data)`: an answer, or null for anything that does not read.
- `transferOf(result)`: the frames' buffers, each once, for the transfer list.

## Invariants

- No DOM, no `new Worker`: shared by the Worker, its service, the client and the tests.
- A `done` whose frames do not read (not four images of one size with matching buffers), or whose `specks` is no count, becomes a `failed` for its job, so the page is never left waiting.
- The idle and beckon frames are the same objects in both frame sets; `transferOf` lists their buffers once (a buffer listed twice throws in `postMessage`).

## Tests

`cut-protocol.test.ts`.
