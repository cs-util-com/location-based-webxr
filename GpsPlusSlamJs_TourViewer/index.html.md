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
  D-P1): on the creator page an intro (`#setup-intro`: the opening, the
  "why" list - four reasons two per row ("No sign-up, no account" in place
  of the privacy line since 2026-10-12: the Drive relay passes tours through
  the site worker, so "no servers of ours" was not true), as in the
  L5 prototype, with the gaps set in the page's own CSS because the design
  system zeroes paragraph and list margins (r820 feedback R1;
  `setup-flow.spec.js` pins rows and gaps at three viewports) - and
  "Follow the route", beside the prototype's phone (`.setup-intro-art`),
  whose dotted route, pin, label and photo run the prototype's 7 s loop
  (`intro-dots`, `intro-pin`, `intro-label`, `intro-photo`; none under
  reduced motion, the whole picture shown; `setup-flow.spec.js` pins the
  computed animation names)), then the stage
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
  legal notice and the privacy page (`legal.html#notice`,
  `legal.html#privacy`; `legal.html.md`). The intro's "Runs offline once
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

## Public API

The `data-testid` contract the e2e suite drives: `wizard`, `step-host`
(owns `host-tiles`, `host-steps`, `host-continue`), `setup-intro` (owns
`setup-begin`), `setup-stage`, `setup-map` (owns `setup-map-svg` and the
drawn `map-station-<step>`), `setup-card` (owns `setup-badge`, `setup-of`,
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
or branching order - `walk-close`, the completion card
`walk-done` with `walk-done-title` and `walk-done-text`, `walk-progress`,
the hint `walk-hint` (`#walk-hint`, hidden unless no station is guessed,
M4), `walk-rows` whose rows carry `walk-row`, `data-state`, `data-id`,
`data-chosen`, the title button `walk-row-main` with a `walk-row-sub`, the
action `walk-row-act` (`data-k` skip, bring or undo), the confirm
`walk-row-confirm` with `walk-row-cancel` and the undo's bar
`walk-undobar`; the completion card has no button of its own: the X
`#enter-ar` is the one way out). While the list
is open the quick action `#station-skip` is not shown (the prototype: the rows
carry its actions). In AR a visitor's
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
  or confirmed) holds `#walk-radar` (a button, "Stations around you - tap
  to change the range": a tap steps the range, the list opens from the
  sheet only) with `#walk-radar-canvas`, `#walk-range` (the range
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
