/**
 * The choice and quiz inspectors' edits, pure: each control of the
 * inspector turns into the whole step it writes, so one control is one
 * undo step and the document checks the step as the format reads it.
 */
import { describe, expect, it } from "vitest";
import type {
  TourChoice,
  TourQuizEntry,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { END_TARGET } from "./story-steps.js";
import {
  MAX_ANSWERS,
  newStoryStep,
  stepFieldEdit,
  stepWithAnswer,
  stepWithGoto,
  stepWithoutAnswer,
  stepWithRight,
} from "./story-step-edits.js";

const CHOICE: TourChoice = {
  id: "c",
  kind: "choice",
  prompt: "Which way?",
  options: [
    { id: "a1", label: "Left", goto: "x" },
    { id: "a2", label: "Right", end: true },
  ],
};

const QUIZ: TourQuizEntry = {
  id: "q",
  kind: "quiz",
  question: "How old?",
  points: 2,
  answer: {
    type: "single",
    options: [
      { id: "a1", label: "Old" },
      { id: "a2", label: "New" },
    ],
    correct: "a2",
  },
};

describe("a typed field of a step", () => {
  // Why: the question and each answer's words are typed in place; the
  // text is kept trimmed, a value the step already has writes nothing.
  it("writes the question and an answer's words, trimmed", () => {
    expect(stepFieldEdit(CHOICE, "step:prompt", "  Up or down? ")).toEqual({
      ...CHOICE,
      prompt: "Up or down?",
    });
    expect(stepFieldEdit(CHOICE, "step:label:a2", "Stop")).toEqual({
      ...CHOICE,
      options: [CHOICE.options[0], { id: "a2", label: "Stop", end: true }],
    });
    expect(stepFieldEdit(QUIZ, "step:prompt", "How new?")).toEqual({
      ...QUIZ,
      question: "How new?",
    });
    expect(stepFieldEdit(QUIZ, "step:label:a1", "Ancient")).toMatchObject({
      answer: { options: [{ id: "a1", label: "Ancient" }, { id: "a2" }] },
    });
    expect(stepFieldEdit(CHOICE, "step:prompt", "Which way?")).toBeNull();
    expect(stepFieldEdit(CHOICE, "step:label:zz", "Lost")).toBeNull();
    expect(stepFieldEdit(CHOICE, "title", "Lost")).toBeNull();
  });

  // Why: points are a whole number of 0 or more; anything else is said,
  // never written.
  it("writes a quiz's points and refuses what is no whole number", () => {
    expect(stepFieldEdit(QUIZ, "step:points", "5")).toEqual({
      ...QUIZ,
      points: 5,
    });
    expect(stepFieldEdit(QUIZ, "step:points", "2")).toBeNull();
    for (const bad of ["-1", "1.5", "lots", ""]) {
      expect(stepFieldEdit(QUIZ, "step:points", bad)).toEqual({
        invalid: "Points are a whole number, 0 or more.",
      });
    }
    expect(stepFieldEdit(CHOICE, "step:points", "3")).toBeNull();
  });
});

describe("a new step", () => {
  // Why: the add menu's Choice and Quiz put a step the format reads at
  // once - every text has words, a quiz's right answer is one of its own -
  // so adding never meets a refusal and the inspector opens on real fields.
  it("starts a choice and a quiz with words in every field", () => {
    expect(newStoryStep("choice", "n1")).toEqual({
      id: "n1",
      kind: "choice",
      prompt: "What does the visitor choose?",
      options: [
        { id: "a1", label: "Answer 1" },
        { id: "a2", label: "Answer 2" },
      ],
    });
    expect(newStoryStep("quiz", "n2")).toEqual({
      id: "n2",
      kind: "quiz",
      question: "What is the right answer?",
      points: 10,
      answer: {
        type: "single",
        options: [
          { id: "a1", label: "Answer 1" },
          { id: "a2", label: "Answer 2" },
          { id: "a3", label: "Answer 3" },
        ],
        correct: "a1",
      },
    });
  });
});

describe("an answer's way on, and the answers themselves", () => {
  // Why: the jump picker writes one way per answer, never a jump beside
  // an end; picking the way it already has writes nothing.
  it("sets where an answer leads", () => {
    expect(stepWithGoto(CHOICE, "a1", END_TARGET)?.options[0]).toEqual({
      id: "a1",
      label: "Left",
      end: true,
    });
    expect(stepWithGoto(CHOICE, "a2", "c")?.options[1]).toEqual({
      id: "a2",
      label: "Right",
      goto: "c",
    });
    expect(stepWithGoto(CHOICE, "a2", "")?.options[1]).toEqual({
      id: "a2",
      label: "Right",
    });
    expect(stepWithGoto(CHOICE, "a2", END_TARGET)).toBeNull();
    expect(stepWithGoto(CHOICE, "zz", "")).toBeNull();
  });

  // Why: a choice takes two to four answers: Add stops at four, Remove at
  // two, and a new answer has words and an id of its own.
  it("adds an answer up to four and removes one down to two", () => {
    let step: TourChoice | null = CHOICE;
    for (let n = CHOICE.options.length; n < MAX_ANSWERS; n += 1) {
      step = stepWithAnswer(step as TourChoice) as TourChoice | null;
      expect(step?.options).toHaveLength(n + 1);
    }
    expect(step?.options.at(-1)).toEqual({ id: "a4", label: "Answer 4" });
    expect(new Set(step?.options.map((o) => o.id)).size).toBe(MAX_ANSWERS);
    expect(stepWithAnswer(step as TourChoice)).toBeNull();
    expect(stepWithoutAnswer(CHOICE, "a1")).toBeNull();
    expect(
      stepWithoutAnswer(step as TourChoice, "a1")?.kind === "choice" &&
        (stepWithoutAnswer(step as TourChoice, "a1") as TourChoice).options.map(
          (o) => o.id,
        ),
    ).toEqual(["a2", "a3", "a4"]);
  });

  // Why: a quiz's answers go the same way, and its right answer stays one
  // of its own: removing the right one makes the first left right.
  it("keeps a quiz's right answer one of its own", () => {
    const more = stepWithAnswer(QUIZ) as TourQuizEntry;
    expect(more.answer).toMatchObject({
      options: [{ id: "a1" }, { id: "a2" }, { id: "a3", label: "Answer 3" }],
      correct: "a2",
    });
    expect(stepWithoutAnswer(more, "a2")?.kind === "quiz").toBe(true);
    expect((stepWithoutAnswer(more, "a2") as TourQuizEntry).answer).toEqual({
      type: "single",
      options: [
        { id: "a1", label: "Old" },
        { id: "a3", label: "Answer 3" },
      ],
      correct: "a1",
    });
    expect(stepWithRight(QUIZ, "a1")?.answer).toMatchObject({
      correct: "a1",
    });
    expect(stepWithRight(QUIZ, "a2")).toBeNull();
    expect(stepWithRight(QUIZ, "zz")).toBeNull();
  });
});
