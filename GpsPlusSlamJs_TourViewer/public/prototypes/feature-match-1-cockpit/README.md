# Feature match 1 - Cockpit (throwaway prototype)

## Purpose

The feature-match photo test page as a camera-first cockpit: the live viewfinder fills the screen and ONE fixed dock holds everything a step needs. Not wired to the app, linked from nothing in it; the measuring is faked, the saved zips are real (two PNGs, the frames JSON, a matches JSON, the log).

- The dock sits at the side when the screen is near-square or wider (aspect 4:5 and up: the unfolded Fold in both orientations, landscape phones), at the bottom on a tall phone. Every slot has a fixed size; only labels change, so nothing moves under a finger.
- Dock, top to bottom: the pair chip (key, label, spot; tap opens the pair list), progress "n / 20" and a segment bar of the 20 pairs, the one-line instruction for the current shot, the A and B slots (thumbnail and state) with what changes between them, Retake, the big shutter with a stillness ring, Next pair, three readouts (still %, light, capture mode), a status line, and Details / Download all.
- Hands-off capture: tap the shutter once per pair ("Take A"); photo A is taken after 1.2 s of stillness (DeviceMotionEvent). Photo B then takes itself when the pair's condition is met and the phone is still again: a control pair waits 2 s after A, a light pair waits until the live picture is under 80 % of A's brightness for 2 s, a turn, distance or side-step pair waits until the phone has moved and is still again (1.5 s).
- Without motion readings (blocked in the site settings, or none within 2 s) the page switches to tap + 3 s countdown and says so. The countdown is also a setting.
- During photo B of the dimmed pairs the dock dims itself, so the screen does not light the room.
- Measuring runs right after B (camera paused, a progress card over the viewfinder), then the pair is saved as one zip by itself and the next pair comes up. A failed light check keeps the pair and says why.
- The drawer (Details) opens over the viewfinder from the dock's edge, never over the dock; automatic capture pauses while it is open. Tabs: Pairs (all pairs, status, tap to repeat or skip, Download all), Guide (the pair's full steps, avoid line, spot note, Before you start), Results (table, light warning, Copy log with its hint, the log), Settings (capture mode, save mode, the methods note, synthetic run, prototype switches).

## What to look at

Open it on the phone on a stand. Tap Start, then Take A, take your hand away and watch the ring fill. Try 1b: dim the light after A and see B wait for the darker room. Try a turn pair: B waits until you have turned the phone and held it still.

Prototype switches (Settings): a fake motion sensor (every tap jolts it, "Shake the phone"), "Dim the room" for the drawn room, the faint photo A overlay, Forget progress. URL states for screenshots: `?demo=first`, `?demo=mid&freeze=1`, `?demo=count&freeze=1`, `&drawer=pairs|guide|results|settings`, `&pair=1b`, `&nocam`.
