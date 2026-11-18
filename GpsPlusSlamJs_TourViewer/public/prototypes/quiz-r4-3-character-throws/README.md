# The character throws

This is a throwaway quiz prototype: one self-contained page (`index.html`) that loads three.js from a CDN. It is not wired to the app and nothing in the app links to it. It targets Android Chrome in AR; desktop Chrome works for testing.

## The direction

The character who asks the question also hands out the answers.

- **The question arrives in the narration box at the foot.** The character's name (Mara) is inline and bold in her colour, and the three answers wait as chips under the words. Nothing has to be pressed: the narration leads straight into the question.
- **Once the question has been said, the box folds down to Mara's name.** She throws the answers from her name, one after another. Each one flies slowly on an arc with a trail in her colour, 3.5 px wide over a dark 8 px outline.
- **Each answer lands as a short light pillar at its thing.** The pillar is about a third of the station beam's height, in Mara's colour, with particles rising from the ground and a pulse on landing. It has no beam to the sky, so it never reads as a station.
- **The folded box keeps only Mara's name, a status and the handle.** The question rides on the answers in the world instead: when the visitor comes near one, a plate with the question and that answer floats above it. The plate's size is fixed to a share of the view, so it is always readable.
- **Off-screen answers get one edge cue at a time,** for the nearest answer out of view. It is in Mara's colour and shows the answer's short name and its distance.
- **The station's other items dim** while the question is open. The station's sky beam stays visible.

## Charge, tap and retry

- **The charge happens at eye level at the thing,** as on the object-charge page:
  - inside the reach, the answer wakes and grows;
  - after a 0.6 s arm, it comes up toward the visitor;
  - it fills from below (the dwell);
  - it opens, and a ring closes during the grace.
  - The folded box mirrors the fill in its pill, and an open box shows it in the chip.
- **The reach scales with the spacing:** reach = 0.3 x spacing, with a let-go of 1 m on top, so reach plus let-go stays within half the spacing. That gives 3 m and 1 m at 10 m, and 1.5 m and 1 m at 5 m. An answer is entered at the reach and left only past reach plus let-go.
- **Taking it back:**
  - leaving during the charge drains it, twice as fast as it filled;
  - during the grace, a 1.5 m step away from where it was taken releases it;
  - a released answer is blocked until the visitor has stepped out of its reach once.
- **Tapping the thing:**
  - within reach, it starts the charge;
  - out of reach, it says "Walk closer - N m" at the thing;
  - when the position is weak, it says "Position unsure".
- **The tap fallback is offered only for a weak position or after 20 s of standing still.** Then the answers fly back into the box and the chips become tappable. A tapped chip is held with the same grace, and "Take back - N s" on the chip undoes it. When the position is good again, the box folds and the answers fly out once more; if a tapped answer is still in its grace, this waits until it counts or is taken back. Outside the fallback, a tap on a chip only flashes the hint to walk.
- **Opening the box during a charge** brings the answers in, and the charging chip keeps its fill and shows it as "Filling N %". The fill is frozen while the answer is in the box, and folding sends it out still filled.
- **Opening the box during the grace** keeps the choice. The chip shows "Take back - N s", and the grace keeps counting.
- **A weak position** drains any charge that has not been taken yet and stops new ones.
- **No retry.** Once an answer counts, the others fly back into the box. Mara says the result there as her next line: for a wrong answer she names the right one, and the story goes on in the same box.

## Fields this variant needs in the tour format

- **Per answer** (on top of today's `{ id, label }`):
  - `at: { x, z }`: the place in metres, in the station's own frame;
  - `short`: an optional short name for the edge cue (otherwise the label is cut);
  - `clue`: optional text on the plate once it is woken. This page does not use it; the plate carries the question and the label.
- **Per quiz:**
  - `speaker`: the character who asks and throws; its name and colour come from the character;
  - `says: { right, wrong }`, where `{answer}` in `wrong` is replaced by the chosen label. There is no `retry` line, because this variant has no retry; a `retry` field from another variant is ignored;
  - `choose: { dwellS, graceS, reach }`: the defaults are 4 s, 3 s and 0.3 x the closest spacing, with the let-go fixed at 1 m;
  - `points`.
- **Other answer types:**
  - `text`: typed in the box. Nothing is thrown, because there are no places.
  - `number`: the same as `text`, in the box with a number keyboard.
  - `multiple`: the answers would be thrown and charged one by one, each staying held. A "Done" chip in the box ends it, because standing cannot say "that's all".

## Values to judge (sliders in the notes, or URL parameters)

Open the gear in the top strip for the sliders. Every value can also be set in the URL, for example `?flight=2.5&stagger=0.4`.

- `flight`: the flight time per answer, 0.8 to 4 s, default 2 s.
- `stagger`: the delay between answers, 0 to 2 s, default 0.6 s. At 0 they all fly at once.
- `back`: the return time as a share of the flight time, 0.5 to 1, default 1.
- `dwell`: 2 to 10 s, default 4 s.
- `grace`: 1 to 6 s, default 3 s.
- `spacing`: 5 to 10 m, default 10 m. The answers move with it, and the reach follows.
- `fast`: the speed of Walk, Back and Shift, 3 to 4 m/s.

## The demonstration

- **Beats:** pick one in the top strip, or open the page with `?beat=<name>`. The names are lead-in, ask, fly-out, off-screen, toggle, approach, charge, undo, grace, result-right, result-wrong, goes-on, tap, weak, still and open-during-charge.
- **Moving around:**
  - drag to look;
  - tap the ground to jump; near an answer the jump lands just outside its reach, facing it;
  - hold Walk or Back to move fast, or use W A S D, with Shift for fast.
- **Weak position:** a toggle in the strip.
- **Reset:** starts the lead-in again.
- **Readout:** the strip shows draw calls, triangles and the frame time.
- **The box gestures:**
  - a tap on the words pauses and plays;
  - a vertical drag on the words scrubs;
  - only the handle on the box's top edge folds and opens the box, by a tap or a drag down or up;
  - a tap on the folded pill opens it too.

## The strongest case against this

- **A thrown answer is a moving target.** At 2 s per flight with a 0.6 s stagger, the throw takes about 3 s, and two of the three land out of view. The visitor sees one land, then follows a cue. Whether the trail tells the visitor enough about where the other two went is the open question.
- **The question in the world depends on getting close.** From the start point the visitor sees pillars without words; the plate appears only within the wake distance. Someone who forgets the question has to open the box, which brings every answer back in.
- **No retry is harsh on a guess.** It keeps the walk single, though, and Mara's line makes a wrong answer part of the story.

## Known limits

- Frame times come from a desktop; only a phone can judge them.
- The weak position is a toggle and a small camera wobble, not a real pose.
- The prototype's top strip pushes Exit down by its own height.
