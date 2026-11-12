/**
 * Why these tests matter: a station's stories are edited as folders now,
 * and each of these small changes reaches the visitor. A new story placed
 * after the free blocks would change where the writer puts it on the next
 * reload; a `goto` left naming a deleted child is a file the format
 * refuses; and an empty or over-long title is a story the reader drops.
 */
import { describe, expect, it } from "vitest";
import {
  tourStories,
  type TourChoice,
  type TourStory,
  type TourStoryBlock,
} from "gps-plus-slam-app-framework/ar/tour-story";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { storyOf } from "./test-support/station-content.js";
import {
  newStory,
  withoutStory,
  withoutStoryChild,
  withStory,
  withStoryChild,
  withStoryStep,
  withStoryTitle,
} from "./tour-story-edit.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

const LINE = {
  kind: "shortText",
  view: "card",
  caption: "Hello",
  pose: POSE,
} as const;

const FREE = {
  id: "free-1",
  kind: "shortText",
  view: "pin",
  caption: "Free",
  pose: POSE,
} as const;

function choice(
  id: string,
  gotos: readonly (string | undefined)[],
): TourChoice {
  return {
    id,
    kind: "choice",
    prompt: "Which way?",
    options: gotos.map((goto, i) => ({
      id: `${id}-o${String(i)}`,
      label: `Way ${String(i)}`,
      ...(goto === undefined ? {} : { goto }),
    })),
  };
}

function frame(
  children: TourStation["children"],
): Pick<TourStation, "children"> {
  return { children };
}

const line = (id: string) => ({ ...LINE, id });

describe("newStory", () => {
  it("makes an empty story with the title trimmed", () => {
    expect(newStory("s", "  Story 1 ")).toEqual({
      id: "s",
      kind: "folder",
      role: "story",
      title: "Story 1",
      children: [],
    });
  });

  it("refuses a blank title and one over the format's cap", () => {
    expect(newStory("s", "   ")).toBeNull();
    expect(newStory("s", "x".repeat(81))).toBeNull();
    expect(newStory("s", "x".repeat(80))).not.toBeNull();
  });
});

describe("withStory", () => {
  // Why: the writer lists stories first; a story put after the free blocks
  // would be read back in another place than the tree showed.
  it("puts a new story after the stories and before the free blocks", () => {
    const made = newStory("two", "Two") as TourStory;
    const next = withStory(frame([storyOf("one", []), FREE]), made);
    expect(next.children.map((c) => c.id)).toEqual(["one", "two", "free-1"]);
  });

  // Why: a copy belongs beside its original, where the creator looks for
  // it, not at the end of a long list of stories.
  it("puts a story right after the one named, before a later story", () => {
    const made = newStory("copy", "Copy") as TourStory;
    const next = withStory(
      frame([storyOf("one", []), storyOf("two", []), FREE]),
      made,
      "one",
    );
    expect(next.children.map((c) => c.id)).toEqual([
      "one",
      "copy",
      "two",
      "free-1",
    ]);
  });

  // Why: a name that is no story of the holder (a free block's id, an id
  // gone meanwhile) must not put the story among the free blocks.
  it.each(["free-1", "gone"])(
    "puts it after the last story when %s names no story",
    (after) => {
      const made = newStory("copy", "Copy") as TourStory;
      const next = withStory(frame([storyOf("one", []), FREE]), made, after);
      expect(next.children.map((c) => c.id)).toEqual(["one", "copy", "free-1"]);
    },
  );

  it("puts the first story before the free blocks", () => {
    const made = newStory("one", "One") as TourStory;
    const next = withStory(frame([FREE]), made);
    expect(next.children.map((c) => c.id)).toEqual(["one", "free-1"]);
  });
});

describe("withStoryTitle", () => {
  it("sets a story's title, trimmed, and nothing else", () => {
    const next = withStoryTitle(
      frame([storyOf("one", [line("a")]), FREE]),
      "one",
      " New name ",
    );
    expect(next === null ? [] : tourStories(next).map((s) => s.title)).toEqual([
      "New name",
    ]);
    expect(next?.children[1]).toEqual(FREE);
  });

  it("refuses an unknown story, a blank title and one over the cap", () => {
    const start = frame([storyOf("one", [])]);
    expect(withStoryTitle(start, "other", "x")).toBeNull();
    expect(withStoryTitle(start, "one", "  ")).toBeNull();
    expect(withStoryTitle(start, "one", "x".repeat(81))).toBeNull();
  });
});

describe("withoutStory", () => {
  it("takes a story out with its children", () => {
    const next = withoutStory(
      frame([storyOf("one", [line("a")]), FREE]),
      "one",
    );
    expect(next?.children.map((c) => c.id)).toEqual(["free-1"]);
  });

  it("refuses an unknown story", () => {
    expect(withoutStory(frame([FREE]), "free-1")).toBeNull();
  });
});

