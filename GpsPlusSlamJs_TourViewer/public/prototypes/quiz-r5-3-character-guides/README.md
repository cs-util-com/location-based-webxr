# Quiz 5.3 - The character guides

A throwaway UX prototype, one of three variants of the same quiz round. It is not wired to the app and nothing in the app links to it. Open `index.html` from any static server.

## The direction

An Easter-egg hunt for a story quiz. Each answer is hidden like an egg at the thing it names (the fountain, the plane tree, the bench) and glitters faintly, with the glint and rising sparks of the "find first" page. Walking close (find radius 1.5 m, held for 0.25 s) finds an egg: it opens, then flies on an arc into its slot in the narration box, and from the first found egg on the visitor may choose. The box says quietly how many eggs are still hidden.

Help is never offered on a timer. **Help is a conversation with the character:** the visitor taps Mara's name in the box, and only then does help start. Mara guides in the box's own words ("A bit more to the right...", "There. Keep looking there..."). The side of the box towards the egg glows softly in her colour. Looking the right way long enough (look cone 12 degrees, dwell 3 s) fills the egg from below and its empty slot in the box together, in the egg's colour, and then the egg flies into that slot.

## How asking feels natural and never nags (the choice, and why)

The options I considered:

- **The name as the only door** (the seed). Clean, but a visitor who has never been told cannot know a name is a button.
- **A "Need help?" chip after a pause.** It is a timer by another name, so it is out.
- **A separate help button.** That is a second control, and it competes with the box.
- **Escalating hints on the visitor's own repeated asks.** Kept: each level is something the visitor asks for, never something pushed on them.

What the page does, and why:

- **Mara says once, in her question, that she can help:** "If you get stuck, just ask me." The offer is part of the story, said once at the start, and never repeated. It does not depend on how long the visitor takes, so it cannot nag.
- **Her name in the words is a real button.** Once the quiz is open, a small speech-bubble glyph sits beside the name. It does not pulse or move, and it fills in while she helps.
  - The name sits outside the box's gestures: a tap on the name asks; a tap on the words still pauses or plays.
  - On a desktop, `H` asks too.
- **The first ask** ("Gladly. Turn slowly, I will tell you.") opens the help.
  - Under the words, a line in her colour says which way to turn. It has four steps:
    - near, under 35 degrees: "A bit more to the left...";
    - mid: "More to the left.";
    - behind, over 120 degrees: "It is behind you. Turn to your left.";
    - inside the cone: "There. Keep looking there...".
  - A new line must hold for 0.5 s before it replaces the old one, so a wobbling phone does not make the text flicker.
  - When the look slips off a nearly full egg, she says "Back a little... you had it" at once and keeps that line for 1.6 s.
  - The box's edge glows on the side of the turn, stronger the further away the egg is. It rests (goes dark) while the visitor looks the right way, so the fill is the only thing moving.
