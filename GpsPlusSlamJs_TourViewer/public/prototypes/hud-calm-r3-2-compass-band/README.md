# Calm HUD round 3, variant 2: the compass band

A throwaway, standalone prototype. Nothing in the app links to it, and it does not use the app's code. It is one HTML file: three.js 0.185.1 by import map, metres, Y up, words in the world drawn as Canvas 2D textures.

## The idea

- **The radar is a thin band along the top edge**, like the compass of a game: the middle is straight ahead, left is left. It is 30 px high and at most 440 px wide. It holds circles only: no icons, no letters, no numbers. A small caret marks straight ahead, two faint ticks mark the edges of what the camera sees, and one taller tick marks north.
- **Every circle sits at its true direction.** Nothing is pushed apart. The band covers 180 degrees around the heading by default. A thing behind you, outside that span, sits at the band's end on its side, as a hollow ring, the way the built radar clamps a blip to its rim. With the span set to "all round" (360 degrees), nothing is clamped.
- **Distance has a straight-line scale.** Inside the range, a circle shrinks from 7.5 px (at your feet) to 3.5 px (at the range) and fades from full to 55 % brightness, in proportion to the distance. Twice as far is twice as much smaller, never a square root and never a log.
- **Beyond the range, a thing is a faint hollow ring at its true direction**, not at the band's end. The band's ends already mean "behind you"; putting far things there too would give one place two meanings, and would hide which way a far thing lies. The ring is the same size for every distance beyond the range, so it says "further than the range" and nothing more.
- **It wakes when you stop, as on page 2.** While you walk it sleeps at 14 % opacity, so you know where it is. After 3 s without walking it fades in. Crossing a station's edge wakes it for 3.5 s; a tap on the sleeping band wakes it for 6 s; a tap on the awake band steps the range.
- **Outside a station: stations only.** The next one is orange and filled, with a slow pulse; one not yet visited is a white ring; a visited one is grey, with a white centre while it still holds something unseen.
- **Inside a station: its things.** White is still to see, grey is seen. The range is the station's radius times 1.5, so the band fits the station; a tap steps it to 10, 30 and 100 m. Grey circles are drawn under white ones, so a seen thing never hides an unseen one.
- **The caption line sits under the band's centre**, like a film subtitle with its one control on the left: a small play/pause with a progress ring, the speaker's colour dot, and the words. See below.

## The five points, one by one

