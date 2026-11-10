# declared-characters.ts

## Purpose

The pure rules for a tour's declared characters (the `characters` field of
the tour manifest): when a declaration is refused and in which words, how
many changes a set of declarations is against the written tour, and how
the field is written and read back from a draft. The tour document
(`tour-document.ts`) and the editor session use them; nothing here holds
state.

## Public API

- `MAX_TOUR_CHARACTERS` (32): the format's cap per tour.
- `characterDeclareRefusal(declared, character, heldImages)`: `null`, or
  the sentence that says why the character cannot be declared. Checked in
  this order, first hit wins:
  - an id the format cannot carry ("This character has no id a tour can
    carry.");
  - an id already declared ("NAME is in this tour already.");
  - the cap ("A tour holds at most 32 characters.");
  - the name, by the format's own text rule for a character name (1-80
    characters);
  - the picture not among `heldImages` ("The character's picture is not in
    this tour.");
  - the four poses the same file as the picture ("... must be a picture of
    their own.");
  - the four poses not held.
- `characterChanges(written, now)`: one per added, removed or changed
  declaration (compared by id).
- `withCharacters(manifest, characters)`: the manifest carrying exactly
  these characters; the field is left out when there are none, and the
  same object comes back when nothing changed (so a selector keeps its
  identity).
- `characterImageIds(characters)`: the asset ids the declarations name
  (picture and poses), for the files an undo step keeps.
- `parseRecordedCharacters(value)`: a lenient read of a draft's record:
  each entry that does not read as a character is left out, the rest
  kept, deduplicated by id; `undefined` when the value is not a list.

## Invariants & assumptions

- The refusal sentences are shown to the author as they are; each names
  what to do or what is missing.
- The id is the character library's id (`c` plus base-36), so "already in
  this tour" is a plain id comparison and the same character cannot be
  declared twice.
- Holding the files is the caller's business: `heldImages` is the set of
  image assets the tour (or the document) holds.

## Examples

```ts
const why = characterDeclareRefusal(
  state.characters,
  rita,
  heldImageIds(state),
);
if (why === null)
  dispatch(characterDeclared({ character: rita, what: "adding Rita" }));
```

## Tests

`declared-characters.test.ts` covers each refusal, the cap, the change
count, the write and the lenient parse through the tour document;
`tour-document-parity.test.ts` has the desktop-only row that declares a
character through the editor session, reloads and restores the draft and
saves.
