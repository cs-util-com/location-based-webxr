# `kinds/video/video-card.ts` - a free video's card

## Purpose

The page card of a free video, on the page's screen (`WorldEnv.screen`)
while the visitor is there: its title, its state ("Ready", "Playing",
"Paused", "Watched. Play again?"), play / pause / play again, the sound
switch ("Sound on", or "Tap for sound" while muted) and the time, and one
line for a hint or a note. A porthole's card also holds the clip itself,
large, with a Close. The real controls live here: taps on the 3D look carry
no hit point, so its bar is drawn for show.

## Public API

- `VideoControls` - what the card asks of the part: `toggle`,
  `toggleSound`, `playing`, `sound`, `timeMs`, `durationMs` (0 while
  unknown), `line` (null: none).
- `videoCard(host, { title }, controls, player?)` -> `{ render, dispose }`:
  - `player` - `{ element, onClose }` for a porthole's clip, or null.
  - `render` - brings the card up to the controls; writes only what
    changed, so it may run every frame.
  - `dispose` - removes the card and the clip element it held.

## Invariants & assumptions

- It reuses the narration card's classes (`narration-card.ts`) with
  `data-kind="video"`, `data-testid="video-card"`; its styles are scoped to
  that kind in `index.html`, which widens the screen's root while a
  porthole's player is open.
- The sound switch carries `aria-pressed`; the state line is
  `aria-live="polite"`.
- A press runs the control, then renders at once.

## Examples

```ts
const card = videoCard(host, block, controls, null);
card.render(); // each frame
card.dispose();
```

## Tests

- `video-card.test.ts` (jsdom) - state words and the play button, the
  replay offer, the sound switch and its pressed state, the hint line, the
  porthole's clip and Close.
