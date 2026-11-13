# story-preview.ts

## Purpose

A story's preview in the editor: the story played, from its first step,
by the visitor's own story panel (`../scene-view.ts`) and player
(`../scene-player.ts`) in a dialog over the editor, so what the creator
sees is what a visitor who found its station meets - its words, pictures,
videos and sounds, its choices and their jumps, its timers and its end.

## Public API

- `createStoryPreview({ doc, tour, loadAsset, audio?, schedule? })` ->
  `StoryPreview`. Appends the dialog (`#story-preview`, `role="dialog"`,
  `aria-modal`, labelled by its title "Preview: <story title>") to
  `doc.body`, hidden.
  - `tour()`: the open tour as it is now (unsaved edits included), null
    with none; read on each open and for each asset.
  - `loadAsset(path)`: a content entry of the open tour.
  - `audio`: the sound channel (default: `createSceneAudio` over one
    `<audio>`); `unlock` is called inside the press that opens it.
  - `schedule`: a one-shot clock (default `setTimeout`).
- `open(storyId, opener?)` -> null once it plays, else why not:
  `PREVIEW_NO_STORY` (no tour, or no such story), `PREVIEW_NO_STEPS`.
  The focus goes to its Close; `opener` gets it back on close.
- `close()`, `isOpen()`.
- `PREVIEW_QUIZ_NOTE`: the line under a story that holds a quiz.

The dialog's controls: "Play again" (`data-spv="again"`, from the first
step), "Close" (`data-spv="close"`), the panel's Continue
(`data-spv="continue"`), the answers as buttons; Escape closes it and
goes no further (the page's Escape would drop the editor's selection).
"The story has ended." shows at the end, the focus on Play again.

## Invariants and assumptions

- Only the story is offered: its station stands in holding that story
  alone, so the visitor's panel shows no picker and plays it from its
  first step, under the station's name, description and picture.
- What stands in the visitor's world (a character's figure) has no world
  here: a line under the panel names it ("In the visitor's world: <name>
  stands at the station."). A block with a world view (a pin, a placed
  model) shows its words in the panel, as for the visitor.
- The visitor's player goes past a quiz today (`isPlayableInK4`), so the
  preview does too and says so (`PREVIEW_QUIZ_NOTE`) under a story that
  holds one.
- Pictures pass the same pixel cap as the visitor's (`pictureProblem`).
- On a phone (700 px or less, or 500 px high or less) the dialog takes
  the whole screen (`editor-shell.css`).

## Examples

```ts
const preview = createStoryPreview({
  doc: document,
  tour: () => manifestToWrite(store.getState().tourDocument),
  loadAsset: readContent,
});
const refused = preview.open("legend", button);
if (refused !== null) toast(refused);
```

## Tests

`story-preview.test.ts` (jsdom, the real scene view, a silent audio
fake): a story's first step, Continue, the choice's answers, a jump back
and an end, Play again and Close with the focus back on the opener; Escape
closed without the page seeing it; a story with no steps, a gone one and
no tour refused in words; the quiz line only for a story with a quiz.
`playwright-tests/editor3d-story-cards.spec.js` builds a branching story
in the editor at 1280x800 and 390x844 and plays it here.
