import { describe, expect, it } from "vitest";

import {
  createStoryChoices,
  playableStories,
  storyPickLabel,
} from "./story-choice";
import { playableStory, storyOf } from "./test-support/station-content.js";

/**
 * Why these tests matter: this is the rule of a station with several
 * stories. A story with nothing to play must never be offered (a visitor
 * would tap into an empty panel), one story must start as it always did,
 * and the station must end when nothing is left to play, not a story early
 * and not never.
 */

const quiz = {
  id: "q",
  kind: "quiz",
  question: "How old?",
  points: 1,
  answer: { type: "number", value: 800, tolerance: 50 },
} as const;

const a = playableStory("a");
const b = playableStory("b");
const c = playableStory("c");
const twoOfThem = { id: "s", children: [a, b] };

describe("playableStories", () => {
  it("leaves out an empty story and one of quizzes alone, in the file's order", () => {
    const station = {
      children: [storyOf("empty", []), a, storyOf("quizzes", [quiz]), b],
    };
    expect(playableStories(station).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("what the panel shows", () => {
  it("nothing for a station with no story and no card", () => {
    const panel = createStoryChoices().panelOf(
      { id: "s", children: [] },
      false,
    );
    expect(panel).toEqual({ show: "nothing" });
  });

  it("the card for a station with no playable story but a card", () => {
    const station = { id: "s", children: [storyOf("empty", [])] };
    expect(createStoryChoices().panelOf(station, true)).toEqual({
      show: "card",
    });
  });

  it("the story itself for one playable story, its unplayable sisters not counting", () => {
    const station = { id: "s", children: [storyOf("empty", []), a] };
    expect(createStoryChoices().panelOf(station, true)).toEqual({
      show: "story",
      story: a,
    });
  });

  it("the picker for two, in the file's order, nothing played yet", () => {
    expect(createStoryChoices().panelOf(twoOfThem, false)).toEqual({
      show: "picker",
      picks: [
        { story: a, played: false },
        { story: b, played: false },
      ],
    });
  });
});

describe("after a story", () => {
  it("comes back to the picker with the story marked while another is unplayed", () => {
    const back = createStoryChoices().storyEnded(twoOfThem, "a");
    expect(back?.picks).toEqual([
      { story: a, played: true },
      { story: b, played: false },
    ]);
  });

  it("ends the station with the last unplayed story", () => {
    const choices = createStoryChoices();
    choices.storyEnded(twoOfThem, "b");
    expect(choices.storyEnded(twoOfThem, "a")).toBeNull();
  });

  it("ends a one-story station with its story", () => {
    const station = { id: "s", children: [a] };
    expect(createStoryChoices().storyEnded(station, "a")).toBeNull();
  });

  it("does not count a story played again as a new one", () => {
    // Why: the marked button still plays; a second run of it must not
    // finish a station whose third story nobody has seen.
    const station = { id: "s", children: [a, b, c] };
    const choices = createStoryChoices();
    choices.storyEnded(station, "a");
    expect(choices.storyEnded(station, "a")).not.toBeNull();
    choices.storyEnded(station, "b");
    expect(choices.storyEnded(station, "a")).not.toBeNull();
    expect(choices.storyEnded(station, "c")).toBeNull();
  });
});

describe("the marks", () => {
  it("are per station", () => {
    const other = { ...twoOfThem, id: "s2" };
    const choices = createStoryChoices();
    choices.storyEnded(twoOfThem, "a");
    expect(choices.panelOf(other, false)).toMatchObject({
      picks: [{ played: false }, { played: false }],
    });
    expect(choices.panelOf(twoOfThem, false)).toMatchObject({
      picks: [{ played: true }, { played: false }],
    });
  });

  it("survive reopening the panel, which is what a re-queue does", () => {
    const choices = createStoryChoices();
    choices.storyEnded(twoOfThem, "b");
    expect(choices.panelOf(twoOfThem, false)).toMatchObject({
      picks: [{ played: false }, { played: true }],
    });
  });

  it("go when the station is done, and with its last story", () => {
    const choices = createStoryChoices();
    choices.storyEnded(twoOfThem, "a");
    choices.forget(twoOfThem);
    expect(choices.panelOf(twoOfThem, false)).toMatchObject({
      picks: [{ played: false }, { played: false }],
    });
    choices.storyEnded(twoOfThem, "a");
    choices.storyEnded(twoOfThem, "b");
    expect(choices.panelOf(twoOfThem, false)).toMatchObject({
      picks: [{ played: false }, { played: false }],
    });
  });

  it("all go at once when everything stops", () => {
    const choices = createStoryChoices();
    choices.storyEnded(twoOfThem, "a");
    choices.clear();
    expect(choices.panelOf(twoOfThem, false)).toMatchObject({
      picks: [{ played: false }, { played: false }],
    });
  });
});

describe("storyPickLabel", () => {
  it("is the title, and a played one carries a sign beside it", () => {
    expect(storyPickLabel({ story: a, played: false })).toBe(a.title);
    expect(storyPickLabel({ story: a, played: true })).toBe(`✓ ${a.title}`);
  });
});
