/**
 * The setup's start question (creator setup flow, round 2, the
 * "conversation" variant): step 1 asks one question with four answers, a
 * tap only routes, and step 2 shows that answer's panel - a short why and
 * one action. A fifth panel, "share", is reached from Done's "Make your
 * code now" for a tour started on this phone.
 *
 * The answer is store state (`start-question-slice.ts`): step 2 draws
 * from it and the host tiles read it too. Which step is open stays the
 * wizard's (`wizard.ts`).
 *
 * The DOM surface is structural, like the wizard's, so the unit tests run
 * in node with plain objects.
 *
 * @see start-question.ts.md
 */

import type { WizardStep } from "./wizard.js";
import {
  selectStartPanel,
  START_ANSWERS,
  startPanelShown,
  type StartAnswer,
  type StartPanel,
  type StartQuestionState,
} from "./start-question-slice.js";

/** Step 2's blocks: the host tiles and their steps, the link field, the
 *  "your code already hangs" line, the file open, and the start-here
 *  action. */
export const START_BLOCKS = [
  "host",
  "linkField",
  "codeHangs",
  "file",
  "later",
] as const;
export type StartBlock = (typeof START_BLOCKS)[number];

export interface PanelView {
  heading: string;
  why: string;
  blocks: Readonly<Record<StartBlock, boolean>>;
}

const NONE: Readonly<Record<StartBlock, boolean>> = {
  host: false,
  linkField: false,
  codeHangs: false,
  file: false,
  later: false,
};

const PANELS: Readonly<Record<StartPanel, PanelView>> = {
  new: {
    heading: "Store your tour, then paste its link",
    why: "Your tour is one small zip file in your own storage. Visitors' phones load it from there; once it has loaded, it keeps working without signal. Its link goes into the printed code, so the file comes first.",
    blocks: { ...NONE, host: true, linkField: true },
  },
  share: {
    heading: "Put your tour online, then paste its link",
    why: "This phone saved your tour zip at Done. Put it in your own storage: its link goes into the printed code that visitors scan.",
    blocks: { ...NONE, host: true, linkField: true },
  },
  link: {
    heading: "Paste your tour's link",
    why: "The link opens your tour file where you stored it. Keep the file there: your printed codes point to it.",
    blocks: { ...NONE, linkField: true, codeHangs: true },
  },
  file: {
    heading: "Open the tour file on this phone",
    why: "Pick the tour zip. It opens here, and this phone backs up your work while you place. To share it, put it in your own storage and paste its link.",
    blocks: { ...NONE, file: true },
  },
  later: {
    heading: "Start on this phone now",
    why: "One tap saves an empty tour file on this phone and opens it, so this phone backs up your work from the first pin. The saved file stays empty until Done: then the phone saves the tour file again, with everything in it.",
    blocks: { ...NONE, later: true },
  },
};

/** What step 2 shows for a panel. */
export function panelView(panel: StartPanel): PanelView {
  return PANELS[panel];
}

/** The start button's labels through its async cycle (async-UI rule). */
export const START_LABELS = {
  idle: "Save the tour file and start",
  busy: "Saving…",
  opened: "Saved and opened",
  notSaved: "Not saved - tap to try again",
  notOpened: "Saved, but it did not open - tap to try again",
  cancelled: "Saved - the tour you have open stays open",
  alreadyOpen: "A tour is already open on this phone",
  failed: "Could not save the tour file - tap to try again",
} as const;

export type StartOutcome =
  | "opened"
  | "not-saved"
  | "not-opened"
  | "cancelled"
  | "already-open"
  | "failed";

/** What "start on this phone" needs: the starter zip, a save that says
 *  whether the creator kept the file, the page's file open, and whether a
 *  tour is open already. */
export interface StartDeps {
  pack(): Promise<Blob>;
  save(blob: Blob, filename: string): Promise<boolean>;
  open(file: File): Promise<{ kind: string }>;
  tourOpen(): boolean;
}

const STARTER_NAME = "tour.zip";

/**
 * Save the empty starter tour on this phone, then open that same file as
 * the tour. The save comes first: a tour the creator did not keep a file
 * of would hold their work only in the page's backup, so a dismissed save
 * opens nothing. An open tour is never replaced by an empty one: the open
 * asks first only while a rebuilt file is unsaved, so pins placed since
 * would go without a question, and each try would save another empty
 * file. Never rejects.
 */
