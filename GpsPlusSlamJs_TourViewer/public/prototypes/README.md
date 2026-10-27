# Tour Viewer design prototypes (inspiration gallery)

Standalone HTML drafts made to choose a direction between them (polish
round M1; the rule: root `CLAUDE.md` "Throwaway UX prototypes"). They are
served at `/tour/prototypes/`, linked from nothing in the app, and NOT
wired into its logic: every interaction is faked.

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