1. **No distance distortion.** The square-root scale of page 2 is gone. The scale is linear from 0 m to the range, and the range is a fixed number of metres around you: the station's radius times 1.5 inside, the built adaptive range outside, or a tapped step.
2. **The stutter.** Page 2 drew its radar on a 2D canvas at most 15 times a second. Here the band is a three.js group, a child of the camera, rebuilt every frame from the pose: no canvas and no layout read in the frame (the band's size is read again only after a resize, or when the band shows again). The frame still writes to the DOM where something changed: the band's opacity and the caption line. The measurement below names what the stutter was.
3. **Circles only.** The band holds discs and rings, nothing else. Stations carry no numbers.
4. **Play/pause.** It is 36 px, sits at the left of the line it controls, and its progress ring belongs to the words beside it, so it never stands alone without context.
5. **Spoken words and subtitles in the HUD.** The caption line shows what sounds now, by priority:
   - a character speaking in a story: the line's words appear as they are said (bright when said, dim until then), after the speaker's first name;
   - a video or sound playing (or paused by you) within its reach: its current subtitle cue, from a WebVTT cue list, with the speaker's name where the cue carries a `<v Name>` voice tag;
   - for 2 s after a tap on the band: the range;
   - otherwise, in a story: its title and step ("Water for all, step 2 of 3").
   - It stays while the source is out of view, and on a muted phone. One or two lines, no history: the line shows only the chunk of words being said. When nothing speaks, it fades out.
   - **Signs and long texts stay in 3D only.** The 3D speech bubble of page 2 is gone, so the words exist once, in the line; over the speaker floats only a small dot in their coat colour, the colour of the line's dot.

## The hint: "Show the way"

- **What it does:** it is page 4's drift of light motes, made generic. In a story's search step ("find the stone on the rim"), a tap sends the motes along the ground from in front of you toward the place the story sends you to, once. A far place gets a direction, never its spot: the drift ends at most 9 m out. If the place is behind you, the drift bends round your shoulder, never through the camera.
- **When it is offered:** only in a search step, only where the author allows hints, only after you have stood still for 8 s (longer than the band's 3 s, so the band answers "what is around?" first, and the hint comes only to someone who is still searching). Walking hides it and starts the clock again. It is never shown twice without another full wait, and it never shows by itself in the world: it is a small button at the right of the caption line, which you may ignore.
- **Its name:** the control is an icon (a trail of three dots), with the accessible name "Show the way". "Call the wind" names the picture and not the purpose, and a visitor would have to learn it. "Show the way" says what happens.
- **Not used:** the mechanisms of pages 1 and 3, which were rejected.

## Author settings

Two switches exist on four levels, and a third on two:

- **"On the radar"** (is this thing a circle on the band?) and **"hints"** (may the hint lead to it?): tour, station, story, item.
- **"Radar"** (is there a band at all?): tour and station only.
- **Every switch except the tour's says "as above" until it is set. The nearest level wins: item over story over station over tour.** An item belongs to a story when it starts the story or when the story sends you to it.
- **The starting preset:** the page opens on "Starting example", not on "as above" everywhere. In it, the story "Water for all" sets "on the radar: no", because the rim stone is a thing to find. Greta, who starts that story, sets "on the radar: yes" on herself, and wins over her story: she is on the band and the stone is not. The preset "Every switch as above" clears both.
- **In the settings panel** a tester flips any switch (as above, yes, no) and the band and the hint obey at once. Each item shows what applies to it and from which level. Presets: station B's items off the band; the lion at station A off the band; no hints in "The cracked bell"; the starting example; every switch as above.
- The authoring side (an editor that shows, at every item, what applies and from where) is a later step and is not on this page.

## The timings and sizes, and what to try

| Setting          | Default        | To try         | Why the default                                                                                                                                         |
| ---------------- | -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stand still      | 3 s            | 2 s, 5 s       | As page 2: long enough that waiting at a crossing does not flash it, short enough to answer "what else is here?" before it is asked.                    |
| Hint offer       | 8 s            | 5 s, 15 s      | Well after the band (3 s), so the band answers first. 5 s offers help to someone still reading the band; 15 s may be too late for an impatient visitor. |
| Range inside     | radius x 1.5   | x 1.2, x 2     | The whole station plus its edge. At x 1.2 near things spread more; at x 2 the next station's area starts to show.                                       |
| Band shows       | 180 degrees    | 240, all round | 180 degrees keeps the band's middle wide, so things ahead spread out. 240 shows more behind you. All round clamps nothing but squeezes everything.      |
| Caption size     | medium (15 px) | small, large   | Readable at arm's length outdoors without covering the view. Large is for poor eyesight; small fits more words in landscape.                            |
| Caption lines    | 2              | 1              | Two lines hold most spoken sentences whole. One line is calmer but changes more often.                                                                  |
| Fade             | 0.8 s          | 0.4 s, 1.5 s   | As page 2.                                                                                                                                              |
| Between stations | sleeps         | always on      | As page 2; the built radar is always on between stations.                                                                                               |

Use the settings panel (the menu at the top right, or beside the phone on desktop), or URL options: `?still=3&hint=8&fit=1.5&span=180&strip=m&lines=2&fade=0.8&between=wake`.

Real pose jitter is untested: the walking threshold (0.5 m/s, smoothed over half a second) must be checked against recorded walks before anything is built.

## Measured: why page 2's radar stuttered

A scripted 20 s walk (forward the whole time, turning left and right in turn every 3 s), the same on both pages, through `HC.bench(20)` and an equal timer on page 2, headless Chromium on a desktop (software rendering; a phone's numbers will differ):

Three runs of each condition, frame intervals in ms (median / 95th percentile / worst), and the radar's redraws a second:

| Condition                          | Run 1             | Run 2            | Run 3             | Radar redraws/s |
| ---------------------------------- | ----------------- | ---------------- | ----------------- | --------------- |
| Page 2, canvas radar (15 Hz cap)   | 16.7 / 16.8 / 17  | 16.7 / 16.8 / 67 | 16.7 / 16.8 / 267 | 12.6-13.3       |
| Page 2, radar hidden (control)     | 16.7 / 16.7 / 17  | 16.7 / 16.7 / 33 | 16.7 / 67 / 517   | 0               |
| This page, band (every frame)      | 16.7 / 16.8 / 100 | 16.7 / 16.8 / 83 | 16.7 / 83 / 300   | 60 (each frame) |
| This page, band off by the author  | 16.7 / 16.8 / 100 | 16.7 / 16.8 / 133| 16.7 / 16.8 / 67  | 0               |

(Page 2's first run logged one page error and no radar redraws, so its 13 a second comes from runs 2 and 3; an earlier pair of runs gave 13.3 and 10.7.)

- **What the numbers say:** the median frame is 16.7 ms (60 frames a second) in every condition, with or without a radar. The worst frames come and go with the machine's load: the control without any radar had the worst frame of all (517 ms), so they are not the radar's cost. On this machine the canvas radar did not make frames slower.
- **What they also say:** page 2's radar redrew 12.6 to 13.3 times a second while the view moved 60 times a second (the 15 Hz cap falls on every fourth or fifth frame). A heading-up radar turns with every turn of the phone, so its picture jumped in steps of 75-80 ms against a smooth view behind it. That step is the stutter that this measurement supports: an update rate, not a slow frame.
- **What this page changes:** the band moves with the camera in every frame it renders, so it cannot lag the view by a step.
- **What it cannot say:** a phone's GPU and a canvas texture upload are not measured here (headless software rendering). If the phone's radar also dropped frames, the phone's own frame line must show it; this page's readout shows the worst frame live.
- **A confound, now removed:** the measuring hook's `measure()` used to run every 150 ms even with the hook off, here and on page 2. It forced a layout through `getComputedStyle` and walked about 20,000 grid points. It now runs only while the hook is on (the ruler button, or `?measure` in the URL), which is off by default. The stutter's cause was measured in headless runs as the 12-13 Hz redraw cadence; this loop could have added to it on a phone, and a check on a 60 Hz phone settles it.

## What "seen" means here

- **Short text:** in view within 8 m for 1.5 s.
- **Picture:** in view within 10 m for 2 s.
- **Model:** in view within 10 m for 3 s.
- **Long text:** its last page was shown. Tap the lectern to turn pages.
- **Video, sound:** played to the end. Stopped part way, it stays white.
- **A character who starts a story:** that story played to its end.
- **A place a story sends you to** (the rim stone, the bell piece): reached, within 2.5 m, while that story runs. The story then goes on by itself.

"In view" means within the camera's horizontal field of view.

## What the HUD holds

- **Exit**, top left.
- **The band**, top centre: asleep while you walk, awake when you stop.
- **The caption line**, under the band, only while something speaks or a story runs: its control (play/pause, or Next and Done between a story's steps), the speaker's dot, the words, and in a story the hint (when offered) and leave.

Everything else stands in the world: signs, long texts, captions under pictures and screens, story titles on plaques at the characters' feet, the beam.

## The never-list, item by item

- **A list of the station's items in the HUD:** there is none. The band shows circles without names.
- **Per-item markers on the HUD or the screen edges:** none. Circles exist only inside the band, which is a compass, not an overlay on the view: a circle sits at its bearing on the band, never over the thing in the picture.
- **A floating icon over every item by default:** none. The speaker's dot shows only over the one who speaks, while they speak.
- **A HUD whose content follows the gaze:** the band's circles move as you turn, because a compass shows bearings; what is on it depends on where you stand and on the author's settings, never on what you look at. The caption line depends on what sounds, not on where you look.
- **A HUD label for a station:** none. Stations are circles without numbers.
- **Approach sounds:** none.
- **Aim-to-ask:** none. Nothing reacts to the crosshair.
- **A 2D copy of a 3D text:** none. Signs and long texts are only in the world. Spoken words and subtitles are only in the caption line: the 3D speech bubble is gone, so nothing is shown twice.
- **Radar marks drifting from their true positions:** every circle is at its true bearing and a linear distance size, and is never pushed apart. The only displacement is the clamp of things behind you to the band's ends, drawn hollow, and "all round" removes it.
- **A card outliving its place:** the caption line of a video or sound shows only within its reach; leave it and the thing pauses and the line goes. A story's line goes when you leave its station, its place line included (the story pauses; back at the station the line says so, and the story carries on when you tap its character again).
- **Two stacked panels:** the HUD has one line. The measuring hook checks for overlaps in every beat.
- **Anything starting by nearness alone for a visitor standing still:** only Greta's greeting at station A, once. Station B's characters only turn toward you.
- **A hint volunteered repeatedly:** the hint is a button, offered after 8 s still in a search, never shown in the world by itself, and offered again only after another full wait. The first-run card shows once.
- **`backdrop-filter`, thin light strokes:** none. The band's plate and the caption line are solid with 2 px borders.
- **Any frame over 50 ms:** the town is two instanced draw calls, the band about 30 small meshes. See the measurement above; the readout's worst frame shows it live.
- **A demo that opens already inside a story:** the page opens on the lane outside station A.

## The look is not the direction

This page builds its own invented square, houses, characters and props, the same as page 2's. Judge the direction (a compass band, a caption line, an offered hint) apart from the art.

## The case against

- **A band gives up distance for direction.** A disc radar shows "that one is near, that one far" as a place; the band shows it only as size and brightness, which reads less at a glance. Two things in one direction at different distances overlap on the band, where a disc would put them apart.
- **Behind you is squeezed.** With 180 degrees, everything behind sits at the two ends. A visitor who turns slowly sees things jump in from the ends. "All round" removes the jump but packs the front.
- **The caption line takes the top centre**, where a phone held up shows sky or roofs, so it covers little; but in a narrow lane it covers the facades.
- **Timed words need timed lines.** Each character's line carries the start time of every word. A real tour would need them from speech-to-text alignment or by hand.

## The demonstration

Two invented stations on an invented square: "The well court" (A, radius 18 m) and "The hall steps" (B, radius 20 m). Each has a story character (three at B), a place a story sends you to, a short text, a long text, a picture, a video and a sound with subtitles, and a model.

- **Beat 1:** walk up to the beam with the band asleep. Crossing the edge wakes it, and the stations turn into things. Greta greets once, within 12 m of her.
- **Beat 2:** stand still: the band wakes with the station's things (Greta white; the rim stone is not on the band, by the story's setting).
- **Beat 3:** Greta's words run in the caption line. Next starts the search for the rim stone. Looking the wrong way and standing still, the hint is offered after 8 s; a tap sends the motes. At the stone, Greta answers from behind you: her words are in the line while she is out of view.
- **Beat 4:** look around: a picture, the lectern's three pages and the lion are seen; stand still, and they are grey (the consumed beat).
- **Beat 5:** play the video: its subtitles run in the line. Turn away: they keep running. Pause from the line.
- **Beat 6:** a sign and a sound 2.3 m apart overlap on the band at their true bearings. Tap to step the range. Play the sound: its subtitles in the line.
- **Beat 7:** leave with things unseen: back to stations. A is grey with a white centre, B orange.
- **Beat 8:** station B: three characters, white. Tap the baker to enter his story.
- **Beat 9:** author settings: station B's items off the band; then "The cracked bell" with hints off: no hint after the wait; hints back on: it is offered.

Use the beat stepper (the arrows at the top) or walk freely: drag sideways to turn, drag up to walk; on desktop W A S D or the arrows. The measuring hook is behind the ruler button: HUD coverage, element count, overlaps, the band's state, walking or still time, circles and touching circles, the hint's clock, and the worst frame. `HC.bench(20)` in the console returns the median and worst frame of the next 20 s. `?shots` pauses at every key moment (`HC.resume()` continues), and `?speed=3` runs the beats faster.
