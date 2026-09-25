/**
 * Standalone demo for Component 9 — the onboarding permissions gate + audio
 * unlock (TASK.md §2.3). Wires `mountOnboardingGate` against the framework's
 * real `permission-checker` functions, so this is the one place in the repo
 * that exercises the actual browser permission prompts end to end.
 *
 * Verify (success criterion): Start stays disabled until both camera and GPS
 * report granted; a denied item shows its red explanation; Start unlocks the
 * AudioContext and a short confirmation beep plays.
 */
import {
  checkCameraPermission,
  checkGeolocationPermission,
  requestCameraPermission,
  requestGeolocationPermission,
} from "gps-plus-slam-app-framework/sensors";

import { mountOnboardingGate } from "./view/onboarding-view.js";
import type { GateState } from "./core/permission-gate.js";

const gateRoot = document.getElementById("gate-root");
const statusEl = document.getElementById("status");
const stateLogEl = document.getElementById("state-log");
if (gateRoot === null || statusEl === null || stateLogEl === null) {
  throw new Error("demo root elements not found");
}

/** ~200 ms sine beep — the spec's "test beep" confirming audio is unlocked. */
function playConfirmationBeep(audioContext: AudioContext): void {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0, audioContext.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.02);
  gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.2);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.2);
}

mountOnboardingGate(gateRoot, {
  checkCameraPermission,
  checkGeolocationPermission,
  requestCameraPermission,
  requestGeolocationPermission,
  createAudioContext: () => new AudioContext(),
  onComplete: (audioContext) => {
    statusEl.textContent = "Audio unlocked ✓ — playing confirmation beep.";
    playConfirmationBeep(audioContext);
  },
  onStateChange: (state: GateState) => {
    stateLogEl.textContent = JSON.stringify(state, null, 2);
  },
});
