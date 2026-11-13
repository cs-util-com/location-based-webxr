# ground.ts

## Purpose

The world part of a short text's `ground` view: marks on the ground along a
route from the text's spot toward its `pointsTo`, ending 2 m short of it, in
one of five styles, with a caption plate beside the start.

## Public API

- `groundPart(block, env): WorldPart` - builds the arrow. `object` holds two
  children: the marks (first) and the plate (second). No `tapTarget`.
- `GROUND_DARK_DEFAULT` - each style's dark colour where the record names
  none (the editor's colour fields show it as their default).

## The styles

- `ribbon` - a swept rounded band at knee height with a head, chevrons on its
  back and a soft shadow; it hovers as one piece, a light runs along it, its
  plate hovers too.
- `vanes` - pitched raised chevrons along the route, each hovering out of
  phase, a faint shadow under each.
- `footprints` - a pair at the start, alternating single prints, a pair at
  the end; a light steps from print to print; the plate stands on a post.
- `lights` - guide lights set in the paving every 0.8 m and a V of five at
  the end; a light runs along them and the V flashes.
- `floor` - one cast arrow `lying`, `hovering` or `upright`
  (`floorPlacement`), at most 8 m long; with `captionOnArrow` the caption is
  painted on it where it fits along the shaft, and the plate is hidden then.

## Invariants and assumptions

- Laid out from the record once, in the part's frame (front +Z, Y up, the
  walker's right -X): the point is taken from the block's pose at
  construction, and from the parent frame on each `update`; a move of more
  than 5 cm lays everything out again (the creator dragged the spot). The
  marks never follow the visitor.
- Too near (room past the stop under 0.5 m): no marks, the plate alone,
  facing away from the point. No point at all: straight ahead along +Z at the
  scale's length.
- The plate stands on the side away from the bend (the right when straight),
  facing back along the start; only it turns (`orientation` `upright` or
  `face`), eased like a sign's board.
- Motion (hover, travelling light) only in `play` and only when
  `env.reduceMotion?.()` is not true; the editor and a calm visitor see the
  marks at rest.
- Colours: `color` else the role's accent; `darkColor` else
  `GROUND_DARK_DEFAULT[style]`. Unlit materials with the shading baked into
  vertex colours, like the sign, so the look is the same in every scene.
- Without a DOM (Node) no canvas is made: the plate draws as a flat dark
  board and the caption is never painted on a floor arrow.
- `dispose` frees every geometry, material and texture, including those of
  earlier layouts.

## Example

```ts
const part = groundPart(block, env);
station.add(part.object);
part.update?.({ seconds, viewer });
```

## Tests

`ground.test.ts` - per style: above the ground and within the stop; straight
ahead with no point; plate only when too near; bend side and plate side;
record colours and defaults; motion in play, none in edit or under reduced
motion; relayout when the spot moves; only the plate turns. The maths is in
`ground-route.property.test.ts`. The look is checked side by side against the
prototype in the editor e2e.