describe("withStoryChild", () => {
  it("adds a child at the end of its story", () => {
    const added = {
      ...line("new"),
      advance: { mode: "tap" },
    } as TourStoryBlock;
    const next = withStoryChild(
      frame([storyOf("one", [line("a")])]),
      "one",
      added,
    );
    expect(
      next === null ? [] : tourStories(next)[0]?.children.map((c) => c.id),
    ).toEqual(["a", "new"]);
  });

  it("refuses an unknown story", () => {
    const added = {
      ...line("new"),
      advance: { mode: "tap" },
    } as TourStoryBlock;
    expect(withStoryChild(frame([]), "one", added)).toBeNull();
  });
});

describe("withoutStoryChild", () => {
  // Why: a `goto` naming a child that went is a file the reader refuses;
  // the answer goes on to the next child instead, and the count is what the
  // toast says.
  it("prunes the gotos that named it, and counts them", () => {
    const out = withoutStoryChild(
      frame([
        storyOf("one", [
          line("a"),
          choice("c", ["a", "b", undefined]),
          choice("d", ["a"]),
          line("b"),
        ]),
      ]),
      "a",
    );
    expect(out?.answers).toBe(2);
    const story = out === null ? undefined : tourStories(out.frame)[0];
    expect(story?.children.map((c) => c.id)).toEqual(["c", "d", "b"]);
    const options = (story?.children[0] as TourChoice).options;
    expect(options.map((o) => o.goto)).toEqual([undefined, "b", undefined]);
    expect(Object.hasOwn(options[0] ?? {}, "goto")).toBe(false);
  });

  it("takes a choice out with no answer changed", () => {
    const out = withoutStoryChild(
      frame([storyOf("one", [choice("c", ["b"]), line("b")])]),
      "c",
    );
    expect(out?.answers).toBe(0);
  });

  it("refuses a child of no story", () => {
    expect(withoutStoryChild(frame([FREE]), "free-1")).toBeNull();
  });
});

describe("withStoryStep", () => {
  const story = () =>
    frame([
      storyOf("one", [line("a"), choice("c", ["a", undefined]), line("b")]),
    ]);
  const choiceOf = (out: Pick<TourStation, "children"> | null) =>
    (out === null ? undefined : tourStories(out)[0])?.children[1] as
      | TourChoice
      | undefined;

  // Why: the choice inspector writes a whole step back at once; what it
  // writes is checked by the format's own reader, so an answer that ends
  // the story or jumps back is kept as written.
  it("puts an edited choice in place, ends and backward jumps kept", () => {
    const edited: TourChoice = {
      id: "c",
      kind: "choice",
      prompt: "  Again?  ",
      options: [
        { id: "c-o0", label: "Yes", goto: "c" },
        { id: "c-o1", label: "No", end: true },
        { id: "c-o2", label: "Back", goto: "a" },
      ],
    };
    const got = choiceOf(withStoryStep(story(), edited));
    expect(got?.options).toEqual(edited.options);
    expect(got?.prompt.trim()).toBe("Again?");
  });

  // Why: the editor must never hold a step the reader would refuse on the
  // next load - a blank answer, one answer only, a jump to no step, an
  // end beside a jump - nor turn a step into another kind.
  it("refuses a step the format refuses, an unknown one and another kind", () => {
    const base = choice("c", [undefined, undefined]);
    const bad: TourChoice[] = [
      { ...base, prompt: " " },
      { ...base, options: base.options.slice(0, 1) },
      {
        ...base,
        options: [base.options[0]!, { id: "x", label: "Lost", goto: "gone" }],
      },
      {
        ...base,
        options: [
          base.options[0]!,
          { id: "x", label: "Both", goto: "a", end: true },
        ],
      },
      { ...base, options: [base.options[0]!, { ...base.options[0]! }] },
    ];
    for (const step of bad) expect(withStoryStep(story(), step)).toBeNull();
    expect(withStoryStep(story(), { ...base, id: "nope" })).toBeNull();
    expect(
      withStoryStep(story(), {
        id: "a",
        kind: "quiz",
        question: "Which?",
        points: 1,
        answer: {
          type: "single",
          options: [
            { id: "p", label: "P" },
            { id: "q", label: "Q" },
          ],
          correct: "p",
        },
      }),
    ).toBeNull();
  });

  // Why: a quiz is edited the same way, its right answer one of its own.
  it("puts an edited quiz in place and refuses a right answer it lacks", () => {
    const quiz = {
      id: "q",
      kind: "quiz" as const,
      question: "How old?",
      points: 2,
      answer: {
        type: "single" as const,
        options: [
          { id: "q-a", label: "Old" },
          { id: "q-b", label: "New" },
        ],
        correct: "q-b",
      },
    };
    const holder = frame([storyOf("one", [line("a"), quiz])]);
    const edited = { ...quiz, points: 5, question: "How new?" };
    const out = withStoryStep(holder, edited);
    expect(
      (out === null ? undefined : tourStories(out)[0])?.children[1],
    ).toEqual(edited);
    expect(
      withStoryStep(holder, {
        ...quiz,
        answer: { ...quiz.answer, correct: "zz" },
      }),
    ).toBeNull();
    expect(withStoryStep(holder, { ...quiz, points: -1 })).toBeNull();
  });
});
