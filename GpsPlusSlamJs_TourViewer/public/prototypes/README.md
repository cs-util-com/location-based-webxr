# Tour Viewer design prototypes (inspiration gallery)

Standalone HTML drafts made to choose a direction between them (polish
round M1; the rule: root `CLAUDE.md` "Throwaway UX prototypes"). They are
served at `/tour/prototypes/`, linked from nothing in the app, and NOT
wired into its logic: every interaction is faked.

- `item-kinds/` - new kinds of items for the item lab
  (`/tour/item-lab.html?kind=stamp-1`); its `README.md` says how to add one.
  Pages and files here are linked from nothing in the app.

- `index.html` - the list.
- `landing-1-editorial/` ... `landing-5-map-path/` - the creator's entry
  and setup page, five visual directions. The app took L5.
- `landing-r3-0-strip-or-cards/` ... `landing-r3-5-calm-route-cards/` - the
  landing ideas, third set: six pages that combine what worked in the
  second set (the motivation first, what a visitor sees, what making looks
  like, the steps in the order of the story, the setup as stacked
  sections, example uses at the end); made 2026-10-25. Same AR switch and
  notes panel as the second set; R3-2 and R3-5 load three.js 0.185.1 from
  unpkg after the first paint.
  - `landing-r3-0-strip-or-cards/` - A side-by-side page, not a landing
    page: the four-phone strip and the three cards, one after the other,
    each filled with the same animated drawn phones, to choose the layout by
    seeing both.
  - `landing-r3-1-drawn-phone-strip/` - The drawn style: a calm drawn phone
    shows what a visitor sees, then making a tour as a numbered strip of
    animated phones (place, add, hang the code, a visitor sees it).
    Weakness: on a phone only one strip frame shows at a time.
  - `landing-r3-2-route-alive-phone/` - The 3D park and its self-drawing
    route as the hero, joined by a phone that shows the making side, one
    scroll step at a time; the camera always stops before the phone acts.
    Weakness: eight steps is a long scroll on a phone; three.js takes most
    of the script budget.
  - `landing-r3-3-two-phones-one-station/` - The same station shown twice,
    side by side: being made and being seen, moving in step through the
    story. Weakness: the phones are drawn sideways, while a maker probably
    holds the phone upright.
  - `landing-r3-4-makers-story/` - Text first, in the second person ("You
    know a story about a place"): five story parts, each with a drawn screen
    of the real step that plays once after its text. Weakness: the longest
    read, about seven phone screens before the setup.
  - `landing-r3-5-calm-route-cards/` - The quietest page: the 3D park draws
    its route once and stops, then three cards with drawn phones that play
    in turn, then the setup in the order of the story. Weakness: what a
    visitor sees comes last of the three cards.
- `landing-r2-1-l5-extended/` ... `landing-r2-10-calm-control/` - the
  landing, round 2: ten directions for the Tour Viewer's own page as the
  landing and the start at once (a would-be maker learns what an AR tour is
  and how to start; a visitor with a code gets straight in); made
  2026-10-25. Each fakes the device's AR support with a switch or
  `?ar=1` / `?ar=0`, and ends in a folded notes panel with its direction,
  load-bearing details, measured cost, weaknesses and the values it rests
  on. Three of them load three.js 0.185.1 from unpkg by an import map,
  after the first paint.
  - `landing-r2-1-l5-extended/` - the current setup page kept and grown (a
    moving intro, a strip of what a visitor sees, an example tour, three
    plain steps). Weakness: a long page; AR is only drawn.
  - `landing-r2-2-route-alive-3d/` - a 3D model park where the route draws
    itself and scrolling drops the camera to eye height inside a phone.
    Weakness: three.js takes most of the script budget; a long scroll
    before the steps.
  - `landing-r2-3-through-the-phone/` - the hero is the view through a
    phone held up on site, the tour fixed to its spot while the phone
    sways. Weakness: the drawn phone is small, so its text is tiny.
  - `landing-r2-4-two-doors/` - take a tour or make one, two sign-like
    colour blocks with a short path each. Weakness: AR is explained by two
    small pictures; the visitor door is as loud as the maker's.
  - `landing-r2-5-creator-story-clay/` - the maker's story in a 3D clay
    world, one beat per scroll. Weakness: about five screens before step 1;
    the visitor's view is only implied.
  - `landing-r2-6-poster-first/` - the printed poster as the hero, read
    part by part, printable as an A4 example. Weakness: no 3D; AR is one
    flat drawing.
  - `landing-r2-7-try-in-30-seconds/` - a playground: place three stops on
    a drawn park, then watch them as a visitor. Weakness: a drawn map is
    not the camera; the phone keyboard hides the map while typing.
  - `landing-r2-8-use-case-gallery/` - six invented example tours with a
    "With the tour / Without" switch. Weakness: no moving picture of AR; a
    swiping reader may never reach the last example.
  - `landing-r2-9-developer-landing-forked/` - the developer landing's dusk
    3D world rewritten for makers. Weakness: dark and costly on a phone;
    close in idea to the clay story.
  - `landing-r2-10-calm-control/` - no 3D, no motion, one plain readable
    page with step 1 on it. Weakness: may read as dull; one still picture
    may not make AR clear.
- `hud-1-chips/`, `hud-2-bottom-sheet/`, `hud-3-drag-surface/` - the AR
  authoring overlay. The app takes H1, with an action strip.
- `scan-1-centre-card/`, `scan-2-viewfinder/`, `scan-3-coach-mark/` - the
  visitor's scan overlay. The app takes S1.
- `visitor-1-poster/` ... `visitor-4-one-tap/` - the visitor's start page
  (after scanning a poster), four directions; made 2026-10-12. The app
  took V4.
- `editor-1-left-rail/`, `editor-2-right-inspector/`,
  `editor-3-bottom-strip/` - the desktop editor (M6, before E1), all "full
  map, floating panels", differing in where the list and the editing card
  sit; made 2026-10-13. The app takes `editor-1-left-rail`.
- `editor3d-1-studio/`, `editor3d-2-walk-it/`, `editor3d-3-storyboard/`,
  `editor3d-4-map-tilt/` - the 3D editor on the globe (stations as groups
  of items, codes apart), four directions on a faked town; made
  2026-10-18, before the build. They load three.js from unpkg by an import
  map. When a station moves, the four drafts re-ground its items on the
  fake terrain (an item keeps its height above the ground), while tour.json
  version 3 keeps an item's local pose rigid with its station: the real
  editor must choose between the two deliberately.
- `editor3d-1-studio-r2/` ... `editor3d-4-map-tilt-r2/` - round 2 of the
  same four after round 1 was tried (made 2026-10-19): one shared frame
  (a docked story-card tree and inspector, one set of handles, a top view,
  a two-finger guard), each keeping its own idea. They move a station's items rigidly with it
  and offer "Put items on the ground", as decided after round 1. The
  round-1 pages stay.
- `editor3d-1-studio-r3/` and `editor3d-4-map-r3/` - round 3 (made
  2026-10-19): two converged pages with one set of rules, Studio opening in
  a tilted 3D view and Map opening from above. Both take a `#morph=A-B` or
  `#morph=snapN` flag for how pins and photos lie flat by camera angle
  (their defaults differ: Studio 3-22 degrees, Map 8-42), and
  `#stations=1000` for a large generated tour. The earlier rounds stay.
- `visitor-walk-1-calm-card/` ... `visitor-walk-4-radar-and-list/` - the
  visitor's walk in AR from AR start to the tour's end, four directions
  (calm card, guidance in the world, the guide speaks, radar and list);
  made 2026-10-21. Each covers every state of the walk, a fixed-order and
  an any-order tour, and its own answer to what the skip names when
  nothing vouches for the position. They load three.js from unpkg by an
  import map; `window.__visitorWalk` drives them in checks.
- `station-blocks-1-narrated-text/` ... `station-blocks-8-audio/` - station
  content blocks, one kind of content per page (narrated text, short text,
  pictures, video, 3D models, 3D primitives, a recurring character, audio
  alone), each shown in several views of the same data on the same plain
  square, in a visitor, a creator and an editor mode; made 2026-10-22. They
  load three.js from unpkg by an import map; `window.__stationBlock` drives
  them in checks.
- `station-blocks-2a-ground-road-marking/` ...
  `station-blocks-2f-ground-stepping-cards/` - six directions for the
  short-text block's ground view (road marking, light trail, knee ribbon,
  medallion, spotlight, stepping cards), each a copy of
  `station-blocks-2-short-text/` with only that view replaced and a "1 m
  error" button that draws every block and its target 1 m off; made
  2026-10-25. Section 0 of each page's notes says what it costs and where
  it fails.
