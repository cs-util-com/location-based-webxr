# file-uses.ts

**Purpose:** how one block uses one file, read from the format's
references (`tourBlockRefs`, `TourAssetRef` in the framework's
`tour-kinds.ts`), never from a list of kinds; and the block with a file
taken out or switched. The shelf's delete of a file in use and its
"Replace everywhere" (`tour-document.ts`: `fileUsesOf`,
`fileUsesDeleted`, `fileReplaced`) act on each block by what this says.

## Public API

- `FileUse`:
  - `{ kind: "own" }` - made of the file: a reference that is required
    and not optional (a picture's image, a sound's audio, a character's
    figure). Wins over every other reference to the same file.
  - `{ kind: "inline" }` - shown inside its words: a reference that is
    not required (a long text's body pictures, `asset:<id>` targets).
  - `{ kind: "mention", fields }` - named only in optional fields the
    block stands without (a narration, a poster, a voice); `fields` are
    the block's field names, each once.
- `fileUseOf(block, assetId)` -> `FileUse | null`: null when the block
  names the file nowhere.
- `withoutFields(block, fields)` -> a copy of `block` without those
  fields, everything else kept.
- `withFileSwitched(block, from, to)` -> a copy of `block` whose every
  reference to `from` names `to`: a field holding the id, a record
  holding it (a narration's `audio`), the `asset:` targets of a text.
  Null when the block names `from` nowhere.

## Invariants & assumptions

- The kind of use follows the format's reference flags alone; a new
  kind or field is classed correctly once its row in `TOUR_KINDS`
  declares its references.
- `withFileSwitched` never touches a block's `id`: a captured photo's id
  equals its picture's file id, and stays the photo's.
- An `asset:` target is the format's id alphabet (letters, digits, `_`,
  `-`); only a target naming exactly `from` is switched.
- Pure: the input is never changed.

## Examples

```ts
fileUseOf(narratedText, "snd1"); // { kind: "mention", fields: ["narration"] }
withoutFields(narratedText, ["narration"]); // the text, unnarrated
withFileSwitched(longText, "pic1", "pic2"); // body "![x](asset:pic2)"
```

## Tests

`file-uses.test.ts`: each kind of use (own, inline, mention with its
fields), a block not naming the file, every reference of every kind the
format knows classed, `withoutFields` keeping the rest,
`withFileSwitched` on an own file, a mention (a narration, a poster, a
voice), a text's targets (never an id that only starts like the
file's), a captured photo's id left alone, and null for a block not
naming the file.
`tour-document-file-uses.test.ts` runs them through the reducer.
