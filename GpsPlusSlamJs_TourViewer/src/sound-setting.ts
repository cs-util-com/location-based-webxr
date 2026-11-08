/**
 * The visitor's sound setting: on or off for every tour, remembered in the
 * browser. Off silences the walk's sounds - a voice does not start and the
 * one playing is held (`silencedFocus`), an ambient sound plays at no
 * volume (`world-sound.ts`). `bindSoundToggle` is its button.
 *
 * @see sound-setting.ts.md
 */

import {
  loadVisitorPrefs,
  saveVisitorPrefs,
  type PrefsStorage,
} from "./visitor-prefs.js";
import type { VoiceFocus } from "./voice-focus.js";

/** The stored value's own object, or a fresh one. */
function rootOf(stored: unknown): Record<string, unknown> {
  return typeof stored === "object" && stored !== null && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : {};
}

export interface SoundSetting {
  on(): boolean;
  set(on: boolean): void;
  /** `listener` hears every change; returns its unsubscribe. */
  onChange(listener: (on: boolean) => void): () => void;
}

/** The setting, read once from `storage`: the `sound` field of the
 *  visitor's one prefs key (`visitor-prefs.ts`), so every tour reads it.
 *  Anything but "off" is on. No storage, or one that throws: kept for the
 *  page only. A change is merged into a fresh read, keeping the views. */
export function createSoundSetting(deps: {
  readonly storage: PrefsStorage | undefined;
}): SoundSetting {
  const { storage } = deps;
  let on = rootOf(loadVisitorPrefs(storage))["sound"] !== "off";
  const listeners = new Set<(on: boolean) => void>();
  return {
    on: () => on,
    set(next) {
      if (next === on) return;
      on = next;
      saveVisitorPrefs(storage, {
        ...rootOf(loadVisitorPrefs(storage)),
        sound: on ? "on" : "off",
      });
      for (const listener of [...listeners]) listener(on);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** `button` shows `setting` (pressed: sound off) and flips it on a press;
 *  returns its unbind. */
export function bindSoundToggle(
  button: HTMLButtonElement,
  setting: SoundSetting,
): () => void {
  const show = (on: boolean) => {
    button.setAttribute("aria-pressed", on ? "false" : "true");
    button.setAttribute(
      "aria-label",
      on ? "Sound on - tap to turn it off" : "Sound off - tap to turn it on",
    );
    button.dataset["sound"] = on ? "on" : "off";
  };
  const press = () => {
    setting.set(!setting.on());
  };
  show(setting.on());
  const stop = setting.onChange(show);
  button.addEventListener("click", press);
  return () => {
    stop();
    button.removeEventListener("click", press);
  };
}

/** `focus` under `setting`: while off no voice starts by itself, and
 *  turning it off holds the running voice (it carries on at a tap, or as
 *  its own rules say). A tap still plays: it is the visitor's own ask. */
export function silencedFocus(
  focus: VoiceFocus,
  setting: SoundSetting,
): VoiceFocus {
  setting.onChange((on) => {
    if (!on) focus.running()?.hold();
  });
  return {
    ...focus,
    selfStart: (voice) => setting.on() && focus.selfStart(voice),
  };
}
