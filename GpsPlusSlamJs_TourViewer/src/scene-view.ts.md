# scene-view.ts

## Purpose

The visitor's story panel (tour kit plan K4, §4.2): plays a found station's
scene (`scene-player.ts`) in the DOM overlay with its media and captions,
the tap to continue, the timed advance, scene choices, and ONE story at a
time. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `createSceneView(deps): SceneView`
  - `offer(station)` - a found station: play it now, or queue it behind the
    story playing (shown as "Play: <title>"); a station already playing or
    queued is not added twice;
  - `playNextNow()` - the "Play" button: the story playing stops and waits
    its turn again (its station stays found), the queued one plays;
  - `continueTapped()`;
  - `stopAll()` - the session ended or the tour closed;
  - `playing()` - the station whose story plays.
- Deps: `dom` (`SceneViewDom`), `assets` (by id), `loadAsset(path)`,
  `audio` (`SceneAudio`: `play(blob, onEnded)` rejecting when refused,
  `stop()`), `stage` (`SceneStage` from `scene-stage.ts`),
  `createChoiceButton(label, onClick)`, `schedule(fn, ms)`, `objectUrls`,
  `onStoryEnd(stationId)`.

## Invariants & assumptions

- A character's figure goes to the stage with its asset's stated pixel
  size (the decode cap, `station-prefetch.ts`).
- **Captions always** (plan §4.1): every step puts words in `text` - the
  text, the image's or model's caption, the character's caption, the
  audio's or video's transcript. A character also shows its name.
- **Async feedback** (CLAUDE.md): a step's media shows "Loading the
  picture/figure/sound/3D model…" in `status`, cleared when it shows; a read
  failure says it "could not be loaded - the words are below"; a sound the
  browser refuses says it "did not play here". The words never wait for
  the media.
- **No stale paint:** every rendered step bumps a token; a load that lands
  after the step changed is dropped; the step's object URL is revoked and
  its sound stopped when the step changes.
- **Auto steps** advance on `schedule(afterS x 1000)`; a tap first cancels
  the timer. A choice never auto-advances.
- **Video** shows its transcript (video is later). A quiz never reaches the
  view (the player skips it until K5).
- **One story at a time** is the community PR idea (K-D4: the idea, not
  its implementation): a new tap stops the previous story.

## Examples

```ts
const view = createSceneView({ dom, assets, loadAsset, audio, stage, ... });
view.offer(foundStation); // plays at once, or waits behind "Play: …"
```

## Tests

- `scene-view.test.ts` - steps in order and the end, a character (name,
  caption, figure on the stage, voice), refused sound and unreadable file,
  a late picture dropped and URLs revoked, the auto timer and its cancel, a
  choice, one story at a time and the queue, de-duplication and `stopAll`.
