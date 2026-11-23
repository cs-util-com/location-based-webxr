# Feature-match photo test: scenes, guided (throwaway prototype)

- **Tries:** the guided view's calm card language, rebuilt around three scenes (Light, Flat surface, Deep) that share one base photo each, so photo A is never retaken per pair.
- **Scene header:** scene name, "Scene n of 3" and a rule chip that says whether the phone must stay still (Light) or is hand-held; the viewfinder repeats "Do not move the phone" in the light scene.
- **Shot strip:** one segment per scene with a quiet measuring badge (n of m taken, waiting, measuring %, done), and below it the thumbnails of one scene. Tap a segment to browse another scene; tap a thumbnail to retake it (the card says how many pairs are measured again, the computed turns included) or to take a skipped one.
- **Background measuring:** faked with timers, starts by itself when a scene is complete, never blocks the camera; finished results survive a reload.
- **End view:** opens by itself after the last photo; per-scene progress with each method's count and a time estimate, then "Good enough - make the zip now" or "Wait for the rest", and one download button (while waiting it doubles as the progress bar).
- **Menu:** cockpit-view switch, own pair, skip scene, finish now, countdown and sound, and, for debugging, copy log, simulate reload and start over.
- **Camera:** the live back camera where allowed, otherwise a drawn room, poster and hallway that follow the shot (dimmed for L3/L4, tilted, far, near, to the side).
