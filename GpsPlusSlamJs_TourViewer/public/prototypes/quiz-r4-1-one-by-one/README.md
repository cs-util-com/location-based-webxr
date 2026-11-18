# Quiz 4.1 - One by one

Throwaway UX prototype. It is not wired to the app and nothing in the app links to it.

## The direction

A character asks a question in the narration box. When the question ends, the box folds to one line (a pill with the question) and the answers fly out of it **one at a time**, each along a high arc to the thing it names. Each lands with a ring pulse and a short column of sparks rising a few metres from the ground, then settles as a small beacon at chest height in front of its thing.

An answer whose place is out of view does not fly blind: the pill says "Turn left - the plane tree lands there" and one large cue shows at that screen edge. The answer flies once its place is in view. There is never more than one cue, and nothing is ever drawn clamped to the screen edge.

Walking up to an answer charges it, as on the object-charge page: it wakes and grows, comes towards the visitor to eye level, fills from below, and opens. A short grace (an arc closing round it) lets a step away take the choice back.

Opening the box (the handle on its top edge) brings every answer back in, one by one; the box then offers them as tap choices with the same grace and undo. Folding it sends them out again.

## What to look at

- Does one-at-a-time read as "these are the answers, and here is where each one lives", or is it slow?
- Does the turn cue feel like a guide or like a nag?
- Is the handle findable, and does it stay distinct from a tap on the words (pause or play) and a vertical drag on them (scrub)?
- Does the charge at eye level read at a glance in a camera view?

## Beats (`?beat=`)

`lead-in`, `ask`, `fly-out`, `off-screen`, `toggle`, `approach`, `charge`, `undo`, `grace`, `result-right`, `result-wrong`, `goes-on`, `tap`, `weak`, `still`, `open-during-charge`. The select at the top jumps between them; Reset starts again.

## Values (sliders in the menu, and URL options)

- `flight` - flight time per answer, 0.8-4 s, default 2.
- `stagger` - time between two answers leaving, 0-2 s, default 0.6. 0 sends every answer in view at once.
- `ret` - return speed as a share of the flight time, 0.5-1, default 1.
- `dwell` - time standing by an answer to choose it, 2-10 s, default 4.
- `grace` - time to take a choice back, 1-6 s, default 3.
- `spacing` - distance between answers, 5-10 m, default 10. Reach is `min(3, spacing / 2 - 1)` m and an answer lets go only 1 m past its reach (hysteresis), so two reaches never overlap.
- `at=x,z,yawDeg` places the visitor, `voice=on` adds the browser's text-to-speech.

## Charge, tap and retry

- **Charge:** inside the reach for 0.6 s, the answer starts to fill over the dwell time; leaving lets it drain twice as fast. A full answer opens and counts once the grace has run out. Stepping 1.5 m away from where the visitor stood takes it back, and the answer then waits until the visitor has left its reach before it can charge again.
- **Tap on an answer in the world:** out of reach it says "Walk closer" at the answer; within reach it starts the charge at once.
- **Tap in the box:** always offered while the box is open. A tap chooses that answer with the same grace (its bar empties); a second tap takes it back.
- **Retry:** one. A wrong answer greys out where it stands and cannot be charged again; the character says "Not that one. You have one more try." A second wrong answer ends the question and shows the right one. A right answer after a retry gives half the points.
- **Opening the box during a charge:** the answer flies home, keeps its fill on its chip, and a tap there chooses it. Folding the box sends it back out with the fill it had.
- **Opening the box during a grace:** the opened answer flies home still chosen, with its countdown and its undo (a tap) in the box.
- **Weak position, or standing still for 20 s:** the answers come back into the box and it opens with the tap choice. A clear position, or walking on 2 m, sends them out again. The "Weak" switch forces it.

## Format fields this variant needs

- **Per answer:** a place (where its beacon lands, by default in front of the thing it names), a label, and optional clue text and result text.
- **Per quiz:** the speaker, the question, the result lines for right, wrong and retry, the points, and the dwell, grace and reach values (reach is derived from the spacing unless set).
- **Typed answers (`text`, `number`):** nothing flies; the box stays open with a field, and the place is only the station's own.
- **`multiple`:** every chosen answer stays opened at its place until a "done" step in the box; the one-by-one flight is unchanged.

## Faked here

- The camera, the square, the position and its accuracy are simulated; the weak position is a switch.
- The narration plays on invented word times; the voice has no word sync.
- The other items of the station are one dimmed circle.

## Strongest case against

One by one costs time: with three answers at the default values the last one lands about 3 s after the first, and an answer behind the visitor waits for a turn. A visitor who already knows the answer waits for the show. The tap fallback in the box is the escape, but it needs the box opened first.
