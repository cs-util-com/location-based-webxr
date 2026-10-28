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
  - `end(stationId)` - the guide's "End this story" (K4 review R9): the
    playing story stops and the next queued one starts, a queued one leaves
    the queue; `onStoryEnd(stationId)` is reported either way, also for a
    station the panel does not hold, so it cannot stay found for good;
  - `stopAll()` - the session ended or the tour closed;
  - `playing()` - the station whose story plays.
- Deps: `dom` (`SceneViewDom`), `assets` (by id), `loadAsset(path)`,
  `audio` (`SceneAudio`: `play(blob, onEnded)` rejecting when refused,
  `stop()`), `stage` (`SceneStage` from `scene-stage.ts`),
  `createChoiceButton(label, onClick)`, `schedule(fn, ms)`, `objectUrls`,
  `onStoryEnd(stationId)`.

## Invariants & assumptions

- **A `show` step shows the block it names, by its view.** A block in its
  `stage` view (a character or a model) stands at the station, as the
  character and model steps of earlier versions did; every other block
  shows in the card: a short text's caption, a long text's plain text P
  (B2b), a picture with its caption, a video's player and transcript (B2b),
  an audio's transcript
  with its sound, a model's title, a character's caption with its voice
  (a character in the card plays its voice, but no figure stands). A
  block's world view (a pin, a plane, a placed model) is drawn with its
  station's free blocks (`content-placement.ts`), never by a step.
- A character's figure goes to the stage as it is; the stage's decoder
  measures it from its own header (the decode cap, `station-prefetch.ts`
  `decodeFigure`).
- **A picture is measured before the `<img>` decodes it (K4 review R2):**
  `checkPicture(blob)` (`image-cap.ts` `pictureProblem` in the page) names
  a picture over the tour pixel cap or one whose size cannot be read; it
  is then not shown, and the status says "The picture is too large to show
  here - the words are below."
- **Captions always** (plan §4.1): every step puts words in `text` - the
  text, the picture's caption, the model's title, the character's
  caption, the audio's or video's transcript. A character also shows its
  name.
