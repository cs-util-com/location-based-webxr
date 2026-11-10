# character-import.ts

## Purpose

"Import character...": one flow for the character maker's library and the
tour editor's Characters list. It reads a character file (the exchange PNG
with the character's name inside, or a bare four-pose sheet), refuses it in
words where it cannot be a character, and asks for a name where none came
with it. Both places therefore refuse the same files with the same words.

## Public API

- `readCharacterFile(file: Blob): Promise<ReadCharacter>` - checks the bytes
  (`inspectExchange`), decodes them as a PNG (`decodePicture`), checks the
  pixels (`checkSheetPixels`) and cuts the first pose out as its own picture.
  Throws an `ImportRefusal` (title and words) for a file that is no
  character; a picture that does not decode is "This picture could not be
  opened".
- `createImportFlow(deps): (file: Blob) => Promise<AcceptedCharacter | null>`
  - `deps.errBox` - where a refusal card is drawn (title, words, "Nothing was
    added.", "Choose another file", "Close"); the refusal is also toasted as
    "Not imported: <title>".
  - `deps.askBox` - where the name is asked for when the file carries none
    ("Import it" / "Cancel"; an empty name shows "Give it a name first").
    Cancel toasts "Not imported".
  - `deps.chooseAgain` - the refusal card's "Choose another file".
  - `deps.toast(message, error?)` - the place's own toast.
  - `deps.read` - the reader, `readCharacterFile` unless a test stands in.
  - Resolves to the accepted character (with the name given), or `null` when
    refused or cancelled. A second file while a name is being asked for
    cancels that question (it resolves `null`).
- Types `AcceptedCharacter` (`name`, `steady`, `describedAs`, `framesBlob`,
  `imageBlob`) and `ReadCharacter` (plus `note`, what did not come with the
  file).

## Invariants and assumptions

- Nothing is saved here: the caller saves the accepted character (to the
  library, and in the editor also into the tour).
- Every name and word drawn into a card is escaped.
- An unexpected error (not an `ImportRefusal`) is still refused in words:
  "This file did not work".

## Examples

```ts
const importFlow = createImportFlow({ errBox, askBox, chooseAgain, toast });
const accepted = await importFlow(file);
if (accepted)
  await library.save({
    ...accepted,
    frames: accepted.framesBlob,
    image: accepted.imageBlob,
  });
```

## Tests

- `character-import.test.ts` (jsdom, a stand-in reader) - a refusal draws its
  card and toast; an unexpected error is refused in words; a named file
  resolves at once; an unnamed one asks, an empty name is refused, a name
  given resolves; Cancel resolves `null`; a second file cancels the open
  question.
- The real reader is covered through the maker's browser tests and the
  exchange checks in `character-exchange.test.ts`.
