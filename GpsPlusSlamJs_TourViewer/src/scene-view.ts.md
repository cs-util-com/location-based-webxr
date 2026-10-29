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
- Deps: `dom` (`SceneViewDom`), `assets` (by id), `characters?` (the tour's declared characters by id, minor 2), `loadAsset(path)`,
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
- **A declared character's frames sheet:** a story view of a block whose
  `character` names a declaration with `frames` stands from the sheet (the
  look gets `sheet: true` and slices it); the `portrait` view's round
  portrait stays the block's `image`. A sheet that cannot be read stands
  him from his `image` in one pose, and the figure's own "could not be
  loaded" line the failed read wrote is taken back, since he does stand;
  every other notice stays (the notices are kept per part). Under
  `?debug=1` `debugLines()` names the failed sheet and the character,
  until the next story starts or everything stops (`stopAll`). The `stage` view and a declaration without
  `frames` use the `image` as before.
- **A character in a story view** (`bubble`, `speak`, `two-stations`,
  `portrait`, `popup`; tour format 4.2) goes to the stage with a look
  spec `{ view, name, line, voiced, pose }` (the line is the caption;
  `voiced` is false in the bubble view, which has no voice), which the stage
  draws as a character look (`scene-stage.ts`, `character-look.ts`). The
  caption still shows in the card (captions always). The `portrait` view
  also shows the figure as a round portrait beside his name (`dom.portrait`,
  measured by `checkPicture` like a picture, hidden on the next step). A
  character's own voice - the one a tap on his standing look plays - tells
  the stage when it speaks (`setVoice("speaking")`, with the clip's length
  when the audio knows it, `SceneAudio.durationMs`, so the read-along is
  scaled to it) and when it has spoken (`"spoken"`); every step change
  sets `"idle"`. A `card` or `stage` view's voice is not his: it leaves
  a standing look alone.
  As in the prototype, a story view's voice plays only on a tap on him
  (`characterTapped()`: the figure, bubble or stage in AR, through
  `visitor-stations.ts`, or the portrait in the card); a tap while his
  voice plays stops it, and the next plays it again; **while the step's
  own sound plays (an audio step, a card view's voice) or the step shows a
  video (before its clip plays and while it plays; not when its clip
  cannot be read, and never past its step), a tap on him is taken
  and does nothing** - no second sound over it, and it is not stopped, so
  a `lineEnd` step still moves on at its end; a voice still loading when
  it was stopped is dropped. **His voice failing on a tap after his
  story** (the panel is hidden, so the status line is not seen) is said
  through `sayFailure` ("The voice could not be played here."); during a
  story the status line says it, as for any media. The bubble view has no voice: its tap shuts or opens
  the bubble. The `stage` and `card` views still play the voice with the
  step. **The tap stays his whenever he stands:** after his step and after
  the story (the stage is released, `stage.release`, absent: `clear`, so
  he stays in the world) a tap still plays his voice; only a cleared look
  takes none (a new story, `stopAll`, a story ended with nothing to
  release, a plain `stage` figure or a model taking the stage).
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
- **`lineEnd` steps** (format 4.2) advance when the step's voice or sound
  ends, after a 600 ms tail; never while it plays. With no voice, or one
  that cannot be read or played, or a story view's voice nobody tapped,
  the words' reading time stands in; a tap that starts the voice holds the
  step until it ends, and a tap that stops it counts as its end. A video's
  `lineEnd` waits for the clip's `ended` once its `play` event came (until
  then, so for a clip nobody plays, the transcript's reading time; one
  that cannot be read: the same); the next step resets `onended` and
  `onplay`
  (`character-views.ts` `lineReadingMs`, 1.5-60 s). Held, no timer runs;
  released, the wait starts again. One timer at a time: `armTimer` cancels
  any earlier one (a voice lost while its step renders arms it early).
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
  breaks show. A long text in the `lectern` view stands on its reading
  stand in the square (`lectern-view.ts`), its page drawn as pixels, so
  its step's card shows its title and then its plain text, a blank line
  apart (readable there, and reachable by a screen reader).
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
  current step's own timer: the auto time, or a `lineEnd` step's wait once
  its voice is out of the way (null for a step that waits for a tap or
  for a voice still playing, and while held); null without a story or for a story with a choice.
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

- `sayFailure?(text)`: a failure the hidden panel cannot show (his voice,
  tapped after his story, could not be read or played); the app shows it
  in the walk's toast (`visitor-stations.ts` `sayFailureInToast`).
  Absent: not said.
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
  picture that cannot be read or is too large is left out, and the status
  line says so ("The station's picture could not be loaded." / "... is too
  large to show here.") over every step until the card ends - the words
  carry on.
- A station with NO story steps still has a card when it has something to
  say - a non-empty description or a card picture naming a known asset
  (`station-run.ts` `stationHasCard`, the walk's own rule): its
  name, description and picture show with Continue, which ends it. A
  station with neither ends at once, as before (the walk's sheet names it).
- Tests: `scene-view.test.ts` "the station's name and description", "holds
  the card of a station with no story", "keeps the station's card picture
  over every step", "says why the station's card picture is missing",
  "drops a card picture that lands after its story ended", "ends a station with no story and nothing to show at once"; the
  e2e `story-blocks.spec.js` at the gate and "a station with no story".
- Tests: `scene-view.test.ts` "a declared character's frames sheet" (a story view from the sheet, the stage view and the portrait from the image, the fallback with no failure line, no sheet), and "a character's story views and the advance
  when the line ends" (a story view handed to the stage as a look, the
  plain stage view without one, a card with no figure; the voice told to
  the stage; `lineEnd` on the voice's end, never before; the reading time
  with no voice or a failing one; the hold; the portrait; the voice on a
  tap, its stop and replay, the bubble's tap, a dropped loading voice, the
  release at the story's end, the tap after his step and after the story,
  none on a cleared look, the clip's length handed to the stage, a failed
  sheet clearing only the figure's notice and its debug line) and "a
  lineEnd step on a video" (the reading time until `play`).
