# Calm HUD round 3, variant 1: the classic disc

A throwaway, standalone prototype. Nothing in the app links to it, and it does not use the app's code. It is one HTML file: three.js 0.185.1 by import map, metres, Y up, words in the world drawn as Canvas 2D textures. It carries over round 2's radar that wakes when you stop, its 8 beats and its idea of "seen", and answers five questions about that radar and the foot of the screen.

## The idea

- **A round radar at true scale.** Top right, heading-up, sleeping while you walk and waking when you stop, as in round 2. The scale is now linear: one metre is the same length anywhere on the disc. The range is fixed per step (outside: auto, 30, 100, 300 m; inside a station: fit to the station, 10, 30, 100 m). Everything within the range sits at its true place.
- **Everything beyond the range waits on the rim, in its true direction.** A single thing beyond the range is a hollow circle just inside the rim. Several beyond the range in about one direction (within 25 degrees of each other) merge into one thicker arc along the rim, as wide as the directions they cover. Nothing is pushed sideways to make room.
- **Circles only.** The radar holds circles, rings and arcs. No icons, no numbers, no letters. North is a short tick on the rim. The range is said in words only for 2 s after a tap, in a label under the disc, outside it.
- **No stutter.** The radar is a three.js object hung on the camera, drawn in the same render as the world, every frame. Nothing is redrawn on a 2D canvas. See "The stutter, measured" below.
- **At the foot, one small pill.** A play/pause of 40 px with its progress ring, the speaker's colour dot, and one line of words. Round 2's larger story card is gone.
- **The words line.** It shows what is being said now: a character's words as they are spoken (spoken words in full white, the rest of the line dimmer), or a video's or a sound's subtitle cue. It stays while the thing is out of view and while the sound is muted, because it is the HUD's job to carry words that the world cannot show you at that moment. It keeps no history: a line replaces the one before, and the line fades 1.2 s after its cue ends. Signs, captions and long texts stay in the world only, never in the line.
- **Show the way.** Inside a story, when the story waits for you at its next place and nothing has moved on for 60 s, a small round button appears in the pill. A tap sends a short drift of light along the ground toward that place. See below.

## The timings, and what to try

| Setting            | Default        | To try               | Why the default                                                                                                                                       |
| ------------------ | -------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stand still        | 3 s            | 2 s, 5 s             | As in round 2: waiting at a crossing does not flash it, someone who stops to wonder gets the answer before they ask.                                  |
| Fade               | 0.8 s          | 0.4 s, 1.5 s         | The radar never pops in the corner of the eye, and is readable within a second of waking.                                                             |
| Walking from       | 0.5 m/s        | 0.3, 0.8 m/s         | Walking is about 1.2-1.4 m/s; shuffling while looking around stays under 0.5 m/s once smoothed.                                                       |
| Range outside      | auto           | 30, 100, 300 m       | Auto fits the stations still to find, as built. A fixed step shows how the rim carries the rest.                                                      |
| Range inside       | radius x 1.5   | x 1.2, x 2           | The whole station fits with a margin, so most of its things sit at their true places and only far ones go to the rim.                                 |
| Rim merge          | 25 degrees     | 15, 40 degrees       | Two hollow circles closer than about their own width read as one blob; an arc says "several, that way" without a count.                               |
| Words lines        | one            | two                  | One line keeps the pill small. Two lines show more of a long sentence at once, at the cost of height.                                                 |
| Words size         | medium         | small, large         | 14.5 px reads at arm's length on a phone in daylight. Large is for comparison.                                                                       |
| Speaker name       | dot only       | dot and name         | The dot's colour is the character's coat, so the line says who speaks without a word. The name is one tap away for comparison.                        |
| Bubble             | dots           | words, none          | The words are at the foot already. The bubble over the speaker only says "this one is talking".                                                      |
| Subtitle hold      | 1.2 s          | 0 s, 3 s             | Bridges the short gaps between cues, so the line does not blink off and on between two sentences.                                                    |
| Show the way after | 60 s           | 30 s, 120 s          | Long enough that someone who is looking around, reading or chatting is never nudged. Short enough that someone truly lost is not left alone for long. |
| Arrived within     | 4 m            | 2, 6 m               | A story step's place counts as reached within 4 m: close enough to see the thing, loose enough for GPS.                                              |
| Radar drawing      | disc (3D)      | canvas               | The canvas is round 2's 15 Hz radar, kept for comparison.                                                                                             |

Use the settings panel (the menu at the top right, or beside the phone on desktop), or URL options: `?still=3&fade=0.8&walk=0.5&range=auto&fit=1.5&merge=25&lines=1&strip=m&name=off&bubble=dots&hold=1.2&hint=60&arrive=4&radar=disc`. Round 2's options `edge`, `between` and `beam` still work.

## The stutter, measured

