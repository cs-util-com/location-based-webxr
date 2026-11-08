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
      kind: "story",
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
