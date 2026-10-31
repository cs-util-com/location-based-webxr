# narration-player.ts

## Purpose

A long text's voice: one audio element over the tour's audio file, fetched only when the visitor first presses play, and one clock that the reading sheet and the captions strip both follow, so they never drift apart.

## Public API

- `NarrationClock` - `nowMs()`, `durationMs()` (the file's once known, else the tour's `durationMs`, else 0), `playing()`, `play()`, `pause()`, `seek(ms)` (clamped; kept for when the file arrives), `onChange(listener)` returning an unsubscribe.
- `NarrationPlayer` - a clock plus `dispose()` (stops, revokes the object URL, drops listeners).
- `createNarrationPlayer({ load, durationMs?, onError?, audio?, createUrl?, revokeUrl? })` - `load()` fetches the file; `audio` is a seam for tests.

## Invariants and defensive measures

- `playing()` is true from the press on, also while the file is fetched, so the button answers at once.
- A failed fetch or a refused `play()` reverts to paused and reports through `onError` (the page's error channel); the player stays usable.
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

- `narration-player.test.ts` - lazy fetch, seek before load, clamping, failure reverting the state, dispose.
