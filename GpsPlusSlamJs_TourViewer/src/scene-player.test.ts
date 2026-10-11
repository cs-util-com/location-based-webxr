import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { TourStep } from "gps-plus-slam-app-framework/ar/tour-stations";

import { createScenePlayer, isPlayableInK4 } from "./scene-player";

/**
 * Why these tests matter: the scene player is the castle knight's whole
 * script. A step shown twice, a choice that does not jump, a quiz this
 * version cannot run blocking the scene forever, or a scene that never ends
 * (so its station is never done and a fixed-order tour stops there) would
 * each break the story in front of the visitor.
 */

const text = (id: string, auto?: number): TourStep => ({
  id,
  block: { kind: "text", text: `text ${id}` },
  advance:
    auto === undefined ? { mode: "tap" } : { mode: "auto", afterS: auto },
});
const choice = (id: string, options: [string, string][]): TourStep => ({
  id,
  block: {
    kind: "choice",
    prompt: "Which way?",
    options: options.map(([oid, go]) => ({ id: oid, label: oid, goto: go })),
  },
  advance: { mode: "tap" },
});
const quiz: TourStep = {
  id: "q",
  block: {
    kind: "quiz",
    question: "How old?",
    points: 1,
    answer: { type: "number", value: 800, tolerance: 50 },
  },
  advance: { mode: "tap" },
};

describe("createScenePlayer", () => {
  it("plays the steps in order and ends after the last", () => {
    const p = createScenePlayer([text("a"), text("b")]);
    expect(p.current()?.id).toBe("a");
    expect(p.next()?.id).toBe("b");
    expect(p.next()).toBeNull();
    expect(p.ended()).toBe(true);
    expect(p.next()).toBeNull();
  });

  it("a choice waits for an answer, then jumps to its target and carries on from there", () => {
    const p = createScenePlayer([
      choice("c", [
        ["left", "l"],
        ["right", "r"],
      ]),
      text("l"),
      text("r"),
    ]);
    expect(p.current()?.id).toBe("c");
    expect(p.next()?.id).toBe("c"); // a tap does not answer
    expect(p.choose("nope")?.id).toBe("c");
    expect(p.choose("right")?.id).toBe("r");
    expect(p.next()).toBeNull();
  });

  it("a choice on a step that is not current changes nothing", () => {
    const p = createScenePlayer([
      text("a"),
      choice("c", [
        ["x", "a"],
        ["y", "a"],
      ]),
    ]);
    expect(p.choose("x")?.id).toBe("a");
  });

  it("skips what this version cannot show (a quiz is K5's) and ends a scene of nothing playable", () => {
    expect(isPlayableInK4(quiz)).toBe(false);
    const p = createScenePlayer([quiz, text("a"), quiz]);
    expect(p.current()?.id).toBe("a");
    expect(p.next()).toBeNull();
    expect(createScenePlayer([quiz]).ended()).toBe(true);
    expect(createScenePlayer([]).current()).toBeNull();
  });

  it("a choice whose target is unplayable jumps to the next playable step after it", () => {
    const p = createScenePlayer([
      choice("c", [
        ["a", "q"],
        ["b", "z"],
      ]),
      quiz,
      text("z"),
    ]);
    expect(p.choose("a")?.id).toBe("z");
  });

  it("only visitor answers move it: any tap sequence ends a choice-free scene after exactly its playable steps (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 20 }),
        fc.integer({ min: 0, max: 40 }),
        (playable, taps) => {
          const steps = playable.map((ok, i) =>
            ok ? text(`s${i}`) : { ...quiz, id: `q${i}` },
          );
          const p = createScenePlayer(steps);
          const shown: string[] = [];
          for (
            let s = p.current(), i = 0;
            s !== null && i <= taps;
            s = p.next(), i += 1
          )
            shown.push(s.id);
          const expected = steps
            .filter((s) => s.block.kind !== "quiz")
            .map((s) => s.id);
          expect(shown).toEqual(expected.slice(0, taps + 1));
          expect(taps + 1 < expected.length || p.ended()).toBe(true);
        },
      ),
    );
  });
});
