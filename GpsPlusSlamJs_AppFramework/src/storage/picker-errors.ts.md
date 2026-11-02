# storage/picker-errors.ts

## Purpose

One reading of a rejected File System Access picker call
(`showSaveFilePicker`, `showDirectoryPicker`): did the user dismiss the
dialog, or is the dialog unavailable here? Before this module the rule was
written four times (the framework's `downloadBlob`, the Tour Viewer's save
dialog, the Recorder's folder and save dialogs), with `downloadBlob`
reading the name alone and the other three requiring a `DOMException`. The
shared rule is `downloadBlob`'s, because that one is published: an error
named `AbortError` is a dismissal, by its name. For the apps' former
copies this widens "cancelled" by one case no browser produces (a
non-`DOMException` carrying the name).

Deep import: `gps-plus-slam-app-framework/storage/picker-errors` (not in the
`storage` barrel).

## Public API

- `classifyPickerRejection(err: unknown): PickerRejection`
  - `'cancelled'` - an object whose `name` is `AbortError` (a
    `DOMException` in every browser; a plain `Error` so named counts too):
    the user dismissed the dialog. Nothing is written, and no other way of
    saving is offered in its place.
  - `'unavailable'` - anything else: another `DOMException`
    (`SecurityError` with no click to open it on or in an iframe,
    `NotAllowedError` with a dialog already open), a `TypeError`, a
    string, nullish or another non-object. The caller may save another way
    (a download).
- `type PickerRejection = 'cancelled' | 'unavailable'`.

## Invariants & assumptions

- A picker that is missing, or that throws at once instead of returning a
  promise, is `unavailable` too; callers pass a synchronous throw through
  the same function.
- Not for the Web Share sheet: `navigator.share` rejects with `AbortError`
  both when the user cancels and when the share fails
  (`share-or-download.ts`), so its rule is different on purpose.
- Not the OPEN dialog's rule: `save-target.ts`'s `pickWritableFile` reads a
  `NotAllowedError` (a second picker refused while one is open) as a
  cancel, because offering the file input then would be a second dialog;
  the save dialog reads it as unavailable, so its caller downloads. The
  difference is deliberate and pinned in `save-target.test.ts`.
- Pure, no imports; never throws (nullish is read without a property
  access).

## Examples

```ts
import { classifyPickerRejection } from 'gps-plus-slam-app-framework/storage/picker-errors';

try {
  handle = await window.showSaveFilePicker(options);
} catch (err) {
  if (classifyPickerRejection(err) === 'cancelled') return; // nothing to do
  download(blob); // the dialog is unavailable: save another way
}
```

## Tests

`picker-errors.test.ts`: the dismissal by name (a `DOMException`, a plain
`Error` and an object so named); refusals, a string, a number and nullish
values as unavailable; a property over any name, for a `DOMException` and
a plain `Error`. Its callers' tests: `download-blob.test.ts`,
`save-target.test.ts`, and the Recorder's `external-file-storage.test.ts`.
