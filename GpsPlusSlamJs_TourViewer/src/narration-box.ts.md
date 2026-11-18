# narration-box.ts

## Purpose

The narration box: how a visitor follows a narrated long text in the AR
view without looking away from the place. A box at the bottom edge shows
at most three lines of the text, the words already spoken white and the
rest grey, with a thin scrollbar on the right. Scrolling the words is
scrubbing the voice; a tap pauses or plays. Its specification is the calm
HUD's scroll box prototype
(`public/prototypes/hud-calm-r5-1-scroll-box/`); the arithmetic is in
`narration-box-timeline.ts`, the shared playback state in
`narration-box-slice.ts`, and `captions-follow.ts` decides when it shows
and what.

## Public API

- `createNarrationBox({ host, store, now? }): NarrationBox`
  - `host` - where the box and its tap signs are appended.
  - `store` - anything with `dispatch` (the page's AR store).
  - `now` - the page's time in ms, `performance.now` by default (tests
    pass a fake to step the follow's smoothing).
- `NarrationBox`
  - `element` - the box (`section.narration-box`,
    `data-testid="narration-box"`, focusable).
  - `slots.left`, `slots.right` - the side places for a story step's
    action and a quiz; empty and hidden for now.
  - `show(content)` - shows `content`. Cheap for the same content, so the
    frame loop may call it every frame; a new `key`, text, timing,
    speaker, title, synthetic flag or voice credit rebuilds the words, the
    disclosure and the label.
  - `hide()` - fades out, inert, out of reach of taps.
  - `tick()` - follows the voice; `show` calls it, and so does every
    frame.
  - `state()` - what a test or the check page reads: shown, key, lit word
    and its text, lines, rows, scroll (in lines), scrubbing.
  - `dispose()` - removes the box and its signs and tells the store it is
    hidden.
- `NarrationBoxContent` - `key`, `title`, `speaker { name, color }`,
  `plain` (the text the timing's offsets are into), `timing` (its
  segments), `player` (a `NarrationClock`), `synthetic`, and an optional
  `voiceCredit`.

## Invariants & assumptions

- The voice is the clock. The box reads `player.nowMs()` every frame and
  never keeps its own time; while a finger drags, the dragged place is
  shown instead and becomes the voice's on release.
- Store dispatch policy: `narrationBoxShown` on a new text or a new
  showing, `narrationBoxPlaying` when the play state changes,
  `narrationBoxScrubbing` at a drag's start and end, `narrationBoxHidden`
  on hide and dispose. Never per word or per frame: each dispatch runs the
  AR store's subscribers. A drag holds the voice for the finger only and
  does not count as a pause.
- The width rule (the prototype's): the box is at most 80 % of the window
  (`BOX_SHARE`) and never wider than 720 px (`BOX_CAP_PX`). The text
  column is the text's natural one-line width plus 2 px, at least 90 px
  (`TEXT_MIN_PX`), at most the box less its chrome (`BOX_CHROME_PX`
  38 px: padding 14 + 10, border 2, scrollbar room 12) and the right
  slot. A text longer than three lines therefore fills the box's maximum.
- Lines come from where the browser put the words (`offsetTop`), counted
  from the speaker's name, which opens line 0. Rows are at most three;
  the spoken line sits in the middle row (`BOX_FOLLOW_ROW`), clamped to
  the text, eased at the prototype's rate (9 per second), at once with
  reduced motion. Until the voice passes the first words' line, the box
  keeps the name and its disclosure in view as far as the rows allow,
  even when a long credit puts the first words two lines down.
- Tap against drag: a press that moves at most 8 px (`BOX_TAP_SLOP_PX`)
  is a tap. A tap toggles play and pause and puts a play or pause sign at
  the finger (0.75 s, removed after 1.5 s at the latest). A tap on a
  voice at its end starts it again from the start.
- A drag: one line height of finger movement is one line of text and
  one line of the voice, up ahead, down back; past either end the words
  stretch 0.3 as far at first (the rubber band). The read line (the lit
  word's, or the first word's before any is lit) never leaves the window
  (`dragScroll`): past an end the stretch flattens out before it would,
  and in the text the words wait at the edge it would leave by, then move
  on with the finger from there (the press's start scroll moves with
  them), so they never jump. So the release always goes on from a line
  in view; a drag far past an end once carried the read line out of the
  window, and the voice then read words nobody could see. A playing voice is held for the
  drag with `player.hold()` when it has one (`voice-focus.ts`: it stays
  the channel's running voice, so a voice it holds does not wake), else
  `pause()`. A voice that was not playing is left alone, so a voice the
  channel holds stays held to carry on. On release the voice goes on from
  the dragged place, or, dragged past its end, is paused for good (its
  channel handed back).
- A voice carried on while the finger is down (the voice channel when a
  clip it held behind ends, or the page's sound gate at a return) is held
  again on the next frame and counts as one the drag holds: the release
  lets it go on from the dragged place.
- A press ends on `pointerup`, `pointercancel` or `lostpointercapture`
  (the system taking the capture: a notification, the browser taking the
  gesture). Only `pointerup` can be a tap; the other two end a drag as a
  release does, so the box never stays dragging with the voice held for a
  gone finger.
- A drag cut off by `hide()`, a new text or `dispose()` never plays the
  voice again: the place is kept, and a voice the drag held is paused
  properly, its channel handed back (a voice waiting behind it carries
  on), as after a drag let go past the end. A drag that ends while the
  page is hidden (a cancelled pointer) does not play on: the voice stays
  held, the channel's voice, for the page's sound gate.
- A hidden page is not the box's to silence: the page's sound gate
  (`sound-setting.ts`) pauses every voice and carries the held one on at
  the return. Should that happen with a finger still on the words, the
  next frame holds the voice again until the finger lets go.
- Keyboard: the box is focusable; Space or Enter plays or pauses (the
  sign at the box's middle), the up and down arrows move the voice one
  line. The `aria-label` names the speaker, the title, a synthetic voice,
  and these gestures and keys; a polite live region says "Playing" or
  "Paused" when the play state changes (not on the first showing).
- Play state on screen: `data-speaking="yes"` while the voice plays and
  no finger holds it (and "no" once hidden); the name in the words
  breathes then (2.4 s), the hidden measuring copy never. With reduced motion
  nothing breathes, and a paused voice's name is dimmed instead. Reduced
  motion also drops the word fades, the box's fade and the swap; reduced
  transparency or more contrast raise the tint and the grey.
- Intended differences from the prototype:
  - the speaker's name is not a line of its own and has no coloured
    mark: it starts the words, bold, in the speaker's colour, once per
    text;
  - a synthetic voice and the voice's credit are said visibly after the
    name, small and in the muted grey (" · synthetic voice · <credit>"),
    because some voice services require a visible disclosure; with
    neither, nothing is shown. Its line height of 1 keeps the first lines
    on the 22 px grid the scroll moves by, and a credit long enough to
    take lines of its own still counts them.
- Defensive: an empty text shows one empty line and still scrubs; a
  non-finite line height falls back to 22 px; a pointer capture that
  fails is ignored; `tick` is guarded against re-entry (a dispatch that
  runs a subscriber that ticks the frame again).

## Examples

```ts
const box = createNarrationBox({ host: arRoot, store: arStore });
box.show({
  key: block.id,
  title: block.title,
  speaker: { name: "Narrator", color: "#f9a8d4" },
  plain,
  timing,
  player,
  synthetic: true,
  voiceCredit: "Read by the archive",
});
// every frame:
box.tick();
// leaving the station:
box.hide();
```

## Tests

- `narration-box.test.ts` (jsdom, with word tops stubbed to four words a
  line): the name once at the start, the disclosure after it, words lit
  and greyed, the follow row, tap toggle with its sign, the restart at
  the end, a drag that scrubs and plays on, a paused voice left paused,
  the rubber band and its limit, the read line kept in view on a slow
  drag back from the end without a jump, a drag cut off by hide or a new
  text not replaying,
  the voice channel kept through a drag (with `createVoiceFocus` and two
  focused players, both a voice it holds and a held text voice), the
  keyboard, the live region and `data-speaking`, a hidden page left to
  the page, the store told only on a change, hide and a new text, taps
  kept from the AR scene, an empty text, dispose; the store and the live
  region quiet during a scrub; the channel handed back with a focused
  voice behind when a drag is cut off (hide, new text, dispose) or ends
  past the end; the voice held again while the finger is down; the
  opening scroll when the name and disclosure take lines of their own;
  no playing on from a drag ended in a hidden page; a voice the channel
  carries on mid-drag held and played on from the dragged place; the
  disclosure and label redrawn when only the credit, synthetic flag or
  title changes; a drag ended by a lost pointer capture, which is no tap.
- `narration-box-timeline.test.ts` and
  `narration-box-timeline.property.test.ts` - the arithmetic, with
  properties.
- `playwright-tests/narration-check.spec.js` - the layout at three
  viewports against the prototype's numbers, the name and disclosure on
  the first line (the disclosure's first line right after the name), the
  thumb, every word on the 22 px line grid, the line count against the
  drawn lines, the opening scroll at the voice's start, the lit word
  following the voice, and no box for a stale track.
