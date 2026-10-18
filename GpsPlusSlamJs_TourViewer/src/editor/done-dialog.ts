/**
 * The desktop editor's "Done" dialog (tour editor plan 2026-10-17-1816,
 * W2, D18, D19): what is left to do when the creator leaves the editor -
 * where the changes are, how the tour at its link is updated (per host,
 * `tour-host.ts`), that a file at a link is public at once, and, while the
 * file still carries the walk, that the walk goes public with it unless it
 * is moved out ("Move the walk out", the page's `moveWalk`). The words are
 * pure (`doneWords`); the wiring takes structural elements, so its tests
 * run in node.
 *
 * @see done-dialog.ts.md
 */

import {
  hostReplaceOnComputer,
  isTourHost,
  type TourHost,
} from "../tour-host.js";

/**
 * The Google-Drive-mount tip ("open the tour from your Drive folder, and
 * every save lands in Drive by itself") stays OFF until the owner has
 * checked that a write through Drive for desktop keeps the Drive file id
 * the printed code points at (the plan's review #10, D18). Turning it on
 * is this one switch: the words and the element are in place and tested.
 */
export const DRIVE_MOUNT_TIP_SHOWN = false;

/** Where the changes went: written into the opened file, downloaded as a
 *  copy, or nothing was saved because nothing changed. */
export type DoneSaved =
  | { readonly kind: "in-place"; readonly name: string }
  | { readonly kind: "downloaded"; readonly name: string }
  | { readonly kind: "unchanged"; readonly name: string };

export interface DoneFacts {
  readonly saved: DoneSaved;
  /** The host the update steps are for (the dialog's picker starts here). */
  readonly host: TourHost;
  /** The newest bytes still carry the walk recording. */
  readonly carriesWalk: boolean;
  /** The Drive-mount tip's switch (`DRIVE_MOUNT_TIP_SHOWN`). */
  readonly driveMountTip: boolean;
}

export interface DoneWords {
  readonly where: string;
  readonly update: string;
  readonly publicLine: string;
  /** Null when the file carries no walk. */
  readonly walk: string | null;
  /** Null unless the switch is on, the host is Drive and the file was
   *  written in place. */
  readonly driveTip: string | null;
}

const PUBLIC_LINE =
  "A file at a shared link is public: anyone with the link, or with a printed code, can open it as soon as it is uploaded.";

const DRIVE_TIP =
  "Tip: with Google Drive for desktop, open the tour from your Drive folder here - every save then lands in Drive by itself, under the same link.";

function whereLine(saved: DoneSaved): string {
  switch (saved.kind) {
    case "in-place":
      return `Your changes are saved in ${saved.name}, the file you opened on this computer.`;
    case "downloaded":
      return `Your changes were downloaded as ${saved.name}. That copy is the tour now: the file you opened does not have them.`;
    case "unchanged":
      return `Nothing was changed since you opened ${saved.name}.`;
  }
}

/** The dialog's words for `facts`. */
export function doneWords(facts: DoneFacts): DoneWords {
  const name = facts.saved.name;
  return {
    where: whereLine(facts.saved),
    update: hostReplaceOnComputer(facts.host, name),
    publicLine: PUBLIC_LINE,
    walk: facts.carriesWalk
      ? `${name} also carries your walk recording: the GPS track of your walk and the depth your phone measured. If it is the file at your tour's link, anyone with the link can download them too. Move the walk out to keep it to yourself: it goes into a separate file you keep, and ${name} keeps what visitors need.`
      : null,
    driveTip:
      facts.driveMountTip &&
      facts.host === "drive" &&
      facts.saved.kind === "in-place"
        ? DRIVE_TIP
        : null,
  };
}

/** The move's button, idle and while it runs. */
export const MOVE_LABELS = {
  idle: "Move the walk out",
  moving: "Moving the walk out…",
} as const;

/** What the page's move came to: done, refused in words, or nothing moved
 *  because the walk's file was not saved (a dismissed save dialog). */
export type WalkMoveOutcome =
  | {
      readonly kind: "moved";
      readonly walkName: string;
      readonly tourName: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "cancelled" };

