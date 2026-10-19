# have-tour.ts

## Purpose

The behaviour of the creator page's "You already have a tour?" box on a
phone (tour editor plan 2026-10-17-1816, W1; the question is plan
2026-10-15-0348's round 2): open a tour from this device or from its link,
through the page's one open path, then ask "Play it, or continue setting it
up?". The computer half of the box (a link to `edit.html` and one line) is
plain markup in `index.html` and has no behaviour here.

## Public API

- `wireHaveTour(deps: HaveTourDeps): void` - labels the two buttons and
  wires them, the link form and "Continue setting it up".
- `HaveTourDeps`
  - `dom: HaveTourDom` - structural stand-ins for the box's elements
    (`fileButton`, `fileInput`, `form`, `linkInput`, `linkButton`,
    `status`, `ask`, `askText`, `play`, `continueButton`), so the unit
    test needs no DOM.
  - `openFile(file)` / `openLink(url)` - the page's open path
    (`ArchiveOpen.openFile` / `ArchiveOpen.openLink` in `archive-open.ts`),
    each resolving an `OpenOutcome` (`scan-open.ts`).
  - `playHref(url)` - the visitor's page for a link (`main.ts` passes
    `wizard.ts`'s `visitorLaunchHref`, which keeps `?debug=1`).
  - `errorText()` - the open's own error sentence (the page's error box,
    `describeOpenError`), shown for a failed open.
  - `continueSetup()` - back to the step card (`main.ts` scrolls
    `#setup-card` into view; the open already moved the steps on).
- `HAVE_TOUR_LABELS` (`file`, `link`, `busy`), `PLAY_OR_CONTINUE`,
  `FILE_OPENED_ASK`, `HAVE_TOUR_CORS_TEXT`, `HAVE_TOUR_FAILED_TEXT` - the
  box's words, exported for the tests.
- `editorPitch(win)` (PR #637 review) - the computer's line about the
  editor (`#have-tour-editor-text`, set by `main.ts`), true for this
  browser: "save it back into the tour file" where `showOpenFilePicker`
  exists, else "save a new copy of the tour file to put in place of the old
  one". Both fixed wordings were wrong somewhere (the line said "back into"
  everywhere; the review asked for "a new copy" everywhere). The test is
  `file-picker.ts`'s `hasFilePicker`, shared with `editor/save-target.ts`'s
  `saveFinePrint` from outside `editor/`: the setup page may not import
  the editor's modules (`viewer-not-to-editor`, which keeps Leaflet off the
  visitor's page; M4a review #8 removed the second copy).
- **"Continue setting it up" lands where the creator got to**: the link
  open goes through the page's open path, whose `presentTourForPrint`
  (the wizard's `presentTour`) opens the step
  remembered for that link (`wizard.ts`, "the remembered step (M6)" in
  `wizard.test.ts`), and the print step only for a link never set up on
  this device.

## Invariants & assumptions

- **One open path.** The box never opens a tour itself: a link goes through
  `ArchiveOpen.openLink` (once opened, the link of record and step 2's
  "found" line; a link that did not open is never handed on to printing,
  PR #637 review), a file through the file open (its content key, its
  `presentLocalTour`). What the steps show after an open from the box is
  what they show after an open from the steps.
- **Async-UI rule.** Both buttons are disabled and read "Opening…" from the
  click until the open settles, and come back on every outcome, including
  an open that throws. `#have-tour-status` (a live region) says "Opening
  <name>…" or "Opening the tour…" meanwhile.
- **What each outcome shows:**
  - opened from a link - the question, with "Play it" pointing at the
    visitor's page for that link;
  - opened from a file - `FILE_OPENED_ASK`, without "Play it": the mode is
    read once at boot from `?qr=`, and a visitor's page opens a tour by its
    link, so a file has nothing to play from (an open question in the W1
    report: host it first, or a later hand-off of the file);
  - failed - in the open's own words (the error box), never step 2's
    printing messages, which answer a question the box never asked (M1
    review #3). A link refused by a host that blocks browsers gets
    `HAVE_TOUR_CORS_TEXT` (`open-errors.ts` `HOST_REFUSED_TEXT`, then the
    way around: download the file and open it with "From this device");
    an empty error box falls back to the cause's own sentence
    (`describeOpenCause`), then `HAVE_TOUR_FAILED_TEXT`.
    `#have-tour-status` keeps the sentences' line breaks (`pre-line`);
  - cancelled - the creator kept a tour with an unsaved rebuilt file, and
    the status says so;
  - superseded - nothing; the newer open speaks.
- A new open hides the last question until it settles. The picker's value
  is cleared on every pick, so the same file can be picked again after a
  failure; a closed picker opens nothing; an empty link does nothing.
- **Which half shows is CSS, not code** (`index.html`): the page's AR check
  writes `#enter-ar[data-ar-state]` (`ar-entry.ts`); `unsupported` (a
  computer, or a phone without AR) shows the editor half, any settled state
  other than `unsupported` shows this phone half, and `checking` shows
  neither. The whole box is `.creator-only`: a visitor never sees it.

## Examples

```ts
wireHaveTour({
  dom: {
    fileButton,
    fileInput,
    form,
    linkInput,
    linkButton,
    status,
    ask,
    askText,
    play,
    continueButton,
  },
  openFile: (file) => archive.openFile(file),
  openLink: (url) => archive.openLink(url),
  playHref: (url) => visitorLaunchHref(url, ctx.debug),
  errorText: () => errorBox.textContent ?? "",
  continueSetup: () => setupCard.scrollIntoView({ block: "start" }),
});
```

## Tests

- `have-tour.test.ts` - over stand-ins: the labels, the busy state on both
  outcomes and on a throw, the link's question and play link, the file's
  question without play, a failed link and a failed file, a cancelled
  open, an empty link, a closed picker, "Continue setting it up", and a
  new open hiding the last question.
- `playwright-tests/way-in.spec.js` - in a real page: a computer gets the
  editor half below the map and the steps; a phone with AR (the fakes)
  opens a link, gets the question, continues to the steps or plays the
  visitor's page; opens a file and gets no "Play it"; a link from a host
  that blocks browsers says why and gives the buttons back.
