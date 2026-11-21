/**
 * The setup's start question (round 2 of the creator setup flow, variant
 * "conversation"): step 1 asks how the creator wants to start, a tap only
 * routes, and step 2 shows that answer's panel with its one action.
 *
 * Why these tests matter: the question replaces a step that did three
 * things at once (storage, starter, open a file), so the routing is the
 * whole contract - a tap must change nothing but the panel and the open
 * step, each panel must show exactly its own blocks, and the one new action
 * ("Start on this phone now, share later") must save the file BEFORE it
 * opens it, never open a tour the creator did not get to keep, and say so
 * in its button when the save is dismissed or fails (async-UI rule).
 */
import { configureStore } from "@reduxjs/toolkit";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  panelView,
  START_BLOCKS,
  START_LABELS,
  startOnThisPhone,
  wireStartQuestion,
  type StartBlock,
} from "./start-question.js";
import {
  selectStartPanel,
  START_ANSWERS,
  type StartPanel,
  startPanelShown,
  startQuestionReducer,
} from "./start-question-slice.js";
import type { WizardStep } from "./wizard.js";

class FakeNode {
  hidden = false;
  open = false;
  disabled = false;
  textContent: string | null = "";
  readonly dataset: Record<string, string | undefined> = {};
  private readonly listeners = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

/** Resolves once every queued microtask and the timers' turn has run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  options: {
    initial?: StartPanel | null;
    hosted?: boolean;
    save?: (blob: Blob, name: string) => Promise<boolean>;
    open?: (file: File) => Promise<{ kind: string }>;
    pack?: () => Promise<Blob>;
    /** Whether a tour is open; the default fake open opens one. */
    tourOpen?: boolean;
  } = {},
) {
  const node = () => new FakeNode();
  const dom = {
    answers: {
      new: node(),
      link: node(),
      file: node(),
      later: node(),
    },
    heading: node(),
    why: node(),
    blocks: {
      host: node(),
      linkField: node(),
      codeHangs: node(),
      file: node(),
      later: node(),
    },
    backs: [node(), node()],
    codeHangsButton: node(),
    startButton: node(),
    makeCode: node(),
    makeCodeButton: node(),
    doneStep: node(),
  };
  const opened: WizardStep[] = [];
  const panels: (StartPanel | null)[] = [];
  const calls: string[] = [];
  const state = {
    hosted: options.hosted ?? false,
    tourOpen: options.tourOpen ?? false,
  };
  const tourListeners: (() => void)[] = [];
  const store = configureStore({
    reducer: { startQuestion: startQuestionReducer },
  });
  wireStartQuestion({
    dom,
    store,
    initial: options.initial ?? null,
    openStep: (step) => opened.push(step),
    hosted: () => state.hosted,
    onTourChange: (fn) => {
      tourListeners.push(fn);
    },
    onPanel: (panel) => panels.push(panel),
    start: {
      pack:
        options.pack ??
        (() => {
          calls.push("pack");
          return Promise.resolve(new Blob(["zip"]));
        }),
      save:
        options.save ??
        ((_blob, name) => {
          calls.push(`save ${name}`);
          return Promise.resolve(true);
        }),
      open:
        options.open ??
        ((file) => {
          calls.push(`open ${file.name}`);
          state.tourOpen = true;
          return Promise.resolve({ kind: "opened" });
        }),
      tourOpen: () => state.tourOpen,
    },
  });
  /** The wizard's tour changed (opened, opened from a file, closed). */
  const tourChanged = (hosted: boolean) => {
    state.hosted = hosted;
    for (const fn of tourListeners) fn();
  };
  const shown = (): StartBlock[] =>
    START_BLOCKS.filter((b) => !dom.blocks[b].hidden);
  // The answer is read from the store, as the host tiles read it.
  const question = { panel: () => selectStartPanel(store.getState()) };
  return {
    dom,
    opened,
    panels,
    calls,
    question,
    shown,
    state,
    store,
    tourChanged,
  };
}

