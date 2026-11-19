/**
 * Step 1's opening question: "Is your tour's file in your storage
 * already?". Each answer leads to its one way in: a new tour reveals the
 * host tiles with the reasons the file comes first, a link moves on to
 * step 2, and a zip on this phone opens the device's file picker.
 *
 * The answer is passing UI state, read by nothing else and never stored:
 * the step it leads to holds what matters (the chosen host, the link, the
 * open tour). The DOM surface is structural, so the tests run in node.
 *
 * @see storage-question.ts.md
 */

/** The three answers, in the order the page shows them. */
export const STORAGE_ANSWERS = ["newTour", "link", "zip"] as const;
export type StorageAnswer = (typeof STORAGE_ANSWERS)[number];

interface AnswerNode {
  setAttribute(name: string, value: string): void;
  addEventListener(type: "click", fn: () => void): void;
}

export interface StorageQuestionDom {
  /** One toggle button per answer; `aria-pressed` marks the given one. */
  answers: Readonly<Record<StorageAnswer, AnswerNode>>;
  panels: {
    /** The host tiles and the reasons: shown for a new tour only. */
    newTour: { hidden: HTMLElement["hidden"] };
    /** The "Open it from this device" line: shown for a zip only, so the
     *  open's progress and its retry stay in view. */
    zip: { hidden: HTMLElement["hidden"] };
  };
}

export function wireStorageQuestion(deps: {
  dom: StorageQuestionDom;
  /** "Yes, I have its link": move on to the link step. */
  onLink: () => void;
  /** "Yes, the zip is on this phone": open the device's file picker. Called
   *  inside the tap, so the picker keeps the tap's user activation. */
  onZip: () => void;
}): void {
  const { dom } = deps;

  function show(given: StorageAnswer | null): void {
    for (const answer of STORAGE_ANSWERS) {
      dom.answers[answer].setAttribute(
        "aria-pressed",
        String(answer === given),
      );
    }
    dom.panels.newTour.hidden = given !== "newTour";
    dom.panels.zip.hidden = given !== "zip";
  }

  for (const answer of STORAGE_ANSWERS) {
    dom.answers[answer].addEventListener("click", () => {
      show(answer);
      if (answer === "link") deps.onLink();
      if (answer === "zip") deps.onZip();
    });
  }
  show(null);
}
