# object-describe.ts

## Purpose

How a tour object is named wherever one is listed or labelled - the
creator's object list (`object-list.ts`), the summary map
(`summary-model.ts`) and the desktop editor (M6 E1). The two existing
copies had drifted (a photo with a blank caption read "Photo" on the map
and a blank title in the list); the M6 E1 plan review (#3) asked for one
rule before a third page used it (root `CLAUDE.md` DEC-H3). Pure.

## Public API

- `ObjectLook` - `"pin" | "photo" | "model"`: what an object in the
  world is in the pages' words and icons; `objectLook(kind)` maps the
  format's kinds onto it (a short text is a pin, a picture a photo, a
  model a model). The format's kinds stay out of the pages' words.
- `objectTitle(object): string` - for an object in the world or a
  station's free block: a pin's text (its caption); a photo's caption, or
  a model's title, else `"Photo"` when it has none or only blanks (the
  word an untitled model has always been listed under).
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
codeDistanceLine(pin, [codeGeo]); // "4 m from the code"
```

## Tests

`object-describe.test.ts` (a pin's text, a photo's caption or "Photo", the
looks of the three kinds,
the distance to one code or the nearest of several, none without a
code); `object-list.test.ts` pins that the list uses the same rule.
