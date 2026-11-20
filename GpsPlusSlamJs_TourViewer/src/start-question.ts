/**
 * The setup's start question (creator setup flow, round 2, the
 * "conversation" variant): step 1 asks one question with four answers, a
 * tap only routes, and step 2 shows that answer's panel - a short why and
 * one action. A fifth panel, "share", is reached from Done's "Make your
 * code now" for a tour started on this phone.
 *
 * The answer is page UI state held here, not in the Redux store: like the
 * open step (`wizard.ts`), it is which panel one page shows, read by no
 * other view and never saved; the tour itself is the store's.
 *
 * The DOM surface is structural, like the wizard's, so the unit tests run
 * in node with plain objects.
 *
 * @see start-question.ts.md
 */

import type { WizardStep } from "./wizard.js";

/** The four answers of step 1, in the page's order. */
export const START_ANSWERS = ["new", "link", "file", "later"] as const;
type StartAnswer = (typeof START_ANSWERS)[number];

/** Step 2's panel: an answer, or "share" - a tour started on this phone
 *  being put online from Done. */
export type StartPanel = StartAnswer | "share";

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
  failed: "Could not save the tour file - tap to try again",
} as const;

export type StartOutcome = "opened" | "not-saved" | "not-opened" | "failed";

/** What "start on this phone" needs: the starter zip, a save that says
 *  whether the creator kept the file, and the page's file open. */
export interface StartDeps {
  pack(): Promise<Blob>;
  save(blob: Blob, filename: string): Promise<boolean>;
  open(file: File): Promise<{ kind: string }>;
}

const STARTER_NAME = "tour.zip";

/**
 * Save the empty starter tour on this phone, then open that same file as
 * the tour. The save comes first: a tour the creator did not keep a file
 * of would hold their work only in the page's backup, so a dismissed save
 * opens nothing. Never rejects.
 */
export async function startOnThisPhone(deps: StartDeps): Promise<StartOutcome> {
  try {
    const blob = await deps.pack();
    // The save follows a short await after the tap; packing an empty zip
    // takes milliseconds, well inside the tap's user activation.
    const saved = await deps.save(blob, STARTER_NAME);
    if (!saved) return "not-saved";
    const file = new File([blob], STARTER_NAME, { type: "application/zip" });
    const outcome = await deps.open(file);
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
  /** Step 6; its toggle decides whether "Make your code now" shows. */
  doneStep: {
    open: boolean;
    readonly dataset: Record<string, string | undefined>;
    addEventListener(type: "toggle", fn: () => void): void;
  };
}

export interface StartQuestion {
  /** The panel step 2 shows, or null before any answer. */
  panel(): StartPanel | null;
}

export function wireStartQuestion(deps: {
  dom: StartQuestionDom;
  /** A returning creator's panel (a stored host reads as "new"). */
  initial: StartPanel | null;
  /** `wizard.openStep`, the one owner of which step is open. */
  openStep: (step: WizardStep) => void;
  /** `wizard.hosted`: whether the open tour has a link. */
  hosted: () => boolean;
  /** The panel changed (the host tiles redraw for "share"). */
  onPanel?: (panel: StartPanel) => void;
  start: StartDeps;
}): StartQuestion {
  const { dom } = deps;
  let current: StartPanel | null = null;

  /** `notify` false for the first draw: the host tiles draw themselves. */
  function show(panel: StartPanel, notify = true): void {
    current = panel;
    const view = panelView(panel);
    dom.heading.textContent = view.heading;
    dom.why.textContent = view.why;
    for (const block of START_BLOCKS) {
      dom.blocks[block].hidden = !view.blocks[block];
    }
    if (notify) deps.onPanel?.(panel);
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
  dom.doneStep.addEventListener("toggle", () => {
    if (dom.doneStep.open) renderDone();
  });

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

  if (deps.initial !== null) show(deps.initial, false);
  return { panel: () => current };
}

const OUTCOME_LABEL: Readonly<Record<StartOutcome, string>> = {
  opened: START_LABELS.opened,
  "not-saved": START_LABELS.notSaved,
  "not-opened": START_LABELS.notOpened,
  failed: START_LABELS.failed,
};
