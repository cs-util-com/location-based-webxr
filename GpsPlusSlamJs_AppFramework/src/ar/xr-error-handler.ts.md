# xr-error-handler.ts

## Purpose

Turns whatever `navigator.xr.requestSession()` rejects with into one
user-facing sentence. Kept separate from the AR modules so the mapping is
testable without a WebXR stack, and so every consumer app shows the same wording
for the same failure.

## Public API

### `getXrErrorMessage(error: unknown): string`

Never throws, never returns empty — always yields a displayable string.
Resolution order:

1. **`DOMException`** → look up `error.name` in `XR_ERROR_MESSAGES`; unknown
   names fall through to `XR_ERROR_MESSAGE_UNKNOWN`. This is the normal path,
   since the WebXR spec rejects with `DOMException`.
2. **Plain `Error`** → lowercase substring sniffing on `error.message`:
   `"not supported"` → the NotSupportedError text, `"permission"` or `"denied"`
   → the SecurityError text. A best-effort net for browsers that reject with a
   generic `Error`.
3. **Anything else** (string, `null`, object) → `XR_ERROR_MESSAGE_UNKNOWN`.

### `XR_ERROR_MESSAGES: Record<string, string>`

`DOMException.name` → message, for `NotSupportedError`, `SecurityError`,
`InvalidStateError` and `NotAllowedError`. Every message names a **user
action** ("install ARCore", "allow camera access", "close other AR apps"), not
the internal cause — that is the point of the module.

### `XR_ERROR_MESSAGE_UNKNOWN: string`

The catch-all.

## Invariants & assumptions

- **Total function.** Any input produces a message; callers never need a
  fallback of their own.
- **The substring sniffing is deliberately narrow.** It runs only for non-`DOMException`
  errors and only on two phrases. Broadening it risks mapping an unrelated
  failure onto a confident, wrong instruction — telling a user to grant camera
  permission when the real fault was something else is worse than the generic
  message.
- **`XR_ERROR_MESSAGES` is an exported mutable `Record`.** It is treated as
  read-only by every consumer; nothing enforces that. If a caller ever needs
  per-app wording, add a parameter rather than mutating the shared table.
- The `DOMException` and `Error` branches assume those globals exist — true in
  every browser and in jsdom.

## Example

```ts
import { getXrErrorMessage } from 'gps-plus-slam-app-framework/ar/xr-error-handler';

try {
  await navigator.xr.requestSession('immersive-ar', opts);
} catch (err) {
  showError(getXrErrorMessage(err)); // always a sentence worth showing
}
```

## Tests

`xr-error-handler.test.ts` — 9 tests: each known `DOMException` name maps to its
message, an unknown name falls back, both `Error`-message heuristics fire, and
non-error inputs still yield the fallback.