- `editor-approach-1-quiet-camera/`, `editor-approach-2-arrival-board/`,
  `editor-approach-3-work-while-flying/` - three directions for opening a
  tour in the editor on the globe: what the creator sees while the camera
  flies in from space and the map loads (a calm camera with one line of
  text; a loading board in the left rail; an editor that works during the
  flight); each has a network-case strip; made 2026-10-30.
- `character-sheet-1-guided-steps/` ... `character-sheet-3-make-your-character/` -
  three directions for making a guide character from an image AI (guided
  steps, one inspector panel, a playful card with a live stand-in); made
  2026-10-29. Each cuts the AI's four-pose picture in the browser (alpha, or a
  flood fill from the border on white), offers a steady body when the
  talking frames jitter, and draws its own sample pictures, good and broken.
- `editor-panel-1-explorer/` ... `editor-panel-4-place-in-world/` - four
  directions for the editor's station list, its context-sensitive right
  panel and adding every content type (a file explorer, a content gallery,
  tabs with a toolbar, placing in the view), each on the same sample tour
  with story folders listed before free items and a light Markdown
  description; made 2026-11-03.
- `editor-bottom-panel-1-tabs/`, `editor-bottom-panel-2-status-drawer/` -
  two directions for the editor's bottom bar and a collapsible panel for
  problems, history, map loading and performance (one tabbed panel, or a
  drawer per status item); made 2026-11-03.
