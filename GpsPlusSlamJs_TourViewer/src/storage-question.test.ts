/**
 * Step 1's opening question: is the tour's file in your storage already?
 *
 * Why these tests matter: the file must be in the creator's storage before
 * anything is made - its link goes into the printed code, and only an open
 * tour keeps a copy of what is placed on this phone. One question routes
 * each creator to the one way in that fits them (the host tiles, the link
 * step, or the device's file picker), so each answer must lead exactly
 * there and show nothing of the others.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  STORAGE_ANSWERS,
  wireStorageQuestion,
  type StorageAnswer,
} from "./storage-question.js";

class FakeButton {
  readonly attributes = new Map<string, string>();
  private readonly listeners: (() => void)[] = [];
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(_type: "click", fn: () => void): void {
    this.listeners.push(fn);
  }
  click(): void {
    for (const fn of this.listeners) fn();
  }
  pressed(): string | undefined {
    return this.attributes.get("aria-pressed");
  }
}

function setup() {
  const answers = {
    newTour: new FakeButton(),
    link: new FakeButton(),
    zip: new FakeButton(),
  };
  const panels = { newTour: { hidden: true }, zip: { hidden: true } };
  const calls: string[] = [];
  wireStorageQuestion({
    dom: { answers, panels },
    onLink: () => calls.push("link"),
    onZip: () => calls.push("zip"),
  });
  return { answers, panels, calls };
}

describe("wireStorageQuestion", () => {
  it("starts with nothing answered and nothing revealed", () => {
    const { answers, panels, calls } = setup();
    for (const answer of STORAGE_ANSWERS) {
      expect(answers[answer].pressed()).toBe("false");
    }
    expect(panels.newTour.hidden).toBe(true);
    expect(panels.zip.hidden).toBe(true);
    expect(calls).toEqual([]);
  });

  it("a new tour reveals the host tiles with their why, and nothing else", () => {
    const { answers, panels, calls } = setup();
    answers.newTour.click();
    expect(panels.newTour.hidden).toBe(false);
    expect(panels.zip.hidden).toBe(true);
    expect(answers.newTour.pressed()).toBe("true");
    expect(calls).toEqual([]);
  });

  it("a link moves on to the link step and leaves step 1's panels closed", () => {
    const { answers, panels, calls } = setup();
    answers.newTour.click();
    answers.link.click();
    expect(calls).toEqual(["link"]);
    expect(panels.newTour.hidden).toBe(true);
    expect(panels.zip.hidden).toBe(true);
    expect(answers.link.pressed()).toBe("true");
    expect(answers.newTour.pressed()).toBe("false");
  });

  it("a zip on this phone opens the file picker and shows its line, where the open reports its progress", () => {
    // The line holds the existing "Open it from this device" button: the
    // open's in-progress label and its retry live there.
    const { answers, panels, calls } = setup();
    answers.zip.click();
    expect(calls).toEqual(["zip"]);
    expect(panels.zip.hidden).toBe(false);
    expect(panels.newTour.hidden).toBe(true);
  });

  it("whatever the answers, at most one panel shows and only the last answer reads pressed", () => {
    // The property behind the cases above: the question has one answer at
    // a time, so a creator who changes their mind never sees two ways in.
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<StorageAnswer>(...STORAGE_ANSWERS), {
          minLength: 1,
          maxLength: 12,
        }),
        (taps) => {
          const { answers, panels, calls } = setup();
          for (const tap of taps) answers[tap].click();
          const last = taps[taps.length - 1];
          for (const answer of STORAGE_ANSWERS) {
            expect(answers[answer].pressed()).toBe(String(answer === last));
          }
          expect(panels.newTour.hidden).toBe(last !== "newTour");
          expect(panels.zip.hidden).toBe(last !== "zip");
          expect(calls).toEqual(taps.filter((t) => t !== "newTour"));
        },
      ),
    );
  });
});
