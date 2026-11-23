# feature-match-4-scenes-camera

Variant "Camera-first" of the scenes flow for the feature-match photo test.

- The live camera fills the screen (a drawn room, poster or hallway when no camera is available).
- A thin top overlay names the scene and the shot, with story-style progress segments and a chip that says whether the phone must stay still.
- One big shutter and one short physical instruction sit at the bottom; the Light scene uses a 2 s self-timer so the tap does not move the phone.
- The shot counter carries a ring and a tiny pill for background measuring; tapping it (or swiping up) opens the sheet with every shot for retakes and skips.
- A "Ghost" chip overlays the scene's first shot to line up controls and retakes; a light check after L2-L4 says whether it really got darker.
- The end view opens by itself: per-scene, per-method progress, "Good enough, make the zip now" or "Wait for the rest", then one Download button (a text placeholder).
- State is kept in localStorage; "Simulate reload" in the menu reloads the page and resumes. Processing is faked with timers.