- `globe-look-1-glitter-haze/` ... `globe-look-4-relief-deck/` - four
  directions for the globe seen over open sea with the sun low (sun glitter,
  haze, cumulus clouds): the sea and the air alone, raymarched clouds, lit
  puff clusters, a relief cloud deck. Each has the same three views
  (`?view=10km|3km|30km`), `?sun=`, a `?tier=low|high` switch, a frame-time
  readout and `window.lookStats()`, and notes with its own self-check;
  made 2026-11-03.
- `globe-look-1-glitter-haze-r2/` ... `globe-look-4-relief-deck-r2/`,
  `globe-look-5-puffs-on-relief/`, `globe-look-6-raymarch-relief/` - the
  second round: the first four with their visible faults fixed (clouds near
  the camera, wobble, popping puffs, see-through bases), two combinations of
  their cloud styles, a free camera on every page, and a frame meter that
  reports frames per second, long frames, the GPU time where the browser
  offers it, and a Measure button that renders each frame 1 to 8 times to
  get the real cost of one frame on a display-capped screen; made
  2026-11-04.
- `globe-look-7-raymarch-lod/`, `globe-look-8-raymarch-living/`,
  `globe-look-9-raymarch-sharp/` - the third round, all from the raymarched
  clouds of round 2: a cloud resolution that follows the camera's distance
  without a visible switch (`?lod=0|1`), a region-sized cloud field that
  does not repeat and clouds that slowly change shape (`?field=tiled|random`,
  `?evolve=0|1`, `?timescale=`), and full-resolution clouds rebuilt over
  four frames with the camera's motion (`?method=base|new`). Each also has
  denser clouds and a far sea that keeps its long waves in the cheap tier;
  made 2026-11-04.
- `globe-look-10-living-lod/`, `globe-look-11-no-slices/` - the fourth
  round: the living cloud field combined with the distance scale, without
  the slices, the far flicker and the small round clouds of round 3
  (`?skip=live`, `?refdiv=` bring parts back), and a study of the slices
  (`?deband=off|refine|fine|entry|strat`) with a banding measure per method.
  Both pages' frame meters follow the display's refresh rate as it changes;
  made 2026-11-04.
- `globe-look-10-living-lod-r2/` - the fifth round, a copy of the living
  clouds page: far clouds marched with longer steps so they stay until the
  haze hides them (`?far=new|old`), the sun disc and halo hidden by the
  cloud in front of it (`?sunfix=1|0`), and a medium quality setting
  (`?tier=low|medium|high`, `?mset=a|b|c|d` for the candidates measured);
  made 2026-11-04.
