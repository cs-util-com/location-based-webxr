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
  /** The newest bytes still carry the walk recording; `unknown` when that
   *  could not be checked (the M4b milestone review #9: said as "may"). */
  readonly carriesWalk: boolean | "unknown";
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

function walkLine(name: string, carries: boolean | "unknown"): string | null {
  if (carries === false) return null;
  const moveOut = `Move the walk out to keep it to yourself: it goes into a separate file you keep, and ${name} keeps what visitors need.`;
  return carries === "unknown"
    ? `Whether ${name} also carries your walk recording (the GPS track of your walk and the depth your phone measured) could not be checked. If it does and it is the file at your tour's link, anyone with the link can download them too. ${moveOut}`
    : `${name} also carries your walk recording: the GPS track of your walk and the depth your phone measured. If it is the file at your tour's link, anyone with the link can download them too. ${moveOut}`;
}

/** The dialog's words for `facts`. */
export function doneWords(facts: DoneFacts): DoneWords {
  const name = facts.saved.name;
  return {
    where: whereLine(facts.saved),
    update: hostReplaceOnComputer(facts.host, name),
    publicLine: PUBLIC_LINE,
    walk: walkLine(name, facts.carriesWalk),
    driveTip:
      facts.driveMountTip &&
      facts.host === "drive" &&
      facts.saved.kind === "in-place"
        ? DRIVE_TIP
        : null,
  };
}

/** The move's button: idle, while it runs, and waiting for the second
 *  click - which takes a downloaded walk out of the tour (`confirm`), or
 *  downloads the tour without a walk already saved (`download`). */
export const MOVE_LABELS = {
  idle: "Move the walk out",
  moving: "Moving the walk out…",
  confirm: "Take the walk out of the tour",
  download: "Download the tour without the walk",
} as const;

/** What the page's move came to: done (with where the changes are now),
 *  refused in words, nothing moved because the walk's file was not saved
 *  (a dismissed save dialog), or - where the browser has no save dialog -
 *  the walk downloaded and the tour unchanged until `confirm` (a second
 *  click) takes it out: a download that started is not one that landed
 *  (the M4b milestone review #2); or the walk saved into the chosen file
 *  and the tour, which has no file to write into, downloaded only on a
 *  second click - a download needs a fresh click (the M4b fix re-review
 *  #2). */
export type WalkMoveOutcome =
  | {
      readonly kind: "moved";
      readonly walkName: string;
      readonly tourName: string;
      /** Where the changes are now: the dialog's first line follows. */
      readonly saved: DoneSaved;
    }
  | {
      readonly kind: "downloaded";
      readonly walkName: string;
      readonly confirm: () => Promise<WalkMoveOutcome>;
    }
  | {
      readonly kind: "walk-saved";
      readonly walkName: string;
      readonly confirm: () => Promise<WalkMoveOutcome>;
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
  close: Pick<HTMLButtonElement, "focus" | "disabled"> & Listening;
}

export interface DoneDialogDeps {
  dom: DoneDialogDom;
  /** Move the walk out (the page delivers both files, then commits).
   *  Called synchronously in the button's click: the page opens the
   *  browser's save dialog before its first await. */
  moveWalk: () => Promise<WalkMoveOutcome>;
  /** The dialog closed: the page gives focus back. */
  onClose: () => void;
}

export interface DoneDialog {
  open(facts: DoneFacts): void;
  /** Close, unless a move runs (its files are being written: the page
   *  must not change under it, the M4b milestone review #1); `force`
   *  closes anyway, for a tour that is gone. */
  close(force?: boolean): void;
  isOpen(): boolean;
}

export function wireDoneDialog(deps: DoneDialogDeps): DoneDialog {
  const { dom } = deps;
  let facts: DoneFacts | null = null;
  let moving = false;
  /** The second step of a move whose walk was downloaded. */
  let pending: (() => Promise<WalkMoveOutcome>) | null = null;
  /** The walk was moved out: its section stays to say where it went. */
  let moved = false;

  function render(): void {
    if (facts === null) return;
    const words = doneWords(facts);
    dom.where.textContent = words.where;
    dom.host.value = facts.host;
    dom.update.textContent = words.update;
    dom.publicLine.textContent = words.publicLine;
    dom.walk.hidden = words.walk === null && !moved;
    dom.walkText.hidden = words.walk === null;
    dom.walkText.textContent = words.walk ?? "";
    dom.driveTip.hidden = words.driveTip === null;
    dom.driveTip.textContent = words.driveTip ?? "";
  }

  function button(label: string): void {
    dom.moveButton.disabled = false;
    dom.moveButton.hidden = false;
    dom.moveButton.textContent = label;
  }

  function close(force = false): void {
    if (dom.backdrop.hidden || (moving && !force)) return;
    dom.backdrop.hidden = true;
    pending = null;
    deps.onClose();
  }

  function settle(outcome: WalkMoveOutcome): void {
    switch (outcome.kind) {
      case "moved":
        moved = true;
        dom.moveStatus.textContent = `The walk is in ${outcome.walkName} - keep that file. ${outcome.tourName} no longer carries it.`;
        dom.moveButton.hidden = true;
        if (facts !== null) {
          facts = { ...facts, saved: outcome.saved, carriesWalk: false };
        }
        render();
        return;
      case "downloaded":
        pending = outcome.confirm;
        dom.moveStatus.textContent = `The walk was downloaded as ${outcome.walkName}. Check that it is in your downloads, then take it out of the tour - until then the tour file keeps it.`;
        button(MOVE_LABELS.confirm);
        return;
      case "walk-saved":
        pending = outcome.confirm;
        dom.moveStatus.textContent = `The walk is in ${outcome.walkName} - keep that file. Now download the tour without it - until then the tour still carries it.`;
        button(MOVE_LABELS.download);
        return;
      case "refused":
        dom.moveStatus.textContent = outcome.reason;
        button(MOVE_LABELS.idle);
        return;
      case "cancelled":
        dom.moveStatus.textContent = NOTHING_MOVED;
        button(MOVE_LABELS.idle);
    }
  }

  dom.host.addEventListener("change", () => {
    if (facts === null || !isTourHost(dom.host.value)) return;
    facts = { ...facts, host: dom.host.value };
    render();
  });
  dom.moveButton.addEventListener("click", () => {
    if (moving || facts === null) return;
    const run = pending ?? deps.moveWalk;
    pending = null;
    moving = true;
    // The async-UI rule: in progress while the files are written, then
    // the durable end state - the move's result, or the button back. The
    // dialog stays open meanwhile (review #1).
    dom.moveButton.disabled = true;
    dom.moveButton.textContent = MOVE_LABELS.moving;
    dom.close.disabled = true;
    dom.moveStatus.textContent = "";
    // Called here, in the click: the page's save dialog needs it (#2).
    let started: Promise<WalkMoveOutcome>;
    try {
      started = run();
    } catch (err) {
      started = Promise.reject(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    void started
      .then(settle, (err: unknown) => {
        dom.moveStatus.textContent = `The walk was not moved: ${err instanceof Error ? err.message : String(err)}`;
        button(MOVE_LABELS.idle);
      })
      .finally(() => {
        moving = false;
        dom.close.disabled = false;
      });
  });
  dom.close.addEventListener("click", () => {
    close();
  });

  return {
    open(next) {
      facts = next;
      if (!moving) {
        moved = false;
        pending = null;
        button(MOVE_LABELS.idle);
        dom.moveStatus.textContent = "";
      }
      render();
      dom.backdrop.hidden = false;
      dom.close.focus();
    },
    close,
    isOpen: () => !dom.backdrop.hidden,
  };
}
