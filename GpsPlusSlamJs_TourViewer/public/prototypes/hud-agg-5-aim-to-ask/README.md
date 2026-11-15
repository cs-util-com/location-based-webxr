# HUD aggregation: Aim to ask

A throwaway prototype of one direction for the visitor's AR view inside a station. It is a standalone page. It is not wired to the app. It uses three.js 0.185.1 from a CDN through an import map.

## The direction

- **There is a small ring in the middle of the screen.** No item-specific information is on screen until the visitor points the ring at something.
- **Pointing gives one label and one action**, next to the ring, for example "The market in 1958 / Walk closer · 4 m" or "The old fountain / Tap to read".
- **A tap acts on what the ring points at.** A tap anywhere on the camera counts, and so does a tap on the thing itself, so a visitor who stands still can still start everything (a tap is always enough).
- **Things out of view are one count and one direction at the foot**, for example "3 more, turn left". It names no item, so it is not a list. Only things not seen yet are counted, and the arrow gives the shorter turn to the nearest one.
- **At most one panel, and it grows out of the ring.** In portrait it sits low in the screen so the thing under the ring stays visible. In landscape it sits to the right of the ring. It closes when the visitor points away for 2 s (the ring drains while it counts down), when they leave the item's place, or on its close button.
- **Pointing at nothing, the place you stand in speaks**: inside the listening spot the label offers "Tap to listen" without the visitor having to aim at the ground.
- **The station you are in and the station you are not at look different.**
  - The things of the station you are in glow teal in the world, and each one answers the ring by name.
  - A station you are not at answers only as itself ("Old well / Next stop · 61 m"). Its things are grey, never named and never counted.
  - Once you have left a station, the station answers as a whole ("Market square / Left · 2 not seen").
- **What changes in the walk layer (W4):**
  - The radar stays while walking between stations.
  - Inside a station it shrinks to a 48 px dial: a teal ring for "you are in a station" and an orange dot at the next stop's bearing.
  - The walk sheet and the focus pill are dropped. The next stop is the beacon in the world, the dot on the dial, and the ring's answer when you point at the beacon. Between stations, the foot cue turns orange and points to the next stop.
  - The story card stops being a bottom sheet. It becomes the one panel at the ring.

## Ranking rule (which thing wins the screen)

1. **A story step, a quiz included, wins over everything.** While it shows, the ring names nothing and the foot cue hides. A playing narration pauses (and resumes after the step, if the visitor still stands in it). A film plays on silently. Free things show only in the world, as a pulsing glow.
2. **Otherwise, what the ring points at wins.** If two things are near the ring, the one nearest to its centre wins, with some stickiness, so the label does not flicker between them.
3. **Pointing at nothing:** the place the visitor stands in (the listening spot, a playing film's reach).
4. **Panels:** a panel opens only on a tap or on a start the visitor walked into. A new panel replaces the old one, and the old thing keeps running in the world.

## How the quiz enters (beat 6)

The story's next step arrives as the one panel at the ring. It holds the question as one line, four answer buttons, and one small line that says what the step did to the rest ("Listening paused · film silent while Mira asks"). The ring turns amber and small, and nothing else is on screen besides Exit and the dial. This page shows only how the quiz enters. It is not a full quiz player.

## A seventh and an eighth item

Nothing on screen grows. The count at the foot goes up, and the ring names each thing only while it is pointed at. Try "+2 items" under "Tune it" in the menu.

## The fixed demonstration

The arrows at the top step through the eight beats, and "Walk for me" plays them in order. The menu (the three lines) has the beat list, the knobs, the per-beat measurements and this text.

1. Arrive at the station: an arrival toast, and the welcome story step at the ring.
2. Stand still for 20 s, sped up: only the label of the pin ahead shows. Nothing starts.
3. Turn a full circle: the pin's panel drains and closes, then the label names each thing the ring passes. It ends on the film: "Walk closer · 4 m".
4. Walk toward the film: the metres count down. Walking into its 5 m reach starts it, and its panel opens.
5. Step into the narration while the film plays: the film's panel closes on leaving its reach, and the film plays on in the world. Inside the listening spot "Tap to listen" starts it. Stepping out pauses it and closes its panel, and stepping back in resumes it.
6. The story reaches the quiz (see above).
7. The position becomes weak: a "Position weak" chip appears under the dial, the dial goes grey, and every distance disappears from labels and the dial. The film, finished meanwhile, reads "Finished · Tap to watch again".
8. Leave toward the next stop: a toast, the dial grows back into the radar, a glance back names "Market square / Left · 2 not seen", and pointing at the beacon names "Old well / Next stop · 61 m".

**The measuring hook** is the dashed line at the foot. It shows the share of the screen covered by HUD boxes, how many HUD boxes there are besides Exit and the dial, and how many of them overlap. Overlapping boxes get a red outline. The menu keeps the highest values for each beat. The dashed yellow controls are demo chrome and are not measured.

## Knobs (this direction's own thresholds, swept on the page)

- How long you point away before a panel closes: 1 s, 2 s (default), 3 s, or never (only on leaving).
- How wide the ring catches: 5°, 9° (default) or 14°. A near thing always catches at its own angular size.
- Things out of view: a count with a turn (default), one dot each with no text, a small cue beside the ring, or none.
- The label: two lines (default) or one line.
- Six items, or six plus two more.

## The strongest case against it

- **Reading needs pointing.** To keep a panel open, the visitor has to keep the phone near the thing. Holding a phone up in daylight tires the arm, and a phone lowered to read turns the ring onto the ground. The 35° tolerance and the "never" knob soften this, but they also weaken the rule that a panel goes away when you look elsewhere.
- **Nothing introduces itself.** A thing you never point at never says what it is. The foot count is the only push, and it is easy to ignore. This is the opposite of what a first-time visitor who does not know what kinds of things exist may need.
- **Under a weak position the drawing drifts away from the real place.** The ring then points at the drawing, not at the statue or wall it belongs to, which makes the error more visible than in a design that never asks you to aim.
- **Things in a line share one ring.** The nearer one wins, and the farther one needs a step aside.
- **It counts the ring as HUD.** Beside Exit and the dial there are three boxes while walking (the ring, the label and the foot cue), one more than the assumed limit of two. Without the ring, the label has nothing to stand beside.

## What it leaves out

- No full quiz player, by the brief: the quiz round designs that.
- No real camera, no device orientation and no sound. Drag, the arrow keys or the beat buttons stand in for walking and turning.
- The picture's then-and-now compare is a simple drag split inside the panel, not the app's full-screen picture sheet.
- No screen-reader design, by the standing rule for the AR view.
- No `backdrop-filter` anywhere: every plate is a plain dark fill with alpha.
