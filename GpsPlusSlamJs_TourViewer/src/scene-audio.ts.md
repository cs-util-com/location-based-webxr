# scene-audio.ts

## Purpose

The stories' one sound channel (tour kit plan K4, §8 G4 "audio unlock and
battery"): ONE audio element for the page, unlocked by the visitor's
"Start the tour" tap and reused for every clip. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `createSceneAudio({ createElement, objectUrls }): UnlockableAudio`
  - `unlock()` - call synchronously inside the tap: the element plays a
    tiny silent WAV; once (a refused unlock may be tried on the next tap);
  - `play(blob, onEnded)` - stops the previous clip, plays this one;
    rejects when the browser refuses (the story then says so);
  - `stop()` - pause, forget the end callback, revoke the clip's URL.
- `silentWav()` - a 45-byte RIFF/WAVE, PCM mono 8 kHz, one silent sample.
- `AudioElementLike` - the slice of `HTMLAudioElement` it drives.

## Invariants & assumptions

- Mobile browsers let an element play only after it played inside a user
  gesture; a story starts minutes into the walk with no tap of its own, so
  the element must be the one the start tap unlocked (one element, made
  lazily, never replaced).
- No network: the silent clip is built in memory, its object URL revoked
  once the unlock settles. Every clip's URL is revoked at its end or stop.
- `createElement` is the page's `seams.createAudioElement` (`new Audio()`;
  the e2e fake records what plays).

## Examples

```ts
const audio = createSceneAudio({
  createElement: () => new Audio(),
  objectUrls,
});
button.onclick = () => audio.unlock(); // the start tap
await audio.play(voiceBlob, () => {}); // later, no tap needed
```

## Tests

- `scene-audio.test.ts` - every clip through the one unlocked element; one
  unlock and its URL released; a new clip stops and releases the previous;
  the end calls back once; a refusal passes on; the WAV's header fields.
