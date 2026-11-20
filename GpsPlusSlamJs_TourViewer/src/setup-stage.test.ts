/**
 * The setup page's question, checklist and map (polish round M2b, the L5
 * look; the question and its paths, `setup-path.ts`).
 *
 * Why these tests matter: step 1 only asks, and an answer only routes, so
 * the question must give way to its path's checklist and come back on
 * "Change the answer". The card shows one step at a time, so the
 * checklist, Back and Next are the ONLY way between steps - an item that
 * opened the wrong step, or a row that offered "Next" past "Start
 * creating", would strand the creator. Every move must go through the
 * wizard (which keeps the create step open during an AR session), and a
 * tap on the open step's heading must not collapse it, or the card would
 * be left empty.
 */
import { describe, expect, it } from "vitest";

import type { SetupAnswer } from "./setup-path.js";
import { wireSetupStage } from "./setup-stage.js";
import { WIZARD_STEPS, type WizardStep } from "./wizard.js";

class FakeNode {
  children: FakeNode[] = [];
  textContent = "";
  hidden = false;
  open = false;
  type = "";
  className = "";
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  scrolled = 0;
  scrolls: (ScrollIntoViewOptions | undefined)[] = [];
  focused: (FocusOptions | undefined)[] = [];
  private readonly listeners = new Map<string, ((e: FakeEvent) => void)[]>();
  constructor(readonly tagName: string) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  replaceChildren(...nodes: FakeNode[]) {
    this.children = nodes;
  }
  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }
  addEventListener(type: string, fn: (e: FakeEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string): FakeEvent {
    const event = new FakeEvent();
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
  scrollIntoView(options?: ScrollIntoViewOptions) {
    this.scrolled += 1;
    this.scrolls.push(options);
  }
  focus(options?: FocusOptions) {
    this.focused.push(options);
  }
}

class FakeEvent {
  prevented = false;
  preventDefault() {
    this.prevented = true;
  }
}

const ANSWERS = ["share-now", "have-link", "file-here", "start-here"] as const;

function setup(
  initiallyOpen: WizardStep | null = "host",
  reducedMotion = false,
  initialAnswer: SetupAnswer | null = "share-now",
) {
  const steps = Object.fromEntries(
    WIZARD_STEPS.map((s) => [s, new FakeNode("details")]),
  ) as Record<WizardStep, FakeNode>;
  const summaries = Object.fromEntries(
    WIZARD_STEPS.map((s) => [s, new FakeNode("summary")]),
  ) as Record<WizardStep, FakeNode>;
  if (initiallyOpen !== null) steps[initiallyOpen].open = true;
  const answers = ANSWERS.map((a) => {
    const node = new FakeNode("button");
    node.dataset["answer"] = a;
    return node;
  });
  const dom = {
    steps,
    summaries,
    question: new FakeNode("div"),
    answers,
    change: new FakeNode("button"),
    card: new FakeNode("div"),
    badge: new FakeNode("span"),
    of: new FakeNode("span"),
    dots: new FakeNode("ol"),
    nav: new FakeNode("div"),
    back: new FakeNode("button"),
    next: new FakeNode("button"),
    begins: [new FakeNode("button"), new FakeNode("button")],
    stage: new FakeNode("div"),
  };
  const opened: WizardStep[] = [];
  /** A wizard stand-in: one step open, as wizard.ts guarantees. */
  const openStep = (step: WizardStep) => {
    opened.push(step);
    for (const s of WIZARD_STEPS) steps[s].open = s === step;
    steps[step].fire("toggle");
  };
  let answer = initialAnswer;
  const answered: (SetupAnswer | null)[] = [];
  const stage = wireSetupStage({
    dom,
    openStep,
    answer: () => answer,
    onAnswer: (given) => {
      answered.push(given);
      answer = given;
      stage.render();
    },
    createElement: (tag) => new FakeNode(tag),
    reducedMotion: () => reducedMotion,
  });
  const dot = (step: WizardStep) => {
    const found = dom.dots.children.find((d) => d.dataset.step === step);
    if (found === undefined) throw new Error(`no item ${step}`);
    return found;
  };
  return { dom, opened, stage, dot, steps, summaries, answered };
}

describe("wireSetupStage", () => {
  it("shows the question as step 1, with no checklist and no row, while no answer is chosen", () => {
    const { dom } = setup(null, false, null);
    expect(dom.question.hidden).toBe(false);
    expect(dom.change.hidden).toBe(true);
    expect(dom.badge.textContent).toBe("1");
    expect(dom.of.textContent).toBe("Step 1 of 2");
    expect(dom.dots.children).toEqual([]);
    expect(dom.nav.hidden).toBe(true);
    expect(dom.card.getAttribute("data-path")).toBe("none");
  });

  it("an answer only routes: it is handed over, and its checklist replaces the question", () => {
    const { dom, answered, opened } = setup(null, false, null);
    dom.answers[3]?.fire("click");
    expect(answered).toEqual(["start-here"]);
    // Opening the first step is the caller's (it knows the stored host).
    expect(opened).toEqual([]);
    expect(dom.question.hidden).toBe(true);
    expect(dom.change.hidden).toBe(false);
    expect(dom.badge.textContent).toBe("2");
    expect(dom.card.getAttribute("data-path")).toBe("start-here");
    expect(dom.dots.children.map((d) => d.dataset.step)).toEqual([
      "starter",
      "measure",
      "done",
    ]);
    dom.change.fire("click");
    expect(answered).toEqual(["start-here", null]);
    expect(dom.question.hidden).toBe(false);
    expect(dom.dots.children).toEqual([]);
  });

  it("renders an item per step of the path, the open one current", () => {
    const { dom, dot } = setup("print");
    expect(dom.dots.children.map((d) => d.dataset.step)).toEqual([
      "host",
      "link",
      "print",
      "hang",
      "measure",
      "done",
    ]);
    expect(dom.badge.textContent).toBe("2");
    expect(dom.of.textContent).toBe("Step 2 of 2");
    expect(dot("print").getAttribute("aria-current")).toBe("step");
    expect(dot("print").getAttribute("data-testid")).toBe("station-print");
    expect(dot("host").dataset["state"]).toBe("done");
    expect(dot("hang").dataset["state"]).toBe("todo");
  });

  it("an item opens its step through the wizard", () => {
    const { opened, dot } = setup("host");
    dot("hang").fire("click");
    expect(opened).toEqual(["hang"]);
    expect(dot("hang").dataset["state"]).toBe("current");
  });

  it("Back and Next move one step along the path through the wizard", () => {
    const { dom, opened } = setup("link");
    dom.next.fire("click");
    expect(opened).toEqual(["print"]);
    dom.back.fire("click");
    expect(opened).toEqual(["print", "link"]);
  });

  it("hides Back on the first item, Next on create, and the whole row on done", () => {
    const { dom, dot } = setup("host");
    expect(dom.back.hidden).toBe(true);
    expect(dom.next.hidden).toBe(false);
    dot("measure").fire("click");
    expect(dom.back.hidden).toBe(false);
    expect(dom.next.hidden).toBe(true);
    dot("done").fire("click");
    expect(dom.nav.hidden).toBe(true);
  });

  it("keeps the open step's heading from collapsing it", () => {
    const { summaries } = setup("print");
    expect(summaries.print.fire("click").prevented).toBe(true);
  });

  it("re-renders when the wizard opens a step by itself (a tour opened, the Finish)", () => {
    const { dom, steps, dot } = setup("link");
    for (const s of WIZARD_STEPS) steps[s].open = s === "done";
    steps.done.fire("toggle");
    expect(dot("done").dataset["state"]).toBe("current");
    expect(dom.nav.hidden).toBe(true);
  });

  // The landing has a "Make your tour" near the top and one after the
  // cards: each must bring the setup into view and put the keyboard on
  // what the reader acts on next, else a keyboard or screen-reader user is
  // left at the button with the setup scrolled past them.
  it("every Make your tour button scrolls to the stage and focuses the open step's heading", () => {
    const { dom, summaries } = setup("print");
    for (const begin of dom.begins) begin.fire("click");
    expect(dom.stage.scrolls).toEqual([
      { block: "start", behavior: "smooth" },
      { block: "start", behavior: "smooth" },
    ]);
    // The scroll is the button's; the focus must not scroll again.
    expect(summaries.print.focused).toEqual([
      { preventScroll: true },
      { preventScroll: true },
    ]);
    expect(summaries.host.focused).toEqual([]);
  });

  it("focuses the question's first answer while no answer is chosen", () => {
    const { dom } = setup(null, false, null);
    dom.begins[0]?.fire("click");
    expect(dom.answers[0]?.focused).toEqual([{ preventScroll: true }]);
  });

  it("scrolls at once under reduced motion", () => {
    const { dom } = setup("host", true);
    dom.begins[0]?.fire("click");
    expect(dom.stage.scrolls).toEqual([
      { block: "start", behavior: "instant" },
    ]);
  });
});
