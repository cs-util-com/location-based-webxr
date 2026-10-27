import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { TourStep } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  createScenePlayer,
  isPlayableInK4,
  playableStepCount,
} from "./scene-player";

/**
 * Why these tests matter: the scene player is the castle knight's whole
 * script. A step shown twice, a choice that does not jump, a quiz this
 * version cannot run blocking the scene forever, or a scene that never ends
 * (so its station is never done and a fixed-order tour stops there) would
 * each break the story in front of the visitor.
 */

const text = (id: string, auto?: number): TourStep => ({
  id,
  action: { kind: "show", block: `b-${id}` },
  advance:
    auto === undefined ? { mode: "tap" } : { mode: "auto", afterS: auto },
});
const choice = (
  id: string,
  options: [string, string | undefined][],
): TourStep => ({
  id,
  action: {
    kind: "choice",
    prompt: "Which way?",
    options: options.map(([oid, go]) =>
      go === undefined
        ? { id: oid, label: oid }
        : { id: oid, label: oid, goto: go },
    ),
  },
  advance: { mode: "tap" },
});
const quiz: TourStep = {
  id: "q",
  action: {
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

  it("a choice whose option names no step goes on to the next step", () => {
    const p = createScenePlayer([
      choice("c", [
        ["on", undefined],
        ["back", "c"],
      ]),
      text("n"),
      text("m"),
    ]);
    expect(p.choose("on")?.id).toBe("n");
    expect(p.next()?.id).toBe("m");
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
            .filter((s) => s.action.kind !== "quiz")
            .map((s) => s.id);
          expect(shown).toEqual(expected.slice(0, taps + 1));
          expect(taps + 1 < expected.length || p.ended()).toBe(true);
        },
      ),
    );
  });
});

describe("createScenePlayer along any choice path (property)", () => {
  // Why this test matters: a story's choices pick the path, so the blocks
  // a visitor sees are the ones its show steps name along the path the
  // answers chose - in order, each show step once per visit, quizzes
  // skipped. An independent walk over the step list (the oracle below)
  // must agree with the player for every scene and every answer sequence.
  type Kind = "show" | "quiz" | "choice";
  const sceneArb = fc
    .array(fc.constantFrom<Kind>("show", "quiz", "choice"), {
      minLength: 1,
      maxLength: 8,
    })
    .chain((kinds) =>
      fc
        .array(
          fc.tuple(
            fc.option(fc.nat({ max: kinds.length - 1 }), { nil: undefined }),
            fc.option(fc.nat({ max: kinds.length - 1 }), { nil: undefined }),
          ),
          { minLength: kinds.length, maxLength: kinds.length },
        )
        .map((gotos) =>
          kinds.map((kind, i): TourStep => {
            const id = "s" + String(i);
            if (kind === "show") return text(id);
            if (kind === "quiz") return { ...quiz, id };
            const [a, b] = gotos[i]!;
            return choice(id, [
              ["x", a === undefined ? undefined : "s" + String(a)],
              ["y", b === undefined ? undefined : "s" + String(b)],
            ]);
          }),
        ),
    );

  /** The ids the player should show for the answers in picks, at most
   *  limit moves. */
  function oracle(
    steps: readonly TourStep[],
    picks: readonly boolean[],
    limit: number,
  ): string[] {
    const playableAt = (from: number): number => {
      let i = from;
      while (i < steps.length && steps[i]!.action.kind === "quiz") i += 1;
      return i;
    };
    const seen: string[] = [];
    let i = playableAt(0);
    for (let move = 0; i < steps.length && move <= limit; move += 1) {
      const step = steps[i]!;
      seen.push(step.id);
      if (step.action.kind !== "choice") {
        i = playableAt(i + 1);
        continue;
      }
      const option = step.action.options[picks[move % picks.length]! ? 1 : 0]!;
      i = playableAt(
        option.goto === undefined
          ? i + 1
          : steps.findIndex((s) => s.id === option.goto),
      );
    }
    return seen;
  }

  it("shows exactly the steps the answers lead to, in order, quizzes skipped", () => {
    fc.assert(
      fc.property(
        sceneArb,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        (steps, picks) => {
          const limit = 25;
          const p = createScenePlayer(steps);
          const seen: string[] = [];
          for (
            let s = p.current(), move = 0;
            s !== null && move <= limit;
            move += 1
          ) {
            seen.push(s.id);
            s =
              s.action.kind === "choice"
                ? p.choose(picks[move % picks.length]! ? "y" : "x")
                : p.next();
          }
          expect(seen).toEqual(oracle(steps, picks, limit));
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("playableStepCount (the story card's dots)", () => {
  // Why this test matters: the story card draws one dot per step the
  // visitor will see. A quiz this version skips is no dot, and a scene with
  // a choice has no fixed number of steps, so it gets no dots at all
  // rather than dots that lie.
  it("counts the steps a choice-free scene plays, quizzes left out", () => {
    expect(playableStepCount([text("a"), text("b", 3), text("c")])).toBe(3);
    expect(playableStepCount([text("a"), quiz, text("b")])).toBe(2);
    expect(playableStepCount([])).toBe(0);
  });

  it("is null for a scene with a choice", () => {
    expect(
      playableStepCount([text("a"), choice("c", [["x", "a"]]), text("b")]),
    ).toBeNull();
  });

  it("equals the number of steps the player shows, tapping through any choice-free scene", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("text", "auto", "quiz"), { maxLength: 8 }),
        (kinds) => {
          const steps = kinds.map((k, i) =>
            k === "quiz"
              ? { ...quiz, id: `q${String(i)}` }
              : text(String(i), k === "auto" ? 2 : undefined),
          );
          const p = createScenePlayer(steps);
          let shown = 0;
          while (p.current() !== null) {
            shown += 1;
            p.next();
          }
          expect(playableStepCount(steps)).toBe(shown);
        },
      ),
    );
  });
});