The question was whether round 2's radar stutters because drawing it is slow or for another reason. `HC.bench()` runs a scripted 20 s walk (north at 1.3 m/s, the view swinging left and right, the radar held awake) with round 2's canvas radar and with the 3D disc, and records every frame. Headless Chromium on a software renderer, 390 x 844; three runs of each at device pixel ratio 1, one at ratio 2.

- **Frame interval (median / 95th percentile / worst):** canvas 16.7 / 33.3-50 / 150-417 ms; disc 16.7 / 33.3-50 / 83-200 ms.
- **Radar time per frame (median / 95th percentile):** canvas 0.3-0.5 / 1.0-5.7 ms per draw; disc 0.1 / 0.4-0.9 ms.
- **How often the radar's picture changes:** canvas 12.2-12.9 times a second, a median gap of 83 ms; disc 47-55 times a second, a median gap of 16.7 ms (every frame drawn).
- **Round 2's page itself, timed from outside during its beat 1:** median 16.7 ms, 95th percentile 33.4 ms, worst 133 ms.

**What the numbers say.** The drawing is cheap in both: well under a millisecond in the median, a few percent of a frame. The worst frames are the software renderer's, in both modes alike (its render step alone reaches 60-150 ms), so they say nothing about the radar. The difference that is measured is the cadence: the canvas radar redraws at most 15 times a second (12-13 in practice), while the heading changes every frame, so a visitor who turns sees the heading-up disc rotate in steps of about 80 ms. That is the stutter this page can show. The disc changes with every frame of the world, so it turns smoothly.

**What it does not say.** None of this was measured on a phone, and the built radar's own measurement (1.3-1.5 ms a draw on desktop) is on a different machine. If a phone shows frame drops while the radar draws, that is a second cause this page cannot find.

## Show the way: the hint

The look is round 2's wind, page 4: a short drift of warm light motes that starts in front of you, low over the ground, and flows toward the story's next place. If that place is behind you, the drift bends round your shoulder; if it is near, it ends a little short of it; if it is far, it gives a direction and stops 9 m out. It lasts 3 s and then is gone. Nothing stays in the world, and nothing is added to the radar.

What is different from page 4:

