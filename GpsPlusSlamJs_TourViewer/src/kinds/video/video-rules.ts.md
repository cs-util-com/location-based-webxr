# `kinds/video/video-rules.ts` - a free video's rules

## Purpose

The pure half of a free video in the world: when the creator's trigger
starts it, when the visitor counts as there, what each event does to its
playing, whether it starts with its sound, the visitor's remembered sound
choice and the hint its card shows. No three.js, no page; `video-world.ts`
drives these each frame.

## Public API

- Constants:
  - `VIDEO_DEFAULT_WIDTH_M` (1.6) - the width a video takes when it first
    stands in the world (from a file, or out of a story).
  - `VIDEO_DEFAULT_WITHIN_M` (6) - a `near` start's distance when the block
    names none.
  - `VIDEO_AWAY_M` (25) - the reach of every other start: beyond it plus
    the margin the visitor has left.
  - `VIDEO_MARGIN_M` (2) - the hysteresis band beyond the reach.
  - `VIDEO_LOOK_DEG` (15) and `VIDEO_LOOK_DWELL_S` (0.6) - a `look` start.
  - `VIDEO_SOUND_REFUSED_MS` (1000) - how long a start with sound may wait
    for the browser before the part mutes it and says so.
- `videoStartOf(block)` - the trigger, `enter` when absent.
- `videoReachM(block)` - `withinM` (or the default) for `near`, else
  `VIDEO_AWAY_M`.
- `videoThere(distanceM, reachM, was)` - there within the reach, gone beyond
  reach + margin, unchanged between them and for a distance that is no
  number.
- `lookDwell(dwellS, offDeg, dtS)` - the time the video has been within
  `VIDEO_LOOK_DEG` of the view's middle; any look away resets it.
- `startFires(start, there, dwellS)` - `enter` / `near`: there; `look`:
  there and dwelt; `tap`: never (the tap itself starts it).
- `videoStep(state, event)` -> `{ state, action }` - the playing rule:
  - `waiting`: start or tap -> `playing` / `play`.
  - `playing`: leave -> `held` / `pause`; tap -> `paused` / `pause`;
    ended -> `finished`.
  - `held`: return -> `playing` / `resume`; tap -> `paused`.
  - `paused`: tap -> `playing` / `resume`.
  - `finished`: tap -> `playing` / `replay`; nothing else moves it.
- `decideStartSound({ chosen, creator, activated })` -> `{ sound, blocked }`:
  the visitor's choice over the creator's (`off` when neither); a wanted
  sound before the page was touched starts muted and `blocked`.
- `videoSoundChoice(stored)` / `withVideoSound(stored, choice)` - read and
  write the `videoSound` key of the visitor's stored preferences
  (`visitor-prefs.ts`), keeping every other key.
- `videoHint(start, state, distanceM, reachM)` - "Tap the video to play",
  "Walk closer to start · N m" (N at least 1), or null.

## Invariants & assumptions

- A finished video never restarts by itself: a leave, a return or its
  trigger leaves it finished; only a tap replays it.
- The state is `playing` exactly when a player following the actions plays
  (the property test drives any event sequence).
- A stored choice that is not `on` or `off` reads as none.

## Examples

```ts
let state: VideoState = "waiting";
const step = videoStep(state, "start"); // { state: "playing", action: "play" }
decideStartSound({ chosen: null, creator: "on", activated: false });
// { sound: false, blocked: true }
```

## Tests

- `video-rules.test.ts` - each rule and its edges.
- `video-rules.property.test.ts` - the playing rule over any event
  sequence; the margin never flips inside its band, for any reach.