const NOTHING_MOVED =
  "Nothing was moved: the walk's file was not saved, so the tour keeps its walk.";

interface Listening {
  addEventListener(type: string, handler: () => void): void;
}

type Text = Pick<HTMLElement, "textContent">;
type Shown = Pick<HTMLElement, "hidden">;

/** The dialog's elements (structural, so the unit tests run in node). */
export interface DoneDialogDom {
  backdrop: Shown;
  where: Text;
  host: Pick<HTMLSelectElement, "value"> & Listening;
  update: Text;
  publicLine: Text;
  /** The walk section, and its words and controls. */
  walk: Shown;
  walkText: Text & Shown;
  moveButton: Pick<HTMLButtonElement, "textContent" | "disabled" | "hidden"> &
    Listening;
  moveStatus: Text;
  driveTip: Text & Shown;
  close: Pick<HTMLButtonElement, "focus"> & Listening;
}

export interface DoneDialogDeps {
  dom: DoneDialogDom;
  /** Move the walk out (the page delivers both files, then commits). */
  moveWalk: () => Promise<WalkMoveOutcome>;
  /** The dialog closed: the page gives focus back. */
  onClose: () => void;
}

export interface DoneDialog {
  open(facts: DoneFacts): void;
  close(): void;
  isOpen(): boolean;
}

export function wireDoneDialog(deps: DoneDialogDeps): DoneDialog {
  const { dom } = deps;
  let facts: DoneFacts | null = null;
  let moving = false;

  function render(): void {
    if (facts === null) return;
    const words = doneWords(facts);
    dom.where.textContent = words.where;
    dom.host.value = facts.host;
    dom.update.textContent = words.update;
    dom.publicLine.textContent = words.publicLine;
    dom.walk.hidden = words.walk === null;
    dom.walkText.hidden = false;
    dom.walkText.textContent = words.walk ?? "";
    dom.driveTip.hidden = words.driveTip === null;
    dom.driveTip.textContent = words.driveTip ?? "";
  }

  function idleButton(): void {
    dom.moveButton.disabled = false;
    dom.moveButton.hidden = false;
    dom.moveButton.textContent = MOVE_LABELS.idle;
  }

  function close(): void {
    if (dom.backdrop.hidden) return;
    dom.backdrop.hidden = true;
    deps.onClose();
  }

  dom.host.addEventListener("change", () => {
    if (facts === null || !isTourHost(dom.host.value)) return;
    facts = { ...facts, host: dom.host.value };
    render();
  });
  dom.moveButton.addEventListener("click", () => {
    if (moving || facts === null) return;
    moving = true;
    // The async-UI rule: in progress while both files are written, then
    // the durable end state - the move's result, or the button back.
    dom.moveButton.disabled = true;
    dom.moveButton.textContent = MOVE_LABELS.moving;
    dom.moveStatus.textContent = "";
    void deps
      .moveWalk()
      .then(
        (outcome) => {
          if (outcome.kind === "moved") {
            dom.moveStatus.textContent = `The walk is in ${outcome.walkName} - keep that file. ${outcome.tourName} no longer carries it.`;
            dom.moveButton.hidden = true;
            dom.walkText.hidden = true;
            if (facts !== null) facts = { ...facts, carriesWalk: false };
            return;
          }
          dom.moveStatus.textContent =
            outcome.kind === "refused" ? outcome.reason : NOTHING_MOVED;
          idleButton();
        },
        (err: unknown) => {
          dom.moveStatus.textContent = `The walk was not moved: ${err instanceof Error ? err.message : String(err)}`;
          idleButton();
        },
      )
      .finally(() => {
        moving = false;
      });
  });
  dom.close.addEventListener("click", close);

  return {
    open(next) {
      facts = next;
      render();
      if (!moving) {
        idleButton();
        dom.moveStatus.textContent = "";
      }
      dom.backdrop.hidden = false;
      dom.close.focus();
    },
    close,
    isOpen: () => !dom.backdrop.hidden,
  };
}
