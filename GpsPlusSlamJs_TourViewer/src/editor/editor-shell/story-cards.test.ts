/**
 * A story's step cards as the story inspector draws them: what each step
 * is, where each answer leads (the jump chips) and the loop warning on
 * the steps of a loop no answer can leave, with its one fix.
 */
import { describe, expect, it } from "vitest";
import type { TourStoryChild } from "gps-plus-slam-app-framework/ar/tour-story";
import { storyCards } from "./story-cards.js";

const TEXT: TourStoryChild = {
  id: "t1",
  kind: "shortText",
  view: "card",
  text: "The gate",
  advance: { mode: "auto", afterS: 4 },
} as unknown as TourStoryChild;

const CHOICE: TourStoryChild = {
  id: "c1",
  kind: "choice",
  prompt: "Which way?",
  options: [
    { id: "a1", label: "Again", goto: "t1" },
    { id: "a2", label: "Stop", end: true },
    { id: "a3", label: "On" },
  ],
};

const QUIZ: TourStoryChild = {
  id: "q1",
  kind: "quiz",
  question: "How old?",
  points: 5,
  answer: {
    type: "single",
    options: [
      { id: "x", label: "Old" },
      { id: "y", label: "New" },
    ],
    correct: "y",
  },
};

describe("storyCards", () => {
  // Why: a card says what the step is and, for a choice, where each
  // answer leads, as a chip the editor can follow; a quiz names its right
  // answer and where the story goes after it.
  it("draws each step with its jumps", () => {
    const [text, choice, quiz] = storyCards([TEXT, CHOICE, QUIZ]);
    expect(text).toMatchObject({
      id: "t1",
      number: 1,
      kind: "pin",
      tag: "Shows a pin",
      line: null,
      chips: ["After 4 s"],
      answers: [],
      issue: null,
      fix: null,
    });
    expect(choice).toMatchObject({
      number: 2,
      kind: "choice",
      tag: "Asks",
      title: "Which way?",
      line: "The visitor picks one of 3 answers.",
      answers: [
        {
          label: "Again",
          right: null,
          jump: { text: "goes back to step 1", type: "back", to: "t1" },
        },
        {
          label: "Stop",
          jump: { text: "ends the story", type: "end", to: null },
        },
        { label: "On", jump: { text: "next: step 3", type: "next", to: "q1" } },
      ],
    });
    expect(quiz).toMatchObject({
      kind: "quiz",
      tag: "Quiz",
      title: "How old?",
      line: "5 points for the right answer, then the story goes on.",
      answers: [
        { label: "Old", right: false, jump: null },
        { label: "New", right: true, jump: null },
        {
          label: "After the answer",
          right: null,
          jump: { text: "then the story ends", type: "end", to: null },
        },
      ],
    });
  });

  // Why: a loop no answer can leave is said on each of its steps, and the
  // loop's last choice offers the one fix: its last answer ends the story.
  it("warns on the steps of a trap, the fix on its last choice", () => {
    const trap: TourStoryChild = {
      id: "c2",
      kind: "choice",
      prompt: "Again?",
      options: [
        { id: "a1", label: "Yes", goto: "t1" },
        { id: "a2", label: "Sure", goto: "t1" },
      ],
    };
    const cards = storyCards([TEXT, trap]);
    expect(cards.map((c) => c.issue)).toEqual([
      expect.stringContaining("Steps 1 and 2 go round in a loop"),
      expect.stringContaining("Steps 1 and 2 go round in a loop"),
    ]);
    expect(cards.map((c) => c.fix)).toEqual([
      null,
      'Let "Sure" end the story',
    ]);
    expect(storyCards([TEXT, CHOICE]).every((c) => c.issue === null)).toBe(
      true,
    );
  });
});
