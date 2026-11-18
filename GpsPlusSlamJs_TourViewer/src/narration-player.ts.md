# narration-player.ts

## Purpose

A long text's voice: one audio element over the tour's audio file, fetched only when the visitor first presses play, and one clock that the reading sheet and the narration box both follow, so they never drift apart.

## Public API

- `NarrationClock` - `nowMs()`, `durationMs()` (the file's once known, else the tour's `durationMs`, else 0), `playing()`, `play()`, `pause()`, an optional `hold()` (a pause for a scrub that keeps the voice's place in the voice channel; `voice-focus.ts` gives it, `pause` stands in without), `seek(ms)` (clamped; kept for when the file arrives), `onChange(listener)` returning an unsubscribe.
- `NarrationPlayer` - a clock plus `dispose()` (stops, revokes the object URL, drops listeners).
- `createNarrationPlayer({ load, durationMs?, onError?, audio?, createUrl?, revokeUrl? })` - `load()` fetches the file; `audio` is a seam for tests.

## Invariants and defensive measures

- `playing()` is true from the press on, also while the file is fetched, so the button answers at once.
- A failed fetch or a refused `play()` reverts to paused and reports through `onError` (the page's error channel); the player stays usable.
- Every press of play or pause counts (`presses`, a generation counter as `scene-audio.ts` keeps for its holds). A `play()` that a later press superseded neither starts the audio element nor reports its AbortError (`isPlayAbort` of `scene-audio.ts`): a drag can hold a voice the frame after it was carried on, and play-pause-play can land before the first `play()` settled, and neither must show the error toast. An AbortError of the current press (nobody's pause caused it) is reported, since nothing plays then.
- The file is fetched once; a second press while fetching does not fetch again.

## Example

```ts
const player = createNarrationPlayer({
  load: () => loadAsset(path),
  durationMs,
});
player.seek(12_000);
player.play();
```

## Tests

- `narration-player.test.ts` - lazy fetch, seek before load, clamping, failure reverting the state, a play() cut short by a pause taken quietly, the superseded play()'s abort after play-pause-play taken quietly, the current play()'s abort reported, one audio start after play-pause-play during the fetch, end and pause, dispose.