- **Two reply pills sit under her line** so that a visitor never has to guess how to continue or how to stop:
  - "Show me" is a second, stronger ask: "Here, I will light it up for you." A short pale-yellow light pillar rises at the egg (4 m, with the light pillars' fade), and its particles rise.
  - "I'll look myself" ends the help: "All right. I am here if you need me."
  - A tap on the name while she is helping is the same as "Show me". A third ask only repeats the direction, and nothing gets stronger than the pillar.
- **One ask helps with one egg.** That is the nearest hidden egg at the moment of asking, and it stays the target. When it is collected, Mara says "There it is." and help ends by itself, so it never stays on in the background. The setting "One ask helps with: every egg, until stopped" is there to compare ("That is one. Now the next...").
- **While she helps, her target egg** is drawn from any distance, grows a little and glints faster (every 0.6 s), so the visitor can see what the words point at.

## Where this diverges from the seed, and from the brief

- The reply pills "Show me" and "I'll look myself" are not in the seed. Without them, a stronger hint and a way out would have no visible way in.
- The second ask brings a pale-yellow hint pillar at the egg. The seed has only words and the glow.
- By default, help is scoped to one egg and ends on its own.
- Her question mentions help once, up front. The seed has only the tap on the name.
- The name carries a static speech-bubble glyph once there is something to ask about. Without it, the name would not look like a door.
- Folding the box (its handle) sends the found eggs back to their places, where they sit open with a label; opening it brings them back to their slots.
  - An egg found while the box is folded stays open at its place until the box opens.
  - The folded line starts with "N hidden", then her name, then the words.
- The look direction is the heading only, because the simulated camera has no pitch. The cone has hysteresis: the look enters below 12 degrees and leaves above 1.5 times that.
- A tap on a found egg's slot chooses it, with a 3 s grace bar; a second tap takes the choice back. A gaze-collected egg is choosable like any other.

## What to look at

1. `?beat=hunt`: the eggs are hidden and only their glitter shows (turn towards the tree and the bench). The box says "3 eggs are hidden here".
2. `?beat=help-ask`, then `help-on`: the line in her words, the right edge of the box glowing, and the glow and the words changing as you turn (drag sideways, or Q and E).
3. `?beat=gaze-collect`: the bench egg and its "Hidden" slot fill together. Keep looking and it flies in.
4. `?beat=gaze-away`: "Back a little... you had it", and the fill draining.
5. `?beat=help-stronger`: the pale hint light at the bench, behind the visitor's right shoulder.
6. Change the creator settings in the menu. Each change restarts the beat, so you see what the visitor sees.

## Beats (`?beat=`)

- `lead-in`: the start. The lead narration, then the question.
- `hunt`: the question is open and nothing is found yet.
- `found-walk`: the visitor walks up to the fountain egg; it opens and flies into its slot.
- `shortcut-choose`: one egg found and already chosen, with the grace bar running.
- `help-ask`: just after the visitor tapped Mara's name.
- `help-on`: help running while the visitor turns slowly.
- `help-stronger`: after a second ask, with the hint light.
- `gaze-collect`: looking at the egg, partly filled.
- `gaze-away`: the look slipped off a nearly full egg.
- `all-found`: all three in the box.
- `choose`: a slot chosen, with the grace bar.
- `wrong`: a wrong guess, with one more allowed (two guesses).
- `right`: the right answer.
- `locked`: the prerequisite is not met.
- `fold`: the box folded, the found egg back at its place.
- `?still=1` freezes the page after its beat, for screenshots.
- `?at=x,z,yawDeg` places the visitor.

## Values (menu sliders; each is also a URL option)

- `cone`: look cone half-angle, 12 degrees (5-30); the look leaves at 1.5 times it.
- `dwell`: 3 s (1.5-8).
- `drain`: looking away empties a full egg within 1 s (0.3-3).
- `find`: find radius, 1.5 m (0.8-3).
- `glintSlow` and `glintFast`: glint periods, 4.5 s far away and 0.9 s at the egg. The guided egg glints every 0.6 s.
- `beamH`: hint light height, 4 m.
- `fade`: the light fades out from 0.55 of its height, to exactly 0 at the top, with a soft rim at the ground.
- `color`: hint light colour, `#fff4b0`. The station beam stays orange, with the same fade.
- `flight`: flight time into the box, 2 s.
- `stagger`: 0.6 s between two flights.
- `grace`: a choice can be taken back within 3 s.

## Creator settings, and what the visitor sees

- **Guesses** (`attempts`):
  - One: a wrong answer reveals the right one, and there are no points.
  - Two: "Not that one. You have one more guess." The tried slot is crossed out, and the box says "Last guess."
  - As many as they like: "Not that one. Try another."
- **A guess costs** (`cost`, 0-20 points) and **The visitor has** (`purse`).
  - The box says "A guess costs 5 of your 40 points." and each slot says "Tap to choose - 5 points".
  - A visitor who cannot pay sees the slots dimmed, reading "Needs 5 points".
  - When a wrong guess leaves too little for another, the game ends with "...you have no points left for another guess", then the answer.
  - The result shows the net points.
- **Prerequisite** (`key`):
  - Golden key, visitor has none: Mara says "There is a question waiting here, but it is locked. Find the golden key at the old gate, then come back to me." There are no eggs and no glitter, and asking her repeats this.
  - Golden key, visitor has it: the question begins "You brought the golden key, so here is my question.", and the box adds "Opened with your golden key."
- **One ask helps with** (`scope`): one egg (the default), or every egg until stopped.

## Faked here

- The camera, the square and the position are simulated, and the look direction is the view's heading only.
- The narration plays on invented word times. "Voice" adds the browser's text-to-speech, without word sync.
- Points, the key and the purse are local values on the page.

## The strongest case against

Help that talks needs words to read while the visitor is turning on the spot. On a bright street, a one-line instruction at the bottom of the screen may be read less than a light at the egg. That is why "Show me" exists, and it may turn out to be the part people use. The words also make help slower than an arrow.

The bet is that a character who answers when asked fits a story tour better than a hint system does. Whether it does is a field question.
