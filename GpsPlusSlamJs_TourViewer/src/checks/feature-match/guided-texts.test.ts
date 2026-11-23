import { describe, expect, it } from "vitest";

import { DIAGRAM_KINDS } from "./guided-diagram";
import {
  LIGHT_NOTE,
  OTHER_TAB_TEXT,
  retakeText,
  SCENE_SETUP,
  SHOT_WORDS,
  shotCard,
} from "./guided-texts";
import { shotList, type ShotKey } from "./scenes";

const DASHES = /[‒-―]/;
const FIRST: readonly ShotKey[] = ["L1", "F1", "D1", "X1"];

// Why this test matters: both views walk a first-time tester through every
// shot with a few short lines and a picture; a shot without one of them
// leaves that tester guessing, and a text with markup would show its tags
// (they are set as text).
describe("SHOT_WORDS", () => {
  it("has a title, purpose, avoid line and known diagram for every shot", () => {
    const keys = [...new Set(shotList(3, 1).map((s) => s.key))].sort();
    expect(Object.keys(SHOT_WORDS).sort()).toEqual(keys);
    for (const [key, w] of Object.entries(SHOT_WORDS)) {
      for (const t of [w.title, w.capture, w.purpose, w.avoid]) {
        expect(t.trim(), key).not.toBe("");
      }
      for (const t of Object.values(w)) {
        expect(t, key).not.toMatch(DASHES);
        expect(t, key).not.toMatch(/[<>]/);
      }
      expect(DIAGRAM_KINDS, key).toContain(w.diagram);
    }
  });

  // Why: a scene's first shot has nothing before it to change; every later
  // shot must name its one change, or the tester takes the same photo twice.
  it("names a change on every later shot and none on a first shot", () => {
    for (const [key, w] of Object.entries(SHOT_WORDS)) {
      expect(w.change.trim() === "", key).toBe(FIRST.includes(key as ShotKey));
    }
  });

  // Why: the dimmed light shots failed in the field when the light was
  // dimmed before the reference; L1 keeps the light on, L3 and L4 dim and
  // keep the phone where it is.
  it("keeps the light on for L1 and dims for L3 and L4 without moving", () => {
    expect(SHOT_WORDS.L1.capture).toMatch(/^Light ON/);
    for (const key of ["L3", "L4"] as const) {
      expect(SHOT_WORDS[key].change, key).toMatch(/^Dim/);
      expect(SHOT_WORDS[key].capture, key).toMatch(/without moving the phone/);
    }
  });

  it("gives each shot its own title", () => {
    const titles = Object.values(SHOT_WORDS).map((w) => w.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("shotCard", () => {
  // Why: the setup line belongs to the scene, so every shot of a scene
  // repeats where its first shot was taken from.
  it("adds the scene's setup to the shot's words", () => {
    for (const shot of shotList(2, 1)) {
      const c = shotCard(shot);
      expect(c.setup).toBe(SCENE_SETUP[shot.kind]);
      expect(c.title).toBe(SHOT_WORDS[shot.key].title);
    }
  });
});

describe("LIGHT_NOTE", () => {
  // Why: the review after a light shot is where a failed check must say
  // what to do; "ok" is the one note that asks for nothing.
  it("asks for a retake on every failed light check", () => {
    expect(LIGHT_NOTE.ok).toMatch(/ok/);
    for (const [k, t] of Object.entries(LIGHT_NOTE)) {
      expect(/retake/i.test(t), k).toBe(k !== "ok");
      expect(t, k).not.toMatch(DASHES);
    }
    expect(LIGHT_NOTE["too-dark-a"]).toMatch(/L1/);
    expect(LIGHT_NOTE["not-darker-than-dimmed"]).toMatch(/L3/);
  });
});

describe("retakeText", () => {
  // Why: a retake of F1 silently redoes 7 measurements; the tester is told
  // the cost, in the right number.
  it("names the shot and the pairs it redoes, singular for one", () => {
    expect(retakeText("F1", 7)).toBe("Retaking F1 redoes 7 measurements.");
    expect(retakeText("L2", 1)).toBe("Retaking L2 redoes 1 measurement.");
  });
});

// Why this test matters: the tab lock is asked once at load, so a refused
// tab stays refused after the other tab closes; its text must say how to
// get the run back (reload), not leave the tester stuck.
describe("OTHER_TAB_TEXT", () => {
  it("tells the tester to reload this tab once the other one is closed", () => {
    expect(OTHER_TAB_TEXT).toMatch(/close the other tab/i);
    expect(OTHER_TAB_TEXT).toMatch(/reload this/i);
    expect(OTHER_TAB_TEXT).not.toMatch(DASHES);
  });
});
