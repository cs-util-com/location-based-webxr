# The creator decides, the player adapts

A throwaway quiz-player prototype. It is one self-contained page (`index.html`) that loads three.js from a CDN. It is not wired to the app.

## The direction

There is one quiz player with two presentations, and every quiz is shown in one of them at any moment:

- **In the square.** The answers are hidden at their places. The visitor finds them like eggs, then chooses one by standing in its ring. The only HUD is a small pill at the foot.
- **In the card.** The question and its answers sit in one panel at the foot. The visitor taps an answer, then presses Check.

Which one is shown is decided in two steps.

- **The tour data decides whether a quiz may go to the square at all.** All of these must hold:
  - the answer type is `single` or `multiple`;
  - every option has a place;
  - the two closest answers stand at least 5 m apart;
  - the quiz is not marked `present: "card"`.
- **The player decides whether it is in the square right now.** Both of these must hold:
  - the position is vouched for, with hysteresis: good for 3 s to lift, weak for 1.5 s to drop;
  - the visitor has not started answering in the card.

The hand-over is meant to be seen. The question always opens in the card. Once the position is trusted, the answers fly out of the card to their places as small chips, and the card shrinks to the pill. If the position goes weak, they fly back into the card. Whatever was found stays found, and a chosen answer stays chosen. Nothing counts unless the visitor makes it count, with Check in the card or by letting the grace ring close in the square.

## The ranking rule (what wins the screen)

- **While a quiz is open, it owns the bottom band.** It shows as either the card or the pill, never both, and it never sits over a story card. The story card comes back when the quiz ends.
- **The walk's own layer stays:** Exit, the radar and the toast.
- **The other items of the station wait.** They dim in the square, as the narration circle behind the start point does, and their cards do not take the band. A sound that is already playing is not stopped, since items do not lock each other.
- **A seventh or eighth item** is treated like the narration circle: dimmed in the world, with no HUD element of its own while the quiz is open.

## Answer types

- **`single`:** goes to the square when placed. Otherwise it plays in the card.
- **`multiple`:** the answers are found in the square. Once all are found, they fly back to the card, where the visitor chooses several. Toggling several answers by standing has no honest way to take one back.
- **`text`, `code`, `number`:** always the card. These are judged after the normalisation, never as typed. The page's stand-in for it:
  - NFC, case folding and whitespace folding;
  - ä, ö, ü and ß folded to ae, oe, ue and ss, so "Bürgerhaus" and "buergerhaus" match;
  - a decimal comma for numbers;
  - text and code compared as salted SHA-256 hashes.

## Fields the world quiz needs in the tour format

All of them are optional, so every quiz written today still plays, as a card.

- **On the quiz:**
  - `present: "auto" | "card"`, default `"auto"`. A creator who wants a placed quiz to stay a card on every phone sets `"card"`. There is deliberately no `"world"`: the player must always be able to fall back.
  - `place: { find: { radius }, choose: { ring, dwellS, graceS } }`, the feel, each value with a default (2 m, 2 m, 3 s, 2.5 s).
- **On each option** (`{ id, label }` today):
  - `at: { x, z }`, the answer's place in metres in the station's own frame, the same frame its other items use. Whether that frame is the station anchor or lat/lon is open.
  - `clue: string`, shown on the thing once it is found.
- **Checks when the tour is saved:**
  - either every option has `at` or none does; a half-placed quiz plays as a card, and the editor says so;
  - the two closest answers stand at least 5 m apart, inside the station;
  - `at` is allowed only on `single` and `multiple` answers.

## The fixed demonstration

Seven runs, picked at the top of the page. The arrows step through the beats, and Play walks the visitor through them.

1. **Placed:** the question appears, the answers lift, search, all found, stand at an answer, take it back by stepping out, answer again, the result, the story continues.
2. **The position turns weak:**
   - the position goes weak in a half-full ring, and the ring drains;
   - the answers fall back to the card;
   - the position returns and they lift again, because the card was not touched;
   - weak again, back to the card;
   - the visitor chooses in the card, which pins the quiz there;
   - the position returns and the card stays;
   - Check, then the story continues.
3. **A visitor who does not move:** after 20 s of standing still, the pill offers the card strongly. "Answer here" brings every answer into the card.
4. **Answers placed too close:** four lamps 3 m apart. The quiz stays in the card even with a good position. Moving the spacing slider below 3 m lets it lift.
5. **A typed answer** (a second story): "  BUERGERHAUS" is accepted.
6. **Number and code:** "22,5" for 23 m with a tolerance of 1 m, and "k7q" for the code K7Q.
7. **Several answers:** the answers are found in the square and chosen in the card.

**The measuring hook:**

- A readout in the top bar shows the HUD footprint (all HUD boxes, and the quiz's own boxes alone), the element count and the number of overlapping pairs.
- Any two HUD boxes that overlap get a red outline.
- The notes (the gear button) hold a per-beat table for portrait and landscape.

**Values to judge** each have a slider in the notes: the lift delay, the drop delay, the minimum spacing, the dwell, the grace and the still-standing nudge.

## The strongest case against this

- **Two presentations of one quiz means two things to learn.** A visitor whose position flickers sees the quiz move between the square and the card. The hysteresis hides short flickers, but a long walk under trees could still cause several hand-overs and wear down trust in both presentations.
- **The creator's placing work can go unseen.** Answers placed on the editor's map may play only as a card for many visitors on the day.
- **The flight leaks direction.** The chips show roughly where each answer hides, which takes some of the hunt out of "find first".
- **A card-only player is simpler and always works.** The extra state this page carries (hysteresis, pinning, carrying a choice across a hand-over) is new machinery with its own ways to fail.

## Left out

- Leaving the station with the quiz open, and coming back. The find-then-stand variant of this round covers it.
- The dwell look itself. The ground ring here is neutral, so any of the earlier dwell looks can be dropped in.
- Effects and requirements beyond points.
- Sounds.

## Known limits

- The frame times come from a desktop. Software GL in the checks is slow, so only a phone can judge them.
- The prototype's top bar pushes Exit and the radar down by its own height.
- The chips in flight are not counted in the footprint, because they last under a second.
