// @vitest-environment jsdom
/**
 * Why these tests matter: the view renders from the store on every change,
 * and a naive re-render loses what the person was doing. These pin the
 * keyboard focus after a decision (a rebuilt button list once dropped it to
 * the page body), the stop dialog's live text and its target (Stop must
 * stop the stretch the dialog was opened for, never the next one), the
 * closer look never opening a stretch that has not started, and the
 * production page saying plainly that the trainer is not available yet.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  finishCurrent,
  storeAt,
} from "../test-support/splat-trainer-fixtures.js";
import { trainerPageActions as A } from "./trainer-page-slice.js";
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

describe("census and the trainer that is not there yet", () => {
  it("offers the practice run only with the practice trainer", () => {
    const { q } = mount(storeAt(4, "practice"));
    expect(q('[data-ref="startBtn"]').hidden).toBe(false);
    expect(q('[data-ref="unavailable"]').hidden).toBe(true);
    expect(q('[data-ref="modeChip"]').hidden).toBe(false);
  });

  it("says the trainer is not available yet in production, with no start button", () => {
    const { q } = mount(storeAt(4, "unavailable"));
    expect(q('[data-ref="startBtn"]').hidden).toBe(true);
    expect(q('[data-ref="unavailable"]').hidden).toBe(false);
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
    expect(barText(store.getState())?.[1]).toContain("Measuring how fast");
    expect(minutesText(10 * 60)).toBe("about 10 min");
    expect(minutesText(3 * 3600)).toBe("about 3 hours");
    expect(minutesText(5)).toBe("about 1 min");
  });
});
