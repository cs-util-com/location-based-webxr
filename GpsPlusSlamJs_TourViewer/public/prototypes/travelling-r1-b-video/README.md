# Travelling surface B - The screen comes with you

Throwaway UX prototype. Not wired to the app and linked from nothing in it; the gallery at
`../index.html` is the only way in. It applies the "one box that travels" pattern of
`../sign-speaks-r6-2-travelling-box/` to a free video.

## The idea

A video's player - the picture, its captions and its control bar - is one object, and this page
lets it live in two places, never both:

- **On its screen in the world.** While the picture is big enough on the phone's screen (the
  "picture from" threshold), the screen is in view and not seen from too far to the side, the clip
  plays there. The title stays in the world above it in every case.
- **In a corner of the phone's screen.** Otherwise, and only while the video plays (or, with the
  other setting, once it was started), the same texture flies to a small player in a corner and
  keeps playing there. When the screen can be watched again it flies back. Its empty place in the
  world shows a "playing on your screen" sign; tapping it rings the corner player.
- **The bottom centre belongs to the narration box.** The video docks in its own corner, so a
  narration can speak at the bottom centre while the video plays beside it. A bottom corner that
  would touch the narration band sits just above it, whether a narration shows or not, so the
  corner never moves when a voice starts.
- **Only one video holds the corner**: the one the visitor tapped last. Another playing video
  stays in the world, playing; the newest start with sound takes the sound, the other plays on
  silent. No queue, no stack, no list.
- **Nothing sounds without a tap.** A stopped video stays off until tapped; docking and flying
  back never start, stop or unmute anything. Leaving the station pauses every video and empties
  the corner; coming back does not start them again ("paused when you left").

Controls are the same in both places: tap the picture to play or pause; the bar holds play,
sound and captions (CC). No scrub. Captions are drawn inside the picture, in the same surface.

## What to look at

- **7 m** (the opening): the stopped screen with "tap to watch". Tap the picture: at 7 m the
  picture is about 65 px tall, under 120 px, so the playing player docks at once.
- **Walk up**: from outside the station circle to 3 m; a finger taps the picture to play there.
- **3 m / 15 m**: at 3 m the clip plays on its screen (about 152 px), at 15 m in the corner.
- **65 deg**: seen that far to the side the screen is not watched, so the player docks.
- **Turn**: the player docks while the screen is out of view and flies back after it returns.
- **Taps**: a finger mutes, switches captions off and on, unmutes, pauses and plays, wherever the
  player is at that moment.
