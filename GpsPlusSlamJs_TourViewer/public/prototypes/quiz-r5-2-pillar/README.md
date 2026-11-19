# Quiz round 5, variant 2 - A pillar on request

Throwaway UX prototype. Nothing in the app links to it.

## The direction

An Easter-egg hunt in AR. Each answer is an egg hidden at the thing it names. The eggs glitter faintly (page 6's glitter). If you walk close to one, you find it: it opens and flies slowly into its chip in the narration box. You may answer once the first egg is found. Until then, each chip is an empty dashed slot with a "?". The status row quietly counts what is still hidden ("3 eggs hidden here", "2 still hidden", "All found").

Help is never offered on a timer. Help comes only when the visitor asks the character. Then one egg gets a pale yellow pillar of light (`#fff4b0`). Its profile is the one from page 11: about 4 m high, fading to exactly 0 at the top, with motes rising inside. Look-to-collect opens only for that egg. Its fill rising from below is the only collection animation. If you look away, the fill drains. If the egg is out of view, one soft glow on the screen edge on its side shows the way. There is never more than one. When the egg is collected, its pillar sinks and the next one rises at the nearest hidden egg.

## How the visitor asks, and whether help stays on

Options considered:

- **A reply line in the box (chosen).** A still pill in the status row: "**Mara**, help me find them". It is written in the visitor's voice to the character, like a reply in a conversation. It is present from the question on, at the same place, and never animated, pulsing or timed. It cannot be confused with an offer.
- A tap on the character's name or portrait. Rejected: nobody would find it, and the brief says the visitor asks, which needs a visible way to ask.
- Speaking to the character (speech recognition). Rejected for now: unreliable outdoors, and it needs a visible fallback anyway.
- A long press on an empty chip slot. Rejected: hidden, and it ties help to one answer while the visitor does not yet know which egg is where.

Help **stays on** once asked, until the visitor taps "Stop helping" or every egg is found. Asking per egg would make the visitor repeat the same request two or three times in a row. A help that is switched on and can be switched off says the same thing with one tap. While help is on, the pill reads "Mara is helping - look for the light" and wears a pale beam tint. The count gains "- look for the light". Turning it off restores the question narration.

## Divergences from the brief and the seed pages

- **Tap-walk instead of a jump:** tapping the ground walks there at 3.5 m/s, so the find radius and the pillar are seen being approached. WASD and the Walk pad still work.
- **The lit egg grows with distance** (scale `max(1, d/6)`), and its shell is dimmed while lit, so its fill still reads from 10-20 m away. The other eggs keep their size.
- **Gaze uses the heading only.** The look cone compares the horizontal angle, with hysteresis: entering below the cone, leaving above 1.5 times the cone. Pitch is ignored: on a phone the visitor would have to aim down at an egg on the ground, which reads as a reticle task.
- **The right answer is revealed in the box at the end,** even if its egg was never found. A wrong final answer otherwise leaves an unexplained "?".
- **The station's own beam** (the orange one far behind the square) uses the same page 11 fade, so the two beams read as one family.
- **An additive-blend toggle** for the pillar, to compare against the normal blend outdoors.
- **A `freeze=1` URL option** stops the simulation after a beat is set up, for screenshots only.
- **The rules sit in the hint line** under the box ("Choose now, or keep looking." followed by the tries, the cost and the key), not in a separate panel.

## What the creator settings look like to the visitor

- **Attempts 1 / 2 / unlimited:** the hint reads "You have 2 tries.", "One try left." or "As many tries as you like." A wrong answer with tries left crosses that chip and gives a short retry line. With none left, the question ends and the right egg is shown. A right answer after a retry scores 5 instead of 10.
- **Cost per answer:** the hint adds "Each answer costs 5 coins; you have 20." The cost is deducted when the choice commits, after the grace time. If the visitor is short of coins, a tap on a chip flashes the hint instead of holding the chip.
- **Prerequisite (golden key):** the hunt and the help work normally. Found chips read "Needs the golden key", and a tap flashes the hint, which explains where the key comes from. With the key ("Has the golden key" in the panel), the hint says "Your golden key opens this question."

## Beats (`?beat=`)

- `lead-in`: the narration before the question.
- `hunt`: the question is open, every egg is hidden.
- `found-walk`: walking into the find radius of the first egg.
- `shortcut-choose`: one egg found, the visitor taps its chip at once.
- `help-ask`: help has just been asked. The pillar rises at the nearest egg, out of view, and the edge glow shows.
- `help-on`: the lit egg is in view.
- `gaze-collect`: looking at it, the fill is rising.
- `gaze-away`: looking away at 85 % fill, the fill drains and the edge glow returns.
- `all-found`: all three are in the box, help switches itself off.
- `choose`: a chip is held, in the grace time.
- `wrong`: a wrong answer committed.
- `right`: the right answer committed, with the result.

## Sliders (panel)

- Values:
  - look cone 5-30 degrees (12);
  - dwell 1.5-8 s (3);
  - drain 0.3-3 s (1);
  - find radius 0.8-4 m (1.5);
  - glint slow 1.5-8 s (4.5) and glint fast 0.3-2 s (0.9);
  - beam height 2-8 m (4);
  - fade start 0.2-0.9 of the height (0.55);
  - pillar rise and sink 0.3-2.5 s (0.9);
  - flight time 0.8-4 s (2);
  - stagger 0-2 s (0.6);
  - choice grace 1-6 s (3).
  - Also: beam colour, additive blend and voice.
- Creator settings: attempts (1 / 2 / unlimited), cost per answer 0-20 coins, "needs the golden key".
- The visitor: coins 0-50 (20), "has the key".

## URL options

Every slider takes its key as a URL option (for example `cone=12&dwell=3&beamh=4&fade=0.55`). Also:

- `beat=` picks a beat;
- `freeze=1` freezes after setup;
- `attempts=0|1|2` (0 = unlimited);
- `cost=`, `coins=`;
- `key=need`, `key=has` or `key=need,has`;
- `beam=fff4b0` sets the colour (hex without `#`);
- `add=1` turns on additive blending;
- `voice=on`;
- `at=x,y,z` sets the start position.

## Faked here

- The camera, the square, the position and the heading are simulated.
- The narration runs on invented word times. "Voice" adds the browser's speech without word sync.
- Coins and the golden key are plain switches; nothing earns them.
- "Nearest hidden egg" is the straight-line distance, not a walking route.

## The strongest case against

A pillar of 4 m standing over the answer is a strong hint. On a small square, one asked-for pillar nearly answers the question, and help that stays on lights all three in turn. The quieter alternative is a per-egg ask that lights only one egg. It costs a tap per egg, and that cost may be exactly the friction the creator wants. The cost-per-answer setting does not cover help: whether asking for help should cost something is an open question this page does not try.
