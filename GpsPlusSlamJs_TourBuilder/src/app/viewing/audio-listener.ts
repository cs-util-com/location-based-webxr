/**
 * Hands the onboarding gate's unlocked `AudioContext` to Three.js (plan
 * VC4/R4).
 *
 * Component 9's Start click is the user gesture that unlocks Web Audio, and
 * component 8 deliberately never unlocks audio itself (its plan A16) — so the
 * composed app is the one piece that must join the two. There is exactly one
 * correct way to do that, and the obvious-looking one is wrong:
 *
 * ```ts
 * const listener = new AudioListener();
 * listener.context = unlocked;   // ✗ WRONG — silent stories
 * ```
 *
 * `AudioListener`'s constructor does `this.context = AudioContext.getContext();
 * this.gain = this.context.createGain(); this.gain.connect(this.context
 * .destination)`. Re-assigning `.context` afterwards leaves `gain` built on —
 * and wired to — the *other* context, so every `PositionalAudio` component 1
 * creates from this listener renders into a graph nobody hears, with no error
 * anywhere. Three's own supported entry point is the static
 * `AudioContext.setContext()`, called BEFORE the listener is constructed.
 */

import { AudioContext as ThreeAudioContext, AudioListener } from "three";

/**
 * Install `unlocked` as three's global audio context and return a listener
 * bound to it. Add the result to the AR camera so `PositionalAudio`
 * spatialisation follows the visitor's head.
 */
export function createSceneAudioListener(
  unlocked: AudioContext,
): AudioListener {
  ThreeAudioContext.setContext(unlocked);
  return new AudioListener();
}
