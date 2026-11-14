// @vitest-environment jsdom
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStoryPreview,
  PREVIEW_NO_STEPS,
  PREVIEW_NO_STORY,
  PREVIEW_QUIZ_NOTE,
} from "./story-preview.js";
import { stationContent, storyOf } from "../test-support/station-content.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

/** A tour of one station holding a story of a text, a choice that goes
 *  back to the text or ends, and (with `quiz`) a quiz after it; and an
 *  empty story. */
function tour(quiz = false): TourManifest {
  return {
    version: 9,
    minor: 0,
    order: "free",
    assets: [],
    stations: [
      {
        id: "gate",
        title: "The old gate",
        lat: 51,
        lon: 7,
        ...stationContent([
          storyOf("legend", [
            {
              id: "l1",
              kind: "longText",
              view: "card",
              title: "The siege",
              body: "In 1632 the gate held.",
              pose: POSE,
              advance: { mode: "tap" },
            },
            {
              id: "c1",
              kind: "choice",
              prompt: "Again?",
              options: [
                { id: "o1", label: "Once more", goto: "l1" },
                { id: "o2", label: "Enough", end: true },
              ],
            },
            ...((quiz
              ? [
                  {
                    id: "q1",
                    kind: "quiz",
                    question: "Which year?",
                    points: 10,
                    answer: {
                      type: "single",
                      options: [
                        { id: "a", label: "1632" },
                        { id: "b", label: "1700" },
                      ],
                      correct: "a",
                    },
                  },
                ]
              : []) as Parameters<typeof storyOf>[1]),
          ]),
          storyOf("empty", []),
        ]),
      },
    ],
  } as unknown as TourManifest;
}

function setUp(manifest: TourManifest | null = tour()) {
  const audio = { play: vi.fn(() => Promise.resolve()), stop: vi.fn() };
  const preview = createStoryPreview({
    doc: document,
    tour: () => manifest,
    loadAsset: () => Promise.reject(new Error("no files here")),
    audio,
    schedule: () => () => undefined,
  });
  const root = document.getElementById("story-preview");
  if (root === null) throw new Error("no preview");
  const q = <T extends HTMLElement>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (found === null) throw new Error(`no ${selector}`);
    return found;
  };
  return { preview, root, q };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("createStoryPreview", () => {
  // Why: the preview is the visitor's own panel and player, so what the
  // author sees is what a visitor meets: the first step's words, Continue
  // on a tap step, then the choice's answers as buttons, a jump back
  // going back, and an answer that ends the story ending it.
  it("plays a story through the visitor's panel, its jumps and its end", () => {
    const { preview, root, q } = setUp();
    const opener = document.createElement("button");
    document.body.append(opener);
    expect(preview.open("legend", opener)).toBeNull();
    expect(root.hidden).toBe(false);
    expect(q("#spv-title").textContent).toBe("Preview: A story");
    expect(q(".stitle").textContent).toBe("The old gate");
    expect(q(".text").textContent).toContain("In 1632 the gate held.");
    expect(document.activeElement?.textContent).toBe("Close");
    q('[data-spv="continue"]').click();
    const answers = () =>
      [...root.querySelectorAll<HTMLElement>(".choices button")].map(
        (b) => b.textContent,
      );
    expect(answers()).toEqual(["Once more", "Enough"]);
    root.querySelector<HTMLElement>(".choices button")?.click();
    expect(q(".text").textContent).toContain("In 1632 the gate held.");
    q('[data-spv="continue"]').click();
    [...root.querySelectorAll<HTMLElement>(".choices button")][1]?.click();
    expect(q(".spvend").hidden).toBe(false);
    expect(document.activeElement?.textContent).toBe("Play again");
    q('[data-spv="again"]').click();
    expect(q(".spvend").hidden).toBe(true);
    expect(q(".text").textContent).toContain("In 1632 the gate held.");
    q('[data-spv="close"]').click();
    expect(preview.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  // Why: Escape must close the preview and stop there: the editor's own
  // Escape would drop its selection under the dialog.
  it("closes on Escape without the page seeing it", () => {
    const { preview, root } = setUp();
    const page = vi.fn();
    document.addEventListener("keydown", page);
    preview.open("legend");
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(preview.isOpen()).toBe(false);
    expect(page).not.toHaveBeenCalled();
    document.removeEventListener("keydown", page);
  });

  // Why: a story the player cannot start says why instead of opening an
  // empty dialog: one with no steps, one gone, no tour at all.
  it("refuses a story with no steps, a gone one, and no tour, in words", () => {
    const { preview } = setUp();
    expect(preview.open("empty")).toBe(PREVIEW_NO_STEPS);
    expect(preview.open("gone")).toBe(PREVIEW_NO_STORY);
    expect(preview.isOpen()).toBe(false);
    document.body.replaceChildren();
    expect(setUp(null).preview.open("legend")).toBe(PREVIEW_NO_STORY);
  });

  // Why: the visitor's player goes past a quiz today, so the preview must
  // say so where a story holds one rather than look broken.
  it("says that a quiz is not played, only for a story with one", () => {
    const plain = setUp();
    plain.preview.open("legend");
    expect(plain.q(".spvnote").hidden).toBe(true);
    document.body.replaceChildren();
    const quiz = setUp(tour(true));
    quiz.preview.open("legend");
    expect(quiz.q(".spvnote").hidden).toBe(false);
    expect(quiz.q(".spvnote").textContent).toBe(PREVIEW_QUIZ_NOTE);
  });
});
