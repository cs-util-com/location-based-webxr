# Feature match 5 - Session timeline (throwaway prototype)

The scenes flow (Light, Flat surface, Deep, optional own pair) as ONE vertical timeline that grows as you work. Not wired to the app, linked from nothing in it; measuring and the zip are faked with timers.

- The current scene is the only expanded node: shot strip, the next step and whether the phone may move, the camera, one shutter. Still scenes fire 2 s after the tap ("Hands off"); the light check per shot shows on the camera and in the finished row.
- A finished scene collapses into a row of its thumbnails plus a live processing bar (Not yet / Waiting / Measuring / Done, with a time estimate and an optional pair list). Tap any thumbnail to retake it; retaking a shared first shot names every pair it redoes.
- After the last shot (or "Finish now") the page scrolls into the Processing node: summary and the "Good enough - make the zip now" / "Wait for the rest" choice first, per-method progress per scene next to or below it, then one Download button.
- Trust is quiet: a "saved on this phone" line in the top bar, a tick on every thumbnail, and a "Resumed where you left off" note after a reload. The menu holds the cockpit switch, Copy log, Simulate reload (a real reload; state lives in localStorage) and Start over.
- URL states for screenshots: `?demo=setup|light|mid|retake|end`, `&nocam` forces the drawn camera, `&freeze` stops the fake processing.
