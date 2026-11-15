# `kinds/video/video-cap.ts` - how many free videos play at once

## Purpose

The play cap of the station blocks design, section 6: at most two free
videos play at once, and at most one of them with its sound. A pure rule
(`capStep`) and the page's cap (`videoCap`) that the video parts share
(`video-world.ts`).

## Which video wins

- **Playing: the first to start.** The videos that started first keep
  playing; a later start waits, in the order it asked, and the first in
  line takes the next place that comes free. This is the design's rule ("a
  third start waits ... until one ends or is no longer present"), and the
  one a visitor can predict: nothing that plays stops because another
  started. Neither the nearest nor the one faced is used: both change with
  every step and turn of the visitor, so they would need a hysteresis and
  could pause a clip he is watching.
- **Sound: the newest start with sound.** A start (or resume) with sound,
  or the visitor's sound switch turned on, takes the sound; the video heard
  before is muted where it is, still playing, never paused, rewound or
  restarted. The design: "a second unmuted start mutes the first".
- A place comes free when a video stops playing: paused by the visitor,
  left (beyond its reach plus the margin), ended, refused by the browser,
  or freed. A wait is given up when the visitor leaves the video.
- Every view counts alike: screen, cutout, porthole, window and
  stand-here. The design makes no exception.

## Public API

- `VIDEO_PLAY_CAP` (2) - the design's guess at what a mid-range phone
  decodes smoothly; a phone where two stutter would lower it to one.
- `CapState` `{ playing, waiting, audible }` and `EMPTY_CAP`.
- `CapAction` `{ type: "ask" | "leave" | "heard" | "quiet", id }`.
- `capStep(state, action, limit = VIDEO_PLAY_CAP)` ->
  `{ state, granted, muted }`:
  - `ask` - one that plays or waits keeps its place; else it plays when a
    place is free (`granted`), or waits last in line.
  - `leave` - out of both lists, no longer heard; each freed place goes to
    the first that waits (`granted`).
  - `heard` - one that plays becomes the one heard; the one heard before
    is in `muted`. One that does not play is ignored.
  - `quiet` - the one heard is heard no more.
  - A `limit` that is no whole number of at least one counts as one.
- `CapSeat` `{ granted(), muted() }` - a video as the cap sees it.
- `videoCap(limit?)` -> `VideoCap` `{ ask, leave, heard, quiet }`: `ask`
  returns whether it may play now; a seat that waits has `granted` called
  once it may. The state is committed before any seat is called back, so a
  seat may call the cap again from its callback.

## Invariants & assumptions

- Never more than `limit` play; the one heard is one that plays; playing
  and waiting are apart and list each video once; nobody waits while a
  place is free.
- A seat that neither plays nor waits is forgotten, so a page that builds
  and frees videos for hours keeps no list of the gone.
- The page's cap is one module value in `video-world.ts`, shared by every
  station: it counts `<video>` elements, a resource like the elements, and
  a phone's decoders are the page's.

## Examples

```ts
const cap = videoCap();
cap.ask(a); // true
cap.ask(b); // true
cap.ask(c); // false: c waits
cap.leave(a); // c.granted() is called
```

## Tests

- `video-cap.test.ts` - each rule, the line's order, a limit other than
  two, and a seat calling the cap again from its callback.
- `video-cap.property.test.ts` - over any action sequence and limits 1 to
  4, the invariants above.
- `video-world.test.ts`, "videos that share the play cap" - the parts:
  a third waits and starts when one stops, the sound moves without a jump,
  a left wait is dropped, stand-here counts, and over any videos, triggers
  and visitor walks, taps, ends and sound switches (limits 1 to 3), never
  more than the limit play and never two are heard.
