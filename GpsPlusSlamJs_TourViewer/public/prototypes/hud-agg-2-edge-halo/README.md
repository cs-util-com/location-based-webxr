# HUD aggregation, direction "Edge halo"

A throwaway prototype of the visitor's AR view inside a station. Open `index.html`; it is self-contained (three.js 0.185.1 from a CDN by import map) and is not wired to the app.

## The direction

- **The middle of the screen belongs to the world.** Nothing item-specific sits there except one caption for the item you are looking at.
- **The border is the HUD.** Every item of the station you are in that is out of view is one coloured mark on the screen's border, at its bearing:
  - left and right edges for items to the side, the top edge for items above;
  - the bottom edge for items behind you, with a nub pointing the shorter way to turn;
  - the colour and the small symbol inside say the kind (pin, model, picture, film, narration, guide/quiz, sign, sound zone);
  - brightness says how near; a slow pulse says "this waits for you"; a white ring round the mark is the progress of something playing; a hollow mark was already seen or heard.
- **No text and no distances on the border.** Turning toward a mark makes it slide along the border and melt into its item (a short flight from the edge to the item and a ring where it lands). Only then does a one-line caption appear over the item ("Market day film · walk closer · 4 m", "tap to play").
- **The frame says where you are.** Inside a station the border carries a faint teal glow; it turns amber when the position is weak and yellow while a quiz waits for an answer.
- **The foot keeps one small control** for what is playing, or for the sound circle you are standing in (it is at your feet, so it cannot have a caption). Cards you open (a pin's text, the picture, the model's notes) and the story take the same place, one at a time.

### What it changes in the built walk layer

- The radar is replaced by the border: the frame *is* the radar unrolled. Outside a station the border shows stations as dots, the next one as an orange flag mark.
- The focus pill and the framework HUD's edge arrows are folded into the border, and so are the short text's edge-hint tags: one edge system instead of three.
- The walk sheet's peek is gone inside a station. The next station joins the border only once the station is done (its story finished), and in view it is the beacon plus one caption ("The well · 38 m").
- Left out: the station list and the progress segments. They would need an entry point (for example a pull at the foot); not designed here.

## Items of this station and everything else

- Inside a station: one mark per item, and the tinted frame. Other stations are not shown.
- Outside a station: no item marks at all. Stations are dots; the next one is the orange flag. Items of a station you are not at show only their look in the world.

## Ranking rule

- **Border:** every item out of view keeps a place. Above the symbol limit (default 3, try 4 or all) the order is playing, waiting for you, not yet seen, paused, seen; nearer before farther. Below the limit a mark becomes a plain dot, so nothing vanishes.
- **Middle:** one caption, for the item in view nearest the middle of the screen. The current one keeps it until another is clearly nearer the middle, so it does not flicker.
- **Foot:** the story if it speaks, else a card you opened, else what is playing (or the circle you stand in).
- **One voice:** starting a sound pauses the other. The story pauses free sound and hands it back when it ends. Free items show only their world glow while the story is on screen.
- **Leaving:** a card or control closes 1.5 s (try 0.8 or 3) after you leave its place, with a margin so a jittering position does not flicker it. A sound paused by leaving carries on when you come back. Nothing starts by nearness: a tap starts everything.

## A seventh and an eighth item

They get marks like the others. The symbol limit keeps the frame readable; beyond it a mark is a dot ranked as above. The page can add a sign and a sound zone to try it.

## The fixed demonstration

Eight beats, from the demo bar at the top (dashed, not part of the design): arrive, stand still 20 s, turn a full circle, walk toward the film, step into the narration while the film plays, the story reaches the quiz, the position becomes weak, leave toward the next station. The play button runs them all. The gear opens the thresholds and the measured table per beat and orientation.

The quiz is shown only where it enters: the guide's story takes the foot, the border clears, the frame turns yellow, and the four answers replace Continue. A world quiz would put its answer places on the border as the only marks.

## Measuring hook

- The demo bar's last line: HUD footprint (share of the screen under HUD boxes, without and with the frame's glow band), element count (Exit, the frame, each mark, the caption, the foot card, the toast), overlaps, and the slowest frame's work time.
- Any two HUD boxes that overlap are outlined in red. "Measuring boxes: on" outlines all of them.
- `window.__hud.LOG` holds the maximum per beat for each screen size.

## The strongest case against it

- The edge of a phone is where attention is weakest. In bright sun a 20 px mark at the border may not be seen at all, and the design puts everything there.
- Bearing is only as good as the position. A 3 m item swings round the frame when the position moves a few metres; when the position is weak the marks have to widen into arcs that say little.
- Colour carries the kind. Eight kinds are near the limit of colours told apart at a glance, and the symbol inside a 20 px mark is small.
- Nothing on the border is tappable: a visitor cannot ask "what is that mark?" without turning toward it.
- The frame's glow band costs about 5 % of the screen on its own if counted as HUD, more than the whole HUD of the leanest other directions.
