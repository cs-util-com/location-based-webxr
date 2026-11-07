# voice-focus.ts

## Purpose

The page's one voice channel: one voice is heard at a time, whoever asks. A tap wins and holds what runs; what was held carries on when the tap's voice ends. There is no waiting line and no muted fallback. Free figures, narrated texts, a story's sound and a story's clip all speak through it.

## Public API

- `createVoiceFocus(): VoiceFocus`
  - `tapped(voice)` - an active start: it runs, whatever ran is held. One voice is remembered: a second tap over a tapped voice stops that one and keeps the first held; a story's voice is kept instead of a held free one, which stops.
  - `selfStart(voice)` - a start nobody tapped: true when the channel was free. False leaves everything as it was, and the caller stays tappable.
  - `ended(voice)` - it is over: the held voice carries on. A held voice that ends is forgotten.
  - `behind(voice)` - it waits behind what runs and carries on when that ends or is tapped: true when the one place behind was free. False when nothing runs, when `voice` is the one running, or when the place is taken; the caller stays tappable.
  - `running()` - the voice heard now, or null.
- `Voice` - `hold()`, `carryOn()`, `stop()`, and `story` on a voice a story owns.
- `focusedPlayer(inner, focus): FocusedPlayer` - a `NarrationPlayer` in the channel: `play` is a tap, `pause` gives the channel back; adds `wanted()` (playing or held), `carryOn()` (a self-start; refused, it takes the place behind what runs and answers false) and `stop()` (for good, back to its start).
- `focusedSceneAudio(audio, focus, onHeld?): SceneAudio` - the story's sound channel in it; a clip is a tap. `onHeld(held)` hears the channel hold it and let it go, so its step can wait. `takeBack()` is a tap on the held voice: it runs again, whatever runs is held. A clip replaced by the next one ends nothing: its late refusal or end is not the new clip's. A `play` a hold's pause cut short (AbortError) is no refusal: it resolves and the clip keeps the channel. Only the held clip's AbortError is excused: one with no hold behind it, or a later clip's, rejects and gives the channel back as any refusal does.
- `storyVideoVoice(video, focus, onHeld?)` - the story's clip in it; `started` takes the channel unless the clip is muted, `ended` gives it back. A `play` the browser refuses at carrying on gives it back too.

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
