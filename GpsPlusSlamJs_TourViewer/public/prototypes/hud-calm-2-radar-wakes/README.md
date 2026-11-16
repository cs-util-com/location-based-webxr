# Calm HUD round 2, direction 2: the radar wakes when you stop

A throwaway, standalone prototype. Nothing in the app links to it, and it does not use the app's code. It is one HTML file: three.js 0.185.1 by import map, metres, Y up, words in the world drawn as Canvas 2D textures.

## The idea

The radar that is already built stays in its place: 132 px, top right, heading-up, with the range-step tap. What changes is when it shows and what it shows.

- **While you walk, it sleeps.** It fades to a faint ring (14 % opacity), which tells you where it is without asking for a look. The street gets the screen.
- **When you stand still, it wakes.** After a few seconds without walking, it fades back in. Turning on the spot counts as standing still, so you can stop, look around and read the radar together.
- **Outside a station it shows stations only**, exactly as built: the next one is orange with its number, the ones not yet visited are dark with a white ring, and visited ones are grey. A grey one with a white centre still has something unseen.
- **Inside a station it shows the station's things at their true places.** The range fits the station: its radius times 1.5. White means still to see, grey means seen. Every mark is drawn at its true place, always. Grey marks are drawn first and white ones on top, so a seen thing never hides an unseen one. Two marks on almost the same spot get a slightly larger white ring, with no number (a number would read like a station). A tap that steps the range in pulls close marks apart, because the map grows, not because they move. A thing beyond the range shows as a hollow mark at the rim, as the built radar clamps its blips.
- **At the station edge the radar switches.** Crossing the edge wakes it for 3.5 s, even while walking. Over about one second the station's dot grows into its true outline (dashed), the other stations fade out and the things fade in. Leaving does the reverse.
- **A tap on the sleeping radar wakes it** for 6 s. A tap on the awake radar steps the range. Inside a station the steps are: fit to station, 10 m, 30 m and 100 m. Outside they are the built auto, 30 m, 100 m and 300 m. "Range: ..." shows for 2 s, and the step resets at every edge.

## The timings, and what to try

| Setting          | Default  | To try                   | Why the default                                                                                                                                                                              |
| ---------------- | -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stand still      | 3 s      | 2 s, 5 s                 | Long enough that waiting at a crossing or for a companion to catch up does not flash it. Short enough that someone who stops to wonder "what else is here?" gets the answer before they ask. |
| Fade             | 0.8 s    | 0.4 s, 1.5 s             | Slow enough that the radar never pops in the corner of the eye. Fast enough to be readable within a second of waking.                                                                        |
| Walking from     | 0.5 m/s  | 0.3 m/s, 0.8 m/s         | Walking is about 1.2-1.4 m/s. Shuffling while looking around stays under 0.5 m/s once smoothed. The speed is the pose's speed, smoothed over about half a second.                            |
| At the edge      | wakes    | stays asleep             | The switch from stations to things is the moment the radar's meaning changes, so it is shown once.                                                                                           |
| Between stations | sleeps   | always on                | The built radar is always on between stations. Use "always on" to compare.                                                                                                                  |
| Beam             | as built | round 1                  | See below.                                                                                                                                                                                   |

Use the settings panel (the menu at the top right, or beside the phone on desktop), or URL options: `?still=3&fade=0.8&walk=0.5&edge=on&between=wake&beam=built`.

Real phone pose has jitter. The real threshold must be checked against recorded walks before anything is built. This page cannot answer that.

## The beam

The default is the **built W4 beacon**: a thin orange six-sided column from 4 to 26 m, whose width grows with distance, plus a ground ring at the station's radius. It is already in the app. The ground ring marks exactly the edge where this radar switches, so the two explain each other. The round-1 beam (8 cm, with a white gem) is one tap away for comparison. A station's beam fades out once you are inside it, and stays off once it has been visited.

## What "seen" means here

- **Short text:** in view within 8 m for 1.5 s.
- **Picture:** in view within 10 m for 2 s.
- **Model:** in view within 10 m for 3 s.
- **Long text:** its last page was shown. Tap the lectern to turn pages.
- **Video, sound:** played to the end. Stopped part way, it stays white.
- **A character who starts a story:** that story played to its end. Its inner steps are not marks; the story owns them.

"In view" means within the camera's horizontal field of view.

## What the HUD holds

- **Exit**, top left.
- **The radar**, top right: asleep while you walk, awake when you stop.
- **At the foot, one thing at most.** Either the running story's step control (a dot in the colour of the person you entered it through, the story's title, "With <name>, step n of m", Next, leave), or one play/pause with a progress ring for the playing video or sound. The play/pause shows only while you are within that thing's reach, so you can pause it while it is out of view. Leave its reach and it pauses and hides; come back and it carries on. During a story, a tapped video plays with its in-world control only, so two panels never stack.

Everything else stands in the world. Texts are on boards and lecterns. Captions are under pictures and screens. Spoken lines are in a bubble over the speaker. Story titles at station B are on plaques at the characters' feet.

