# object-describe.ts

## Purpose

**The one rule** for how a tour object or block is named wherever one is
listed or labelled - the creator's object list (`object-list.ts`), the
summary map (`summary-model.ts`), the desktop editor's rail and map (M6
E1), and the 3D editor's tree, inspector and picture picker
(`editor/editor-shell/tree-model.ts`, `inspector-model.ts`). No page
names a block on its own: the tree's `blockTitle` once disagreed with
this module (a picture's title against its caption, an untitled model
called "Photo") and was folded in here. The two existing
copies had drifted (a photo with a blank caption read "Photo" on the map
and a blank title in the list); the M6 E1 plan review (#3) asked for one
rule before a third page used it (root `CLAUDE.md` DEC-H3). Pure.

## Public API

- A kind's words and look are the editor's list of kinds
  (`kinds/edit-kinds.ts` `KIND_EDIT`): its `label`, the ONE word every
  creator page uses for it ("Pin", "Long text", "Photo", "Video", "Audio",
  "3D model", "Character"), `kindNoun`, and its `look`. They lived here
  until the list took them.
  - **Why "Pin" and "Photo", not the format's "short text" and
    "picture":** the phone places a pin and takes a photo ("Place a pin",
    "Take a photo"), its list, toasts and AR hints say "pins and photos",
    the rail groups them as "Pins" and "Photos", and the landing and
    visitor pages speak of photos. The 3D editor alone said "Short text"
    and "Picture", and the 2D card "Pin note" and "Photo note": three
    names for two things. "Note" remains the one word for "a pin or a
    photo" together ("3 notes", "Find a code or note"), and a search still
    finds a pin or a photo by "note" and by the old words
    (`editor/editor-model.ts` `filterItems`).
- `objectOwnText(object): string | undefined` - the text a free block
  carries for its name (a caption, a character's name, else a title); unlike
  `objectTitle` it can be empty. One case per kind, checked exhaustive by
  the compiler; a kind it does not know (a newer file) gives undefined.
- `objectTitle(object): string` - for any object or block (in the world
  or in a station's story): its title (a character's name), else its
  caption (a pin's own text), else its kind's name
  (`KIND_EDIT` label) - each trimmed, so a text of blanks names
  nothing.
- `codeDistanceLine(object, codes): string` - `"4 m from the code"` with
  one code, `"12 m from the nearest code"` with several, `""` without a
  code or without a finite distance. Whole metres: the objects' own GPS
  error is metres.

## Invariants & assumptions

- A title is text for `textContent`, never markup: a label comes from a
  zip anyone can write.
- The distance is horizontal (`move-with-code.ts` `horizontalM`), which
  is the licensed library's geo maths: it runs once a store exists.

## Examples

```ts
objectTitle({ kind: "picture", caption: "  " /* ... */ }); // "Photo"
objectTitle({ kind: "picture", title: " Gate ", caption: "1870" }); // "Gate"
codeDistanceLine(pin, [codeGeo]); // "4 m from the code"
```

## Tests

`object-describe.test.ts` (a pin's text; a picture's title, else its
caption, else "Photo", trimmed; the kinds' words "Pin" and "Photo", and
inside a sentence (`kindNoun`); every block kind by its own text, else
its kind's name; the looks of the four kinds in the world,
the distance to one code or the nearest of several, none without a
code); `object-list.test.ts` pins that the list uses the same rule.
