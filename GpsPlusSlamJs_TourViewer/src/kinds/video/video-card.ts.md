# `kinds/video/video-card.ts` - a free video's card

## Purpose

The page card of a free video, on the page's screen (`WorldEnv.screen`)
while the visitor is there: its title, its state ("Ready", "Playing",
"Paused", "Watched. Play again?"), play / pause / play again, the sound
switch ("Sound on", or "Tap for sound" while muted) and the time, and one
line for a hint or a note. A video with captions also has a CC switch in
that row and a caption strip that follows the clip's time. A porthole's card also holds the clip itself,
large, with a Close. The real controls live here: taps on the 3D look carry
no hit point, so its bar is drawn for show.

## Public API

- `VideoControls` - what the card asks of the part: `toggle`,
  `toggleSound`, `playing`, `sound`, `timeMs`, `durationMs` (0 while
  unknown), `line` (null: none), and `captions?`
  (`VideoCaptionControls`: `text` - the cue on now, "" between cues;
  `on`; `toggle`) - absent: no CC and no strip.
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
- The sound switch and CC carry `aria-pressed`; the state line is
  `aria-live="polite"`. The caption strip is not a live region (the
  transcript is the screen reader's text); it is written as
  `textContent` and hidden while off or between cues.
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
  caption strip and CC (and none without captions), the porthole's clip
  and Close.
