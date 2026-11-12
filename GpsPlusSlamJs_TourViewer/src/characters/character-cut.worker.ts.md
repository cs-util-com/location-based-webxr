# character-cut.worker.ts

**Purpose:** the module Worker that runs the character-sheet cut, so cutting a large picture never freezes the page.

## Public API

None exported. It wires `createCutService` (`cut-service.ts`) to `decodePicture` (`decode-picture.ts`) and the Worker's `postMessage`, and handles every `message` event. The page side is `cut-client.ts`; the page constructs the Worker.

## Invariants

- Requests run one after another: the client sends the next only when the last has answered, so no two cuts hold a picture's memory at once.
- `self` is cast because the app's TypeScript config has the DOM lib, not the webworker lib.

## Tests

Not unit-tested (it needs a real Worker); the service it runs is (`cut-service.test.ts`), and the maker page's browser tests run it for real.
