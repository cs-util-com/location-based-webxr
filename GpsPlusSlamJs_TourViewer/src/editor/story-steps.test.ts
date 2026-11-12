/**
 * Where each step of a story leads, and the rule that finds a loop no
 * answer can leave. The editor's step cards, its jump picker and the
 * Problems list all read these.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourChoice,
  TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";
import {
  END_TARGET,
  gotoChoices,
  gotoValue,
  loopSteps,
  stepExits,
  stepJump,
  stepJumpText,
  stepNumbers,
  storyTrap,
  trappedSteps,
  withGoto,
} from "./story-steps.js";

const text = (id: string): TourStoryChild =>
  ({
    id,
    kind: "shortText",
    view: "card",
    caption: id,
    advance: { mode: "tap" },
  }) as unknown as TourStoryChild;

/** A choice whose answers lead to `ways`: a child id, "END" or
 *  undefined (the next step). */
const choice = (
  id: string,
  ways: readonly (string | undefined)[],
  labels: readonly string[] = ways.map((_, i) => `A${String(i + 1)}`),
): TourChoice => ({
  id,
  kind: "choice",
  prompt: `Ask ${id}`,
  options: ways.map((way, i) => ({
    id: `o${String(i)}`,
    label: labels[i] ?? `A${String(i + 1)}`,
    ...(way === undefined ? {} : way === "END" ? { end: true } : { goto: way }),
  })),
});

const quiz = (id: string): TourStoryChild => ({
  id,
  kind: "quiz",
  question: "How old?",
  points: 1,
  answer: {
    type: "single",
    options: [
      { id: "a", label: "Old" },
      { id: "b", label: "New" },
    ],
    correct: "a",
  },
});

describe("stepJump", () => {
  // Why: each chip on a step card says where the visitor goes next; the
  // kinds of jump are told apart because a backward jump is drawn dashed
  // and a jump to a gone step is a fault.
  it("tells the next step, a jump ahead, a jump back, the end and nowhere", () => {
    const steps = [
      text("a"),
      choice("c", [undefined, "d", "a", "c", "END", "b", "gone"]),
      text("b"),
      text("d"),
    ];
    const c = steps[1] as TourChoice;
    const jumps = c.options.map((o) => stepJump(steps, 1, o));
    expect(jumps).toEqual([
      { type: "next", to: 2 },
      { type: "jump", to: 3 },
      { type: "back", to: 0 },
      { type: "back", to: 1 },
      { type: "end", implicit: false },
      { type: "next", to: 2 },
      { type: "missing" },
    ]);
    expect(stepJump(steps, 3, null)).toEqual({ type: "end", implicit: true });
    expect(jumps.map(stepJumpText)).toEqual([
      "next: step 3",
      "jumps to step 4",
      "goes back to step 1",
      "goes back to step 2",
      "ends the story",
      "next: step 3",
      "jumps nowhere",
    ]);
    expect(stepJumpText({ type: "end", implicit: true })).toBe(
      "then the story ends",
    );
  });

  // Why: a quiz does not branch: right or wrong, the story goes on.
  it("a quiz and a block go on to the next step", () => {
    const steps = [quiz("q"), text("a")];
    expect(stepExits(steps, 0)).toEqual([1]);
    expect(stepExits(steps, 1)).toEqual([2]);
  });
});

describe("the jump picker", () => {
  // Why: the picker offers the next step, every step ahead, every step
  // back (this one too: "ask this again") and the end, in that order, and
  // shows an answer's own way as picked.
  it("offers next, ahead, back and the end, and names the way picked", () => {
    const steps = [
      text("a"),
      choice("c", [undefined, "a", "END", "b"]),
      text("b"),
      text("d"),
    ];
    const title = (s: TourStoryChild) => s.id.toUpperCase();
    expect(gotoChoices(steps, 1, title)).toEqual([
      { group: "next", value: "", label: "Next step (3: B)" },
      { group: "ahead", value: "d", label: "Jump to step 4: D" },
      { group: "back", value: "a", label: "Go back to step 1: A" },
      { group: "back", value: "c", label: "Ask this again (step 2)" },
      { group: "end", value: END_TARGET, label: "End the story" },
    ]);
    const c = steps[1] as TourChoice;
    expect(c.options.map((o) => gotoValue(steps, 1, o))).toEqual([
      "",
      "a",
      END_TARGET,
      "",
    ]);
    expect(
      gotoChoices([choice("c", [undefined, undefined])], 0, title)[0],
    ).toEqual({
      group: "next",
      value: "",
      label: "Next step (the story ends)",
    });
  });

  // Why: an answer holds one way on: picking the end drops its jump,
  // picking a step drops its end, the next step is no jump at all.
  it("writes a picked way as the format holds it", () => {
    const option = { id: "o", label: "Go", goto: "a" };
    expect(withGoto(option, END_TARGET)).toEqual({
      id: "o",
      label: "Go",
      end: true,
    });
    expect(withGoto({ id: "o", label: "Go", end: true }, "b")).toEqual({
      id: "o",
      label: "Go",
      goto: "b",
    });
    expect(withGoto(option, "")).toEqual({ id: "o", label: "Go" });
  });
});

