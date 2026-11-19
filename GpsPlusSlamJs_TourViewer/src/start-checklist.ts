/**
 * Step 5's "Before you start" list, right above "Start creating" (creator
 * entry prototype, variant B): what keeps placed work safe, said from what
 * the page really knows.
 *
 * - The tour line is checked only while a tour is open on this page: only
 *   an open tour has a draft on this phone (`creator-draft.ts`), so only
 *   then does a reload or a crash keep what was placed.
 * - The hung code is never checked: the page cannot see it. It is a
 *   reminder.
 * - "This phone cannot keep a backup copy" shows only once the draft
 *   store said so (`CreatorDraft.persists()`), never as a guess.
 *
 * Pure view mapping plus a render into the step's elements; it keeps no
 * state of its own. `creator-setup.ts` renders it with the setup panel,
 * and the refusal of a start with no tour open (`creator-measuring.ts`)
 * says {@link NO_TOUR_START_MESSAGE}.
 */

/** A row's mark: checked, open, a reminder that is never checked, or a
 *  warning. */
type StartCheckState = "done" | "todo" | "reminder" | "warning";

type StartCheckId = "tour" | "code" | "no-backup";

interface StartCheckRow {
  id: StartCheckId;
  state: StartCheckState;
  text: string;
  shown: boolean;
  /** The tour row's "Open it in step 2", shown while no tour is open. */
  linkShown: boolean;
}

export interface StartChecklistView {
  rows: readonly StartCheckRow[];
}

export interface StartChecklistInput {
  /** A tour is open on this page (`ctx.session !== null`). */
  tourOpen: boolean;
  /** The draft store has not said it keeps nothing
   *  (`CreatorDraft.persists()`). */
  backupKept: boolean;
}

const TOUR_BACKED_UP =
  "Your tour is open on this phone, so everything you place is backed up here.";
/** The tour line where the phone keeps no draft: the backup claim would
 *  be false. */
const TOUR_OPEN_ONLY = "Your tour is open on this phone.";
/** The unchecked tour line says what to do: beside an empty box, a
 *  sentence saying the tour is open would be read as true. */
const TOUR_TODO_BACKED_UP =
  "Open your tour on this phone, so everything you place is backed up here.";
const TOUR_TODO = "Open your tour on this phone.";
const CODE_REMINDER =
  "Your code hangs where the tour starts. This page cannot see it, so check before you go.";
const NO_BACKUP =
  "This phone cannot keep a backup copy, so what you place lives only in this page until you tap Done.";

/** What a start with no tour open says, in the setup panel's status line
 *  (the missing print size's place). */
export const NO_TOUR_START_MESSAGE =
  "Open your tour on this phone first, in step 2: only an open tour is backed up here while you place things.";

/** The words a screen reader hears before each row's text: the mark is
 *  drawn by the CSS and hidden from it. */
const SPOKEN_STATE: Record<StartCheckState, string> = {
  done: "Done:",
  todo: "Not yet:",
  reminder: "Reminder:",
  warning: "Warning:",
};

export function startChecklistView(
  input: StartChecklistInput,
): StartChecklistView {
  return {
    rows: [
      {
        id: "tour",
        state: input.tourOpen ? "done" : "todo",
        text: input.tourOpen
          ? input.backupKept
            ? TOUR_BACKED_UP
            : TOUR_OPEN_ONLY
          : input.backupKept
            ? TOUR_TODO_BACKED_UP
            : TOUR_TODO,
        shown: true,
        linkShown: !input.tourOpen,
      },
      {
        id: "code",
        state: "reminder",
        text: CODE_REMINDER,
        shown: true,
        linkShown: false,
      },
      {
        id: "no-backup",
        state: "warning",
        text: NO_BACKUP,
        shown: !input.backupKept,
        linkShown: false,
      },
    ],
  };
}

/** One row's elements: the item, its spoken state word, its text. */
interface StartCheckRowDom {
  root: Pick<HTMLElement, "dataset" | "hidden">;
  state: Pick<HTMLElement, "textContent">;
  text: Pick<HTMLElement, "textContent">;
}

export interface StartChecklistDom {
  tour: StartCheckRowDom;
  code: StartCheckRowDom;
  noBackup: StartCheckRowDom;
  /** The tour row's link to step 2. */
  tourLink: Pick<HTMLElement, "hidden">;
}

function renderRow(dom: StartCheckRowDom, row: StartCheckRow): void {
  dom.root.hidden = !row.shown;
  dom.root.dataset["state"] = row.state;
  const spoken = SPOKEN_STATE[row.state];
  if (dom.state.textContent !== spoken) dom.state.textContent = spoken;
  if (dom.text.textContent !== row.text) dom.text.textContent = row.text;
}

export function renderStartChecklist(
  dom: StartChecklistDom,
  view: StartChecklistView,
): void {
  for (const row of view.rows) {
    if (row.id === "tour") {
      renderRow(dom.tour, row);
      dom.tourLink.hidden = !row.linkShown;
    } else if (row.id === "code") {
      renderRow(dom.code, row);
    } else {
      renderRow(dom.noBackup, row);
    }
  }
}
