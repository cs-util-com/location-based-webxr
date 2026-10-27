# index.html

## Purpose

Two pages in one file (guided-setup plan DEC-N1, 2026-09-08): the plain
page is the CREATOR'S guided setup, a `?qr=` launch is the VISITOR'S
screen. Everything marked `.creator-only` is hidden for a visitor
(`visitor-screen.ts`); `#visitor-screen` is hidden for a creator.

- The setup (`wizard.ts`): collapsible steps, one open at a time, each
  with an `<h2>` inside its summary (valid markup; how a screen reader
  exposes it through the disclosure is a field-test item) and an inline
  SVG icon; the reached step and the last opened link are remembered per
  device (M6). **SIX steps since polish round M2** (the flow rework of
  F10 had made it four; step 6 restores a completion step of its own). The
  steps use up to `48rem` of the width (A14; they were capped at 26rem,
  half a landscape phone).

  **The L5 look since polish round M2b** (the owner's prototype verdict,
  D-P1): on the creator page the landing (`#landing`, see "The landing"
  below; it replaced the intro, `#setup-intro`, on 2026-10-26), then the stage
  (`#setup-stage`): the illustrated map (`#setup-map`, an example route
  with six stations drawn by `setup-stage.ts`; ids prefixed `map-`)
  beside the step card (`#setup-card`) on a wide or landscape screen, above
  it on a phone. The card shows ONE step - the open `<details>`; closed
  steps are hidden by CSS - under its station row (`#setup-badge`,
  `#setup-of`, `#setup-dots`) and over `#setup-nav` (Back/Next; none on
  step 6, no Next on step 5). The paper palette is set on the design
  system's own tokens on `:root`, only for the creator page and only while
  no AR session runs (`body[data-ar-active]`), so `#ar-root` over the
  camera keeps the sheet's tokens; L5's own tokens are `--map-*`. The
  header (`<h1>Tour Viewer</h1>`) shows for a visitor only. The steps:
  1. **Where the tour lives** (`#step-host`): the host tiles
     (`#host-tiles`, a radiogroup filled by `host-picker.ts`), the chosen
     host's steps (`#host-steps`), the starter zip (`#starter-zip`, only
     for a host that needs a file before it gives a link), Continue
     (`#host-continue`), and a small link to open a tour zip from the
     device (`#open-file`, "Open it from this device", tour kit plan K0;
     a file has no link, so its code is printed once the zip is hosted).
  2. **The link** (`#step-link`): `#open-form` with the button "Check
     link" - the check also runs by itself on paste and when the field is
     left - and `#link-status`, the line saying what the check found
     (`link-check.ts`). The shortener advice and its bit.ly warning live
     here, where the check that counts runs. The picker itself (`#file-input`) and the line naming a
     file-opened tour (`#file-status`) and the open tour's signature lines
     (`#tour-trust`, tour kit plan K1: who signed it or that nobody did,
     trust warnings, linked tours; `white-space: pre-line`) sit under
     `#error`, outside the
     wizard, so a visitor reaches them too - with `#file-advice`, the
     "Open the downloaded file" button shown under a "host blocks
     browsers" error.
  3. **Print** (`#print-panel`): the tour's own name first (`#tour-name-input`,
     W2 of the tour editor plan 2026-10-17-1816: apart from the poster's
     title, it shows the open tour's title, and a changed one renames the
     tour, saved by the next Finish - an emptied one removes the title,
     `tour-name-field.ts`; no `maxlength`, which counts UTF-16 units: a
     name over 80 characters is refused in `#tour-name-error`, plan §23
     #8); by PDF only since polish round M0b - a
     PDF of N numbered posters (`#print-count` between the big - and +
     `#print-count-down` / `#print-count-up`, three by default), each
     carrying the poster text of `#poster-title`, `#poster-explanation`
     and `#poster-cta` (polish round D-P7, r820 feedback R8), previewed as
     one small poster per code (`#print-tiles`). The defaults nobody needs
     to touch sit in the closed `#print-settings` (r820 feedback R7): the
     side length in centimetres (`#author-size`, 18 by default; a size
     refusal at AR start opens the block), `#print-paper` and the first
     code number (`#author-c`). The launch link the codes carry
     (`#print-url-out`) is shown in step 2 since the r820 feedback (R6). The print dialog's "fit to page" silently rescales, and a
     rescaled code measures the world wrong, so the page has no print
     stylesheet and no print button. The link is SHOWN
     (`#print-url-shown`), not asked for, whenever a tour is open, and the
     code renders without a button press; `#print-url-ask` returns only
     when nothing is open, which is what keeps printing before hosting
     possible (F7 + flows plan DEC-F2).
  4. **Hang** (`#step-hang`): the "It hangs - continue" button.
  5. **Create the tour** (`#step-measure`): a `<details>` like its
     siblings since F4, wrapping `#ar-root`; its button reads "Start
     creating". And `#draft-offer` - unsaved work this
     device still holds for this tour, offered with three answers rather
     than applied (F13). The paste form F12 added here (`#tour-missing`) is gone: the
     printed code carries the tour's link, so reading it in AR opens the
     tour (scan-to-open plan §2).
  6. **Done** (`#step-done`): `#finish-block` (the rebuilt zip's status,
     the save, the summary and `#replace-help`), opened by the Finish
     (polish round M2, B9). Until then `.done-pending` says what the step
     is for; page CSS hides it once the block shows.