- **Voice box**: a narration box (round 5's look, a silent stand-in) at the bottom centre, a finger
  taps it to speak while the docked video plays in its corner above it.
- **2 videos**: a second video, a porthole, in the same station. Play the screen, turn to the mill
  (the screen's player docks), tap the mill: the mill takes the corner and the sound, the screen's
  player goes home and plays on, silent. Walk back: the mill docks, the screen stays in the world.
- **Leave**: walk out of the station; the corner empties and the video pauses. Press again to
  come back: it stays paused until tapped.
- **End**: jumps to the clip's last seconds; at the end "watched - tap to play again".

## Knobs (settings panel, and URL options)

- `thr` picture from 80 / 120 / 160 / 220 px (default 120; 80 is added to the brief's three to
  show where the pattern stops being "always docked").
- `ctl` play control: the picture / the bar's button. With the button, the gate also needs the
  button at least `tap` px tall (40 / 48 / 56).
- `mode` docks while playing / once started (a paused video then docks too).
- `corner` bottom right / bottom left / top right.
- `size` screen width 1.6 (the app's default) / 2.5 / 4 m; `aspect` 16:9 / 4:3 / 9:16.
- `fly` flight 0 (off) / 0.35 / 0.6 / 1.2 s; `settle` hold before moving 0.15 / 0.3 / 0.6 / 1 s;
  `hyst` 5 / 10 / 15 %; `angle` 35 / 50 / 60 deg.
- `sound` tone / silent; `text` normal / longest / missing; `stage` window / upright / sideways.
- `at` the opening beat (walk, d3, d7, d15, side); `narr=on`, `two=on`; `autostart` stands in for
  the first tap.

## Where it docks (measured and computed)

The settings panel computes this live for the current knobs. Upright phone 390 px wide (42 deg
across), standing straight in front, 16:9 clip. The readout measured 154 / 66 / 31 px at 3 / 7 /
15 m for the 1.6 m screen, against 152 / 65 / 30 computed.

- **1.6 m screen** (picture 0.90 m tall): 152 / 65 / 30 px at 3 / 7 / 15 m. Docks beyond 5.7 m
  (80 px), 3.8 m (120), 2.9 m (160), 2.1 m (220). The bar's button (0.34 m) stays 48 px tall out to
  3.6 m.
- **2.5 m screen** (1.41 m): 238 / 102 / 48 px. Docks beyond 8.9 / 5.9 / 4.5 / 3.2 m.
- **4 m screen** (2.25 m): 381 / 163 / 76 px. Docks beyond 14.3 / 9.5 / 7.1 / 5.2 m.
- A sideways phone sees less height per metre (50 deg top to bottom): everything docks about
  20 % sooner (1.6 m at 120 px: beyond 3.1 m).
- A 4:3 clip is taller for the same width (1.6 m at 120 px: beyond 5.1 m); a 9:16 clip is shown
  in a square picture area (pillarboxed), so its screen is square.

**The verdict across the range:** with the app's default 1.6 m screen, every threshold of the
brief (120 / 160 / 220 px) docks the player beyond 2 to 4 m, so at 7 m and 15 m the pattern is
"always docked" while it plays; only a 4 m screen at 120 px keeps the clip in the world at a
normal standing distance. A threshold near 80 px, or a larger default screen, would change that.
What decides it is the question whether a 65 px picture at 7 m is "watchable" for a visitor -
not answerable on a desktop.

**The corner player** is 218 x 169 px on an upright phone (16:9), its picture 123 px tall, its
buttons 46 px square. So at 160 and 220 px the docked picture is smaller than the world picture it
replaced: the flight shrinks it. The threshold and the corner's size are separate here on purpose
(a 220 px corner player would be the whole width of the phone).

## Values chosen at one point, and what would reverse them

- **The bar is taller than the app's** (0.21 of the width against 0.13) so that its buttons are
  44 px or more in the corner player. In the world that makes the screen's bar chunkier.
- **A paused video that is already docked stays docked** (in "while playing" mode it never docks
  while paused): otherwise the pause button the visitor just pressed would fly away from under the
  thumb and the clip would be lost out of view. It flies home once the screen can be watched or
  the visitor leaves; an ended video flies home.
- **Hold 0.3 s, 5 % hysteresis, flight 0.6 s**, as 6.2. The hysteresis also widens the angle limit
  for a player already in the world.
- **A video given the corner waits for it to empty** before it flies in, so two players never cross in
  the corner.
- **When the screen's world place is not on the phone's screen** (turned away, walked out), the
  corner fades out instead of flying off the edge; going to the corner, the flight starts from
  where the screen was last seen.
- **Station circle 20 m**, as 6.2. **Touch forgiveness**: 12 px around the bar's buttons in the
  world.

## Faked

- The clips are canvas drawings driven by the clip's own clock (a harbour at dawn, a windmill);
  their sound is a soft generated tone. No real footage, no recording, no real place.
- The camera, the square and the walk are simulated; nothing runs in AR. The sideways drag on the
  view stands in for turning the phone.
- The narration box is a silent stand-in for round 5's box; who speaks when the narration and a
  video both want sound is not decided here.
- Where a narration's words show is one pick for the whole tour, in the tour's settings; this page
  has no pick of its own.

## Not verified

- On a phone in AR: whether the flight reads as the same clip travelling; whether a 65 px picture
  at 7 m is watchable outdoors; whether the corner player's 46 px buttons are hit with a thumb on
  the move.
- The top-right corner against the app's own top-right HUD (the radar and compass may sit there).
- Frame times: the screenshots ran on SwiftShader, whose numbers mean nothing for a phone.
- On a sideways phone at 3 m the demo strip at the top covers the screen's title plate; the strip
  is not part of the design.

## Cost

The settings panel shows the cost once a second: frame work (average and max), the longest gap
between frames, the count of frames over 50 ms, the videos' draws and triangles (the screen, its
title, legs, the "away" face and the overlay quad while docked or flying), and the player
repaints: a playing clip repaints its 640 px wide canvas at most 30 times a second, a paused one
never, and a clip neither in view nor docked is not repainted.

## Files

- `kind.js` - the item kind (read, assets, fields, world); the screen and the porthole, and the
  player surface they share with the corner.
- `sample.json` - the records: normal, longest (long title and captions), missing (no clip file:
  it says so and never docks), and the second video.
- `travelling-screen.js` - the page: the scene, the place decision, the corner, the flight,
  gestures and beats.
- `travelling-screen.css`, `index.html`.
