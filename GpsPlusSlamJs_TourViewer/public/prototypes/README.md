# Tour Viewer design prototypes (inspiration gallery)

Standalone HTML drafts made to choose a direction between them (polish
round M1; the rule: root `CLAUDE.md` "Throwaway UX prototypes"). They are
served at `/tour/prototypes/`, linked from nothing in the app, and NOT
wired into its logic: every interaction is faked.

- `index.html` - the list.
- `landing-1-editorial/` ... `landing-5-map-path/` - the creator's entry
  and setup page, five visual directions. The app took L5.
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