## The never-list, item by item

- **A list of the station's items in the HUD:** there is none. The radar shows marks without names.
- **Per-item markers on the HUD or the screen edges:** none. Marks exist only inside the radar disc, which is a map, not an overlay on the view.
- **A floating icon over every item by default:** none. Only the audio item has particles, and those belong to the item itself.
- **A HUD whose content follows the gaze:** the HUD content depends on where you stand and whether you walk, never on what you look at.
- **A HUD label for a station:** none. Station names are not shown at all; stations are numbered blips, as built.
- **Approach sounds:** none.
- **Aim-to-ask:** none. Nothing reacts to the crosshair; things react to a tap or to standing near and looking.
- **A 2D copy of a 3D text:** none. The long text pages turn on the lectern itself.
- **Radar marks drifting from their true positions:** marks are drawn at their true bearing and square-root distance, and are never pushed apart. Close marks overlap where they are, unseen on top, and a ring marks two on one spot; stepping the range in pulls them apart. The only displacement is the built clamp of things beyond the range to the rim, drawn hollow so it reads as "further".
- **A card outliving its place:** the play/pause hides as soon as you leave the thing's reach. The story control hides when you leave its station; the story pauses (the bubble shows "...") and carries on when you tap its character again.
- **Two stacked panels:** the foot holds one thing at most, and the measuring hook checks for overlaps in every beat.
- **Anything starting by nearness alone for a visitor standing still:** only Greta's greeting at station A, the deliberate exception, once per visit. Station B's characters only turn toward you; you tap one to start.
- **A hint volunteered repeatedly:** the first-run card ("Walk up to the orange beam...") shows once and goes at the first touch or after 12 s. Waking the radar is a state, not a hint: it shows the same map whenever you stop, with nothing added.
- **`backdrop-filter`, thin light strokes:** none. Plates are solid with 2 px borders. The radar keeps its built look.
- **Any frame over 50 ms:** the town is two instanced draw calls. The radar redraws at 15 Hz on a small canvas. The readout's worst frame shows the measurement. Headless screenshots run on a software renderer, so their frame times say nothing about a phone.
- **A demo that opens already inside a story:** the page opens outside station A, on the lane, with the beam ahead.

## The look is not the direction

This page alone builds its own invented square, houses, characters and props. The sibling pages share another scene. Judge the direction (when the radar shows, and what it shows inside and outside a station) apart from the art: none of this scene is a proposal.

## The case against

- **Inside a station the radar is awake most of the visit.** A visitor in a station mostly stands: reading, watching, listening. With a 3 s stand-still time the radar wakes within seconds of every stop, so inside a station it sleeps mainly on the short walks between things. The calm it buys is mostly on the way to a station and between stations. A longer stand-still time (5 s) helps only a little; "always on inside, asleep between" may be the honest reading of this direction.
- **The radar still names nothing.** It says how much is left and roughly where, not what. A visitor who wants to know what a white mark is must walk to it.
- **Real pose jitter is untested.** The walking threshold rests on a smoothed simulated pose. On a phone, jitter could keep the radar awake while walking slowly, or asleep while shuffling.

## Story titles: no picker

This page shows no list or picker of story titles. At station B each story's title stands on a plaque at its character's feet, and a tap on the character enters it. If this direction were chosen, the plaques would replace the built picker of story titles. Whether the app keeps the picker as a fallback, for a station whose characters stand far apart, is a separate decision this page does not test.

## The demonstration

There are two invented stations on an invented square: "The well court" (A, radius 18 m) and "The hall steps" (B, radius 20 m), about 83 m apart. Each has 7 or 9 things: characters, a short text, a long text, a picture, a video, a sound with particles and a model.

- **Beat 1:** Walk up to the beam with the radar asleep. Crossing the edge wakes it and the switch to things plays. Greta greets once, when you are within 12 m of her, not at the edge.
- **Beat 2:** Stand still: the radar wakes with the station's things, all white.
- **Beat 3:** Greta's story: three steps, the rim stone, Done.
- **Beat 4:** Look around: a picture, the lectern's three pages and the lion are seen. Stand still: they are grey (the consumed beat).
- **Beat 5:** Play the video, turn away, pause it from the HUD.
- **Beat 6:** A sign and a sound 2.3 m apart: their marks overlap at their true places, the unseen sound on top. Tap to 10 m and they stand apart.
- **Beat 7:** Leave with things unseen: the switch back to stations. A shows grey with a white centre, B orange.
- **Beat 8:** Station B: no greeting. Stand still: three characters, white. Tap the baker to enter his story.

To try it, use the beat stepper (the arrows at the top) or walk freely. Drag sideways to turn, drag up to walk; on desktop use W A S D or the arrows. The measuring hook is behind the ruler button: it shows HUD coverage, element count, overlaps, the radar's state, walking or still time, marks and stacked marks, and the worst frame. A per-beat table is in the settings panel. `?shots` pauses at every key moment (`HC.resume()` continues), and `?speed=3` runs the beats faster.
