# Quiz 5.1 - Warmer, in the world

Throwaway UX prototype for quiz round 5, variant 1 of 3. Not wired to the app, linked from nothing in it. It is kept as an inspiration gallery entry.

- Files: `index.html`, `warmer.js`, `warmer.css` (the narration box's styles from quiz 4.1, plus this variant's slot, creator panel and states).
- three.js 0.185.1 from unpkg through an import map; nothing else.

## Direction

An Easter-egg hunt for a story quiz. Each answer is an egg hidden at the thing it names:

- the fountain's egg sits on the near rim;
- the plane tree's egg sits at its foot;
- the bench's egg sits under the seat.

Each egg glitters faintly, with the find-first page's gold star sparks, warming with distance.

- **Walking within the find radius** (for 0.25 s) finds an egg. It opens where it is (the lid lifts and sparks burst upwards), then flies slowly on a high arc into its chip in the narration box. This is quiz 4.1's flight.
- **Choosing is open from the first found egg.** A tap on a chip chooses it; a second tap within the grace takes it back.
- **One slot in the box stands for every egg still hidden**: "3 hidden here", then "2 still hidden". It is the box's quiet count.
- **Help only on request.** The slot's small line reads "Stuck? Ask Mara". A tap there asks Mara. She says one line, and help mode is on: the slot turns pale yellow and reads "Mara helps - tap to stop".
- **Help is angle-warm.** With help on, the target egg answers to the visitor's turn:
  - as the view swings towards it, its glitter quickens (down to 0.6 s between glints inside the cone), brightens and grows;
  - its sparks climb from 0.7 m up to about 3 m and rise faster;
  - inside the look cone the egg itself shows faintly and fills from below, which is the one animation;
  - a full fill collects it exactly like a walk find: it opens and flies into the box;
  - looking away drains the fill.
  - The target is the nearest hidden egg by default. A creator setting can make every hidden egg answer instead.
- **Nothing else appears on screen.** There is no reticle, no arrow, no tether, no HUD that follows the gaze and no charge bar in the box.

## How the visitor asks for help, and why this way

Candidates considered:

1. **The count slot is the ask (chosen).** The element that says "2 still hidden" also carries "Stuck? Ask Mara", and a tap on it asks.
2. A tap on the speaker's name in the box.
3. A separate "?" or "Help" button.
4. A line Mara offers after some time ("Shall I help?").
5. A gesture, such as shaking the phone or a long press on the box.

Why 1:

- **Nothing new appears.** The count has to be there anyway (the brief asks for it), so the ask costs no extra element and no extra place to look.
- **It is static.** It is there from the first moment and never changes on a timer. It never moves, pulses or grows, so it cannot nag.
- **It sits where the problem is.** The visitor is stuck exactly on the eggs this slot counts.
- **The others lose:**
  - 2 clashes with the box's own gesture (a tap on the words pauses), and nothing says a name is tappable.
  - 3 reads as app help, not as the character, and is one more control.
  - 4 is a nag by definition: an offer on a timer, which the brief rules out.
  - 5 is undiscoverable and unreliable while holding a phone up.
- A second tap on the same slot switches help off, with a short line from Mara. When the last egg is found, the slot leaves the box and help ends by itself.

After a help line, a help-off line or a retry line has played (and 3 s more), the box shows the question again with all its words lit, so the visitor never loses the question.

## Divergences from the seed, with reasons

- **A short pale-yellow pillar at the faced egg, only while help is on and only inside the cone.**
  - The seed said "nothing extra appears beyond the box". On the phone's camera an egg 10 m away is a few pixels, and the faster glitter alone was hard to read at that size in the screenshots.
  - The pillar uses the light-pillars page's profile (exactly 0 at the top, a soft ground rim, fading near the eye) in the hint colour.
  - It never shows outside help mode, never outside the cone, and never stays after the collect.
  - The beam slider set to 0 turns it off, which gives the strict seed.
- **A faced egg keeps a minimum on-screen size.** Inside the cone, an egg farther than 5 m is scaled so it looks as large as it would at 5 m. The reason is the same: a 0.5 m egg at 10 m is too small to see filling.
- **Hysteresis on the cone.** An egg enters at the cone (12°) and lets go only past 1.5 times it. Without that, hand shake at the cone's edge flickers the fill between filling and draining.
- **Distance warmth stays on without help.** The page-6 glitter warms as the visitor walks closer, with or without help. Help adds the angle warmth on top. This keeps the unhelped hunt the same as the find-first page.
- **Folding the box** sends found eggs back to rest, opened, at their places (with a soft pool of their colour), as quiz 4.1 did with its answers. Opening the box brings them home. An egg found while folded opens and rests in place. Its dot in the folded pill fills (hidden eggs are hollow rings).
- **At the result, the eggs nobody found come to the box too**, so the full answer set is visible with the result.
- **The station beam** is a pillar with the light-pillars page's fade in the station colour, with sparks that only rise. Quiz 4.1's flat beam is not reused.

## Beats (`?beat=`)

