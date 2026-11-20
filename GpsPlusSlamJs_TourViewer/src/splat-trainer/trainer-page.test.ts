// @vitest-environment jsdom
/**
 * Why these tests matter: the view renders from the store on every change,
 * and a naive re-render loses what the person was doing. These pin the
 * keyboard focus after a decision (a rebuilt button list once dropped it to
 * the page body), the stop dialog's live text and its target (Stop must
 * stop the stretch the dialog was opened for, never the next one), the
 * closer look never opening a stretch that has not started, and what the
 * page shows while a slow step runs: the read of a large recording, the
 * trainer loading and the graphics card being prepared.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureStore } from "@reduxjs/toolkit";

import {
  CENSUS,
  finishCurrent,
  plan,
  storeAt,
} from "../test-support/splat-trainer-fixtures.js";
import type { TrainProgress } from "./trainer-adapter.js";
import {
  initialTrainerPageState,
  trainerPageActions as A,
  trainerPageReducer,
} from "./trainer-page-slice.js";
import {
  barText,
  loupeWord,
  minutesText,
  mountSplatTrainerPage,
  type MountedTrainerPage,
  type PageController,
} from "./trainer-page.js";

let mounted: MountedTrainerPage | null = null;

afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.body.textContent = "";
});

function mount(store = storeAt(4), isPhone = false) {
  const root = document.createElement("div");
  document.body.append(root);
  const controller: PageController = {
    store,
    sides: { previews: new Map() },
    chooseRecording: vi.fn(),
    save: vi.fn(() => Promise.resolve()),
  };
  mounted = mountSplatTrainerPage(root, controller, {
    win: window,
    isPhone,
  });
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (el === null) throw new Error(`no ${sel}`);
    return el;
  };
  return { root, store, controller, q };
}

const printOf = (root: HTMLElement, n: number) =>
  root.querySelector<HTMLElement>(`.print[data-id="w${n - 1}"]`);

describe("census and the trainer", () => {
  it("offers the practice run only with the practice trainer", () => {
    const { q } = mount(storeAt(4, "practice"));
    expect(q('[data-ref="startBtn"]').hidden).toBe(false);
    expect(q('[data-ref="modeChip"]').hidden).toBe(false);
  });

  // Why: the GPU trainer trains for real, so the page offers the start
  // and shows no practice chip.
  it("offers a real run, not a practice one, with the GPU trainer", () => {
    const { q } = mount(storeAt(4, "gpu"));
    expect(q('[data-ref="startBtn"]').hidden).toBe(false);
    expect(q('[data-ref="modeChip"]').hidden).toBe(true);
    expect(q('[data-ref="censusLead"]').textContent).toContain("40 photos");
  });

  it("refuses on a phone-sized screen", () => {
    const { q } = mount(storeAt(4), true);
    expect(q('[data-ref="refusal"]').hidden).toBe(false);
    expect(q('[data-ref="refusalHead"]').textContent).toBe(
      "Use a desktop computer",
    );
  });
});

describe("keyboard focus across re-renders", () => {
  it("keeps the focus on the print's controls after a decision, never on the body", () => {
    const { root, store } = mount();
    store.dispatch(A.trainingStarted());
    finishCurrent(store, "poor");
    for (let i = 0; i < 3; i++) finishCurrent(store, "good");
    const print = printOf(root, 1);
    const discard = print?.querySelector<HTMLButtonElement>(
      '[data-act="discard"]',
    );
    expect(discard).toBeTruthy();
    discard?.focus();
    discard?.click();
    expect(store.getState().windows[0]?.decision).toBe("discard");
    expect(document.activeElement).not.toBe(document.body);
    expect((document.activeElement as HTMLElement).dataset.act).toBe("undo");
    (document.activeElement as HTMLElement).click();
    expect(store.getState().windows[0]?.decision).toBeNull();
    expect((document.activeElement as HTMLElement).dataset.act).toBe("again");
  });

  it("does not rebuild unchanged buttons, so a focused button survives a progress tick", () => {
    const { root, store } = mount(storeAt(3));
    store.dispatch(A.trainingStarted());
    finishCurrent(store, "weak");
    const again = printOf(root, 1)?.querySelector<HTMLButtonElement>(
      '[data-act="again"]',
    );
    again?.focus();
    store.dispatch(
      A.progressed({
        id: "w1",
        attempt: 1,
        fraction: 0.4,
        secondsLeft: 9,
        nextPreviewInS: 2,
        stage: "training",
      }),
    );
    expect(document.activeElement).toBe(again);
  });
});

describe("the stop dialog", () => {
  it("shows live progress and stops the stretch it was opened for", () => {
    const { root, store, q } = mount();
    store.dispatch(A.trainingStarted());
    store.dispatch(
      A.progressed({
        id: "w0",
        attempt: 1,
        fraction: 0.2,
        secondsLeft: 30,
        nextPreviewInS: 3,
        stage: "training",
      }),
    );
    q<HTMLButtonElement>('[data-ref="stopBtn"]').click();
    const text = () =>
      root.ownerDocument.querySelector('[data-ref="stopText"]')?.textContent;
    expect(text()).toContain("Stretch 1 is 20 % done");
    store.dispatch(
      A.progressed({
        id: "w0",
        attempt: 1,
        fraction: 0.6,
        secondsLeft: 10,
        nextPreviewInS: 1,
        stage: "training",
      }),
    );
    expect(text()).toContain("Stretch 1 is 60 % done");
    // Stretch 1 finishes while the dialog is open: the next one must not start,
    // and Stop must not stop stretch 2.
    finishCurrent(store, "good");
    expect(text()).toContain("Stretch 1 has just finished");
    expect(store.getState().windows[1]?.status).toBe("waiting");
    q<HTMLButtonElement>('[data-act="stop"]').click();
    const s = store.getState();
    expect(s.phase).toBe("stopped");
    expect(s.windows[0]?.status).toBe("done");
    expect(s.windows[1]?.status).toBe("waiting");
    expect(q('[data-ref="veil"]').hidden).toBe(true);
  });

  it("Keep training starts the held stretch", () => {
    const { store, q } = mount();
    store.dispatch(A.trainingStarted());
    q<HTMLButtonElement>('[data-ref="stopBtn"]').click();
    finishCurrent(store, "good");
    q<HTMLButtonElement>('[data-act="close"]').click();
    expect(store.getState().windows[1]?.status).toBe("training");
  });
});

describe("the closer look", () => {
  it("never opens a stretch that has not started, and skips them with Next", () => {
    const { root, store, q } = mount(storeAt(5));
    store.dispatch(A.trainingStarted());
    finishCurrent(store, "good");
    // Stretch 3 trains, 4 and 5 wait.
    printOf(root, 4)?.querySelector<HTMLButtonElement>(".print-frame")?.click();
    expect(q('[data-ref="veil"]').hidden).toBe(true);
    printOf(root, 1)?.querySelector<HTMLButtonElement>(".print-frame")?.click();
    expect(q('[data-ref="veil"]').hidden).toBe(false);
    const word = () => q(".loupe-word").textContent;
    expect(word()).toBe("Good");
    q<HTMLButtonElement>('[data-act="next"]').click();
    expect(word()).toBe("Still training");
    expect(q<HTMLButtonElement>('[data-act="next"]').disabled).toBe(true);
  });

  it("names a stretch queued to train again Waiting, never Still training", () => {
    const store = storeAt(2);
    store.dispatch(A.trainingStarted());
    finishCurrent(store, "poor");
    store.dispatch(A.trainAgainAsked({ id: "w0" }));
    const w0 = store.getState().windows[0];
    expect(w0?.status).toBe("queued");
    expect(w0 && loupeWord(w0)).toBe("Waiting");
  });
});

describe("bar texts", () => {
  it("measures before it estimates, and estimates in minutes or hours", () => {
    const store = storeAt(2);
    store.dispatch(A.trainingStarted());
    store.dispatch(
      A.progressed({
        id: "w0",
        attempt: 1,
        fraction: 0.01,
        secondsLeft: null,
        nextPreviewInS: null,
        stage: "training",
      }),
    );
    expect(barText(store.getState())?.[1]).toContain("Measuring how fast");
    expect(minutesText(10 * 60)).toBe("about 10 min");
    expect(minutesText(3 * 3600)).toBe("about 3 hours");
    expect(minutesText(5)).toBe("about 1 min");
  });

  it("says nothing for a time that is not a number", () => {
    // Why: "about NaN min" or "about Infinity hours" is worse than no
    // estimate at all.
    expect(minutesText(Number.NaN)).toBe("");
    expect(minutesText(Number.POSITIVE_INFINITY)).toBe("");
    expect(minutesText(-5)).toBe("");
  });

  it("counts one finished stretch in the singular", () => {
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    finishCurrent(store);
    store.dispatch(A.stopAsked());
    store.dispatch(A.stopConfirmed({ id: "w1" }));
    expect(barText(store.getState())?.[0]).toBe(
      "Stopped. 1 of 3 stretches is finished and kept while this page stays open.",
    );
  });

  it("names a save made while stopped", () => {
    // Why: after "Save the finished ones" the stopped bar read exactly
    // as before, so nothing said the save had worked.
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    finishCurrent(store);
    store.dispatch(A.stopAsked());
    store.dispatch(A.stopConfirmed({ id: "w1" }));
    store.dispatch(A.saveStarted());
    store.dispatch(A.saveSucceeded({ count: 1 }));
    expect(barText(store.getState())?.[1]).toBe(
      "Saved: 1 stretch is in the file. Continue starts at stretch 2.",
    );
  });
});

describe("refusals by code", () => {
  function refusedWith(reason: string, code?: "no-depth") {
    const { store, q } = mount(storeAt(2));
    store.dispatch(A.anotherRecordingChosen());
    store.dispatch(A.readingStarted({ id: "r2", name: "b.zip" }));
    store.dispatch(
      A.readRefused(
        code === undefined ? { id: "r2", reason } : { id: "r2", reason, code },
      ),
    );
    return q('[data-ref="refusalHead"]').textContent;
  }

  it("says the recording has no depth only for the reader's no-depth refusal", () => {
    // Why: matching the word "depth" in the sentence called a recording
    // whose depth data was damaged a recording without depth.
    expect(refusedWith("No depth was recorded.", "no-depth")).toBe(
      "This recording has no depth",
    );
    expect(
      refusedWith("This recording's depth data does not include the lens."),
    ).toBe("This recording cannot be used");
  });
});

describe("saving", () => {
  function atSave() {
    const h = mount(storeAt(2));
    h.store.dispatch(A.trainingStarted());
    finishCurrent(h.store);
    finishCurrent(h.store);
    h.q<HTMLButtonElement>('[data-ref="saveBtn"]').click();
    return h;
  }

  it("cannot be cancelled while it saves", () => {
    // Why: closing the dialog mid-save left the page with no sign of the
    // save still running, and a second Save could start beside it.
    const { root, store, q } = atSave();
    store.dispatch(A.saveStarted());
    const cancel = q<HTMLButtonElement>('.modal [data-act="close"]');
    expect(cancel.disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(q('[data-ref="veil"]').hidden).toBe(false);
    q('[data-ref="veil"]').dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(q('[data-ref="veil"]').hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-ref="saveBtn"]')?.click();
    expect(store.getState().save.status).toBe("saving");
  });

  it("says what became of the picked file when saving fails", () => {
    const { store, q } = atSave();
    store.dispatch(A.saveStarted());
    store.dispatch(
      A.saveFailed({
        message: "disk full",
        left: 'The file "a.zip" you picked was not written, and may now be empty.',
      }),
    );
    const text = q(".save-error").textContent ?? "";
    expect(text).not.toContain("Nothing was lost");
    expect(text).toContain('The file "a.zip" you picked was not written');
  });
});

describe("focus and the rest of the page behind a dialog", () => {
  it("makes the page inert behind a dialog and gives the focus back on close", () => {
    // Why: with the page still reachable behind the veil, Tab walked out
    // of the dialog; on close the focus fell to the body, so a keyboard
    // user started again from the top of the page.
    const { root, store, q } = mount();
    store.dispatch(A.trainingStarted());
    const stop = q<HTMLButtonElement>('[data-ref="stopBtn"]');
    stop.focus();
    stop.click();
    const app = root.querySelector(".app");
    expect(app?.hasAttribute("inert")).toBe(true);
    q<HTMLButtonElement>('[data-act="close"]').click();
    expect(app?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(stop);
  });

  it("moves the focus to the new phase's action when its button goes away", () => {
    const { q } = mount();
    const start = q<HTMLButtonElement>('[data-ref="startBtn"]');
    start.focus();
    start.click();
    expect(document.activeElement).toBe(q('[data-ref="stopBtn"]'));
  });
});

describe("checking the graphics again", () => {
  it("shows the check running on its button, keeps the card, and says when nothing changed", () => {
    const { store, q } = mount(storeAt(2));
    store.dispatch(A.probeFinished("integrated"));
    const recheck = q<HTMLButtonElement>('[data-ref="gpuRecheck"]');
    recheck.click();
    expect(q('[data-ref="gpuWarn"]').hidden).toBe(false);
    expect(recheck.textContent).toBe("Checking...");
    expect(recheck.disabled).toBe(true);
    expect(recheck.getAttribute("aria-busy")).toBe("true");
    store.dispatch(A.probeFinished("integrated"));
    expect(recheck.textContent).toBe("Check again");
    expect(recheck.disabled).toBe(false);
    expect(q('[data-ref="gpuRecheckLine"]').textContent).toBe(
      "Still the built-in graphics.",
    );
    recheck.click();
    store.dispatch(A.probeFinished("ready"));
    expect(q('[data-ref="gpuWarn"]').hidden).toBe(true);
  });
});

describe("the page root", () => {
  it("carries the class its stylesheet is scoped under only while mounted", () => {
    // Why: every rule of the page's stylesheet is scoped under this class;
    // a root without it shows an unstyled page, and one that keeps it
    // after dispose keeps the page's colours on whatever comes next.
    const { root } = mount();
    expect(root.classList.contains("splat-page")).toBe(true);
    mounted?.dispose();
    mounted = null;
    expect(root.classList.contains("splat-page")).toBe(false);
  });
});

describe("reading a recording, as the page shows it", () => {
  function reading() {
    const store = configureStore({
      reducer: trainerPageReducer,
      preloadedState: initialTrainerPageState("gpu"),
    });
    store.dispatch(A.probeFinished("ready"));
    return store;
  }

  // Why: on a phone or a slow disk a large zip takes long to read, and a
  // page that shows nothing looks broken. From the first frame after the
  // pick the button is busy and a bar with a value shows how much is read.
  it("shows a busy button and a determinate bar from the first frame of the read", () => {
    const store = reading();
    const { q } = mount(store);
    const bar = q<HTMLProgressElement>('[data-ref="readBar"]');
    const choose = q<HTMLButtonElement>('[data-ref="chooseBtn"]');
    const line = q('[data-ref="readLine"]');
    expect(bar.hidden).toBe(true);
    store.dispatch(A.readingStarted({ id: "r1", name: "walk.zip" }));
    expect(bar.hidden).toBe(false);
    expect(bar.hasAttribute("value")).toBe(true);
    expect(bar.value).toBe(0);
    expect(choose.disabled).toBe(true);
    expect(choose.dataset.busy).toBe("true");
    expect(line.textContent).toBe("Reading the recording on this computer...");
    store.dispatch(A.readProgressed({ id: "r1", done: 30, total: 120 }));
    expect(bar.value).toBeCloseTo(0.25);
    expect(line.textContent).toBe(
      "Reading the recording on this computer: 25 %",
    );
    store.dispatch(
      A.readFinished({ id: "r1", census: CENSUS, windows: plan(2) }),
    );
    expect(bar.hidden).toBe(true);
    expect(q('[data-ref="census"]').hidden).toBe(false);
  });

  // Why: a refused read must not leave a bar standing or the button busy.
  it("takes the bar down and frees the button when the read is refused", () => {
    const store = reading();
    const { q } = mount(store);
    store.dispatch(A.readingStarted({ id: "r1", name: "walk.zip" }));
    store.dispatch(A.readProgressed({ id: "r1", done: 3, total: 4 }));
    store.dispatch(A.readRefused({ id: "r1", reason: "Not a recording." }));
    expect(q('[data-ref="readBar"]').hidden).toBe(true);
    expect(q('[data-ref="refusal"]').hidden).toBe(false);
    store.dispatch(A.anotherRecordingChosen());
    const choose = q<HTMLButtonElement>('[data-ref="chooseBtn"]');
    expect(choose.disabled).toBe(false);
    expect(choose.dataset.busy).toBeUndefined();
  });
});

describe("what each print says while its stretch runs", () => {
  const progress = (
    store: ReturnType<typeof storeAt>,
    p: Partial<TrainProgress> & Pick<TrainProgress, "stage">,
  ) =>
    store.dispatch(
      A.progressed({
        id: "w0",
        attempt: 1,
        fraction: 0,
        secondsLeft: null,
        nextPreviewInS: null,
        ...p,
      }),
    );

  // Why: after "Make the splat" the trainer loads and the graphics card is
  // prepared before the first step; the print and the bar say so at once.
  // Each print then carries its own stage, percent and time left, not
  // only the bar at the bottom.
  it("names the stage, the percent and the time left on its own print", () => {
    const store = storeAt(3, "gpu");
    const { root } = mount(store);
    store.dispatch(A.trainingStarted());
    const first = printOf(root, 1);
    const live = () => first?.querySelector(".live-pct")?.textContent;
    const next = () => first?.querySelector(".live-next")?.textContent;
    expect(live()).toBe("Loading the trainer");
    expect(first?.dataset.stage).toBe("loading");
    expect(barText(store.getState())?.[1]).toContain("Loading the trainer...");
    expect(printOf(root, 2)?.querySelector(".print-empty")?.textContent).toBe(
      "Waiting",
    );
    progress(store, { stage: "preparing" });
    expect(live()).toBe("Preparing the graphics card");
    expect(barText(store.getState())?.[1]).toContain(
      "Preparing the graphics card...",
    );
    progress(store, {
      stage: "training",
      fraction: 0.42,
      secondsLeft: 150,
      nextPreviewInS: 12,
    });
    expect(live()).toBe("Training 42 %");
    expect(next()).toBe("about 3 min left, new look in 12 s");
    progress(store, { stage: "checking", fraction: 0.9 });
    expect(live()).toBe("Checking the result");
    expect(next()).toBe("");
    finishCurrent(store);
    expect(first?.dataset.status).toBe("done");
    expect(first?.dataset.stage).toBeUndefined();
    expect(first?.querySelector(".print-mark")?.textContent).toBe("Good");
    expect(printOf(root, 2)?.querySelector(".live-pct")?.textContent).toBe(
      "Loading the trainer",
    );
  });

  // Why: a trainer that fails while loading must end the print in words,
  // never leave it saying "Loading the trainer".
  it("ends a failed start in words on its print", () => {
    const store = storeAt(2, "gpu");
    const { root } = mount(store);
    store.dispatch(A.trainingStarted());
    store.dispatch(
      A.windowFinished({
        id: "w0",
        attempt: 1,
        outcome: "failed",
        metrics: null,
        judgement: {
          verdict: "poor",
          reasons: ["the trainer stopped"],
          say: "Training stopped with an error.",
        },
        trainingS: 0,
      }),
    );
    const first = printOf(root, 1);
    expect(first?.dataset.status).toBe("done");
    expect(first?.querySelector(".print-say")?.textContent).toBe(
      "Training stopped with an error.",
    );
  });

  // Why: the practice trainer draws pictures; every print says so, so a
  // practice run is never taken for a splat.
  it("says on every print of a practice run that it shows a drawing", () => {
    const { root } = mount(storeAt(3, "practice"));
    const notes = [...root.querySelectorAll(".print")].map(
      (p) => p.querySelector(".print-practice")?.textContent,
    );
    expect(notes).toEqual(Array(3).fill("Practice: a drawing, not a splat"));
    mounted?.dispose();
    const real = mount(storeAt(3, "gpu"));
    expect(real.root.querySelectorAll(".print-practice")).toHaveLength(0);
  });
});