- **It is offered by time, not called.** The button is not there until a story has waited 60 s at a step whose place you have not reached, with nothing moving on. A step only waits that way when it has a place (in the demo: the rim stone in "Water for all", the arch's keystone in "Raising the arch"). Any progress (reaching the place, a new step, leaving the story) resets the clock and hides the button.
- **It is a plain icon, not a phrase.** A round button with three wind lines, inside the pill, between the words and the leave button. Its accessible name is "Show the way to the story's next place". A short icon fits the pill without pushing the words line away, and no name is needed on screen because the button only ever appears in one situation: lost in a story. A named action ("Call the wind") would ask the visitor to learn a piece of fiction for a one-off help.
- **No guide is asked, and nothing glows.** The hint does not involve a character, and it does not mark the thing itself; it only shows the way there.
- **It never repeats on its own.** After the drift, the button stays for another tap. It goes when the story moves on.

## Author settings

Three switches an author would set in the editor, shown live in the settings panel under "Author settings":

- **Shown on the radar** (tour, station, story, item): whether a thing is a mark on the radar at all.
- **Hints allowed** (tour, station, story, item): whether "show the way" is ever offered.
- **Radar at all** (tour and station only): whether the radar is there.

Each switch at every level below the tour starts at "as above". **The nearest level that says yes or no wins: item, then story, then station, then tour.** A thing's story is the story it belongs to; a story's station is the station of the character who starts it. The tour level is always yes or no.

Examples: station B set to "not on the radar" hides all of B's things, but one item at B set to "yes" still shows. A story with hints off never offers "show the way", even when the tour allows hints. "Radar at all: no" at station B removes the radar while you are inside B, and it comes back when you leave.

In the panel each button cycles "as above", yes, no; the button says what it resolves to. Four presets set one switch each, and URL `?author=b-off,lion-off,well-nohint,radar-b-off` sets them from the start (any subset).

## Words and cues

- **Characters' words** are timed per word, as a voice's word-boundary events would give them: each word's length follows its letters, with a pause after a comma or a full stop (about 155 words a minute). The line shows the sentence that is being spoken, cut to the pill's width at word boundaries without reading the layout; the spoken part is full white, the rest at 42 %.
- **Video and sound subtitles** are WebVTT cue lists, one per item ("Drawing water, 1938" and "The bucket chain" at A, "Casting the bell, 1951" and "The hall's echo" at B). The cue that is playing now is the line; between cues the line holds 1.2 s, then fades.
- **The dot's colour** is the speaker's coat, or white for a video or sound.

## What the HUD holds

- **Exit**, top left.
- **The radar**, top right: asleep while you walk, awake when you stop. "Range: ..." under it for 2 s after a tap.
- **At the foot, one pill at most:** play/pause with a progress ring, the speaker's dot, the words line, and while a story runs a Next and a leave button. "Show the way" joins it only when offered.

Everything else stands in the world, as in round 2.

## The never-list, item by item

- **A list of the station's items in the HUD:** there is none. The radar shows circles without names, and the words line only ever holds what is being said now.
- **Per-item markers on the HUD or the screen edges:** none. Marks exist only inside the radar disc, and the far ones on its rim, which is part of the map.
- **A floating icon over every item by default:** none.
- **A HUD whose content follows the gaze:** the HUD depends on where you stand, whether you walk, and what is playing; never on what you look at. The words line stays when you look away from the speaker.
- **A HUD label for a station:** none. Stations are circles; the next one is orange.
- **Icons or text in the radar:** none. Circles, rings and arcs only. The range label sits outside the disc and only after a tap.
- **Approach sounds:** none.
- **Aim-to-ask:** none. Things react to a tap or to standing near and looking.
- **A 2D copy of a 3D text:** none. Signs, captions and long texts are never put into the words line.
- **A transcript or history:** none. The words line holds one line and replaces it.
- **Radar marks drifting from their true positions:** none. Inside the range every mark is at its true bearing and linear distance; beyond it, at its true bearing on the rim. Close marks overlap where they are, unseen on top.
- **A card outliving its place:** the play/pause hides when you leave the thing's reach. The story pauses when you leave its station.
- **Two stacked panels:** the foot holds one pill at most, and "show the way" sits inside it. The measuring hook checks for overlaps in every beat.
- **A hint volunteered repeatedly:** "show the way" is offered once per wait, never played on its own, and goes as soon as the story moves on.
- **A hint that names or marks the thing:** none. It shows a way, not the answer.
- **`backdrop-filter`, thin light strokes:** none. The pill is solid with a 2 px border.
- **Any frame over 50 ms:** headless runs show them in both radar modes alike, from the software renderer; see "The stutter, measured". A phone is what decides.
- **A demo that opens already inside a story:** the page opens outside station A, on the lane, with the beam ahead.

## The look is not the direction

This page builds its own invented square, houses, characters and props, taken over from round 2. Judge the radar and the foot of the screen apart from the art: none of this scene is a proposal.

## The case against

- **Linear scale crowds a station's centre.** Round 2's square-root scale gave near things more room. With a linear scale, things 2 m apart at a 30 m range are 4 px apart on the disc. A tap to 10 m pulls them apart, but that is a tap.
- **An arc on the rim says "several" but not how many.** A visitor who wants to know must turn and walk that way.
- **The words line is one more thing at the foot during a story.** It is small, but it moves while someone talks. Someone who wants silence on the screen can only mute the whole HUD.
- **60 s is a guess.** Nobody has walked a story on a phone with this page; real visitors may wait much longer by choice, or give up sooner.
- **The radar in 3D is drawn by the same renderer as the world.** On a phone in AR the camera's projection differs from this page's; the disc must be placed against the real projection, which this page does not test.

## The demonstration

The same two invented stations as round 2: "The well court" (A, radius 18 m) and "The hall steps" (B, radius 20 m), about 83 m apart, 7 and 9 things.

- **Beat 1:** Walk up to the beam with the radar asleep. Crossing the edge wakes it; the stations fade out and the things fade in.
- **Beat 2:** Stand still: the radar wakes with A's things, all white. A tap steps the range to 10 m: the far things go to the rim, and those in about one direction merge into an arc.
- **Beat 3:** Greta's story: her words run in the pill, word by word. The story waits for you at the rim stone, then goes on.
- **Beat 4:** Look around: a picture, the lectern and the lion are seen, and turn grey.
- **Beat 5:** Play the video, turn away: its subtitles stay in the pill. Pause it from the pill.
- **Beat 6:** A sign and a sound 2.3 m apart: they overlap at their true places. Step the range in and they stand apart; the far things sit on the rim as hollow circles.
- **Beat 7:** Leave with things unseen: back to stations. A grey with a white centre, B orange.
- **Beat 8:** Station B: stand still, three characters. Tap the baker to hear his story.
- **Beat 9:** Lost in a story. "Water for all" waits for you at the rim stone, and nothing happens for a while. The round button appears in the pill; a tap sends the drift toward the stone. Walk there and the story goes on.

To try it, use the beat stepper (the arrows at the top) or walk freely. Drag sideways to turn, drag up to walk; on desktop use W A S D or the arrows. The measuring hook is behind the ruler button: HUD coverage, element count, overlaps, the radar's state, marks, rim circles and arcs, and frame times. `?shots` pauses at every key moment (`HC.resume()` continues), and `?speed=3` runs the beats faster. `HC.bench({ seconds: 20, radar: 'canvas' })` runs the scripted walk below.
