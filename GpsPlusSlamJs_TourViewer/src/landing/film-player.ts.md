# film-player.ts

## Purpose

Decides when the hero film moves: owns its position on the timeline,
plays once by itself when enough is in view, pauses when it leaves the
view or on a tap, jumps to a part, yields to AR, and requests animation
frames only while it plays.

## Public API

- `createFilmPlayer(o): FilmPlayer`
  - `o`: `timeline`, `reducedMotion`, `startShare` (0, 1],
    `leaveShare` [0, startShare), `requestFrame(cb)`, `cancelFrame(id)`,
    `render(t)`, `onChange(snapshot)`, `maxStepS` (default 0.1).
  - Throws `RangeError` for shares out of range.
- `FilmPlayer`: `snapshot()`, `setViewShare(v)`, `tap()`, `toggle()`,
  `jumpTo(beat)` (`RangeError` for no such part), `release()`, `redraw()`,
  `destroy()`.
- `PlayerSnapshot`: `{ status, pausedBy, t, position, opening, moving }`.

## Invariants

- States: waiting, playing, paused (by "user", "view" or "release"),
  finished. A frame is pending exactly while playing.
- Hysteresis: starts or resumes at `startShare`, pauses below `leaveShare`.
- A user pause holds through view changes; a tap or the button resumes.
- After `release` (AR) it does not resume until the film has left the view
  once, or is tapped.
- Plays once: finished stays finished; `toggle` then plays again from 0.
- Reduced motion: opens finished on the last frame with `opening` true;
  never starts by itself; an explicit play plays.
- One step is at most `maxStepS`, and the first frame of a run counts 0,
  so a tab that was hidden does not skip a part.
- `moving` is playing with at least the start share in view: the page's
  one moving thing (the cards wait for it).

## Tests

`film-player.test.ts` and `film-player.property.test.ts` (random actions:
frame pending iff playing, `t` in range, finished at the end, a user pause
holds).
