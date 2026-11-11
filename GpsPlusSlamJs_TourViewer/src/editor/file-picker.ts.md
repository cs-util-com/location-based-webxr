# file-picker.ts

## Purpose

The editor's file picker for one kind of file: one hidden file input,
opened on demand, settling with the chosen file or with null.

## Public API

- `acceptFor(kind)` -> the input's `accept`: every extension the tour's
  media allowlist (`gps-plus-slam-app-framework/ar/tour-media`) takes for
  the asset kind, each with its dot (`".mp4,.webm"`).
- `createFilePicker(host)` -> `{ pick(kind), pickMany() }`: appends one hidden input
  (`data-testid="add-file-input"`) to `host`; `pick` sets its `accept`,
  clears it, clicks it, and settles with the chosen file, or null on the
  input's `cancel` event or a change with no file.
  `pickMany` opens it for several files of every kind the allowlist takes
  (the asset shelf's "Add files..."), settling with the chosen files, or
  none on a cancel; a later `pick` is single again.

## Invariants & assumptions

- A second `pick` while one is open settles the first with null, so no
  add waits on a picker the browser closed without a `cancel` event.
- `accept` only steers the picker; the session's `addFile` checks the
  file again, so a file of another type picked by "All files" is refused
  in words, not taken.

## Examples

```ts
const picker = createFilePicker(document.body);
const file = await picker.pick("model"); // File | null
```

## Tests

`file-picker.test.ts` (jsdom): the allowlist per kind, a chosen file, a
cancel and an empty change, and a second pick settling the first, and a
many-files pick of every kind.