describe("panelView", () => {
  it("gives every panel a heading, a why and at least one block (property)", () => {
    const panel = fc.constantFrom<StartPanel>(...START_ANSWERS, "share");
    fc.assert(
      fc.property(panel, (p) => {
        const view = panelView(p);
        expect(view.heading.length).toBeGreaterThan(0);
        expect(view.why.length).toBeGreaterThan(0);
        expect(START_BLOCKS.some((b) => view.blocks[b])).toBe(true);
      }),
    );
  });

  it("shows each answer its own blocks and nothing else", () => {
    const on = (p: StartPanel) =>
      START_BLOCKS.filter((b) => panelView(p).blocks[b]);
    expect(on("new")).toEqual(["host", "linkField"]);
    expect(on("share")).toEqual(["host", "linkField"]);
    expect(on("link")).toEqual(["linkField", "codeHangs"]);
    expect(on("file")).toEqual(["file"]);
    expect(on("later")).toEqual(["later"]);
  });

  // Why: the copy must be honest - the start-later file is
  // empty until Done, and the new-tour why keeps the offline promise the
  // legal page relies on.
  it("says what each route really does", () => {
    expect(panelView("new").why).toMatch(
      /once it has loaded, it keeps working without signal/,
    );
    expect(panelView("share").why).toMatch(/saved your tour zip at Done/);
    expect(panelView("later").why).toMatch(/empty until Done/);
  });
});

describe("wireStartQuestion", () => {
  it("opens on the question with no panel chosen on a first visit", () => {
    const { panels, question, opened } = setup();
    expect(question.panel()).toBeNull();
    expect(panels).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("brings an initial panel back without opening a step (the wizard owns the first step)", () => {
    const { question, shown, opened, dom } = setup({ initial: "new" });
    expect(question.panel()).toBe("new");
    expect(shown()).toEqual(["host", "linkField"]);
    expect(dom.heading.textContent).toBe(panelView("new").heading);
    expect(opened).toEqual([]);
  });

  it("a tap on an answer only routes: its panel, then step 2 (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...START_ANSWERS), (answer) => {
        const { dom, opened, calls, question, shown, panels } = setup();
        dom.answers[answer].fire("click");
        expect(question.panel()).toBe(answer);
        expect(panels).toEqual([answer]);
        expect(opened).toEqual(["link"]);
        expect(shown()).toEqual(
          START_BLOCKS.filter((b) => panelView(answer).blocks[b]),
        );
        expect(dom.heading.textContent).toBe(panelView(answer).heading);
        expect(dom.why.textContent).toBe(panelView(answer).why);
        // Nothing was packed, saved or opened by the tap itself.
        expect(calls).toEqual([]);
      }),
    );
  });

  // Why: the answer is store state read by more than one view; step 2
  // draws whatever the store holds, however it got there.
  it("draws the panel the store holds, also one dispatched from elsewhere", () => {
    const { store, shown, dom, panels, opened } = setup();
    store.dispatch(startPanelShown("later"));
    expect(shown()).toEqual(["later"]);
    expect(dom.heading.textContent).toBe(panelView("later").heading);
    expect(panels).toEqual(["later"]);
    expect(opened).toEqual([]);
  });

  it("every back link returns to the question, keeping the answer", () => {
    const { dom, opened, question } = setup();
    dom.answers.file.fire("click");
    for (const back of dom.backs) back.fire("click");
    expect(opened).toEqual(["link", "host", "host"]);
    expect(question.panel()).toBe("file");
  });

  it("a code that already hangs goes straight to step 5, where it opens the tour", () => {
    const { dom, opened } = setup();
    dom.answers.link.fire("click");
    dom.codeHangsButton.fire("click");
    expect(opened).toEqual(["link", "measure"]);
  });
});