- The visitor's start page in the owner's V4 look (polish round M4a,
  D-R12/D-R14; reference `public/prototypes/visitor-4-one-tap/`):
  `#visitor-screen` (kicker, `#visitor-cover` one photo, `#visitor-title`,
  `#visitor-subline`, `#visitor-description` (W2) - written by
  `visitor-start.ts`, which also titles the tab after the tour), then `#ar-root`
  restyled as the action (the status sentence above, the round
  `#enter-ar` with its ring and `data-step` marker, `#ar-hint` as the
  one line under it, by flex `order`), then `#visitor-more` after the
  stage ("What happens?" `#visitor-what`, whose "Stays on your phone"
  says the app sends none of your data - no camera image, no location -
  and links the privacy page; hidden on a phone without AR and for a
  tour not finished yet, whose Start is withheld (`#enter-ar`
  `data-start="withheld"`),
  `visitor-privacy`; and `make-your-own`). The safety line
  `#visitor-safety` stands before the round button (W6, D13: "Watch where
  you walk..."), shown on the visitor's start page only. All of it
  is scoped to `body[data-mode="visitor"]:not([data-ar-active="true"])`:
  in a session `#ar-root` is the overlay and keeps the sheet's HUD look.
  The paper palette is the creator page's (`:root:has(...)`), extended to
  the visitor. Fluid sizes are custom properties on the visitor body
  (the lint's css-tree grammar knows neither `clamp()` nor `dvh`); a
  phone held sideways gets two columns. `playwright-tests/visitor-start.spec.js`
  pins the layout at 412x915, 360x640 and 915x412.
- The visitor's scan card in AR (polish round M4b, the owner's S1, D-P5
  amended; reference `public/prototypes/scan-1-centre-card/`):
  `#scan-card` inside `#ar-root` (fixed, centred, `pointer-events:
none`), its `.scan-card-panel` darker than the prototype's, with the
  phone-over-code animation, `#scan-card-title` and `#scan-card-line`
  (the visitor's sentence); `#scan-escape` lives in it, at the bottom of
  the screen, the only part that takes taps. Sideways: animation beside
  the words. `ar-mode.spec.js` pins its centring and the skip's place.
- **"You already have a tour?"** (`#have-tour`, creator-only, tour editor
  plan 2026-10-17-1816 W1): BELOW the map and the steps, so the first-time
  story stays first. Two halves, chosen by CSS from the page's AR check
  (`#enter-ar[data-ar-state]`, written by `ar-entry.ts`): `unsupported`
  (a computer) shows `.have-tour-desktop` - one line
  (`#have-tour-editor-text`, said per browser by `main.ts` with
  `have-tour.ts`'s `editorPitch`: saved back into the tour file where the
  file picker exists, else a new copy; the markup holds the latter, PR #637
  review) and "Open the
  editor" (`edit.html`); any other settled state (a phone with AR) shows
  `.have-tour-phone` - "From this device" (`#have-tour-file` over its own
  hidden `#have-tour-input`, no test id), the link form (`#have-tour-form`,
  `#have-tour-link`, `#have-tour-open`), the status line
  `#have-tour-status` and, after an open, `#have-tour-ask` ("Play it" /
  "Continue setting it up"). While the check runs (`checking`) and before
  it began (no state) the whole section stays out of view, its heading
  too: a heading over two hidden halves read as an empty box (PR #637
  review). `#measure-desktop`'s rule carries no mode check and needs none:
  it is `.creator-only` and keeps `hidden` on a visitor's page, which the
  design system's `[hidden]` rule wins over (`way-in.spec.js` pins it).
  Behaviour: `have-tour.ts`.
- **The setup page's foot** (`#setup-foot`, creator-only, W6, D13): the
  legal notice and the privacy page, the site-wide page at `/legal/`
  (`/legal/#notice`, `/legal/#privacy`; `legal.html.md` says why it moved). The intro's "Runs offline once
  opened" became "Works offline once the tour is loaded", and then (the M4b
  fix re-review #3) "Keeps working without signal once a tour has loaded":
  the tour is cached, the page is not (no service worker), so nothing on
  the page promises an offline revisit - the host step says the same, and
  "Other settings" says the kept tours open faster (`legal.spec.js`).
- **Step 5 on a computer** (W1, plan review #9): `#measure-desktop` says
  the step runs on site on an Android phone with Chrome and links the
  editor; the same AR check shows it, and on the creator page an
  `unsupported` `#enter-ar`, `#ar-hint` and `#ar-status` are hidden
  rather than shown as a dead "AR not supported" button (the button keeps
  its text and disabled state for the code that reads them).
- **Android only, said plainly** (D8): the setup lede says tours run on
  Android phones with Chrome; the visitor's no-AR sentence
  (`visitor-status.ts`) and the poster's default call to action
  (`poster-text.ts`) say it too.
- Below the steps, creator-only: the Storage section (`#storage-panel`,
  summary "Other settings" - something you normally do not open, F9).
- Shared: `#error`, and under it `#error-contact` (W2, D15: "Questions
  about this tour? Contact its maker:" and the tour's contact as a link,
  `#error-contact-link`, shown for a visitor while an error shows and the
  open tour names a contact, `tour-contact.ts`), `#ar-root` (the DOM-overlay root: hint, status line,
  button, the setup panel `#setup-panel` with `setup-status` and, inside
  `#setup-controls` (the code is measured on its own and its position
  decided by the settle: the measure button, the explicit replace and its
  confirm are gone, UI round 1, U3, and the move question since code book
  plan M6), first the strip's persistent Undo `setup-undo` (its label
  `setup-undo-label`, `creator-undo.ts`), then the
  placement controls `setup-pin` / `pin-label` / `pin-save` /
  `pin-cancel` / `setup-photo`; then `setup-finish`, and LAST, outside
  the controls because it works on the page too, the object list
  `#object-list` (drawn by `object-list.ts`, M4; last so that in AR it
  never pushes Finish off the first screen); the visitor's
  `scan-escape`), `#stats`, `#gallery`.

Behaviour lives in the wiring modules composed by `src/main.ts` (see
`main.ts.md`); the page carries only structure and its inline CSS
(alpha-hex borders - the stylelint csstree validator predates
`color-mix()`).

## The landing

The top of a creator's page, built from two of the landing prototypes:
the step cards of the maker's story, and the route-alive scene as the hero
film (`src/landing/landing-film.ts`; until it mounts, and for good where
its chunk fails, the hero shows its last moment as a drawing).

- **Shown by CSS, before `main.ts`:** `#landing` is `.creator-only` but
  not authored `hidden`; `body[data-mode="creator"] .landing` shows it, and
  the first-paint script (`#first-paint-mode`) sets the mode before the
  first paint. `visitor-screen.ts` sets `hidden` on it for a visitor.
- **Top to bottom:** `.landing-way` (a visitor's way in: scan the code, or
  `#have-tour` for a link), the hero (`.landing-kicker`, the `h1`
  "You know a story about a place.", `.landing-lede`, `.landing-make-line`,
  `.landing-needs` "Tours run on Android phones with Chrome." and a "Make
  your tour" button, `.landing-begin`), the film's host `#landing-film`,
  the five step cards (`.landing-cards`, each `.landing-card`: kicker,
  `h3`, two lines (the visitors' card leads with a bold "No app to
  install:", the tour opens in the phone's browser, and its caption says it
  again), a picture box `.landing-pic` with its dock
  `.lc-dock[data-kind]` and, for cards 2 to 5, a pause button over the
  picture `.landing-hold`, authored `hidden`, and "Show again"
  `.landing-again`, invisible but in the layout until the cards' module
  marks it `data-ready`, a 44 px target whose negative margin keeps the
  caption's line height; both described by their card's heading,
  `aria-describedby="landing-step-<n>"`), a closing line, "Make your own
  tour" (`.landing-make`: six reasons in one list, two columns from 600 px, three across the
  whole column from 900 px wide and taller than 560 px;
  a line that the setup's steps open in any order; `#setup-begin`), and the
  use cases' host `#landing-uses` (a short static list until their section,
  `src/landing/use-cases.ts`, replaces it, its heading with it; the host
  keeps the landing's section gap and gutters and drops the section's own
  outer padding, `.landing-uses > .uc`, and sets its heading and line in
  the landing's own sizes).
- **Reserved sizes:** the film's box is a fixed height that holds the
  film's picture at the prototype's own proportion plus the room for its
  bar and a caption (`--film-chrome`: 133 px for three caption lines up
  to 480 px wide, 114 px for two, 110 px framed). Upright (narrower than
  900 px and taller than wide) the picture is 9:10 and the box the page's
  whole width, edge to edge with lines above and below only (the
  prototype's picture is full width there too, and a narrower one put the
  phone below the size where its screen keeps its card text); elsewhere
  the picture is 3:2 in a framed, rounded box, centred (16:9 from 900 px
  wide), its width following the view's height
  (`max-width: (100svh - 66px) * 3/2`, `* 16/9` from 900 px) so the
  picture and its bar never outgrow the view. The film fills whatever box
  it is given; on the 16:9 box the 3:2 still is letterboxed. Its heights use `cqw`
  (`.landing-hero` is an inline-size container). Before the film mounts
  the box shows its last moment as a drawing at the same proportion
  (`public/landing/hero-still-{portrait,landscape}.svg`, 9:10 and 3:2,
  `loading="lazy"`, so a visitor's hidden page never fetches it), where
  the picture will be, and the box keeps its size when the film replaces
  it. Measured 2026-10-26 at eleven viewports from 320x640 to 1920x1080:
  no change of size on mount, the still within 1 px of the picture. A
  reduced-motion list of captions grows the box below
  (`:has(> .lf-list)`), 119 to 195 px, once at mount (below the fold on
  an upright phone) and back when the film is played. That growth is
  reserved under reduced motion until the film mounts, as a bottom margin
  on `.landing-film:not([data-mount], :has(> .lf-list))` (156 px up
  to 480 px wide, 118 px wider; it goes in the same style change as the
  list arrives, so the box changes once instead of growing by the list and
  then shrinking by the margin, which now and then left a restored reload
  that margin past the stage), a lower bound of the measured growth: a page the wizard
  reloaded mid-setup was otherwise pushed 35 px past the stage at
  390x844. Measured 2026-10-27, the content below still moves on mount
  by 1 to 2 px at most widths, 20 px on a phone held sideways, 20 px at
  360 and 39 px at 320 px wide (more in a wider face), never up. The film's inner
  room is `--lf-inset` (16 px upright, the page's gutter; 12 px framed). Each picture box is `2 * --pw + 28px` tall, `--pw` the
  phone's width: 206 px (56vw under 368 px), 214 px from 900 px wide, and
  `(100svh - 74px) / 2 - 14px` on a phone held sideways (at most 560 px
  high), where the picture is `1.6 * --pw` wide beside its text.
  The use cases' host reserves the mounted section's height (`min-height`
  per column count, `calc(a + b * vw)`): the wizard reloads mid-setup, and
  a section that grew after the browser restored the scroll left the
  creator about 1 700 px past the stage. The values are a lower bound of
  the measured heights in the system face, so the section never ends in a
  gap: measured 2026-10-26 the section still grows on mount by 8 to 28 px
  at most widths (145 px at 320, 83 at 639 and 64 at 640, near the column
  steps) and by 32 to 282 px in the wide face. A host whose chunk failed
  drops the reservation. A lower bound measured in one face is not enough
  in a wider one (the CI's Linux face put the stage 141 px down after a
  reload at 390x844), so the height the tab last measured, at the same
  window width, is kept in session storage and set as the host's inline
  `min-height` by the classic script `#landing-uses-height` right after the
  host, before the first paint (`src/landing/uses-height.ts`).
- **Gaps** (all set here, the design system zeroes margins): the hero's
  kicker 16 px under the band (34 px from 900 px), the `h1` 8 px, lede 10,
  make-line 12 (20 from 900 px), needs 7, button 14, film 18 (28 from
  900 px); on a phone held sideways 6, 6, 4 and 10. Cards: text then
  picture 20 px (stacked) or side by side with a column gap of 5 % of the
  view, at most 72 px (desktop, from 1440 px wide), or 22 px (sideways
  phone); caption 9 px under the picture; 52 px (56 px from 900 px wide
  and taller than 560 px, 40 px sideways) after each card; inside a card the kicker 6 px above the
  heading, the heading 12 px above its first line (8 px sideways), lines
  10 px apart, the text indented 50 px for the marks (76 px desktop). "Make your own tour": 14 px
  between heading, list, line and button. `landing.spec.js` pins them at
  390x844, 844x390 and 1440x900, also in a wide face, the wide-screen
  layout below at 1100x700, 1280x720, 1440x900 and 1920x1080, each also in a
  wide face, and the hero on the first screen at seven desktop sizes
  (1000x700 to 1920x1080, short windows included) in both faces.
- **Sizes without `clamp()` or `min()`:** the prototypes' fluid sizes are
  steps at fixed widths; the csstree validator rejects `clamp()`, `min()`
  and `max()` here. The `h1`: 29 px, 44 px from 600 px wide, 56 px from
  900 px, and beside the film from 1000 px 48 px, or 40 px where its
  column is narrow (under 1160 px wide) or the window short (under 680 px
  high); 25 px on a phone held sideways (landscape, at most 560 px high).
  The prototypes' 60 px from 1160 px is not used: beside the film the
  text column is at most about 454 px wide, where 56 and 60 px gave four
  lines in the system face.
- **On a wide screen** (every rule has a height guard or a width no phone
  has, so a phone, upright or held sideways, keeps its layout; measured
  2026-10-27 at 390x844 and 844x390, also in a wide face, no element moved
  or changed size):
  - From 768 px wide and taller than 560 px the reading text is larger
    (`.landing-way` and the step cards' captions `.landing-caption` 16 px,
    the reasons and the numbered order 17.5 px, the use cases' sentences
    17 px) and so are the main buttons (`.landing-begin`: 17 px, at least
    52 px high). The film's own caption keeps its size
    (`src/landing/landing-film.css`). Each value was judged by geometry
    (line counts in the system face and the wide face, 2026-10-27), none
    yet by eye on a real screen:
    - The way-in line and the cards' captions 16 px (considered 15 to
      18): secondary lines, a step under the 17.5 px reading text and so
      under the 17 to 18 px asked for body text. 17 px still keeps the
      way-in line on one line from 768 px in both faces; 18 px wraps it to
      two at 768 px in the wide face. Reversing: if they read too small
      beside the reading text, 17 px.
    - The reasons and the numbered order 17.5 px (considered 16.5 to
      18.5): at 18.5 px a reason takes a third line in the three-column
      list at 900 px in the wide face (273 px columns). Reversing: 18.5 px
      if 17.5 reads too small and three-line reasons are accepted.
    - The use cases' sentences 17 px (considered 16 to 18): at 18 px a
      sentence runs to five lines in the wide face at 768 and 1280 px (four
      at 17). Reversing: 16 px if the use-case cards read too long.
    - The breakpoint 768 px (considered 600 to 900): with the larger text
      from 600 or 640 px the way-in line wraps to two lines and the use
      cases' sentences run to five lines in their 293 px columns in the
      wide face; 700 px would also keep both. Reversing: 700 px if
      tablets from 700 px wide should get the larger text.
  - From 1000 px wide the hero's text and film stand side by side
    (`.landing-hero` a two-column grid, 48 px apart, the film's top on the
    kicker's). The film's box is 58 % of the row less the gap, at 16:9 plus
    its chrome, its height capped at `100svh - 96px` (and its width with
    it), so the whole film, bar and caption included, is on the first
    screen: it starts about 73 px down, which leaves about 23 px below it.
    Swept 2026-10-27: the breakpoint at 1000, 1100 and 1200 px (1200 left a
    1100 px window stacked with only the film's top in view; 1000 and 1100
    both fit, so the lower one won, its text column about 386 px at
    1000 px); the share at 0.52, 0.58 and 0.64 (0.64 gave a four-line `h1`
    and pushed the button under a 600 px high window; 0.58 makes text and
    film about equally tall); the cap at 72, 96 and 120 px (72 let the film
    run past a 500 px high window). Reversing: if the film's small text
    reads too small at about 534 px wide, or the text column too narrow,
    the breakpoint goes to 1100.
  - The headline beside the film is 48 px, and 40 px where its column is
    narrow (1000 to 1159 px wide: about 386 to 453 px) or the window short
    (under 680 px high). In a wide face (Verdana; the CI's Linux face,
    DejaVu Sans, has the same widths) 48 px wrapped it to five lines in
    the narrow column and four in the 454 px one, so the hero's button
    ended at 705 px at 1000x700, 1100x600 and 1100x700 and at 653 px at
    1280x600; with 40 px it ends at 619 px at 1000x700 and 575 px at the
    other three (519 to 548 px in the system face). From 1160 px wide and
    680 px high, 48 px ends it at 653 px in the wide face (545 in the
    system face), at least 27 px clear. Swept 2026-10-27 in both faces at
    1000x700, 1100x600, 1100x700, 1280x600, 1280x720, 1440x900 and
    1920x1080: the headline at 36, 38, 40, 42, 44, 46 and 48 px; the
    film's share at 0.5, 0.52 and 0.55 against 44 and 48 px; and the
    1100 px breakpoint. Only 40 px and under keep the button on all seven
    screens at the 0.58 share (42 px ends it at 627 px at 1100x600). The
    share 0.5 with 48 px fits too, but by 3 px at 1100x600 in the wide
    face, and narrows the film on every desktop (626 to 540 px); 0.52 with
    44 px fits by 12 px there. The 1100 px breakpoint alone leaves
    1100x600, 1100x700 and 1280x600 over. Not fitting, named: in the wide
    face a window 1000 to about 1090 px wide and under 620 px high (four
    lines, the button at 619 px); 36 px would fit it. Judged by geometry,
    not yet by eye; 40 px is under the 44 px section titles.
    Reversing: if 40 px reads too small, the share 0.5 with 48 px
    (accepting the 3 px margin at 1100x600 and the smaller film).
  - From 900 px wide and taller than 560 px the step cards' pictures start
    at their kicker's line (`align-items: start`, the picture 6 px down,
    the kicker's own top padding), and the cards are 56 px apart
    (considered 48 to 76, the earlier desktop value; judged by geometry,
    not yet by eye). The largest gap between lines inside a card is 12 px (its heading
    to its first line), so 56 px keeps the cards apart by more than four
    times it; every value in the range keeps a whole card (about 500 to
    516 px) on a 600 px high first screen, so geometry does not decide it. Reversing: 64 to 76 px if the
    cards read as running together.
  - From 900 px wide and taller than 560 px the setup stage stands on the
    landing's column (`--landing-wide`, 1128 px, set on `body` so both the
    landing and the stage read it, and its 16 px gutters): the map's title and
    its frame's outer line on the column's left edge, the step card's right
    edge on its right. The card is sticky (16 px from the top) beside the
    map while the map is in view, except during AR, whose panel lives in
    the card. Its travel is only as long as the map runs on below it
    (about 100 px at 1280x720), and on a first visit the page ends about
    where the stage does. "You already have a tour?" below it keeps its own
    narrower centred column.
- **Its moving parts** are mounted by `src/landing/landing-mount.ts`
  (dynamic imports, a creator only; see its sidecar): the cards' pictures
  (`landing-cards.ts`, which play by `card-play.ts`), the use cases
  (`use-cases.ts`) and the film (`landing-film.ts`; its host also says
  `data-film-state`, `data-film-beat`, `data-playing` and, where it draws
  flat, `data-film-fallback`). Each host says `data-mount="ready"`
  or `"failed"`; a failed one keeps its static content.
- **The returning-device skip:** `#landing-skip`, a classic script right
  after `#setup-stage` (marked by the comment `<!-- /setup-stage -->`),
  scrolls the stage to the top, instantly, for a device with a stored host
  or last link, no hash, and a plain navigation (`src/landing/landing-skip.ts`
  states the rule; `landing-skip.test.ts` holds the copy to it). On a page
  that skipped (`html[data-landing-skip]`) the stage is at least `100vh`
  tall so its top is reachable at that moment; a first visit keeps the
  stage's own height. The head's `<link rel="expect" href="#landing-skip"
blocking="render">` holds the first paint until the script is parsed, so
  a document that arrives in several chunks never paints the landing
  before the jump. The script marks `<html data-landing-skip="applied">`
  (`"moved"` on the reader's first wheel, touch, key or pointer input) and
  makes the stage the keyboard's start point (`tabindex="-1"`, focus
  without a scroll; a first Tab from the top would undo the skip). `main.ts`
  holds the stage at the top while the parts above and in it settle
  (`holdLandingSkip`, called right after `mountLanding`): scroll anchoring
  alone followed the step card and left the stage 218 px off. The hold
  ends on any scroll it did not make (`"moved"`) and a second after the
  landing's parts settled (`"released"`).
- **The stage before `main.ts` has run:** the map and the card's step line
  are shown by CSS for a creator (only a non-creator page hides them, and
  `main.ts` hides them for a visitor as every `.creator-only` part); the
  steps (`#wizard`) need `main.ts`, so a page that opened at the stage
  shows "Loading the setup..." (`.setup-loading`) while they are hidden.

## Public API

The `data-testid` contract the e2e suite drives: `wizard`, `step-host`
(owns `host-tiles`, `host-steps`, `host-continue`), `landing` (owns
`landing-way`, `landing-needs`, `landing-begin-top`, `landing-film` with
`landing-still`, `landing-story`, `landing-cards` with five
`landing-card`, `landing-make` with `setup-begin`, `landing-uses`),
`setup-stage`, `setup-map` (owns `setup-map-svg` and the
drawn `map-station-<step>`), `setup-card` (owns `setup-loading`, `setup-badge`, `setup-of`,
`setup-dots` with `station-<step>`, `setup-nav`, `setup-back`,
`setup-next`), `step-link` (owns
`link-status` and `print-url-out`, the launch link in `#link-launch`),
`starter-zip`, `link-input`, `open-button`, `open-file-button`,
`file-input`, `file-status`, `tour-trust`, `file-advice`, `open-file-advice`,
`storage-panel`,
`clear-cache`, `print-panel` (owns `print-url-ask`, `print-url`,
`print-url-shown`, `tour-name-input`, `poster-text` (`poster-title`, `poster-explanation`,
`poster-cta`), `print-count-down`, `print-count`, `print-count-up`,
`print-settings` (`author-size`, `print-paper`, `author-c`), `print-pdf`,
`print-info`,
`print-tiles` (its tiles `print-tile`, the first canvas `print-canvas`), `visitor-link` - opens in a
new tab, polish round A17), `visitor-link-note` (under it, shown while
the hosted file is not finished yet: what a visitor reads then,
`tour-unfinished.ts`), `make-your-own` (on the visitor screen: the
setup page in a new tab, polish round A8), `visitor-safety`, `visitor-privacy`,
`setup-foot`, `step-hang`, `hang-done`, `step-measure` (owns
`draft-offer`,
`draft-offer-text`, `draft-restore`, `draft-dismiss`, `draft-discard`),
`measure-desktop`, `have-tour` (owns `have-tour-desktop`,
`have-tour-editor-text`, `have-tour-editor`, `have-tour-phone`, `have-tour-file`,
`have-tour-link`, `have-tour-open`, `have-tour-status`, `have-tour-ask`,
`have-tour-play`, `have-tour-continue`),
`step-done` (owns `done-pending`, `finish-block`,
`finish-status`, `finish-download`, `debug-save` ("Save the debug data"
after a Finish that left the walk out, above the replace steps:
`debug-save-text`, `debug-save-btn`, `debug-save-status`;
`creator-debug-save.ts`), `summary` (the summary after Finish,
authoring plan 2026-09-28-0953 M3b: owns `summary-codes`, `summary-map`,
`summary-map-status`, `summary-start-ar`; written by `summary-panel.ts`,
its map by the lazily imported `summary-map-view.ts`), `replace-help` (owns
`replace-help-generic`, `replace-help-drive`, `replace-drive-copy`)), `visitor-screen`,
`visitor-description`, `stats`, `error`, `error-contact`, `gallery`, `ar-hint`, `ar-status`, `ar-debug`, `enter-ar`,
`setup-panel`, `setup-status`, `size-offer`, `size-offer-text`,
`size-offer-use`, `size-offer-keep`, `setup-controls`,
`object-list` (its rows carry
`object-row`, `object-title`, `object-detail`, `object-edit`,
`object-move`, `object-delete`, `object-edit-input`,
`object-edit-save`, `object-edit-cancel`, `object-busy`, and the list
`setup-status` carries `data-clamped` (two lines in AR, whole on a tap;
whole on the page), `object-list-heading`, `object-list-hint`, `object-list-note` and,
beside it after a delete, `object-undo`; in AR the selected row's
`object-close` - the chooser is gone since polish round M3),
`setup-undo`, `setup-undo-label`, `setup-pin`, `pin-label`, `pin-save`,
`pin-cancel`, `setup-photo`, `setup-finish`, `scan-escape`, `station-line`, `station-skip`, `scene-panel`
(owns `scene-title`, `scene-speaker`, `scene-image`, `scene-text`,
`scene-status`, `scene-choices` with its `scene-choice` buttons,
`scene-continue`), `scene-play-next`, `recording-block` (owns `recording-offer`
with `recording-offer-text`, `recording-offer-save`,
`recording-offer-dismiss`, `recording-offer-discard`; `record-session`,
`recording-privacy`, `recording-notice`, `recording-save`,
`recording-status`), `recording-marker`.
`#recording-offer` (M1b, `recording-offer.ts`) offers a recording a killed
tab left unsaved - the draft offer's three answers and its CSS rule, but its
own element (it appears at page open, not when a tour opens). The block
carries `data-housekeeping="done"` once the page-open check of the recording
folders finished, found something or not (the e2e waits for it before it
asserts that nothing is offered).
`recording-privacy` is a static line saying the recording holds the tour
link and the GPS track (M1a review finding 5); `recording-notice` carries
"Reload the page to record." once an unrecorded AR session has run, or the
low-storage warning after the box is ticked (`recording-panel.ts`).
The troubleshooting recording (authoring recording plan 2026-09-28-0953,
M1a): `#recording-block` sits in step 4 BEFORE `#ar-root` - its switch
arms the recording before AR starts and Save is a page action, so neither
belongs over the camera. It is NOT `.creator-only` since M1b: `main.ts` shows
it only with `?debug=1`, for a creator (since polish round M3, Q-Data) and
a visitor (the viewer recording, contextTag `tour-viewing`). `#recording-marker` is
inside `#ar-root`, so the marker is composited over the camera for the
whole recorded session and shows on the page too; `ar-layout.spec.js`
measures the overlay with it visible.
The framework's AR canvas (window-sized, `#ar-root`'s first child after
`initAR`) is taken out of the flow (`#ar-root > canvas { position: fixed }`;
absolute, the RecorderApp's rule, left it at `#ar-root`'s offset and the
page 17 px wider than a phone's window, pinned by
`visitor-walk-layout.spec.js`): in the flow it pushed the whole panel a screen
height down, below the overlay's edge (seen on a phone;
`playwright-tests/ar-layout.spec.js` pins every panel control on screen at
360x640, 360x800 and 390x844). `#size-offer` is the panel's FIRST child,
above `#setup-status`.
The visitor's stations (tour kit plan K4): `#station-line` (the next
station and its distance, `aria-live`), `#station-skip` (first "Can't get
there?", then the labelled skip), the story panel `#scene-panel` and
`#scene-play-next` ("Play: <title>", a station waiting behind the story
playing) are inside `#ar-root`: the visitor stays in AR the whole tour
(K-D9). All start hidden; `station-guide.ts` and `scene-view.ts` show
them. `#relocate-note` ("Test mode: this tour was moved to where you
are.") shows only when the test switch `?relocate=here` moved the tour
(`tour-relocation.ts`).
The visitor's walk in AR (the prototype
`public/prototypes/visitor-walk-4-radar-and-list/`),
all inside `#ar-root`: `#station-line` is visually hidden since M2 (the
hidden copy the tests and a screen reader read; the sheet shows it in two
lines); `#walk-coach` (`walk-coach`, its `data-look` spinner, sway or
plain, and `walk-coach-text`); `#walk-toast-root` (`walk-toast-root`,
`aria-hidden="true"` since its words are announced already by
`#ar-status-live` or `#station-line`; the toast element `#walk-toast` is
created in it); `#walk-live` (`walk-live`, visually hidden, polite: the
welcome back, the one toast text no other region announces); and the sheet
`#walk-sheet` (`walk-sheet`, `data-sheet` peek or list, `data-complete`),
which owns the grab `walk-grab` (`aria-controls="walk-list"`, a 44 px
target from `::before` around its 5 px pill), the peek `walk-peek` (`walk-segments`,
`walk-peek-row`, `walk-eyebrow`, `walk-title`, `walk-distance`,
`walk-tail` (a span in `.walk-tail-row`, after `walk-tail-arrow`: the
being-there peek's arrow to the next station; the row hides while the tail
is empty), `walk-code-tail`, and `#station-skip` as its quick action),
the story card `walk-story` (`#scene-panel` and its parts, `walk-dots`,
`walk-story-acts` with `#scene-continue`, `story-end` (`#walk-story-end`)
and `keep-listening`; while the end is asked (`data-kind="end"`) `#scene-continue` is not shown, so the card offers only its two answers, M4; then `#scene-play-next`), and the list `walk-list`
(`walk-list-title`, `walk-chip` - "Any order" only, hidden for a fixed
order - `walk-close`, the completion card
`walk-done` with `walk-done-title` and `walk-done-text`, `walk-progress`,
the hint `walk-hint` (`#walk-hint`, hidden unless no station is guessed,
M4), `walk-rows` whose rows carry `walk-row`, `data-state`, `data-id`,
`data-chosen`, the title button `walk-row-main` with a `walk-row-sub`, the
action `walk-row-act` (`data-k` skip, bring or undo), the confirm
`walk-row-confirm` with `walk-row-cancel` and the undo's bar
`walk-undobar`; the completion card has no button of its own: the X
`#enter-ar` is the one way out). While the list
is open the quick action `#station-skip` is not shown (the prototype: the rows
carry its actions), except "Finish the tour" (`data-kind="finish"`) while
the tour waits on its last station: no row carries it. In AR a visitor's
`#enter-ar` is the prototype's round Exit button at the top left and `#ar-status`
is visually hidden (kept for `data-state` and `?debug=1`). The scan
card's found look is `#scan-card[data-look="found"]` (a check in its
animation's place). On the start page, `#walk-away` (`walk-away`,
`walk-away-text`, `walk-away-segments`, `walk-away-rows` with
`walk-away-row` items) shows the progress after leaving AR, its
segments in the prototype's paper colours (`--walk-away-found` #0f766e,
`--walk-away-left` #ddd6c7, also its rows' border, on rows of
`--walk-away-row` #fff). The walk's
colours are `--walk-*` tokens on `html`; design.css's `.radar`,
`.toast` and `.hint` classes are not used (plan §1.2). The walk's
surfaces set `font-variant-numeric: lining-nums`, since the app font's
old-style numerals shrink a row's number and a distance next to the prototype's;
`.walk-distance` sets `lining-nums tabular-nums` together, since its own
value replaces the inherited one.
`#ar-debug` (a `<pre>` in `#ar-root`, hidden unless `?debug=1`) holds the
QR readout (QR near-frontal pose plan §66).
Renaming one is an e2e-breaking change. `#ar-hint`, `#ar-status`,
`#ar-debug`, `#enter-ar` and `#setup-panel` must stay children of `#ar-root` (WebXR
DOM overlay composites only that subtree; enforced by
`tests/repo-config/hud-overlay-nesting.test.js`). The `#ar-hint` copy is
the creator's; `visitor-screen.ts` re-words it for a visitor.

## Invariants & assumptions

- **The first paint has its mode** (tour editor plan 2026-10-17-1816, W1):
  `<script id="first-paint-mode">`, a classic inline script and the
  body's FIRST child, sets `body[data-mode]` before anything is painted.
  The paper, the hidden header and the closed steps are keyed on it, and
  `main.ts` sets it only after its imports - the owner saw the design
  system's dark default, the header and step 5's empty card until then.
  Its rule is a copy of `viewerModeFromSearch` (`src/mode.ts`): a classic
  script cannot import a module, so `mode.test.ts` runs the script's text
  against the function (fixed cases and a property). `main.ts` still
  writes the same value.
- **Step 4 must never be collapsed while an AR session runs.** Its content
  is `#ar-root`, the DOM-overlay root, and a collapsed `<details>` renders
  nothing - so a collapse mid-session blanks the overlay, on a phone,
  where no test can see it. Two halves hold it: this file hides the
  summary under `body[data-ar-active="true"]` (which also removes it from
  the tab order and the accessibility tree, so neither a tap nor Enter can
  reach it), and `wizard.ts` refuses to assign `open = false` on it. The
  CSS alone is NOT enough - `open` is assigned from script in several
  places, and a `Ctrl+P` used to reach one of them.
- **`#step-measure` is `overflow: visible`**, deliberately and against the
  shared `.step` atom, which clips. Whether the overlay root's top-layer
  promotion escapes an ancestor's clip is not something any test here can
  answer.
- `#error` carries `role="alert"` — failures must be announced, not just
  colored.
- `#stats` starts `hidden` and is revealed by the first stats render; the
  `[hidden]{display:none}` rule keeps the attribute authoritative over the
  grid/flex display values.
- `#finish-block` is authored `hidden` and is NOT `.creator-only`: the
  class would un-hide it on a creator's load, and it must appear only once
  a finish has produced a zip.
- `#author-size`'s `value` attribute must equal `AUTHOR_DEFAULT_SIZE_M`,
  which `creator-setup.ts` writes into the field on every load. A
  differing attribute is dead text that reads like a decision
  (`src/printed-size-default.test.ts`).
- The gallery is a `<ul>` of `<li><img><figcaption>` items appended in
  archive order as bytes arrive.
- **The creator's AR chip row fits any width from 320 px, in any face.**
  "Place a pin" and "Take a photo" shrink with `.setup-place-row` (`flex: 0 1
auto`) and their labels wrap inside the chip; up to 380 px the chips take a
  tighter padding and gap; the row is `justify-content: safe center`, so a
  row that still outgrew the screen would start at its left edge instead of
  spilling off both. Windows renders the UI stack in Corbel, a narrow face,
  so it fit locally while a Linux browser's wider fallback pushed the row
  4 px off a 360 px screen (24 px at 320). `ar-layout.spec.js` checks the
  H1 HUD in a forced wide face at 412, 360, 320 and 915 px, both edges of
  the row included, and the Undo chip (its own line above "New station
  here", a long label ending in an ellipsis) at 390 and 320 px.

## Tests

Driven by `playwright-tests/*.spec.js`; `way-in.spec.js` holds the
module back and checks the first paint (paper, no header, no empty step)
for a creator and a visitor; the no-console-errors smoke boots
exactly this page. `src/printed-size-default.test.ts` reads this file for
the size default.

## The radar and the precision chip

- `#walk-radar-wrap` (hidden until the walk shows; `data-mode` live or
  frozen; `data-range` the tap's step; `data-heading` none, provisional
  or confirmed) holds `#walk-radar` (a button, "Stations around you, range
  automatic - tap to change the range", the range in its name rewritten
  on each step by `walk-radar.ts`: a tap steps the range, the list opens
  from the sheet only) with `#walk-radar-canvas`, `#walk-range` (the range
  label, `aria-live="polite"`, shown for 2 s after a tap, the chip's
  pill: one rule for both), and `#walk-precision` (`data-kind`) with its
  mark and `#walk-precision-text`.
- Place: fixed at the top right, 30 px from the top and 12 px from the
  right, 132 px; a phone held sideways 108 px, 10 px from the top. The
  range label (after a tap) and the chip under the radar, 6 px apart, right-aligned, at most the radar plus
  36 px wide. Frozen: the canvas grayscale(1) brightness(.85).
- Tokens: `--walk-gps: #93c5fd`, `--walk-weak: #fbbf24`, `--walk-radar`
  (app-local, plan §6 Q2; `walk-radar.test.ts` holds the canvas to them,
  and every `rgb()` tint of the walk CSS to a `--walk-*` colour or a
  neutral: the stylesheet validator refuses `color-mix()`).
- The direction arrows: `#walk-distance-arrow` and `#walk-distance-text`
  inside `#walk-distance`; `.walk-arrow` 15 px (13 px in a row), hidden
  without `data-deg`; reduced motion stops the chip's pending pulse and
  the arrows' turn transition.
- Pinned by `playwright-tests/visitor-walk-layout.spec.js`.

## Reduced motion

- One `@media (prefers-reduced-motion: reduce)` block stills every
  animation of the walk: the coach's spinner and sway, the timed story
  dot, the chip's pending pulse and the toast; the undo bar is hidden
  (a still bar would show a share of time that is no longer true; the
  row's undo button stays while the undo can be made). Each animated rule
  is named there by its OWN selector: a shorter one loses to the
  animated rule's specificity, which is how the spinner and the toast
  once kept moving. `walk-sheet.test.ts` holds the animated rules and the
  stilled ones together (`animation` and `animation-name` alike), and
  `visitor-walk-layout.spec.js` asserts that no walk element runs an
  animation under the emulated preference.

## The focus's edge pill

- `#walk-edge-pill` (hidden until it shows; `data-side` left or right;
  `aria-hidden="true"`: the peek says the same, and a pill coming and
  going with each turn would be read out each time) holds the chevron
  `svg` with its path `#walk-edge-pill-arrow` (redrawn per side by
  `walk-edge-pill.ts`) and `#walk-edge-pill-text`. Inside `#ar-root`
  (`hud-overlay-nesting.test.js`).
- Place (the prototype's): fixed, its top at 42 % of the height, 8 px from
  the edge on its side (the safe-area inset added), at most 44 vw, the
  chevron first on the left and last on the right (`row-reverse`), 6 px
  apart; a phone held sideways puts the left pill at 50 vw + 10 px, right
  of the sheet's card. `pointer-events: none`, z-index 14 (under the
  radar's 20).
- Look: the prototype's background `rgb(10 14 19 / 72%)`, a 1 px border
  of the walk's accent at 70 %, the chevron in `--walk-accent`, 13 px
  semibold text cut with an ellipsis.
- Pinned by `playwright-tests/visitor-walk-layout.spec.js`.
