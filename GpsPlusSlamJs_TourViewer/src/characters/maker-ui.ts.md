# maker-ui.ts

**Purpose:** two small UI pieces of the maker: a button's in-progress state while an async action runs, and an Undo offer that lapses.

## Public API

- `busy(button, label, work)`: disables the button and shows `label` and `aria-busy` while `work` runs; restores the idle label when the last overlapping run settles, on success or failure. Returns the result of `work` or rethrows its error.
- `offerUndo(box, message, undo)`: shows the message with an Undo button in `box`, replacing an earlier offer; Undo runs once. The offer lingers 6 s (module-private `UNDO_LINGER_MS`).

## Tests

`maker-ui.test.ts` (jsdom: the transitional and final states on success and failure, overlapping runs, the lapse, Undo running once).
