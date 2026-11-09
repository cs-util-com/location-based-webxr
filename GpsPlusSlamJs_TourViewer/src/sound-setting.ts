/**
 * The visitor's sound setting: on or off for every tour, remembered in the
 * browser. Off silences the walk's sounds - a voice does not start, the
 * one playing is held and nothing takes over from it (`silencedFocus`), an
 * ambient sound is paused (`world-sound.ts`). `whileShown` adds the page's
 * own visibility: a hidden page is silent too. `bindSoundToggle` is its
 * button.
 *
 * @see sound-setting.ts.md
 */

import {
  loadVisitorPrefs,
  prefsRoot,
  saveVisitorPrefs,
  type PrefsStorage,
} from "./visitor-prefs.js";
import type { Voice, VoiceFocus } from "./voice-focus.js";

/** Whether sound may be heard now, and its changes. */
export interface SoundGate {
  on(): boolean;
  /** `listener` hears every change; returns its unsubscribe. */
  onChange(listener: (on: boolean) => void): () => void;
}

export interface SoundSetting extends SoundGate {
  set(on: boolean): void;
}

/** The setting, read once from `storage`: the `sound` field of the
 *  visitor's one prefs key (`visitor-prefs.ts`), so every tour reads it.
 *  Anything but "off" is on. No storage, or one that throws: kept for the
 *  page only. A change is merged into a fresh read, keeping the views. */
export function createSoundSetting(deps: {
  readonly storage: PrefsStorage | undefined;
}): SoundSetting {
  const { storage } = deps;
  let on = prefsRoot(loadVisitorPrefs(storage))["sound"] !== "off";
  const listeners = new Set<(on: boolean) => void>();
  return {
    on: () => on,
    set(next) {
      if (next === on) return;
      on = next;
      saveVisitorPrefs(storage, {
        ...prefsRoot(loadVisitorPrefs(storage)),
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

/**
 * `setting` while the page is shown: off as well while the document is
 * hidden (`visibilitychange`) or the page is gone (`pagehide`, until a
 * `pageshow` brings it back from the browser's cache). Its listeners hear
 * each change of the result, not of its parts. Lives as long as the page.
 */
export function whileShown(
  setting: SoundGate,
  doc: EventTarget & { readonly visibilityState: string },
  win: EventTarget,
): SoundGate {
  let gone = false;
  const now = (): boolean =>
    setting.on() && !gone && doc.visibilityState !== "hidden";
  let last = now();
  const listeners = new Set<(on: boolean) => void>();
  const check = (): void => {
    const next = now();
    if (next === last) return;
    last = next;
    for (const listener of [...listeners]) listener(next);
  };
  setting.onChange(check);
  doc.addEventListener("visibilitychange", check);
  win.addEventListener("pagehide", () => {
    gone = true;
    check();
  });
  win.addEventListener("pageshow", () => {
    gone = false;
    check();
  });
  return {
    on: now,
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

/**
 * `focus` under `sound`: while off no voice starts by itself, a hand-over
 * included, and turning it off holds the running voice, which stays the
 * channel's. That voice is the quiet one: back on, it carries on. A voice
 * handed the channel while off is the quiet one the same way. A tap still
 * plays: it is the visitor's own ask, and with sound off it turns the
 * sound on (`turnOn`, the page's setting), for every voice alike: the
 * sound button must never say "off" while a voice is heard, and a visitor
 * who taps to hear something wants sound.
 *
 * Every voice reaches `focus` behind a gate of its own (kept per voice, so
 * the channel's identity checks hold); `running()` answers the voice the
 * caller gave.
 */
export function silencedFocus(
  focus: VoiceFocus,
  sound: SoundGate,
  options: {
    /** Turns the page's setting on (saved); none: a tap leaves it. */
    readonly turnOn?: () => void;
  } = {},
): VoiceFocus {
  const gates = new WeakMap<Voice, Voice>();
  const voices = new WeakMap<Voice, Voice>();
  /** The running voice kept quiet by the gate. */
  let quiet: Voice | null = null;
  const gated = (voice: Voice): Voice => {
    const known = gates.get(voice);
    if (known !== undefined) return known;
    const gate: Voice = {
      ...(voice.story === undefined ? {} : { story: voice.story }),
      hold: () => {
        voice.hold();
      },
      carryOn: () => {
        if (sound.on()) voice.carryOn();
        else quiet = gate;
      },
      stop: () => {
        if (quiet === gate) quiet = null;
        voice.stop();
      },
    };
    gates.set(voice, gate);
    voices.set(gate, voice);
    return gate;
  };
  sound.onChange((on) => {
    const running = focus.running();
    if (!on) {
      if (running !== null) {
        quiet = running;
        running.hold();
      }
      return;
    }
    const kept = quiet;
    quiet = null;
    if (kept !== null && kept === running) kept.carryOn();
  });
  return {
    tapped(voice) {
      quiet = null;
      focus.tapped(gated(voice));
      // Every voice that starts playing comes here, not only a tap: a
      // story step that moves on by itself and a story clip that starts
      // with its sound turn the setting on too. After the hand-over, with
      // nothing kept quiet: turning on carries no other voice on, and the
      // starting one is the channel's.
      if (!sound.on()) options.turnOn?.();
    },
    selfStart: (voice) => sound.on() && focus.selfStart(gated(voice)),
    ended(voice) {
      const gate = gated(voice);
      if (quiet === gate) quiet = null;
      focus.ended(gate);
    },
    behind: (voice) => focus.behind(gated(voice)),
    running() {
      const running = focus.running();
      return running === null ? null : (voices.get(running) ?? running);
    },
  };
}
