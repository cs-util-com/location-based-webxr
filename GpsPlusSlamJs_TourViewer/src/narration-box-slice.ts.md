# narration-box-slice.ts

## Purpose

The narration box's playback in the page's store: which narrated text
the bottom box shows, whether its voice plays, whether a finger holds it
by scrubbing, and where it is (the lit word and its line). The box
(`narration-box.ts`) writes it; any view that needs to know whether a
voice is heard (the compass's speaking sign, the story step and quiz that
will share the bottom area) reads it here rather than from the box.

## Public API

- `narrationBoxReducer` - mounted as `narrationBox` by
  `createTourViewerStore`.
- `narrationBoxShown(key)` - the box shows the text `key`. The same key
  again keeps the place; another key starts at the beginning.
- `narrationBoxHidden()` - back to the initial state.
- `narrationBoxFollowed({ playing, word, line })` - where the voice is.
  Ignored while hidden, and for a place that is not an integer (`word`
  from -1, `line` from 0), so a NaN from a voice still loading never
  reaches a reader.
- `narrationBoxScrubbing(on)` - a finger started or ended a drag.
- `selectNarrationBox(state)` - the whole state.
- `selectNarrationSpeaking(state)` - a shown text plays and is not held
  by a scrub.

## Invariants & assumptions

- The audio element stays the clock (`narration-player.ts`); this is the
  view of it the page shares. The box dispatches only on a change of
  these values (a few times a second while a voice plays), never per
  frame.
- Not recorded: no `narrationBox/*` prefix is persisted.
- Hidden means initial: `key` null, not playing, word -1, line 0.

## Examples

```ts
store.dispatch(narrationBoxShown("block-1"));
store.dispatch(narrationBoxFollowed({ playing: true, word: 12, line: 2 }));
selectNarrationSpeaking(store.getState()); // true
```

## Tests

- `narration-box-slice.test.ts`: the initial state, speaking against
  scrubbing, a new text against a re-show, hidden forgets everything (a
  property over any history), bad places refused, mounted in the page's
  store. The box's own test checks what it dispatches.