describe("Done's 'Make your code now' (start on this phone, share later)", () => {
  // Why: a tour started on this phone has no link and no printed code.
  // Done must lead to making one (upload, link, print), and must not show
  // the steps for replacing a file at a link that does not exist.
  it("shows for a tour without a link, and marks the step for the page's CSS", () => {
    const { dom } = setup({ hosted: false });
    expect(dom.makeCode.hidden).toBe(false);
    expect(dom.doneStep.dataset.hosted).toBe("false");
  });

  it("stays hidden for a hosted tour", () => {
    const { dom } = setup({ hosted: true });
    expect(dom.makeCode.hidden).toBe(true);
    expect(dom.doneStep.dataset.hosted).toBe("true");
  });

  // Why: a tour that closes while Done stays open changes no step, so a
  // redraw tied to the step's toggle left the replace-the-hosted-file
  // steps showing for a page with no tour. Done draws from the tour.
  it("redraws whenever the tour changes, with no step toggled", () => {
    const { dom, tourChanged } = setup({ hosted: true });
    tourChanged(false);
    expect(dom.makeCode.hidden).toBe(false);
    expect(dom.doneStep.dataset.hosted).toBe("false");
    tourChanged(true);
    expect(dom.makeCode.hidden).toBe(true);
    expect(dom.doneStep.dataset.hosted).toBe("true");
  });

  it("leads to step 2's share panel: the saved zip's upload steps and the link field", () => {
    const { dom, opened, question, shown, panels } = setup();
    dom.makeCodeButton.fire("click");
    expect(question.panel()).toBe("share");
    expect(panels).toEqual(["share"]);
    expect(opened).toEqual(["link"]);
    expect(shown()).toEqual(["host", "linkField"]);
  });
});

describe("startOnThisPhone", () => {
  it("saves the starter zip first, then opens that same file as the tour", async () => {
    const order: string[] = [];
    let savedBlob: Blob | null = null;
    let openedFile: File | null = null;
    const outcome = await startOnThisPhone({
      pack: () => {
        order.push("pack");
        return Promise.resolve(new Blob(["starter"]));
      },
      save: (blob, name) => {
        order.push(`save ${name}`);
        savedBlob = blob;
        return Promise.resolve(true);
      },
      open: (file) => {
        order.push(`open ${file.name}`);
        openedFile = file;
        return Promise.resolve({ kind: "opened" });
      },
      tourOpen: () => false,
    });
    expect(outcome).toBe("opened");
    expect(order).toEqual(["pack", "save tour.zip", "open tour.zip"]);
    expect(await (openedFile as unknown as File).text()).toBe(
      await (savedBlob as unknown as Blob).text(),
    );
  });

  it("opens nothing when the save is dismissed: the creator would not keep the file", async () => {
    const order: string[] = [];
    const outcome = await startOnThisPhone({
      pack: () => Promise.resolve(new Blob(["s"])),
      save: () => Promise.resolve(false),
      open: () => {
        order.push("open");
        return Promise.resolve({ kind: "opened" });
      },
      tourOpen: () => false,
    });
    expect(outcome).toBe("not-saved");
    expect(order).toEqual([]);
  });

  it("reports an open that did not happen, and a pack or save that threw", async () => {
    expect(
      await startOnThisPhone({
        pack: () => Promise.resolve(new Blob(["s"])),
        save: () => Promise.resolve(true),
        open: () => Promise.resolve({ kind: "failed" }),
        tourOpen: () => false,
      }),
    ).toBe("not-opened");
    expect(
      await startOnThisPhone({
        pack: () => Promise.reject(new Error("no zip")),
        save: () => Promise.resolve(true),
        open: () => Promise.resolve({ kind: "opened" }),
        tourOpen: () => false,
      }),
    ).toBe("failed");
    expect(
      await startOnThisPhone({
        pack: () => Promise.resolve(new Blob(["s"])),
        save: () => {
          throw new Error("picker broke");
        },
        open: () => Promise.resolve({ kind: "opened" }),
        tourOpen: () => false,
      }),
    ).toBe("failed");
  });

  // Why: the open replaces whatever tour is open, and the page asks first
  // only while a rebuilt file is unsaved, so pins placed since would be
  // lost without a question; and every attempt saves another empty file.
  // A tour already open is never replaced by an empty one from here.
  it("refuses while a tour is open: nothing packed, saved or opened", async () => {
    const order: string[] = [];
    const outcome = await startOnThisPhone({
      pack: () => {
        order.push("pack");
        return Promise.resolve(new Blob(["s"]));
      },
      save: () => {
        order.push("save");
        return Promise.resolve(true);
      },
      open: () => {
        order.push("open");
        return Promise.resolve({ kind: "opened" });
      },
      tourOpen: () => true,
    });
    expect(outcome).toBe("already-open");
    expect(order).toEqual([]);
  });

  // Why: a declined "leave this tour?" is the creator's choice, not a
  // failure, and must not invite another tap (each saves another file).
  it("tells a declined open from one that failed", async () => {
    expect(
      await startOnThisPhone({
        pack: () => Promise.resolve(new Blob(["s"])),
        save: () => Promise.resolve(true),
        open: () => Promise.resolve({ kind: "cancelled" }),
        tourOpen: () => false,
      }),
    ).toBe("cancelled");
  });
});

