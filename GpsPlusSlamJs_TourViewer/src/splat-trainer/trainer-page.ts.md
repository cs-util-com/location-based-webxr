# trainer-page.ts

## Purpose

The splat trainer page's view, in the "darkroom" look chosen among the
prototypes (`public/prototypes/splat-trainer-r1-c-darkroom/`): a contact
sheet with one print per stretch that develops while it trains, a quiet
bar at the bottom, and dialogs for stopping, saving and a closer look. It
renders from the store and dispatches what the person does; the only
thing it keeps itself is which dialog is open.

## Public API

- `mountSplatTrainerPage(root, controller, env) -> { dispose }`
  - `controller`: `PageController` - the store (`getState`, `dispatch`,
    `subscribe`), `sides.previews`, `chooseRecording`, `save`;
    `createTrainerPageStore` provides it.
  - `env`: `{ win, isPhone }`; on a phone the page refuses at once.
- Pure text helpers, exported for tests: `minutesText`, `barText`,
  `loupeWord`. The rest (`censusLeadHtml`, `sayFor`, `actionsFor`,
  `saveContentsLine`, `stopDialogText`, `showable`, `liveText` and
  `liveNextText`: a training print's stage line, "Loading the trainer",
  "Preparing the graphics card", "Training N %" or "Checking the result",
  and its "about 3 min left, a new look about every 15 s", each part when known) stay module-private
  and are tested through the mounted page.
- A not-good-enough print offers "Train again with more time" only when
  `canTrainAgain` allows it: a failure whose judgement says `retryHelps:
false` offers only "Save anyway, marked" and "Discard", and its caption
  says why it failed.

## States it shows

Start (drop or choose), reading (the choose button busy and a
determinate bar of entries read, with the percent in words, from the
first frame after the pick), census (sentences, the built-in graphics
warning), training (developing prints, each with its own stage, percent,
time left and newest look; the strip; the bar saying "Loading the
trainer...", "Preparing the graphics card...", "Checking the result..."
or the time left), a practice run (every print says "Practice: a drawing,
not a splat"), the stop dialog, stopped (continue, save the finished ones),
done (verdicts with reasons and actions, save), the save dialog (contents,
the location privacy note, saving, failure), the closer look, and the
refusals (phone, no WebGPU, a recording without depth by the reader's
`no-depth` code, any other recording that cannot be used).

## Invariants

- **Focus survives re-renders.** Action buttons are rebuilt only when
  their list changes; when the focus was inside the rebuilt list it moves
  to the new first button (or the print's frame), never to the body.
- **The stop dialog is live and bound.** Its text re-renders from the
  state on every change; Stop dispatches `stopConfirmed` with the id the
  dialog was opened for, and a stretch that finishes under the open dialog
  holds the next start, so Stop never stops another stretch.
- **The closer look never shows a stretch that has not started.** Clicks
  on a waiting print do nothing, Previous and Next skip waiting stretches,
  and a stretch queued to train again reads "Waiting", never "Still
  training".
- **Dialogs keep the keyboard in and give it back.** While a dialog is
  open the page behind it is `inert`; when it closes (by any path,
  including closing itself because its stretch is gone) the focus returns
  to where it was, or, when that element is gone or hidden, to the
  phase's main action (Stop, Continue, Save, Show, Make the splat, Choose,
  the refusal button, else the heading). A phase change that hides the
  focused button moves the focus the same way.
- **A running save cannot be closed or restarted.** Cancel is disabled,
  Escape and clicks on the veil are ignored, and the bar's Save does
  nothing while it saves. A failed save says what became of the picked
  file (`save.left`) instead of claiming nothing was lost.
- **Check again shows its work.** The button reads "Checking...",
  disabled and `aria-busy`, while the probe runs; the warning stays; a
  probe that finds built-in graphics again says "Still the built-in
  graphics."
- The stopped bar counts in the singular for one stretch and names a save
  made while stopped. `minutesText` says nothing for a time that is not a
  finite, non-negative number.
- The hand-drawn ring is seeded with the framework's `mulberry32`.
- The page root gets the class `splat-page` while mounted; the stylesheet
  is scoped under it (`trainer-page.css.md`).
- All dynamic text goes in through `textContent` or `escapeHtml`.
- The save click asks for the save dialog before any await (browsers
  require the click's user activation).
- The phone and no-WebGPU refusals copy the page's link with
  `copyWithFeedback`.

## Tests

`trainer-page.test.ts` (jsdom): the practice chip and start button, the
GPU trainer's start button without the chip, the read bar and busy
button from the first frame to the census or the refusal, each print's
stage, percent and time left, a failed start ended in words, the
practice note on every print, the phone refusal, focus after a decision and across
a progress tick, the stop dialog's live text and target, Keep training
starting the held stretch, the closer look skipping waiting stretches, and
the bar texts, refusals by code, the save lock and its failure text,
`inert` and focus return, focus across a phase change, Check again, and
the root class. `trainer-page-css.test.ts` checks that every outer rule
of the stylesheet names `.splat-page` and every animation name is
prefixed. The e2e `playwright-tests/splat-trainer.spec.js` runs the
page in a browser, including its layout.
