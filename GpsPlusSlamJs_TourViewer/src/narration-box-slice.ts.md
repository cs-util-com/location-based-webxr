# narration-box-slice.ts

## Purpose

The narration box's playback in the page's store: which narrated text
the bottom box shows, whether its voice plays, and whether a finger holds
it by scrubbing. The box (`narration-box.ts`) writes it. It is the place
the views planned beside the box (the story's next step and a quiz in the
same bottom area) will read whether a narration is heard; no other view
reads it yet.

## Public API

- `narrationBoxReducer` - mounted as `narrationBox` by
  `createTourViewerStore`.
- `narrationBoxShown(key)` - the box shows the text `key`. The same key
  again keeps the state; another key starts silent.
- `narrationBoxHidden()` - back to the initial state.
- `narrationBoxPlaying(on)` - the shown text's voice plays or not.
  Ignored while hidden.
- `narrationBoxScrubbing(on)` - a finger started or ended a drag.
  Ignored while hidden.
- `selectNarrationBox(state)` - the whole state.
- `selectNarrationSpeaking(state)` - a shown text plays and is not held
  by a scrub.

## Invariants & assumptions

- The audio element stays the clock (`narration-player.ts`); this is the
  view of it the page shares. The box dispatches only when a value
  changes: a new text or showing, a tap, a drag's start and end, the
  voice's end. Never per word or per frame: every dispatch runs the AR
  store's subscribers.
- Where the voice is (the lit word, its line) is deliberately not here:
  nothing reads it yet, and it changes several times a second. It joins
  the slice with its first reader.
- Not recorded: no `narrationBox/*` prefix is persisted.
- Hidden means initial: `key` null, not playing, not scrubbing.

## Examples

```ts
store.dispatch(narrationBoxShown("block-1"));
store.dispatch(narrationBoxPlaying(true));
selectNarrationSpeaking(store.getState()); // true
```

## Tests

- `narration-box-slice.test.ts`: the initial state, speaking against
  scrubbing, a new text against a re-show, hidden forgets everything (a
  property over any history), nothing changes while hidden, mounted in
  the page's store. The box's own test checks what it dispatches and how
  often.