- `globe-look-12-map-clouds/` - a copy of `globe-look-10-living-lod-r2/`
  with the coverage taken from the globe's NASA cloud map, read per step by
  latitude and longitude, and a closed deck for overcast places. The life
  cycle runs at 30 times real time. `?place=front|clear|cirrus|highlat` or
  `?lat=&lon=`, `?view=3km|10km|30km|60km`, `?tier=low|medium|high`,
  `?pr=tier`, `?grade=aces-bright|aces|neutral|agx`
  (the globe's own colour presets, default `aces-bright`), `?gradeexp=`. The meter
  and the Measure button are for measuring on a phone; made 2026-11-05.
- `world-items-1-real-objects/` ... `world-items-3-tap-a-card/` - three
  directions for video, audio and a character standing free in the world:
  real objects in the place, a quiet marker that starts when you are near,
  and a card that a tap opens on the screen; made 2026-11-06. They explored
  when these items start and stop, a question largely answered before they
  were made, so where they differ the earlier answer stands: free sound and
  video stay stopped until tapped; a character or a video may start by itself
  only if its settings say so and nothing else plays; the AR view shows no
  lists of items in its HUD.
- `audio-narration-spot-1/` - a narration sound placed in the world, for a
  visitor: one circle on the ground with rising light, a player card only
  inside it (plays on a tap, pauses on leaving, carries on at return, stays
  off once stopped) and an ambient glow nearby that turns quieter while the
  narration plays. Three looks of the circle (motes, curtain, plume), a
  walk-through, position noise and an edit view. The look is a kind module
  (`kind.js`, `kind.css`, `sample.json`) that the page only hosts; the voice
  and the market sound are generated in the page; made 2026-11-08.
- `editor-import-1-drop-into-scene/` and `editor-import-2-tour-library/` -
  two directions for bringing pictures and 3D models into the desktop
  editor: straight onto the place, or a checked library shelf first; the
  size limits on both pages are guesses; made 2026-11-06.
- `quiz-world-stage/` and `quiz-world-1-fan/` ... `quiz-world-7-answer-scenes/` -
  quizzes whose answers stand in a walkable place, all on one shared stage
  (`quiz-world-stage/README.md` is the contract a kind module follows); 1-4
  made 2026-11-07, 5-7 (the creator places the answers, find them first,
  answers as small scenes) made 2026-11-08. Each page says why its 3D carries
  meaning and the strongest case against; the plain card,
  `quiz-visitor-1-story-card/`, is the baseline.
- `story-editor-1-step-cards/` ... `story-editor-3-inline-script/` - three
  directions for the story editor (step cards, a flow graph, an inline
  script), each with the same sample station, every edit on an in-memory
  model with undo, the deletion questions, and a preview through a branch;
  made 2026-10-29.
- `use-cases-true-colour/` - the start page's use-case pictures in the
  look the page does not use (the place dimmed, the tour's pictures in
  their own colours), with a switch to the shipped route-light look;
  rendered from `src/landing/use-case-markup.ts`, no script beyond the
  switch.
- `station-blocks-2g-ground-laid-ribbon/` ... `station-blocks-2o-ground-arc/` -
  nine more ground views for the short-text block, each a copy of
  `station-blocks-2c-ground-chevron-ribbon/` with only that view replaced.
  Everything on the ground is laid out once from the record (the block's
  pose and `pointsTo`) and never moves or changes shape while the visitor
  walks around it; only the small caption plate may turn. A Sun button
  joins the 1 m error button. `window.__stationBlock.groundInfo()` returns a
  signature of the ground marks in world space (every vertex to 1 mm), so a
  check can prove they stay put; made 2026-10-25.
  - `station-blocks-2g-ground-laid-ribbon/` - the knee ribbon laid once
    along the block's turn, with a light running toward the target.
  - `station-blocks-2h-ground-chevron-vanes/` - a row of separate chevrons
    at knee height, pitched nose-up. Weakness: from the target side they
    seem to point away.
  - `station-blocks-2i-ground-chevron-track/` - a flat track on the paving
    with raised chevrons. Weakness: with the error toward the wall the head
    runs into the step.
  - `station-blocks-2j-ground-footprints/` - footprints from a pair to stand
    on to a pair facing the target. Weakness: from 12 m behind, a speck.
  - `station-blocks-2k-ground-guide-lights/` - lights set into the paving,
    ending in a V. Weakness: in sun only the dark rings read.
  - `station-blocks-2l-ground-floor-arrow/` - one short solid arrow at the
    block's spot. Weakness: it says "that way" and does not lead there.
  - `station-blocks-2m-ground-stakes/` - a funnel of stakes with pennants.
    Weakness: the most clutter and the most expensive rebuild.
  - `station-blocks-2n-ground-runner/` - a woven runner with the caption
    woven in at its start. Weakness: the woven caption reads only from
    behind the start and close by.
  - `station-blocks-2o-ground-arc/` - a rail in one arc to a ring before the
    target. Weakness: it passes through head and chest height near both
    ends.
- `station-blocks-2p-ground-styles-bend-knob/` and
  `station-blocks-2q-ground-styles-bend-drag/` - one ground view in five
  styles a creator picks per block (ribbon, vanes, footprints, lights, and
  the floor arrow lying, hovering or upright, with its caption printed on it
  where it fits), each a copy of `station-blocks-2l-ground-floor-arrow/` with
  the ground view and the creator's controls replaced. The arrow runs toward
  `pointsTo` and stops 2 m short; one scale sets the letters and the length
  (by default from the target's distance); handles on a circle round the
  start set the size and the bend in creator and editor mode; hovering
  pieces float by time alone (off under reduced motion); two free colours per
  style with a sun warning below 3 : 1. The pages differ only in the bend
  control; made 2026-10-26.
  - `station-blocks-2p-ground-styles-bend-knob/` - a turn knob behind the
    start bends the arrow. Weakness: the same knob turns a block without a
    target.
  - `station-blocks-2q-ground-styles-bend-drag/` - a handle in the middle of
    the arrow, dragged sideways. Weakness: in the editor at phone width the
    whole bend spans a few pixels, so the slider does it there.

- `narration-1-quiet-voice/` ... `narration-3-sign-speaks/` - a narrated
  long text for the visitor in AR, three directions; made 2026-10-31. Each
  answers how the voice is noticed before anything opens, the captions strip
  next to the full text, the audio states (loading, missing file, the end, a
  locked phone, a call) and a speed control. A fake clock drives the words.
  - `narration-1-quiet-voice/` - the voice is a gentle extra: a small speaker
    mark on the sign, one surface at a time, calm one-line problems.
    Weakness: "4 min" can read as reading time, so the voice is easy to miss.
  - `narration-2-audio-guide/` - listening first: one tap on "Listen" plays
    and shows a persistent mini-player. Weakness: sound starts at once, which
    can startle in a quiet place without earphones.
  - `narration-3-sign-speaks/` - the sign has Read and Listen halves and the
    spoken sentence runs on a plate under it in the world (three.js 0.185.1
    from unpkg). Weakness: beyond about 7-9 m the letters are too small and the
    caption moves to the screen.

- `longtext-editor-1-in-the-inspector/` ... `longtext-editor-3-preview-first/` -
  writing a long text and its narration in the tour editor, three directions;
  made 2026-11-01. Each answers where the body is written and previewed, how
  "shown as typed" parts are pointed out, the view picker (sign and sheet,
  screen only, captions), adding a voice and a timing with the mismatches
  listed, and a timing put out of line by an edit.
  - `longtext-editor-1-in-the-inspector/` - everything in the right-hand
    panel, the preview a phone sheet over the 3D view. Weakness: at 1024x768
    the writer is about 170 px tall while a note is open.
  - `longtext-editor-2-writing-desk/` - a desk over the 3D view's area: text,
    a notes margin, a phone preview in step and a narration timeline.
    Weakness: the 3D view is gone while writing.
  - `longtext-editor-3-preview-first/` - editing in the visitor's own sheet,
    a guided "Add a voice" flow. Weakness: rich-text editing covers the
    common paths only, and at 1024 px the 3D view shrinks to about 260 px.

**Kept, the chosen and the unchosen** (decided 2026-10-11 evening): another
developer may prefer a variant that was not chosen and ask their own
coding agent to build that one. The verdicts are in the polish-round plan
(private docs).

**What goes with them:** the `public/prototypes/` lines in the package's
`.prettierignore` and `.stylelintignore`, and the `landing-5-map-path`,
`landing-r2-1-l5-extended`, `editor3d-*` and `station-blocks-*` entries of `tests/repo-config/slider-pages-load-the-guard.test.js` (`EXEMPT`).
The drafts are not held to the app's lint and format rules.

**Rule applied after the build:** the three HUD drafts first blocked
placing until the code was measured; that contradicts the project's rule of
2026-10-09 (placing never depends on a code) and was lifted.
