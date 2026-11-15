# HUD aggregation prototype: One slot

A throwaway, standalone page. Open `index.html`. three.js 0.185.1 comes from unpkg through an import map; nothing else is loaded and no app code is imported.

## The direction

The screen gets an attention budget. Exactly four things can ever be on it:

- **Exit** (top left);
- **the radar** (top right, stations only);
- **one nudge line** at the foot: one sentence, at most one button;
- **one slot** under it: a single panel that changes its content and never stacks.

Every item of the station, the story and the walk ask for the screen with a rank. One pure arbiter (state in, slot and line out) gives the slot to the top panel request and the line to the best one-liner. The rest waits silently. There is no list of the queue, no edge marks, no second panel.

Today's narration card, video card, captions strip, story card and walk-sheet peek all become content of the one slot or the one line.

## The ranking rule

1. **What the visitor tapped** (a pin's text, the then-and-now picture, the model's card, the station list from the radar). Their own choice wins; what it covered comes back when it closes.
2. **A story step, a quiz included.** While it is on screen, free items show only in the world: their ring glows, bars move over what plays, the narration's particles rise faster. Even the nudge line is quiet then, except for "position is rough".
3. **What is playing.** If two play, the one started last has the slot and the sound. The other plays on, muted, and the nudge line offers "Swap".
4. **A start where the visitor stands** ("you are there", with a Play button). Nothing starts by nearness: a tap is always needed.
5. **Nudge line only**, in this order:
   - the position is weak;
   - fresh walk news (it lingers 3, 6 or 10 s, swept);
   - an item that lost the slot (muted, "you are in ...", finished);
   - "walk N m closer" for the nearest startable thing in view;
   - the one thing out of view that matters ("A picture waits behind you"). It stays named until it has been seen;
   - paused by leaving ("come back to carry on");
   - where the walk goes next, once the story is done or the station is left.

A "Playing first" switch in the demo panel swaps 2 against 3 and 4, as in the seed's example ranking, so both orders can be judged. In that mode the story can lose the slot and shows as "The guide has a question - Show".

## Inside the station, and not

- Items of the station the visitor is in are awake. They have their kind colour, a glowing ring and a floating kind badge. The one the nudge line names glows a little brighter, which links the sentence to the thing.
- Items of a station the visitor is not at are asleep: grey, no ring, no badge (the two signs by the well).
- The radar shows the station the visitor is in as a filled disc around them. Other stations are dots on the rim: orange for next, a teal dot for done, a ring for later.

## Seventh and eighth items

They join the queue, and the HUD does not grow: it is still one slot and one line. They show only in the world until they rank first. "Items: 8" in the demo panel adds a sign and a second voice. The demo panel's queue readout shows the arbiter's decisions; that readout is never shown to a visitor.

## What changes from today's walk

- The sheet's peek becomes the nudge line ("Next: The well - 55 m ahead").
- The station list opens in the slot from a tap on the radar.
- The focus edge pill, the station edge arrows and the edge-hint tags are gone inside this variant.
- The toast becomes the nudge line.
- The radar keeps its place, shrinks to 78 px and drops its precision chip; a weak position shows as an amber dashed rim.

## Sweeps (demo panel)

- ranking order;
- close delay after leaving a place: 0.5, 1.5 or 3 s;
- leave margin (hysteresis): 0, 1.5 or 3 m;
- panel height cap: 25, 30 or 36 % of the height;
- how long news lingers;
- 6 or 8 items;
- position good or weak;
- the overlap outline;
- a portrait or landscape frame on a desktop.

## The strongest case against it

- **One slot means one thing at a time, behind a queue the visitor cannot see.** With two things playing and a story waiting, nothing on screen tells the visitor what is queued. They find out only by walking and tapping in the world, and a swipe can hide the only control of something that is still playing.
- **Without edge marks, an item out of view is found only if the nudge line names it.** A quiet item in a corner may never be named, because the line names one thing at a time and waits until it has been seen.
- **The line is text, and text is slow to read in sunlight while walking.** A glyph only asks to be seen; the nudge line asks to be read.
- **The slot morphs in place, so its content changes under the visitor's thumb** when the rank changes (for example a story step arriving while they reach for Pause). The fade and height animation soften this, but cannot remove it.

## Measuring hook

The readout at the top of the page shows, live:

- the HUD footprint (the union of the HUD boxes, the radar counted as a circle) as a % of the screen;
- the element count;
- the overlapping pairs, with a red outline on any box that overlaps another.

"Measure all beats in this frame" in the demo panel fills a table for the current viewport. It is also callable as `window.__proto.measureAll()`.
