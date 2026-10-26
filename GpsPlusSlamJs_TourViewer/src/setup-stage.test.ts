/**
 * The setup page's station row and map (polish round M2b, the L5 look).
 *
 * Why these tests matter: the card shows one step at a time, so the dots,
 * Back and Next are the ONLY way between steps - a dot that opened the
 * wrong step, or a row that offered "Next" past "Start creating", would
 * strand the creator. Every move must go through the wizard (which keeps
 * step 5 open during an AR session), and a tap on the open step's heading
 * must not collapse it, or the card would be left empty.
 */
import { describe, expect, it } from "vitest";

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

function setup(initiallyOpen: WizardStep = "host", reducedMotion = false) {
  const steps = Object.fromEntries(
    WIZARD_STEPS.map((s) => [s, new FakeNode("details")]),
  ) as Record<WizardStep, FakeNode>;
  const summaries = Object.fromEntries(
    WIZARD_STEPS.map((s) => [s, new FakeNode("summary")]),
  ) as Record<WizardStep, FakeNode>;
  steps[initiallyOpen].open = true;
  const dom = {
    steps,
    summaries,
    badge: new FakeNode("span"),
    of: new FakeNode("span"),
    dots: new FakeNode("nav"),
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
  const stage = wireSetupStage({
    dom,
    openStep,
    createElement: (tag) => new FakeNode(tag),
    reducedMotion: () => reducedMotion,
  });
  const dot = (step: WizardStep) => {
    const found = dom.dots.children.find((d) => d.dataset.step === step);
    if (found === undefined) throw new Error(`no dot ${step}`);
    return found;
  };
  return { dom, opened, stage, dot, steps, summaries };
}

describe("wireSetupStage", () => {
  it("renders a dot per step and the open step's number", () => {
    const { dom, dot } = setup("print");
    expect(dom.dots.children.map((d) => d.dataset.step)).toEqual([
      ...WIZARD_STEPS,
    ]);
    expect(dom.badge.textContent).toBe("3");
    expect(dom.of.textContent).toBe("Step 3 of 6");
    expect(dot("print").getAttribute("aria-current")).toBe("step");
    expect(dot("host").dataset.state).toBe("done");
    expect(dot("hang").dataset.state).toBe("todo");
  });

  it("a dot opens its step through the wizard", () => {
    const { dom, opened, dot } = setup("host");
    dot("hang").fire("click");
    expect(opened).toEqual(["hang"]);
    expect(dom.badge.textContent).toBe("4");
  });

  it("Back and Next move one step through the wizard", () => {
    const { dom, opened } = setup("link");
    dom.next.fire("click");
    expect(opened).toEqual(["print"]);
    dom.back.fire("click");
    expect(opened).toEqual(["print", "link"]);
  });

  it("hides Back on step 1, Next on step 5, and the whole row on step 6", () => {
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
    const { dom, steps } = setup("link");
    for (const s of WIZARD_STEPS) steps[s].open = s === "done";
    steps.done.fire("toggle");
    expect(dom.badge.textContent).toBe("6");
    expect(dom.nav.hidden).toBe(true);
  });

  // The landing has a "Make your tour" near the top and one after the
  // cards: each must bring the setup into view and put the keyboard on the
  // open step's heading, else a keyboard or screen-reader user is left at
  // the button with the setup scrolled past them.
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

  it("scrolls at once under reduced motion", () => {
    const { dom } = setup("host", true);
    dom.begins[0]?.fire("click");
    expect(dom.stage.scrolls).toEqual([
      { block: "start", behavior: "instant" },
    ]);
  });
});