describe("a loop no answer can leave", () => {
  // Why: a backward jump is allowed - to try again, say - but a loop the
  // visitor can never leave keeps him from the end for good, so it is the
  // one jump the editor warns about.
  it("finds a loop of two steps, names it and the answer that can fix it", () => {
    const steps = [
      text("a"),
      choice("c", ["a", "a"], ["Again", "Once more"]),
      text("z"),
    ];
    expect(trappedSteps(steps)).toEqual([0, 1]);
    expect(loopSteps(steps, [0, 1])).toEqual([0, 1]);
    expect(storyTrap(steps)).toEqual({
      steps: [0, 1],
      fixOn: "c",
      fixLabel: "Once more",
      message:
        "Steps 1 and 2 go round in a loop that no answer can leave: a visitor who gets to step 1 never reaches the end. Let one answer end the story or go on.",
    });
  });

  it("is quiet for a backward jump the visitor can leave", () => {
    const steps = [text("a"), choice("c", ["a", "END"])];
    expect(trappedSteps(steps)).toEqual([]);
    expect(storyTrap(steps)).toBeNull();
    expect(storyTrap([])).toBeNull();
  });

  it("names only the loop, not a step that leads into it", () => {
    const steps = [text("lead"), choice("c", ["c", "c"])];
    expect(trappedSteps(steps)).toEqual([0, 1]);
    expect(loopSteps(steps, [0, 1])).toEqual([1]);
    expect(storyTrap(steps)?.message).toBe(
      "Step 2 leads only back to itself that no answer can leave: a visitor who gets to step 2 never reaches the end. Let one answer end the story or go on.",
    );
  });

  it("says step numbers as a list", () => {
    expect(stepNumbers([0])).toBe("Step 1");
    expect(stepNumbers([0, 2])).toBe("Steps 1 and 3");
    expect(stepNumbers([0, 1, 4])).toBe("Steps 1, 2 and 5");
  });

  /** A story of `kinds` whose choices' answers lead to `ways` (an index,
   *  taken modulo the story's length, "END", "gone" or undefined). */
  type Way = number | "END" | "gone" | undefined;
  const graph = fc
    .array(
      fc.oneof(
        fc.constant<Way[] | null>(null),
        fc.array(
          fc.oneof(
            fc.constant<Way>(undefined),
            fc.constant<Way>("END"),
            fc.constant<Way>("gone"),
            fc.nat({ max: 9 }),
          ),
          { minLength: 2, maxLength: 4 },
        ),
      ),
      { minLength: 0, maxLength: 9 },
    )
    .map((plan) =>
      plan.map((ways, i): TourStoryChild =>
        ways === null
          ? text(`s${String(i)}`)
          : choice(
              `s${String(i)}`,
              ways.map((w) =>
                typeof w === "number" ? `s${String(w % plan.length)}` : w,
              ),
            ),
      ),
    );

  /** Which steps reach which (the end is index n), by a closure. */
  function closure(steps: readonly TourStoryChild[]): boolean[][] {
    const n = steps.length;
    const reach = Array.from({ length: n + 1 }, () =>
      new Array<boolean>(n + 1).fill(false),
    );
    for (let i = 0; i < n; i += 1) {
      for (const j of stepExits(steps, i)) reach[i]![j] = true;
    }
    for (let k = 0; k <= n; k += 1) {
      for (let i = 0; i <= n; i += 1) {
        for (let j = 0; j <= n; j += 1) {
          if (reach[i]![k] === true && reach[k]![j] === true)
            reach[i]![j] = true;
        }
      }
    }
    return reach;
  }

  // Why: the warning must name exactly the steps a visitor can get to
  // from the start and never leave for the end - checked against a plain
  // transitive closure over random stories of any shape, jumps to gone
  // steps (which end the story for the visitor) included.
  it("names exactly the steps reached from the start that cannot reach the end", () => {
    fc.assert(
      fc.property(graph, (steps) => {
        const n = steps.length;
        const reach = closure(steps);
        const expected: number[] = [];
        for (let i = 0; i < n; i += 1) {
          const fromStart = i === 0 || reach[0]![i] === true;
          if (fromStart && reach[i]![n] !== true) expected.push(i);
        }
        const trapped = trappedSteps(steps);
        expect(trapped).toEqual(expected);
        const loop = loopSteps(steps, trapped);
        for (const i of loop) {
          expect(trapped).toContain(i);
          expect(reach[i]![i]).toBe(true);
        }
        // A trap always holds a loop: a step that cannot end goes on
        // somewhere, and only finitely many steps are there.
        expect(trapped.length === 0 || loop.length > 0).toBe(true);
        const trap = storyTrap(steps);
        expect(trap === null).toBe(trapped.length === 0);
      }),
      { numRuns: 400 },
    );
  });

  // Why: the offered fix must actually mend the trap it is offered for
  // whenever the loop holds a choice: its last answer ends the story.
  it("the fix, its last answer ending the story, leaves the loop", () => {
    fc.assert(
      fc.property(graph, (steps) => {
        const trap = storyTrap(steps);
        if (trap?.fixOn == null) return;
        const fixed = steps.map((s) => {
          if (s.id !== trap.fixOn || s.kind !== "choice") return s;
          const last = s.options.length - 1;
          return {
            ...s,
            options: s.options.map((o, k) =>
              k === last ? withGoto(o, END_TARGET) : o,
            ),
          };
        });
        const after = trappedSteps(fixed);
        expect(after.filter((i) => trap.steps.includes(i))).not.toEqual(
          trap.steps,
        );
      }),
      { numRuns: 400 },
    );
  });
});