- **Async feedback** (CLAUDE.md): a step's media shows "Loading the
  picture/figure/sound/3D model…" in `status`, cleared when it shows;
  while the stage holds a loaded figure or model back for the visitor's
  position (no GPS zero, or no heading yet: the guide's `figurePoseOf`)
  it says "Waiting for your position to place the figure…" (or "the 3D
  model") until it stands (r881 re-review M-B); a read
  failure says it "could not be loaded - the words are below"; a sound the
  browser refuses says it "did not play here". The words never wait for
  the media.
- **One status line, several media** (r881 third review M1): the line is
  composed from the step's state, never overwritten by one asset's
  settle - the waiting figure, else the latest asset still loading, then
  what went wrong. A voice that plays while the figure waits or loads
  leaves that line standing; a refused voice and a waiting figure are
  both said, and the failure outlives the wait (it stays true for the
  whole step, the wait does not). Everything resets when the step
  changes.
- **No stale paint:** every rendered step bumps a token; a load that lands
  after the step changed is dropped; the step's object URL is revoked and
  its sound stopped when the step changes.
- **Auto steps** advance on `schedule(afterS x 1000)`; a tap first cancels
  the timer. A choice never auto-advances.
- **Video** (B2b step 3) plays in the card's `<video controls playsinline
preload="metadata">` (`dom.video`, `SceneVideo`): the clip and its
  poster are read through `loadAsset` as object URLs of the step. The
  player shows only once its CLIP is here: a player without a clip has
  controls that do nothing. Until then (and for good when the clip cannot
  be read) the poster stands as a still picture in `dom.image` (alt
  empty: the transcript says it); a tap on the player's controls plays the
  clip (the tap is the activation, so no autoplay rule applies), and the
  transcript stays below. A clip that cannot be read says "The video could
  not be loaded - the words are below." on the status line; a poster that
  cannot be read says so too. The words always stay. On the next step, an end or a stop the player
  pauses, drops its `src` and `poster` (`removeAttribute` then `load()`;
  `src = ""` would fetch the page) and hides, and every object URL of the
  step is revoked. The clip is not prefetched (K4 review R3: it may be as
  large as the tour's entry cap); it is read when its step shows.
- **A long text** (B2b step 4) shows `plainTextOf(parseTourMarkdown(body))
.text` (S0's P): paragraphs a blank line apart, a soft break as a space,
  no markup characters; `#scene-text` has `white-space: pre-line` so the
  breaks show.
- A quiz never reaches the view (the player skips it until K5).
- **One story at a time** is the community PR idea (K-D4: the idea, not
  its implementation): a new tap stops the previous story.

## Examples

```ts
const view = createSceneView({ dom, assets, loadAsset, audio, stage, ... });
view.offer(foundStation); // plays at once, or waits behind "Play: …"
```

## Tests

- `scene-view.test.ts` - steps in order and the end, a character (name,
  caption, figure on the stage, voice), a figure or a model only in its
  stage view (a card character's voice still plays), the video card's
  player (clip, poster, transcript, freed on the next step; an unreadable
  clip leaves the poster as a still and no player), a long text's
  paragraphs (B2b), the station's card picture and a station with no story
  (its card until Continue),
  refused sound and unreadable file,
  a late picture dropped and URLs revoked, the auto timer and its cancel, a
  choice, one story at a time and the queue, de-duplication and `stopAll`;
  ending a playing, a queued and an unknown story (R9); the figure's
  waiting line while the stage holds it, cleared once it stands (M-B);
  a voice that plays while the figure waits or still loads keeps that
  line, and a refused voice is said beside the wait and outlives it (M1).

## Progress and change

- `SceneViewDeps.onChange?()` - called after every render of a step, at
  a story's end and on `stopAll()`, so the sheet's story card (its dots,
  the peek in its place) follows without polling.
- `SceneView.progress(): StoryProgress | null` -
  `{ index, count, autoMs }` of the story playing: the step shown, the
  playable step count (`scene-player.ts` `playableStepCount`) and the
  current step's auto-advance time (null for a step that waits for a
  tap); null without a story or for a story with a choice.
- Tested in `scene-view.test.ts` (the step, the count and the auto
  step's time, nothing without a story, no dots with a choice, `onChange`
  on a start, each step, the end and `stopAll`).

## The held step

- `SceneView.holdStep(held)` - while the visitor is asked whether to end
  the story ("End the story of <title> now" showing), the step holds: an
  auto step's timer is cancelled and `progress().autoMs` reads null (the
  dots show no timed fill); released ("Keep listening"), the timer starts
  again from the step's full length. A step shown while held starts
  no timer; a new story starts unheld. The caller derives the hold on
  every sheet render (`visitor-stations.ts`), so it never drifts from
  the end control.
- Tests: "a held step stops its timer; released, it runs again from the
  start" and "a hold set with no story is dropped when the next story
  starts" in `scene-view.test.ts`.

## World blocks a step reaches (B2b)

- `onBlockShown?(stationId, blockId)`: called from the step's render when
  a `show` step reaches a block with a world view (`worldBlockReachedBy`),
  after a tap, a timer or a choice alike. The card still shows its words;
  the app keeps the block standing in the world from then on. Never for a
  card or a stage block.
- Tests: `scene-view.test.ts` "a story's world blocks (B2b)";
  `shown-blocks.property.test.ts` drives this view under any action
  sequence.

## The station's name and description (B2b step 6)

- `dom.description`: the station's `description` (plain text, set with
  `textContent`, line breaks kept by `white-space: pre-line`) under its
  name while its story plays; hidden for a station without one and when
  the story ends, so a queued station's card never keeps the last one's.
- `dom.stationImage`: the station's card picture (`station.image`, an
  image asset), read through `loadAsset` and `checkPicture` as an object
  URL, alt = the station's title; it stands above the story over every
  step and goes when the story ends or stops (its URL revoked). A picture
  that lands after its story ended is dropped (a token, as a step's); a
  picture that cannot be read is left out silently - the words carry on.
- A station with NO story steps still has a card when it has something to
  say - a non-empty description or a card picture naming a known asset: its
  name, description and picture show with Continue, which ends it. A
  station with neither ends at once, as before (the walk's sheet names it).
- Tests: `scene-view.test.ts` "the station's name and description", "holds
  the card of a station with no story", "keeps the station's card picture
  over every step", "drops a card picture that lands after its story
  ended", "ends a station with no story and nothing to show at once"; the
  e2e `story-blocks.spec.js` at the gate and "a station with no story".
