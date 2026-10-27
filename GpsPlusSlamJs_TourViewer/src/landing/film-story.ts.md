# film-story.ts

## Purpose

The hero film's eight parts in order, each a pure function from the
part's own moment to the whole picture: the model (`SceneState`) and the
drawn phone with the old photo (`PhoneState`). Each part also carries its
bar title and its caption.

## Public API

- `FILM_BEATS: BeatSpec<ViewName>[]` (lengths and views, for the timeline).
- `BEAT_TITLES`, `BEAT_CAPTIONS`: one per part.
- `frameAt(beat, t): FilmFrame` (`{ s, u }`); `t` is clamped to the part;
  an unknown part throws `RangeError`.
- `blankPhone()`, `TYPED_TITLE`.
- Types: `ViewName` (`over | mill | poster`), `Pill`, `SceneState`,
  `PhoneState`, `FilmFrame` (the figure's shape is module-private).

## The parts

0. A tour: the finished route draws itself (overview).
1. What a visitor sees at the first station.
2. A story you know: the park empties, the old photo lies where the phone will be.
3. Walk there and place a station.
4. Add words and a picture.
5. Along the walk: the person walks on, the route draws behind them.
6. Hang the code: printed and hung where the walk begins.
7. Visitors scan it, then walk the finished route (the camera moves to the
   overview inside the part, at 3.3 s). Its bar name and caption say that
   the tour opens in the phone's browser and there is no app to install:
   this is where a reader wonders whether a visitor needs one.

## Invariants

- Pure and deterministic; numbers match the prototype exactly (the port was
  checked value by value against it).
- The captions claim only what the film shows; the code opens the tour.
- Every caption fits the room the film's box keeps for it (three lines up
  to 480 px wide, two wider), down to 320 px and in a wide face; pinned by
  `landing-film.spec.js` ("the scanning part").

## Tests

`film-story.test.ts` (park numbers, every part's picture at chosen moments,
clamping, unknown part).
