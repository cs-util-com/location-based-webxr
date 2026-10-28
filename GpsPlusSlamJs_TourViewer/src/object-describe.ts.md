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

- `ObjectLook` - `"pin" | "photo" | "model"`: what an object in the
  world is in the pages' words and icons; `objectLook(kind)` maps the
  format's kinds onto it (a short text is a pin, a picture a photo, a
  model a model). The format's kinds stay out of the pages' words.
- `BLOCK_KIND_LABEL` - each kind in the block model's words ("Short
  text", "Long text", "Picture", "Video", "Audio", "3D model",
  "Character"): the name of a block with no text of its own, and the
  inspector's kind line.
- `objectTitle(object): string` - for any object or block (in the world
  or in a station's story): its title (a character's name), else its
  caption (a pin's own text), else its kind's name
  (`BLOCK_KIND_LABEL`) - each trimmed, so a text of blanks names
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
objectTitle({ kind: "picture", caption: "  " /* ... */ }); // "Picture"
objectTitle({ kind: "picture", title: " Gate ", caption: "1870" }); // "Gate"
codeDistanceLine(pin, [codeGeo]); // "4 m from the code"
```

## Tests

`object-describe.test.ts` (a pin's text; a picture's title, else its
caption, else "Picture", trimmed; every block kind by its own text, else
its kind's name; the looks of the three kinds,
the distance to one code or the nearest of several, none without a
code); `object-list.test.ts` pins that the list uses the same rule.
