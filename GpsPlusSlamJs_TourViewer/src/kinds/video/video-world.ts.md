# `kinds/video/video-world.ts` - a free video in the world

## Purpose

The `WorldPart` of a free video (`screen`, `cutout`, `porthole`), routed by
`play-kinds.ts`: its look (`video-look.ts`) fed by a `<video>` element, and
its rules (`video-rules.ts`) driven by the frames. The creator's trigger
starts it once; leaving pauses it and coming back resumes it; a finished
video stays finished and a tap replays it. While the visitor is there its
card (`video-card.ts`) is on the page's screen. In the editor it is the
same look, still and silent.

## Public API

- `ClipPlayer` - what the part uses of a `<video>` element.
- `VideoDeps` - the page: `makePlayer`, `clipTexture`, `posterTexture`,
  `url` / `revoke`, `activated` (the page was touched), `storage` (the
  visitor's preferences), `element` (the player as a page element).
- `SOUND_REFUSED_NOTE` - the card's line when the browser kept a wanted
  sound off.
- `videoWorld(block, env, deps?)` -> `WorldPart | null`: null in the card
  view and without `widthM`; `deps` defaults to the browser's.

## Invariants & assumptions

- `ready` loads the clip (and the poster, a failure of which only drops
  it), waits for the clip's metadata and rejects when it cannot be read;
  on a page with no player it settles at once. The look is rebuilt to the
  clip's own shape (a stacked clip's picture is its upper half).
- There: the horizontal distance from the object over the scale its
  folders draw it at (`inheritedScaleOf`), with `videoThere`'s margin.
  Coming there opens the card and sends `return`; leaving closes it and
  sends `leave`.
- A `look` start measures the angle between `frame.facing` and the
  direction to the object's position (its pose, not its drawn centre).
- Sound: decided once, at the first start, by `decideStartSound`. A start
  that wanted sound before the page was touched plays muted, and the next
  tap turns the sound on instead of pausing. A `play()` with sound the
  browser rejects, or one that has not played after
  `VIDEO_SOUND_REFUSED_MS`, is muted, tried again and said. A muted
  `play()` the browser rejects stops it: the state goes to `paused` (the
  card says Play), the line says the browser did not start it, and the
  visitor's tap is the next try. A muted start that is only slow to load is
  left to its own promise and still counts as playing.
- The sound switch stores the visitor's choice for every video.
- A porthole's tap opens the card with the clip large and starts it if it
  does not play; Close returns to the plain card.
- The viewer is handed to the look in the part's own frame (the object's
  matrix inverted), so a posed and turned cutout faces the visitor.
- `dispose` pauses and unloads the player, revokes its URL, frees the
  textures and the look, and closes the card.

## Examples

```ts
const part = videoWorld(block, env);
await part?.ready;
part?.update?.({ seconds, viewer, facing });
```

## Tests

- `video-world.test.ts` - with a fake player and screen: each trigger, the
  sound paths (creator, untouched page, refusal, a refused muted start, a
  slow muted load, remembered choice), leave
  and return, finished then replay, the porthole, the silent editor, a
  posed cutout's turn and dispose.