describe("the start button (async-UI rule)", () => {
  it("is busy while it saves and opens, then says it is done", async () => {
    let finishSave: (saved: boolean) => void = () => undefined;
    const { dom, calls } = setup({
      save: () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve;
        }),
      open: (file) => {
        calls.push(`open ${file.name}`);
        return Promise.resolve({ kind: "opened" });
      },
    });
    expect(dom.startButton.textContent).toBe(START_LABELS.idle);
    dom.startButton.fire("click");
    await settle();
    expect(dom.startButton.disabled).toBe(true);
    expect(dom.startButton.textContent).toBe(START_LABELS.busy);
    // A second tap while busy starts nothing.
    dom.startButton.fire("click");
    finishSave(true);
    await settle();
    expect(calls).toEqual(["pack", "open tour.zip"]);
    expect(dom.startButton.disabled).toBe(false);
    expect(dom.startButton.textContent).toBe(START_LABELS.opened);
  });

  it("says a dismissed save and a failure in its own words, and can be tapped again", async () => {
    const dismissed = setup({ save: () => Promise.resolve(false) });
    dismissed.dom.startButton.fire("click");
    await settle();
    expect(dismissed.dom.startButton.textContent).toBe(START_LABELS.notSaved);
    expect(dismissed.dom.startButton.disabled).toBe(false);

    const broken = setup({ pack: () => Promise.reject(new Error("x")) });
    broken.dom.startButton.fire("click");
    await settle();
    expect(broken.dom.startButton.textContent).toBe(START_LABELS.failed);
    expect(broken.dom.startButton.disabled).toBe(false);

    const unopened = setup({
      open: () => Promise.resolve({ kind: "failed" }),
    });
    unopened.dom.startButton.fire("click");
    await settle();
    expect(unopened.dom.startButton.textContent).toBe(START_LABELS.notOpened);

    const declined = setup({
      open: () => Promise.resolve({ kind: "cancelled" }),
    });
    declined.dom.startButton.fire("click");
    await settle();
    expect(declined.dom.startButton.textContent).toBe(START_LABELS.cancelled);
    expect(START_LABELS.cancelled).not.toMatch(/try again/);
  });

  // Why: the creator can walk back to this panel after the tour opened;
  // a second tap used to save another empty file and open it over the
  // tour, pins and all. It now changes nothing and says why.
  it("a second tap after the tour opened saves and opens nothing", async () => {
    const { dom, calls } = setup();
    dom.startButton.fire("click");
    await settle();
    expect(dom.startButton.textContent).toBe(START_LABELS.opened);
    dom.startButton.fire("click");
    await settle();
    expect(calls).toEqual(["pack", "save tour.zip", "open tour.zip"]);
    expect(dom.startButton.textContent).toBe(START_LABELS.alreadyOpen);
  });
});
