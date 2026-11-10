# character-record.ts

**Purpose:** the small JSON record that describes one character on this device (`character.json`) and inside an exchange file, with its validation and its naming rules.

## Public API

- `CHARACTER_FORMAT` (1), `DEFAULT_TOOL`. A name is cut to 40 characters (module-private `NAME_MAX`).
- `CharacterRecord { format, libraryId, name, autoName, createdAtIso, steady, describedAs, tool }`.
- `recordOf(input: unknown): CharacterRecord | null`: the record when every field is well formed (`libraryId` matches `/^c[0-9a-z]+$/`, `createdAtIso` is an ISO date, the name is 1 to 40 characters after trimming), else `null`.
- `ImportedRecord` and `importedRecordOf(input)`: what an exchange file's record says: `ok` with its fields, `newer` when its `format` is above ours, or `unreadable`.
- `nameProblem(name)`: the words to show when a name cannot be used, or `null`.
- `cappedName(name)`: trimmed, inner whitespace collapsed, cut to 40 characters.
- `nextGuideName(taken)`: "Guide 1", "Guide 2", ..., the first not taken.
- `newLibraryId(now, random)`: a fresh folder name from the time and a random part.

## Invariants

- Nothing here throws on bad input; validation answers with `null` or a refusal kind.
- `libraryId` is made only here and used only as a folder name, so its pattern is what keeps a record from naming another folder.

## Tests

`character-record.test.ts` (each field's validation, a newer format, naming and the id pattern).
