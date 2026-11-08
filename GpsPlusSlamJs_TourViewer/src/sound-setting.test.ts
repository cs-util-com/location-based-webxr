// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { createVoiceFocus, type Voice } from "./voice-focus.js";
import {
  bindSoundToggle,
  silencedFocus,
  createSoundSetting,
} from "./sound-setting.js";
import { storeVisitorChoice, VISITOR_PREFS_KEY } from "./visitor-prefs.js";

/** A storage that keeps its items in a map. */
function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    items,
  };
}

describe("the sound setting", () => {
  it("is on by default and remembers off for every tour", () => {
    // Why: sound off is the visitor's, not a tour's: it outlives the page
    // and every tour opened after reads it.
    const storage = memory({
      [VISITOR_PREFS_KEY]: JSON.stringify({
        views: { model: { world: "ghost" } },
      }),
    });
    const setting = createSoundSetting({ storage });
    expect(setting.on()).toBe(true);
    setting.set(false);
    expect(JSON.parse(storage.items.get(VISITOR_PREFS_KEY) ?? "")).toEqual({
      views: { model: { world: "ghost" } },
      sound: "off",
    });
    expect(createSoundSetting({ storage }).on()).toBe(false);
  });

  it("lives in the visitor's one prefs key, which a view choice keeps", () => {
    // Why: one guarded key holds every visitor choice; a view choice merges
    // into a fresh read, so it must not lose sound off.
    const storage = memory();
    createSoundSetting({ storage }).set(false);
    storeVisitorChoice(storage, null, "model", "world", "ghost");
    expect(createSoundSetting({ storage }).on()).toBe(false);
  });

  it("tells its listeners of a change, once, and not of a repeat", () => {
    // Why: turning sound off must reach the voice that is playing now.
    const setting = createSoundSetting({ storage: memory() });
    const heard = vi.fn();
    const stop = setting.onChange(heard);
    setting.set(false);
    setting.set(false);
    setting.set(true);
    stop();
    setting.set(false);
    expect(heard.mock.calls).toEqual([[false], [true]]);
  });

  it("works without storage and with a storage that throws", () => {
    // Why: a private window or blocked site data must not break the page;
    // the setting then lives for the page only.
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    for (const storage of [undefined, throwing]) {
      const setting = createSoundSetting({ storage });
      expect(setting.on()).toBe(true);
      setting.set(false);
      expect(setting.on()).toBe(false);
    }
    expect(
      createSoundSetting({
        storage: memory({ [VISITOR_PREFS_KEY]: "not json" }),
      }).on(),
    ).toBe(true);
  });
});

describe("the sound toggle", () => {
  it("shows the setting and flips it on a press", () => {
    // Why: the button is the visitor's one way to silence the walk; its
    // pressed state and label must say what a press will do.
    const setting = createSoundSetting({ storage: memory() });
    const button = document.createElement("button");
    const unbind = bindSoundToggle(button, setting);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe(
      "Sound on - tap to turn it off",
    );
    button.click();
    expect(setting.on()).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe(
      "Sound off - tap to turn it on",
    );
    unbind();
    button.click();
    expect(setting.on()).toBe(false);
  });
});

describe("the voice focus under the setting", () => {
  it("lets no voice start by itself while off, and holds the running one", () => {
    // Why: sound off silences every voice of the page, a narrated text's
    // and a figure's too, not only the free sounds; a tap still plays.
    const setting = createSoundSetting({ storage: memory() });
    const focus = silencedFocus(createVoiceFocus(), setting);
    const calls: string[] = [];
    const voice = (name: string): Voice => ({
      hold: () => calls.push(name + " hold"),
      carryOn: () => calls.push(name + " carryOn"),
      stop: () => calls.push(name + " stop"),
    });
    const a = voice("a");
    expect(focus.selfStart(a)).toBe(true);
    setting.set(false);
    expect(calls).toEqual(["a hold"]);
    focus.ended(a);
    expect(focus.selfStart(voice("b"))).toBe(false);
    const c = voice("c");
    focus.tapped(c);
    expect(focus.running()).toBe(c);
  });
});
