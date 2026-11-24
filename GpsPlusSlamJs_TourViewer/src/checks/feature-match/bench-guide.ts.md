# bench-guide.ts

## Purpose

The general rules the feature matching page shows before the first shot, and the note on the light scene's places. The words per shot live in `guided-texts.ts`. Data only, so the page's HTML holds no protocol text.

## Public API

- `WELCOME_LEDE`: the welcome screen's first line: a few shots per scene, a first shot then one change per shot (the light, a turn, a step), the pairs made from the shots and saved in one zip.
- `BEFORE_YOU_START`: the six general rules: a stand, screen rotation and zoom; a scene is a few shots of one place, with one change per shot, and the pairs are made from the shots; nothing personal in the picture; aim at detail; the next shot comes up by itself (Details, Shots takes any shot again or skips one); Download all saves every ready pair in one zip, measured on the PC.
- `SPOT_NOTE`: the light scene is repeated at up to three places; after L4, point the phone elsewhere and L1 of the next place comes up by itself.

## Invariants

- Plain English, plain hyphens, no markup: the page sets them as `textContent`.

## Example

```ts
for (const rule of BEFORE_YOU_START) list.append(li(rule));
```

## Tests

`bench-guide.test.ts`: the general rules keep their key phrases, plain text with plain hyphens, a stand and never an untouched phone, and the move after L4 with L1 coming up by itself.
