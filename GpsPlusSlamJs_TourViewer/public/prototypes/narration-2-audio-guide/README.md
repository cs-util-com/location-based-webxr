# Narration prototype 2: the audio guide

**The direction.** Like a museum audio guide, listening is the main way in and reading is the follow-up: the sign in the world says "Listen · 12 min", and one tap on it starts the voice and shows the captions strip, not the sheet. The strip then lives on as a mini-player (while the visitor walks around the station, over the open text, and on top of the walk card), with the speed control and the lock-screen controls treated as first-class parts of it.

Open `index.html` (no build step, no libraries). The yellow-and-black bar at the bottom is the prototype's own controls, not part of the design: view, the voice file (works, slow, missing), events (lock the phone, switch apps, incoming call, jump near the end), where the visitor is, and the orientation (fill the window, phone upright 390 x 844, phone sideways 844 x 390). Press `d` to hide or show it. A hash sets a state for screenshots, e.g. `#frame=upright&play=1&at=95&sheet=1&debug=0` (also `view=`, `where=sign|within|out`, `cond=works|slow|missing`, `rate=`, `quiet=1`, `event=lock|hidden|call|end`); `window.__narrationProto.set({...})` and `.state()` do the same from a script. There is no `<input type="range">` on the page.

## What it optimises for

- The visitor's eyes stay on the place: one tap, and the square talks to them; the text on the phone is a strip of two or three lines, not a page.
- One set of controls in one place: play, back 10 s, speed and "Full text" sit in the same bottom row whether the strip shows captions, sits over the open text, or rides on the walk card. Every control is in the bottom third of an upright phone.
- Listening that survives real life: walking away, locking the phone and putting it in a pocket, a phone call, a slow network.

## What it gives up (where this direction loses)

- **Startle.** A tap on the sign plays sound at once. A visitor in a church, a quiet museum courtyard or a library, or one without earphones, gets a voice out of the phone's speaker. Mitigations kept inside the direction, none of which removes the risk:
  - the sign says what the tap does ("Listen · 12 min", "Plays aloud · tap to start") and a hint before the first tap says "Best with earphones";
  - the voice fades in over 1.5 s instead of starting at full level;
  - for 7 s after the first start in a visit, the strip says "Playing aloud. Too loud here? Read quietly instead";
  - a small "Read without sound" chip hangs on the sign's stem, the only quiet way in that does not need the view switch at the top of the screen.
  - A browser cannot tell whether earphones are connected or the phone is on silent (as far as I know: no reliable API without a microphone permission), so the page cannot adapt to it.
- **Reading is second-class.** "Reading" now means "the voice with the whole text open"; a visitor who only wants to read must find the chip or choose "Sound off" in the view switch. Readers faster than any narrator lose most.
- **A tap on the sign is a remote control.** While the voice plays, tapping the sign pauses it; a visitor who tapped "to open the text" gets a pause instead and must use "Full text".
- **The voice keeps talking after the visitor has left the station.** It says "turn to face north" to someone sixty metres down the path. An audio guide accepts that; a place-bound text suffers.
- **The fade-in may cost background playback.** A volume ramp on a phone needs Web Audio (iOS ignores an audio element's volume), and routing the voice through Web Audio may stop it playing while the phone is locked on iOS. Unverified; if it does, the fade-in goes, not the lock-screen playback.

## The four questions

1. **Discovering the voice in the world.** Yes, the sign says it, and listening is its first word: an amber play disc, "LISTEN · 12 MIN", the title, "Plays aloud · tap to start". The same sign stands in Captions and Reading view (one sign to learn; the view only decides what follows the tap: the strip alone, or the strip over the open text). The sign shows the state of the voice: "NOW PLAYING · 1:01" with moving bars and pulse rings, "RESUME · 9 MIN LEFT", "LISTENED · 12 MIN". In Sound off view, or after the voice failed in this visit, it says "READ · 10 MIN" with a text mark instead.
2. **The strip and the sheet together.** The strip stays, in front, in the same place at the bottom; its caption lines fold away (the sheet marks the same sentence) and the controls row does not move, with "Full text" turning into "Close text". In landscape and on a desktop the strip has the sheet's width and sits at the bottom right from the start, so opening the sheet does not move it either. Closing the sheet keeps the voice playing and unfolds the captions. The strip's x stops the voice and folds the player into a "Resume · 4:12" chip; the sign says "Resume" too. "Read quietly instead" and "Read without sound" pause the voice and open the sheet with a quiet reading mark on the sentence where the voice was; "Listen from here" in that sheet starts the voice at the marked sentence.
3. **Audio states.**
   - Loading: the tap answers at once (pause icon with a spinning ring on the strip and on the sign, "Starting the voice…"); after about 2 s without sound: "The voice is on its way. The text is ready now: read while it loads". A stall during play holds the word mark and says "Waiting for the voice… it carries on by itself".
   - Missing or failing file: no error, no code. The strip becomes "The voice cannot play right now. The whole text is here to read, at your own pace" with "Read the text" (primary) and "Try the voice again"; during play: "The voice stopped. You can read on from where it stopped" and "Read on from here". The sign turns into "READ · 10 MIN" for the rest of the visit, and the sheet opens as quiet reading.
   - The end: "That is the end of this story" with "Show the way on" (primary, the walk card) and "Play again"; the sign says "LISTENED · 12 MIN".
   - Phone locked: the voice plays on (the audio-guide promise: lock it, pocket it, listen), with lock-screen controls. On unlock the camera view needs a tap to come back ("The camera view stops while the phone is locked. The voice played on."); the strip is already there, still playing. Whether a browser keeps an audio element playing while locked during an AR session is not verified on a phone here.
   - Page hidden (another app): if the browser pauses the voice, the strip says "Paused while you were away", and play carries on from the start of the interrupted sentence.
   - Phone call: the voice pauses as the phone rings and does **not** resume by itself afterwards (sound without a tap, in a street, right after a call, is the thing that must never happen). "Paused for your call", and play rewinds to the start of the sentence the call cut. The same rewind applies after any pause longer than 30 s.
   - Lock-screen controls (Media Session): title, "Station 1 · Old market square", the tour's name, an artwork tile, play/pause, back 10 s and forward 10 s, a position bar. The page sets the real `navigator.mediaSession` metadata and handlers; the lock screen itself is a mock-up (no real audio plays here).
4. **Playback rate.** Needed, and first-class: a chip in the strip's control row ("1x", one tap cycles 1x, 1.25x, 1.5x, 0.75x), always reachable with the thumb, highlighted when not 1x, and kept on the phone for every voice ("Speed 1.25x, kept on this phone for every voice"). Remaining time is shown at the chosen speed ("8:28 left at 1.25x"). Not on the lock screen (Media Session has no speed action). Pitch stays natural (browsers keep pitch by default when the rate changes).

## Not shown or not verified

- No real audio: a fake clock drives the word mark, and moving bars stand in for sound.
- On-device behaviour of locking, background playback during an AR session, the call interruption and the Web Audio fade-in is described, not measured.
- The Lectern view is greyed out in the switch ("not in this prototype").