export async function startOnThisPhone(deps: StartDeps): Promise<StartOutcome> {
  try {
    if (deps.tourOpen()) return "already-open";
    const blob = await deps.pack();
    // The save follows a short await after the tap; packing an empty zip
    // takes milliseconds, well inside the tap's user activation.
    const saved = await deps.save(blob, STARTER_NAME);
    if (!saved) return "not-saved";
    const file = new File([blob], STARTER_NAME, { type: "application/zip" });
    const outcome = await deps.open(file);
    // "cancelled": the creator declined to leave the open tour.
    if (outcome.kind === "cancelled") return "cancelled";
    return outcome.kind === "opened" ? "opened" : "not-opened";
  } catch {
    return "failed";
  }
}

type Hidden = HTMLElement["hidden"];

interface Clickable {
  addEventListener(type: "click", fn: () => void): void;
}

export interface StartQuestionDom {
  /** Step 1's answer cards. */
  answers: Readonly<Record<StartAnswer, Clickable>>;
  /** Step 2's heading and why. */
  heading: { textContent: string | null };
  why: { textContent: string | null };
  blocks: Readonly<Record<StartBlock, { hidden: Hidden }>>;
  /** "Back to the question" links. */
  backs: readonly Clickable[];
  /** "Start at the code" in the link panel. */
  codeHangsButton: Clickable;
  /** "Save the tour file and start" in the start-here panel. */
  startButton: Clickable & { disabled: boolean; textContent: string | null };
  /** Done's "Make your code now" block and its button. */
  makeCode: { hidden: Hidden };
  makeCodeButton: Clickable;
  /** Step 6; `data-hosted` tells the page's CSS which file steps show. */
  doneStep: { readonly dataset: Record<string, string | undefined> };
}

/** The page's store as the start question reaches it. */
export interface StartQuestionStore {
  dispatch(action: ReturnType<typeof startPanelShown>): unknown;
  getState(): { readonly startQuestion: StartQuestionState };
  subscribe(listener: () => void): () => void;
}

export function wireStartQuestion(deps: {
  dom: StartQuestionDom;
  /** Holds the answer; step 2 draws whatever it holds. */
  store: StartQuestionStore;
  /** A returning creator's panel (a stored host reads as "new"). */
  initial: StartPanel | null;
  /** `wizard.openStep`, the one owner of which step is open. */
  openStep: (step: WizardStep) => void;
  /** `wizard.hosted`: whether the open tour has a link. */
  hosted: () => boolean;
  /** `wizard.onTourChange`: calls back whenever `hosted()` may change. */
  onTourChange: (listener: () => void) => void;
  /** The panel changed (the host tiles redraw for "share"). */
  onPanel?: (panel: StartPanel) => void;
  start: StartDeps;
}): void {
  const { dom, store } = deps;
  /** The panel last drawn: a render cache, the answer is the store's. */
  let drawn: StartPanel | null = null;
  /** False for the first draw: the host tiles draw themselves. */
  let notify = false;

  function render(): void {
    const panel = selectStartPanel(store.getState());
    if (panel === null || panel === drawn) return;
    drawn = panel;
    const view = panelView(panel);
    dom.heading.textContent = view.heading;
    dom.why.textContent = view.why;
    for (const block of START_BLOCKS) {
      dom.blocks[block].hidden = !view.blocks[block];
    }
    if (notify) deps.onPanel?.(panel);
  }
  store.subscribe(render);

  function show(panel: StartPanel): void {
    store.dispatch(startPanelShown(panel));
  }

  for (const answer of START_ANSWERS) {
    dom.answers[answer].addEventListener("click", () => {
      show(answer);
      deps.openStep("link");
    });
  }
  for (const back of dom.backs) {
    back.addEventListener("click", () => {
      deps.openStep("host");
    });
  }
  dom.codeHangsButton.addEventListener("click", () => {
    deps.openStep("measure");
  });
  dom.makeCodeButton.addEventListener("click", () => {
    show("share");
    deps.openStep("link");
  });

  function renderDone(): void {
    const hosted = deps.hosted();
    dom.doneStep.dataset.hosted = String(hosted);
    dom.makeCode.hidden = hosted;
  }
  deps.onTourChange(renderDone);
  renderDone();

  let busy = false;
  dom.startButton.textContent = START_LABELS.idle;
  dom.startButton.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    dom.startButton.disabled = true;
    dom.startButton.textContent = START_LABELS.busy;
    void startOnThisPhone(deps.start).then((outcome) => {
      busy = false;
      dom.startButton.disabled = false;
      dom.startButton.textContent = OUTCOME_LABEL[outcome];
    });
  });

  if (deps.initial !== null) show(deps.initial);
  render();
  notify = true;
}

const OUTCOME_LABEL: Readonly<Record<StartOutcome, string>> = {
  opened: START_LABELS.opened,
  "not-saved": START_LABELS.notSaved,
  "not-opened": START_LABELS.notOpened,
  cancelled: START_LABELS.cancelled,
  "already-open": START_LABELS.alreadyOpen,
  failed: START_LABELS.failed,
};
