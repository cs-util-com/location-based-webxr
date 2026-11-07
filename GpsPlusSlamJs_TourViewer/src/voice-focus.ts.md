# voice-focus.ts

## Purpose

The page's one voice channel: one voice is heard at a time, whoever asks. A tap wins and holds what runs; what was held carries on when the tap's voice ends. There is no waiting line and no muted fallback. Free figures, narrated texts, a story's sound and a story's clip all speak through it.

## Public API

- `createVoiceFocus(): VoiceFocus`
  - `tapped(voice)` - an active start: it runs, whatever ran is held. One voice is remembered: a second tap over a tapped voice stops that one and keeps the first held; a story's voice is kept instead of a held free one, which stops.
  - `selfStart(voice)` - a start nobody tapped: true when the channel was free. False leaves everything as it was, and the caller stays tappable.
  - `ended(voice)` - it is over: the held voice carries on. A held voice that ends is forgotten.
  - `running()` - the voice heard now, or null.
- `Voice` - `hold()`, `carryOn()`, `stop()`, and `story` on a voice a story owns.
- `focusedPlayer(inner, focus): FocusedPlayer` - a `NarrationPlayer` in the channel: `play` is a tap, `pause` gives the channel back; adds `wanted()` (playing or held), `carryOn()` (a self-start, false when the channel is taken) and `stop()` (for good, back to its start).
- `focusedSceneAudio(audio, focus): SceneAudio` - the story's sound channel in it; a clip is a tap.
- `storyVideoVoice(video, focus)` - the story's clip in it; `started` takes the channel unless the clip is muted, `ended` gives it back.

## Invariants and assumptions

- At most one voice runs and at most one is held; the channel never plays anything, its voices do.
- A voice ends itself when its file runs out; `focusedPlayer` tells the channel, except for a pause the channel asked for (`hold`).
- A player's failure ends its voice like a file running out, so a held voice is not left waiting.
- The channel does not hear a volume or a sound-off setting, and no background sound passes through it.

## Examples

```ts
const focus = createVoiceFocus();
const voice = focusedPlayer(createNarrationPlayer({ load }), focus);
voice.play(); // a tap: holds what spoke
voice.pause(); // the held voice carries on
```

## Tests

`voice-focus.test.ts` covers the rules and each wrapper; `voice-focus.property.test.ts` drives random sequences and holds that one voice runs and one stays paused.