- `lead-in` (default): Mara's lead line, then the question; the hunt opens after it.
- `hunt`: the hunt is open at the start; nothing found yet.
- `found-walk`: the visitor walks into the fountain's egg; it opens and flies into the box.
- `shortcut-choose`: only the fountain is found, and it is chosen right away (the grace bar runs). This shows that choosing is open from the first egg.
- `help-ask`: the slot was just tapped; Mara says the help line and the slot turns pale yellow.
- `help-on`: help is on, the view is turned 34° off the tree and slowly swings towards it. The tree's glitter quickens and its sparks climb.
- `gaze-collect`: facing the tree's egg, 55 % filled; it fills on and comes to the box.
- `gaze-away`: 60 % filled, then turned 32° away; it drains.
- `all-found`: all three in the box: "All found. Tap the one you think is right."
- `choose`: the fountain chosen, the grace bar running.
- `wrong`: the tree committed with 2 attempts: struck through, "You have one more try."
- `right`: the fountain committed: the result line with points.

## Values (sliders in the menu, all also URL options)

- `cone`: look cone half-angle, 5-30°, default 12. Inside it the egg fills.
- `warm`: half-angle where angle warmth starts, 20-90°, default 50.
- `gdwell`: look dwell to collect, 1.5-8 s, default 3.
- `drain`: full to empty when looking away, 0.3-3 s, default 1.
- `radius`: find radius when walking, 0.5-5 m, default 1.5.
- `gslow`: glint period far and unfaced, 1.5-8 s, default 4.5.
- `gfast`: glint period close or faced, 0.3-2 s, default 0.9.
- `beam`: hint pillar height inside the cone, 0-6 m, default 2.4 (0 = none).
- `fade`: where the pillar's fade starts, as a share of its height, 0.2-0.95, default 0.55.
- `hue`: the hint colour (a colour input), default `fff4b0`.
- `flight`: flight time into the box, 0.8-4 s, default 2.
- `stagger`: time between two flights, 0-2 s, default 0.6.
- `grace`: time to take a choice back, 1-6 s, default 3.

Fixed in the code:

- find dwell 0.25 s;
- the egg shows from radius + 3 m;
- distance warmth from 16 m;
- glint length 0.35 s, and 0.6 s between glints inside the cone;
- exit cone 1.5 times the cone;
- a faced egg keeps its 5 m size;
- the egg takes 0.75 s to open.

## The creator's settings (part of the quiz item)

The settings sit in the menu under "Creator" (the strip button opens it there), and each is also a URL option. Each control has a note on what the visitor then sees.

- `attempts`: `1`, `2` (default) or `inf`.
  - The box says "2 tries.", then "One try left.".
  - A wrong answer is struck through and Mara says so.
  - With no tries left, Mara gives the right answer.
  - Right on the first try gives 10 points; right after a retry gives 5.
- `cost`: `0` (default), `5` or `10` points per answer, from the visitor's tour points (40 here).
  - Chips read "Tap to answer - 5 points".
  - The box says "Each answer costs 5 of your 40 points."
  - The result line says what was paid.
  - A tap the visitor cannot afford says so in the box and does nothing.
- `key`: `off` (default), `need` (needed, visitor lacks it) or `have` (needed, visitor has it).
  - With `need`, the hunt works as always, but found answers read "Needs the golden key" with a small gold key. A tap says why, and the box says it once, quietly.
  - With `have`, the box says "Your golden key opens this question."
- `warms`: `nearest` (default) or `any`. This decides which hidden eggs answer to the turn while help is on.
- `buzz`: `off` (default) or `on`: one short vibration when a helped egg enters the cone (Android Chrome), at most every 1.5 s.

## Try it

- Drag sideways on the view to turn.
- Tap the ground to jump there. Near a hidden egg you land just outside its find radius, facing it.
- Hold Walk or Back; Fast walks at 3.5 m/s.
- Desktop keys: W A S D to walk, Q E or the arrow keys to turn, Shift to hurry.
- Tap an egg in the world for a short word ("Walk closer").
- The handle on the box's top edge folds it.
- The meter in the top right shows the frame time, draw calls and, with help on, the target's angle and fill.

## Faked here

- The camera, the square and the position are simulated.
- The look direction is the heading only, with no pitch. On the phone the cone would be measured on the full view direction.
- The narration plays on invented word times.
- The points and the golden key stand in for the tour's own score and items.

## Strongest case against

- **Angle warmth is a hot-cold game, and hot-cold is slow.** A visitor who asked for help may want to be told where the egg is, not to sweep the square. A one-time pointer (the character naming the thing, "look by the tree") would be faster, and that is what variant 2 or 3 may show.
- **The fill needs a steady hold of about 3 s at a small target.** On a real phone, hand shake and GPS jitter at 10 m may make the 12° cone hard to hold; the hysteresis helps, but only a field test shows the right cone and dwell.
- **The pillar weakens the "nothing on screen" promise.** It is the honest fallback for a few-pixel egg; whether the glitter alone suffices is a question for the phone. Set `beam=0` to judge it.
