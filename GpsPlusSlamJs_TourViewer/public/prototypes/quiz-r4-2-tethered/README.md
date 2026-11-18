# Tethered answers

A throwaway quiz prototype for the Tour Viewer's AR view. It is one of three directions for the same question round. Open `index.html` in Chrome; desktop works for testing, and an Android phone is the target.

## The direction

The answers are kept in the HUD and the places are in the world, as in quiz-player-1. This direction adds a visible link between the two.

- Each answer has a thread from its chip in the box to its token in the world. The thread is drawn while the token flies out and after it has landed, so the visitor can always follow a chip to its place.
- Once the question has been read, the box collapses to a slim row of chips with one status line, and the answers fly out to their places.
- Opening the box again reels the answers in. Collapsing it sends them out again.
- When a place is off-screen, the thread itself runs off the edge of the screen toward it. Nothing is clamped to the screen edge.
- The answer is chosen by standing by its place (a charge) or by tapping its chip.

## Threads

- **Look:** a quadratic curve from the top of the chip to the token's screen point.
  - Core: 4.5 px in the answer's hue.
  - Outline: 5 px wider, at 85% near-black, so the thread reads against sky and pavement.
  - Charging or chosen: 6.5 px, 45% toward white, with a glow.
  - Landing: a short pulse that widens the thread by up to 4 px.
  - A wrong answer turns grey and dashed.
- **One off-screen cue (the default, "one"):** only the off-screen answer that needs the smallest turn gets a full thread off the screen. The other off-screen answers keep a 46 px stub with a knot on their chip. This keeps a thread per answer while showing at most one off-screen cue at a time.
- **All ("all", in Values):** every answer draws its full thread, for comparison.

## Choosing

- **Charge:** standing within reach of an answer arms after 0.6 s, then fills its token over the dwell time. A full token chooses the answer, and a grace countdown starts.
- **Undo by stepping away:** stepping out of reach plus let-go undoes the charge (the fill drains) and also undoes a choice still in grace.
- **Tap:** a chip tap chooses the answer and starts the same grace. A second tap on that chip undoes it, and that answer will not recharge until the visitor has left its reach.
- **Object tap:** a tap on a token out of reach says "Walk closer". In reach it starts the charge without the arm delay.
- **Retry:** a wrong answer is said, its chip stays marked and its thread goes grey; the visitor tries again until right. There is no Continue button: the narration leads on.
- **Opening the box during a charge** freezes the fill, and collapsing it resumes. **Opening it during grace** keeps the choice; the box counts the grace down, and a chip tap undoes it.

## Weak position and standing still

- **Weak position:** the answers reel in and the box refuses to collapse, because world places cannot be trusted. Once the position is good again, the answers fly out.
- **Still:** after standing still for the still time (20 s by default), the answers reel in. Walking 1.5 m sends them out again.

## The box

The narration box is the scroll-box look, re-implemented inline. A tap on the words pauses or plays, and a vertical drag scrubs. It collapses and opens two ways: the large left button ("Send out" or "Bring in") and the grab handle on the top edge (tap it, or drag it down or up).

## Answer types

- `single`: the case shown here; one place per answer.
- `text`: no world places; the box stays open with a text field. Threads have nothing to point to.
- `number`: the same, with a number field.
- `multiple`: by chips only. A tap marks each chip, and one confirm in the box ends it. A charge picks a single place, so it does not fit several answers.

## Fields the world quiz needs in the tour format

Per answer:

- `at {x, z}`: the place the answer flies to. The thing it stands for is just behind it.
- `clue`: what the answer said when the visitor found it.
- `says`: an optional text for this answer when it is chosen and wrong.

Per quiz:

- `speaker`: who reads the question. It is its own field, or it is inherited from the previous character step.
- `says {right, retry, wrong}`: what is said for a right answer, for a wrong one with another try, and for the last wrong one.
- `choose {dwellS, graceS, reach, letGo}`: the charge time, the undo window, the reach in metres, and the extra distance before stepping away counts.
- `spacing`: a creator hint for laying out places when they are not given; the prototype puts the answers on a circle of this radius.

## Values (the sliders) and what the sweep showed

The Values panel holds the sliders; each key can also be set in the URL (for example `?flight=3`). These were tried on the phone viewport (390 x 844).

- **flight** 0.8 to 4 s, default 2. At 0.8 s the in-view answer crosses about 900 px/s, and an answer bound off-screen is visible for about 0.1 s. At 2 s it is about 360 px/s and visible for about 0.3 s. At 4 s it is about 180 px/s and visible for about 0.7 s. Somewhere between 2 and 3 s reads best on a desktop screen; it needs a phone in the street to settle.
- **stagger** 0 to 2 s, default 0.6. Time until all three have landed: 2 s at 0, 2.6 s at 0.3, 3.2 s at 0.6, 4 s at 1, 6 s at 2. At 0 they leave as one bunch and the threads cross; 0.6 keeps them apart without a long wait.
- **dwell** 2 to 10 s, default 4. Time from entering reach to chosen, with the arm delay: 2.6 s, 4.7 s, 6.7 s and 10.7 s for 2, 4, 6 and 10.
- **grace** 1 to 6 s, default 3.
- **spacing** 5 to 14 m, default 10. Reach is capped so let-go rings never overlap. At 5 m the reach drops to 1.5 m and the rings touch; at 8 m the full 3 m reach fits with the rings touching; at 10 m there is a 2 m gap and a 7 m walk from the start.
- **reach** 1 to 4 m, default 3 (capped by spacing, as above).
- **ret** (reel-in time as a share of flight) 0.5 to 1, default 1. At 0.5 the answers come back twice as fast as they went out, which makes opening the box feel snappier; 1 keeps the motion symmetric.
- **still** 5 to 30 s, default 20.
- **cue**: "one" (default) or "all".

## The fixed demonstration

The page has a strip of controls for testing on a desk:

- **Beat:** jumps to a moment (`?beat=` works too): lead-in, ask, fly-out, off-screen, toggle, approach, charge, undo, grace, result-right, result-wrong, goes-on, tap, weak, still, open-during-charge.
- **Reset**, **Go fast** (walks at 3.5 m/s), **Weak position**, **Values**.
- Drag to walk and turn. A tap on the ground jumps to just outside the reach of the nearest answer (within 7 m), facing it.
- A meter shows draw calls, triangles, frame time and CPU time.
- `window.__quiz` exposes the state for scripted checks.

## The strongest case against this

Threads are lines drawn over the camera image, and a street is full of lines. Three coloured curves crossing the lower half of the screen compete with what the visitor should be looking at, and a long thread running off-screen can read as a path to follow rather than a direction to turn. The single off-screen cue reduces this but makes the other off-screen answers harder to find. A plain off-screen arrow with no threads, as in the other directions, may be calmer.

## Left out

- No camera image or real AR session: a simple 3D square stands in for the world.
- No real position: walking is simulated, and the weak position is a toggle.
- No audio narration: the words advance on a timer.
- Only the `single` answer type is built; the others are described above.

## Known limits

- Frame times shown on a desktop come from software rendering and say nothing about a phone.
- The round box keeps the scroll-box look, including its 1.5 px gradient edge and 2 px speaker-dot border, which are thinner than the 3 px lines used elsewhere.
- The sliders are built in script, so the page's range inputs do not go through the shared slider guard.
- Flight time and thread weight were judged on a desktop screen only.
