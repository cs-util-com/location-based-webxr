/**
 * The desktop editor's page (`/tour/edit.html`, M6 E1, E2a): the
 * composition root. Opens a tour (a file chosen or dropped, or the
 * sample), draws it in the chosen variant 1 layout (full map, the left
 * rail, the card beside the selected marker), and edits it: a pin's text,
 * Move and Delete with Undo, and a Save that downloads the tour to put in
 * place of the old file - or, where the browser allows it (Chromium's file
 * picker, M6 E2b-1), writes the opened file in place. Linked from nothing
 * yet.
 *
 * @see edit-main.ts.md
 */

import "./editor.css";
import { downloadZip } from "gps-plus-slam-app-framework/storage";
import { FINISH_LABELS } from "../qr-author-mode.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { describeIntegrityError } from "../open-errors.js";
import { scanEntryNames } from "../tour-read-set.js";
import { openDraftStore } from "../draft-store-root.js";
import {
  openTourFile,
  tourFileKeyOfFile,
  type TourSession,
} from "../tour-session.js";
import {
  CARD_RESIZED,
  createEditorCard,
  type CardView,
} from "./editor-card.js";
import { createEditorMap } from "./editor-map.js";
import {
  photoSource,
  type EditorItem,
  type EditorModel,
} from "./editor-model.js";
import { openTourForEditing } from "./editor-open.js";
import {
  createEditorDraft,
  type EditorDraftOffer,
  type NoBackupReason,
} from "./editor-draft.js";
import { createEditorRail } from "./editor-rail.js";
import {
  createEditorSession,
  type EditorSave,
  type EditorSession,
} from "./editor-session.js";
import { revealPadding, type Box } from "./popover-place.js";
import {
  createSaveTarget,
  holdEditorDraftLock,
  holdEditorLock,
  pickTourFile,
  InPlaceRefusal,
  type EditorLock,
  type PickerWindow,
  type SaveTarget,
  type WritableFileHandle,
} from "./save-target.js";

/** The committed sample tour (`public/samples/`), beside this page. */
const SAMPLE_URL = "samples/marienplatz-tour.zip";
const SAMPLE_NAME = "marienplatz-tour.zip";

/** The gap between the panels and the window's edges (`--gap`). */
const EDGE_PX = 12;
/** Below this width the rail starts folded (the prototype's 760 px). */
const NARROW_PX = 760;
/** An undo tapped after a save already wrote the delete (E2b plan
 *  review #2). The page ends an undo when a save starts, so this is the
 *  defensive answer, not an expected path. */
const UNDO_TOO_LATE =
  "That delete is already in the saved file - it cannot be undone here.";

/** How long a delete can be undone - the phone's hold (`object-editing.ts`
 *  `OUTCOME_HOLD_MS`). A Save ends it sooner: the saved file no longer
 *  carries the object. */
const UNDO_MS = 8000;

/** Said when "Delete it" did not land: nothing was thrown away. */
const DISCARD_FAILED =
  "The earlier changes could not be deleted - they are still kept, and offered again next time.";

/** Said once the offer was restored. */
function restoredLine(count: number): string {
  if (count === 0) {
    return "Nothing was restored: the notes those changes were for are edited here already.";
  }
  const back =
    count === 1
      ? "1 earlier change is"
      : `${String(count)} earlier changes are`;
  return `${back} back - not saved yet.`;
}

/** Said once per opened tour when its edits are not backed up in this
 *  browser (M6 E2c, the E2c plan review #6, #10). */
const NO_BACKUP: Readonly<Record<NoBackupReason, string>> = {
  storage:
    "This page keeps no backup copy of your edits in this browser - save before you close it.",
  "other-tab":
    "Another tab has this tour open, so this page keeps no backup copy of your edits - save before you close it.",
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`edit.html lacks #${id}`);
  return found as T;
}

// The library's licence: its geo maths runs once a store exists.
createTourViewerStore();

const modal = element("open-modal");
const drop = element("drop");
const zipInput = element<HTMLInputElement>("zip-input");
/** The chooser's own button: the label and its hidden input are not in the
 *  tab order, so a keyboard user reaches the chooser here (PR #612 review);
 *  its click is the drop box's. */
const chooseButton = element<HTMLButtonElement>("choose-btn");
const openStatus = element("open-status");
const openError = element("open-error");
const sampleButton = element<HTMLButtonElement>("sample-btn");
const cancelButton = element<HTMLButtonElement>("open-cancel");
const topbar = element("topbar");
const toasts = element("toasts");
const saveButton = element<HTMLButtonElement>("save-btn");
const saveStatus = element("save-status");
const keepWalk = element("keep-walk");
const keepWalkInput = element<HTMLInputElement>("keep-walk-input");

let session: TourSession | null = null;
/** The written file, for the card's photos once a save replaced the bytes
 *  the opened file had (E2b plan review #2, #5): the rebuild keeps the
 *  opened session, only the reads move. */
let photoSession: TourSession | null = null;
/** The opened file itself, when it may be written in place (E2b-1). */
let target: SaveTarget | null = null;
/** This tab's hold on the opened file's name (E2b plan review #6), and
 *  when the last one let go: the same name asked again before that is
 *  refused (E2b-1 review #3). */
let lock: EditorLock | null = null;
let letGo: Promise<void> = Promise.resolve();
/** A save of this tour was built: from then on the next rebuild starts
 *  from the page's own copy, whatever happens to the opened file (PR #614
 *  review: delivered or not). */
let built = false;
/** Toasts about this file that mean nothing once another tour is open. */
const fileToasts: HTMLElement[] = [];
/** The browser's file picker is open: a second click opens nothing. */
let picking = false;
/** The tour was opened to be saved in place: its saves keep the walk, even
 *  after a refusal turned them into downloads (E2b plan review #1). */
let keepsWalk = false;
let editor: EditorSession | null = null;
/** The open tour's draft key: its opened file's, then the key of each
 *  in-place write that landed (M6 E2c). */
let fileKey: string | null = null;
let model: EditorModel | null = null;
let selected: string | null = null;
let busy = false;
let saving = false;
/** A save the browser did not deliver (the picker dismissed, a failed
 *  download): Save offers it again before anything else. */
let undelivered: EditorSave | null = null;
/** The marker being dragged, and where it was dropped so far. */
let moving: { id: string; drop: { lat: number; lng: number } | null } | null =
  null;
/** Notes moved since the last save: their card says the height was kept. */
const moved = new Set<string>();
/** The card's last outcome line, for the item it was said about. */
let message: { id: string; text: string; refused?: true } | null = null;
/** The open delete's Undo toast, until it times out or a Save starts. */
let undoOffer: { toast: HTMLElement; timer: number } | null = null;

/** The open tour's edits, backed up in this browser (M6 E2c): the page
 *  says once when they are not, and marks when every write landed
 *  (`data-draft`: `writing`, `saved`, or `off` - the e2e's readiness
 *  mark before it closes a page, which skips `beforeunload`). */
const draft = createEditorDraft({
  openStore: (key) => openDraftStore(navigator, key),
  holdLock: (key) => holdEditorDraftLock(navigator.locks, key),
  noBackup: (reason) => {
    document.body.dataset["draft"] = "off";
    noBackupNote = NO_BACKUP[reason];
    // Said during an open, it waits until the tour shows: switching tours
    // takes the old file's toasts away.
    if (!busy) sayNoBackup();
  },
  onWriting: (writing) => {
    if (document.body.dataset["draft"] === "off") return;
    document.body.dataset["draft"] = writing ? "writing" : "saved";
  },
});

/** The no-backup line not yet shown (said once per opened tour). */
let noBackupNote: string | null = null;

function sayNoBackup(): void {
  if (noBackupNote === null) return;
  fileToasts.push(toast(noBackupNote, undefined, null));
  noBackupNote = null;
}

/** "2 codes, 3 notes" - and the stations when the story has any. */
function openedSummary(opened: EditorModel): string {
  const n = (count: number, one: string, many: string): string =>
    `${String(count)} ${count === 1 ? one : many}`;
  const { code, pin, photo, station } = opened.counts;
  return [
    n(code, "code", "codes"),
    n(pin + photo, "note", "notes"),
    ...(station === 0 ? [] : [n(station, "station", "stations")]),
  ].join(", ");
}

interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

/**
 * A toast. `holdMs` is how long it stays; `null` keeps it until the
 * creator closes it - the save's result, an instruction they have to act
 * on, which an 8 s hold tuned for an Undo took away (PR #611 review).
 */
function toast(
  text: string,
  action?: ToastAction | readonly ToastAction[],
  holdMs: number | null = UNDO_MS,
  closable = holdMs === null,
): HTMLElement {
  const t = document.createElement("div");
  t.className = "toast";
  const words = document.createElement("span");
  words.textContent = text;
  t.append(words);
  const actions = action === undefined ? [] : [action].flat();
  for (const a of actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small";
    b.textContent = a.label;
    b.addEventListener("click", a.run);
    t.append(b);
  }
  if (holdMs === null && closable) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn small";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      t.remove();
    });
    t.append(close);
  } else if (holdMs !== null) {
    setTimeout(() => {
      t.remove();
    }, holdMs);
  }
  toasts.append(t);
  return t;
}

/** The free part of the window: right of the rail, under the top bar
 *  (read from the bar itself, so the CSS stays the one source). */
function freeArea(): Box {
  const bar = topbar.hidden ? 0 : topbar.getBoundingClientRect().bottom;
  return {
    left: rail.right() + EDGE_PX,
    top: bar + EDGE_PX,
    right: window.innerWidth - EDGE_PX,
    bottom: window.innerHeight - EDGE_PX,
  };
}

function reveal(id: string): void {
  map.reveal(
    id,
    revealPadding(
      { width: window.innerWidth, height: window.innerHeight },
      freeArea(),
    ),
  );
}

function placeCard(): void {
  if (selected === null) return;
  card.place(map.anchorOf(selected), freeArea());
}

/** A pin or photo of the tour can be edited; codes, stations and the
 *  walk's recorded photos cannot (yet). */
function editable(item: EditorItem): boolean {
  return (
    (item.kind === "pin" || item.kind === "photo") && item.recorded !== true
  );
}

function viewOf(item: EditorItem): CardView {
  return {
    editable: editable(item),
    moving: moving?.id === item.id,
    moved: moved.has(item.id),
    message: message?.id === item.id ? message.text : "",
  };
}

function showCard(): void {
  const item = model?.items.find((i) => i.id === selected) ?? null;
  if (item === null) {
    card.hide();
    return;
  }
  card.show(item, viewOf(item));
  placeCard();
}

function select(id: string | null, pan = false): void {
  // Typing in the card's field is committed before it shows something else.
  if (id !== selected) {
    card.commit();
    // What was typed was refused, and the card is about to show something
    // else: the refusal goes to a toast, never silently away (PR #611
    // review).
    if (message?.refused === true && message.id === selected) {
      toast(message.text);
    }
  }
  if (moving !== null && moving.id !== id) cancelMove();
  selected = id;
  message = null;
  map.select(id);
  rail.select(id);
  showCard();
  if (pan && id !== null) {
    reveal(id);
    placeCard();
  }
}

function renderSaveState(): void {
  const count = editor?.changeCount() ?? 0;
  if (saving) {
    saveStatus.dataset["state"] = "saving";
    saveStatus.textContent = "Saving…";
    saveButton.disabled = true;
    return;
  }
  // On whenever a tour is open: a click commits the card's typing first,
  // so a disabled button would swallow the first edit (E2a review #3).
  saveButton.disabled = editor === null;
  if (undelivered !== null && count === 0) {
    saveStatus.dataset["state"] = "error";
    saveStatus.textContent = "Not saved yet - tap Save again";
    return;
  }
  if (count === 0) {
    saveStatus.dataset["state"] = "clean";
    saveStatus.textContent = saveStatus.dataset["saved"] ?? "No changes";
    return;
  }
  saveStatus.dataset["state"] = "pending";
  saveStatus.textContent = `${String(count)} ${count === 1 ? "change" : "changes"} not saved`;
}

/** After an edit: the rail, the markers, the card and the status follow. */
function refresh(): void {
  if (editor === null) return;
  model = editor.model();
  rail.update(model);
  map.update(model);
  if (selected !== null && !model.items.some((i) => i.id === selected)) {
    selected = null;
  }
  map.select(selected);
  rail.select(selected);
  showCard();
  renderSaveState();
}

function endUndo(): void {
  if (undoOffer === null) return;
  clearTimeout(undoOffer.timer);
  undoOffer.toast.remove();
  undoOffer = null;
}

function startMove(id: string): void {
  moving = { id, drop: null };
  map.drag(id, (lat, lng) => {
    if (moving?.id === id) moving.drop = { lat, lng };
  });
  showCard();
}

function finishMove(): void {
  const done = moving;
  if (done === null || editor === null) return;
  map.drag(done.id, null);
  moving = null;
  if (done.drop !== null) {
    try {
      if (editor.move(done.id, done.drop.lat, done.drop.lng)) {
        moved.add(done.id);
        message = { id: done.id, text: "Moved - not saved yet." };
      }
    } catch (err) {
      message = {
        id: done.id,
        text: `It cannot go there: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  refresh();
}

function cancelMove(): void {
  const done = moving;
  if (done === null) return;
  map.drag(done.id, null);
  moving = null;
  // Redrawn from the model: the marker goes back to where it was.
  refresh();
}

const map = createEditorMap(element("map"), {
  onSelect: (id) => {
    select(id);
  },
  onHover: (id, on) => {
    map.hover(id, on);
    rail.hover(id, on);
  },
  onBackground: () => {
    if (moving === null) select(null);
  },
  onView: placeCard,
});

const rail = createEditorRail(
  {
    rail: element("rail"),
    body: element("rail-body"),
    mini: element("rail-mini"),
    filter: element<HTMLInputElement>("filter"),
    collapse: element<HTMLButtonElement>("collapse-btn"),
    collapseIcon: document.getElementById(
      "collapse-icon",
    ) as unknown as SVGPathElement,
  },
  {
    onSelect: (id) => {
      select(id, true);
    },
    onHover: (id, on) => {
      map.hover(id, on);
      rail.hover(id, on);
    },
    onResize: placeCard,
  },
);

const card = createEditorCard(
  {
    card: element("card"),
    inner: element("card-inner"),
    arrow:
      element("card").querySelector<HTMLElement>(".arrow") ?? element("card"),
    chip: element("offscreen-chip"),
    chipText: element("offscreen-text"),
    chipShow: element<HTMLButtonElement>("offscreen-show"),
  },
  {
    loadImage: (item) => {
      const open = photoSession ?? session;
      const source = photoSource(item);
      if (open === null || source === null) {
        return Promise.reject(new Error("no tour is open"));
      }
      return source.kind === "content"
        ? open.loadContentEntry(source.path)
        : open.loadEntry(source.path);
    },
    onClose: () => {
      select(null);
    },
    onReveal: () => {
      if (selected !== null) reveal(selected);
    },
    onText: (id, text) => {
      if (editor === null) return;
      const outcome = editor.editText(id, text);
      message =
        outcome.kind === "refused"
          ? { id, text: outcome.reason, refused: true }
          : outcome.kind === "edited"
            ? { id, text: "Changed - not saved yet." }
            : null;
      // In place: the click that blurred the field must still land on the
      // button or row under the pointer (E2a review #3).
      model = editor.model();
      rail.update(model);
      map.update(model);
      card.note(message?.text ?? "");
      renderSaveState();
    },
    onMove: startMove,
    onMoveDone: finishMove,
    onMoveCancel: cancelMove,
    onDelete: (id) => {
      if (editor === null) return;
      const item = model?.items.find((i) => i.id === id);
      const undo = editor.remove(id);
      endUndo();
      select(null);
      refresh();
      const t = toast(`Deleted ${item?.title ?? "the note"}`, {
        label: "Undo",
        run: () => {
          endUndo();
          // Refused once a save wrote the delete: said, never a dead tap.
          if (!undo()) toast(UNDO_TOO_LATE);
          refresh();
        },
      });
      undoOffer = {
        toast: t,
        timer: window.setTimeout(endUndo, UNDO_MS),
      };
    },
  },
);

function showModal(on: boolean): void {
  modal.hidden = !on;
  // Cancel returns to the open tour; with none there is nothing to return to.
  cancelButton.hidden = session === null;
  if (on) openError.hidden = true;
}

/** Leaving would lose edits: changes not saved, or a save not delivered. */
function unsavedWork(): boolean {
  return (
    saving ||
    undelivered !== null ||
    card.dirty() ||
    (editor?.changeCount() ?? 0) > 0
  );
}

window.addEventListener("resize", placeCard);
element("card").addEventListener(CARD_RESIZED, placeCard);
window.addEventListener("beforeunload", (event) => {
  if (unsavedWork()) event.preventDefault();
});
document.addEventListener("keydown", (event) => {
  // Ctrl+S / Cmd+S saves the tour; the browser's "Save page as" never opens
  // here, open tour or not (E2b plan review #10).
  // By the key's letter, so Dvorak's and Colemak's S work; by its
  // position only where the layout's letter is not Latin (E2b-1 review #6).
  const isS =
    event.key.toLowerCase() === "s" ||
    (event.code === "KeyS" && !/^[a-z]$/i.test(event.key));
  if ((event.ctrlKey || event.metaKey) && !event.altKey && isS) {
    event.preventDefault();
    if (modal.hidden) void runSave();
    return;
  }
  if (event.key !== "Escape") return;
  if (moving !== null) {
    cancelMove();
    return;
  }
  if (!modal.hidden && session !== null && !busy) showModal(false);
  else select(null);
});

function setBusy(on: boolean, text: string): void {
  busy = on;
  sampleButton.disabled = on;
  zipInput.disabled = on;
  chooseButton.disabled = on;
  cancelButton.disabled = on;
  openStatus.textContent = text;
}

/** The opened file's hold and target, and the written bytes' session, go
 *  with the tour they belong to. */
function leaveFile(): void {
  const was = lock;
  lock = null;
  was?.release();
  letGo = was?.released ?? Promise.resolve();
  target = null;
  keepsWalk = false;
  for (const t of fileToasts.splice(0)) t.remove();
  void photoSession?.close().catch(() => undefined);
  photoSession = null;
}

function resetEditing(): void {
  built = false;
  endUndo();
  moving = null;
  moved.clear();
  message = null;
  undelivered = null;
  delete saveStatus.dataset["saved"];
}

/** The tour is gone (a late integrity failure): nothing of it stays on
 *  screen, and the dialog says why. */
function dropTour(reason: string): void {
  select(null);
  const open = session;
  session = null;
  editor = null;
  model = null;
  fileKey = null;
  draft.close();
  resetEditing();
  leaveFile();
  void open?.close().catch(() => undefined);
  topbar.hidden = true;
  element("rail").hidden = true;
  showModal(true);
  openError.textContent = reason;
  openError.hidden = false;
}

/**
 * The page's own save target for a file picked with write permission: one
 * tab per file name, and a second tab may still choose to edit here.
 */
async function attachTarget(
  mine: EditorSession,
  handle: WritableFileHandle,
  file: File,
): Promise<void> {
  // A file opened to be written keeps its walk from the start, before the
  // lock's answer: a download saved before "Edit here anyway" must not
  // drop the walk the later in-place write would then carry over the
  // original (E2b-1 review #1).
  keepsWalk = true;
  keepWalk.hidden = true;
  await letGo;
  const held = await holdEditorLock(navigator.locks, file.name);
  if (editor !== mine) {
    held.release();
    return;
  }
  const take = async (): Promise<void> => {
    try {
      const made = await createSaveTarget(handle, file);
      if (editor !== mine) return;
      target = made;
      renderSaveState();
    } catch (err) {
      if (editor !== mine) return;
      fileToasts.push(
        toast(
          `This file cannot be saved in place (${err instanceof Error ? err.message : String(err)}), so Save downloads a copy.`,
        ),
      );
    }
  };
  if (held.granted) {
    lock = held;
    await take();
    return;
  }
  const told = toast(
    `Another tab is editing a file named ${file.name}. Saving here downloads a copy.`,
    {
      label: "Edit here anyway",
      run: () => {
        told.remove();
        if (editor === mine) void take();
      },
    },
    null,
  );
  fileToasts.push(told);
}

/** Open `file`; whether it became the open tour. */
async function openFile(
  file: File,
  handle: WritableFileHandle | null = null,
): Promise<boolean> {
  if (busy) return false;
  openError.hidden = true;
  setBusy(true, `Opening ${file.name}…`);
  // The open tour stays until the new one has opened: a refused file must
  // not cost the creator the tour they had (E1 review #4).
  const outcome = await openTourForEditing(file, {
    onIntegrityFailure: (err, failed) => {
      if (failed === session) dropTour(describeIntegrityError(err));
    },
  });
  if (outcome.kind === "refused") {
    setBusy(false, "");
    openError.textContent = outcome.reason;
    openError.hidden = false;
    return false;
  }
  // A failure the background check latched before the tour was ours
  // (E1 review #6).
  const latched = outcome.session.integrityFailure();
  if (latched !== null) {
    setBusy(false, "");
    await outcome.session.close().catch(() => undefined);
    openError.textContent = describeIntegrityError(latched);
    openError.hidden = false;
    return false;
  }
  // The draft is read inside the open, before the tour shows (E2c plan
  // review #7): what an earlier visit left is offered with the tour.
  document.body.dataset["draft"] = "writing";
  const drafted = await draft.open(
    outcome.session.archive.url,
    outcome.manifest,
  );
  setBusy(false, "");
  select(null);
  const previous = session;
  session = outcome.session;
  void previous?.close().catch(() => undefined);
  resetEditing();
  leaveFile();
  fileKey = outcome.session.archive.url;
  editor = createEditorSession({
    session: outcome.session,
    manifest: outcome.manifest,
    levels: outcome.levels,
    fileName: outcome.fileName,
    draft,
  });
  model = editor.model();
  // The walk-recording switch only for a tour that carries one (S-D10:
  // the saved copy leaves it out unless asked, E2 plan review #4).
  keepWalkInput.checked = false;
  keepWalk.hidden =
    scanEntryNames(
      outcome.session.entries.map((e) => e.filename),
      outcome.manifest,
      outcome.session.manifestWrap,
    ).length === 0;
  element("tour-name").textContent = model.title;
  element("tour-file").textContent = outcome.fileName;
  topbar.hidden = false;
  showModal(false);
  rail.render(model);
  // A narrow window starts with the rail folded, as the prototype does.
  if (window.innerWidth < NARROW_PX) rail.collapse(true);
  const free = freeArea();
  map.show(model, { left: free.left, top: free.top });
  renderSaveState();
  toast(`Opened ${outcome.fileName}: ${openedSummary(model)}`);
  sayNoBackup();
  if (drafted.superseded !== null) {
    fileToasts.push(toast(drafted.superseded, undefined, null));
  }
  if (drafted.offer !== null) offerDraft(editor, drafted.offer);
  if (handle !== null) void attachTarget(editor, handle, file);
  return true;
}

/**
 * What an earlier visit left, offered with the tour (E2c plan review #7):
 * Restore puts it back by the session's own rules (live edits made
 * meanwhile win), Not now leaves it for the next open, Delete it throws
 * it away. It stays until answered.
 */
function offerDraft(mine: EditorSession, offer: EditorDraftOffer): void {
  const t = toast(
    offer.text,
    [
      {
        label: "Restore",
        run: () => {
          t.remove();
          if (editor !== mine) return;
          card.commit();
          const applied = mine.restore(offer);
          draft.restored();
          refresh();
          toast(restoredLine(applied.changed + applied.deleted));
        },
      },
      {
        label: "Not now",
        run: () => {
          t.remove();
        },
      },
      {
        label: "Delete it",
        run: () => {
          t.remove();
          if (editor !== mine) return;
          void draft.discard().then((ok) => {
            if (!ok && editor === mine) toast(DISCARD_FAILED, undefined, null);
          });
        },
      },
    ],
    null,
    false,
  );
  t.classList.add("draft-offer");
  fileToasts.push(t);
}

/** "Choose…" and the drop box: the browser's file picker where it exists,
 *  for a file that can be saved in place, else the file input. */
async function chooseTour(): Promise<void> {
  if (busy || picking) return;
  picking = true;
  const outcome = await pickTourFile(window as unknown as PickerWindow).finally(
    () => {
      picking = false;
    },
  );
  if (outcome.kind === "unavailable") {
    zipInput.click();
    return;
  }
  if (outcome.kind === "cancelled") return;
  if (outcome.kind === "unreadable") {
    openError.textContent = `The chosen file could not be read: ${outcome.reason}`;
    openError.hidden = false;
    return;
  }
  const opened = await openFile(
    outcome.file,
    outcome.writable ? outcome.handle : null,
  );
  // Said about the tour just opened, never over the one that stayed.
  if (opened && !outcome.writable) {
    toast(
      "The browser did not allow saving to this file, so Save downloads a copy.",
    );
  }
}

/**
 * An in-place save was refused (the file changed, moved, or could not be
 * written). The changes stay; "Download instead" turns this tour's saves
 * into downloads - the file on disk is no longer one this page may write
 * over - and saves at once.
 */
function refuseInPlace(
  mine: EditorSession,
  name: string,
  why: string,
  canDownload: boolean,
): void {
  if (!canDownload) {
    // Before any save was built the rebuild reads the opened file, and that
    // no longer reads once something else wrote it: no build can be made,
    // and a download offer would be a promise the page cannot keep (E2b-1
    // review #4).
    // The draft keeps the edits - but a later open finds them only when
    // the change on disk kept the tour's key and the edited notes (E2c
    // plan review #9): said as it is.
    fileToasts.push(
      toast(
        draft.backsUp()
          ? `Not saved to ${name}. ${why} This page can no longer read the file it opened, so these edits cannot be saved here - but this browser keeps a copy of them. Open the file again and they are offered back, if the change on disk left the notes you edited in it and the file is still the same tour (one built on a walk recording, or a listed tour, stays the same; a tour of notes alone does not).`
          : `Not saved to ${name}. ${why} This page can no longer read the file it opened, so these edits cannot be saved here. Open the file again to go on editing it.`,
        undefined,
        null,
      ),
    );
    return;
  }
  const t = toast(
    `Not saved to ${name}. ${why} Your changes are kept.`,
    {
      label: "Download instead",
      run: () => {
        t.remove();
        if (editor !== mine) return;
        const was = lock;
        lock = null;
        was?.release();
        // Waited for by the next open of this name, as `leaveFile` does
        // (PR #614 review).
        letGo = was?.released ?? letGo;
        target = null;
        void runSave();
      },
    },
    null,
  );
  fileToasts.push(t);
}

/** Photos read from what was written from now on (E2b plan review #2). */
async function readPhotosFrom(
  mine: EditorSession,
  written: File,
): Promise<void> {
  try {
    const next = await openTourFile(written);
    if (editor !== mine) {
      void next.close().catch(() => undefined);
      return;
    }
    void photoSession?.close().catch(() => undefined);
    photoSession = next;
  } catch {
    // The opened session stays; a photo that no longer reads says so.
  }
}

/** Hand `save` to the browser as a download; whether it arrived. */
async function download(save: EditorSave): Promise<boolean> {
  try {
    return await downloadZip(save.blob, save.filename);
  } catch {
    return false;
  }
}

/**
 * Deliver `save`: written over the opened file where the page may (the
 * file then backs the next rebuild and the photos), else downloaded. A
 * refused or failed in-place write keeps the save for "Save again" and
 * offers the download.
 */
async function deliver(
  mine: EditorSession,
  save: EditorSave,
  into: SaveTarget | null,
): Promise<{ arrived: boolean; inPlace: boolean }> {
  if (into === null) {
    const arrived = await download(save);
    if (arrived) {
      await readPhotosFrom(
        mine,
        new File([save.blob], save.filename, { type: "application/zip" }),
      );
    }
    return { arrived, inPlace: false };
  }
  // The key of the bytes about to be written, worked out BEFORE the
  // write: once it lands, the draft follows it in the same step (E2c plan
  // review #5). Unreadable (never for a zip this page built) keeps the
  // key the draft has.
  const writtenKey = await tourFileKeyOfFile(
    new File([save.blob], save.filename, { type: "application/zip" }),
  ).catch(() => fileKey);
  try {
    await into.write(save.blob);
    if (editor === mine && writtenKey !== null) {
      draft.landed(save.written, writtenKey);
      fileKey = writtenKey;
    }
    // The photos read from this page's copy of what it wrote, never from
    // the file on disk: once something else rewrites that file, a File
    // read from it no longer reads. The copy is the one the next rebuild
    // starts from anyway (the download path holds the same).
    await readPhotosFrom(
      mine,
      new File([save.blob], save.filename, { type: "application/zip" }),
    );
    return { arrived: true, inPlace: true };
  } catch (err) {
    refuseInPlace(
      mine,
      into.name,
      err instanceof InPlaceRefusal
        ? err.message
        : `It could not be written: ${err instanceof Error ? err.message : String(err)}.`,
      true,
    );
    return { arrived: false, inPlace: true };
  }
}

/** A save whose tour was closed meanwhile ends quietly; the open tour's
 *  page shows its own state. */
function abandon(): void {
  saving = false;
  renderSaveState();
}

async function runSave(): Promise<void> {
  if (editor === null || saving) return;
  card.commit();
  if (moving !== null) finishMove();
  if (editor.changeCount() === 0 && undelivered === null) {
    saveStatus.dataset["state"] = "clean";
    saveStatus.textContent = "Nothing to save";
    return;
  }
  // A save belongs to the tour it started on: one opened meanwhile must not
  // receive it (E2a review #5).
  const mine = editor;
  // The saved file will not carry a deleted object any more: its Undo ends.
  endUndo();
  saving = true;
  renderSaveState();
  // Checked BEFORE the build too: the build reads the opened file, which
  // something else's write makes unreadable (E2b plan review #4).
  const into = target;
  if (into !== null) {
    const state = await into.check().catch(() => "same" as const);
    if (editor !== mine) {
      abandon();
      return;
    }
    if (state !== "same") {
      saving = false;
      renderSaveState();
      refuseInPlace(mine, into.name, new InPlaceRefusal(state).message, built);
      return;
    }
  }
  try {
    const save =
      undelivered !== null && mine.changeCount() === 0
        ? undelivered
        : // In place the walk always stays: the file written over may be
          // the creator's only copy of it (E2b plan review #1).
          await mine.save({
            keepScan: keepsWalk || keepWalkInput.checked,
          });
    if (editor !== mine) {
      abandon();
      return;
    }
    if (save !== undelivered) {
      // A build's versions are this browser's own work, delivered or not
      // (E2c plan review #1).
      draft.built(save.written);
    }
    built = true;
    // A later save rebuilds from this one's bytes, so the walk switch can
    // no longer change anything (the phone's rule, E2a review #1).
    keepWalk.hidden = true;
    // The target this save was checked against, even if "Edit here
    // anyway" attached one while it was built (E2b-1 review #1).
    const { arrived, inPlace } = await deliver(mine, save, into);
    if (editor !== mine) {
      abandon();
      return;
    }
    undelivered = arrived ? null : save;
    if (arrived) {
      // A move made during the save is still pending: its line stays.
      const pending = new Set(mine.pendingIds());
      for (const id of [...moved]) if (!pending.has(id)) moved.delete(id);
      message = null;
      saveStatus.dataset["saved"] = inPlace
        ? `Saved to ${into?.name ?? save.filename}`
        : `Saved as ${save.filename}`;
      // The Finish's own result sentences (E2a review #2).
      toast(
        [
          inPlace
            ? `Saved to ${into?.name ?? save.filename}.`
            : `Saved as ${save.filename}. Put it in place of the old file, under the same name, so the printed codes keep opening it.`,
          ...(save.scanLeftOut.length === 0
            ? []
            : [FINISH_LABELS.scanLeftOut(save.scanLeftOut.length)]),
          ...(save.notPlaced === undefined
            ? []
            : [FINISH_LABELS.photosNotPlaced(save.notPlaced)]),
        ].join(" "),
        undefined,
        // The download's result carries an instruction; in place it does not.
        inPlace ? UNDO_MS : null,
      );
    }
  } catch (err) {
    if (editor !== mine) {
      abandon();
      return;
    }
    saving = false;
    renderSaveState();
    saveStatus.dataset["state"] = "error";
    // The opened file changed on disk before any save (a sync client, an
    // other program): its bytes no longer read (E2b-1 review #4).
    saveStatus.textContent =
      err instanceof DOMException && err.name === "NotReadableError"
        ? "Not saved: the opened file changed on disk and can no longer be read - open it again"
        : `Not saved: ${err instanceof Error ? err.message : String(err)}`;
    saveButton.disabled = false;
    return;
  }
  saving = false;
  refresh();
}

saveButton.addEventListener("click", () => {
  void runSave();
});
// One handler for the drop box and its "Choose…" button (a click on the
// button reaches the label too). The input's own click - the fallback's -
// must not be cancelled, or no file dialog opens.
drop.addEventListener("click", (event) => {
  if (event.target === zipInput) return;
  event.preventDefault();
  void chooseTour();
});
zipInput.addEventListener("change", () => {
  const file = zipInput.files?.[0];
  zipInput.value = "";
  if (file !== undefined) void openFile(file);
});
// A file dropped anywhere else on the page would make the browser open
// it, and the open tour would be gone (PR #609 review): only #drop opens.
for (const type of ["dragover", "drop"] as const) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
  });
}
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => {
  drop.classList.remove("over");
});
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("over");
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) void openFile(file);
});
sampleButton.addEventListener("click", () => {
  if (busy) return;
  openError.hidden = true;
  setBusy(true, "Fetching the sample tour…");
  fetch(SAMPLE_URL)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`the sample answered ${String(response.status)}`);
      }
      const blob = await response.blob();
      setBusy(false, "");
      await openFile(
        new File([blob], SAMPLE_NAME, { type: "application/zip" }),
      );
    })
    .catch((err: unknown) => {
      setBusy(false, "");
      openError.textContent = `The sample tour could not be fetched: ${
        err instanceof Error ? err.message : String(err)
      }`;
      openError.hidden = false;
    });
});
cancelButton.addEventListener("click", () => {
  showModal(false);
});
element<HTMLButtonElement>("open-another").addEventListener("click", () => {
  // The same guard as leaving the page (`main.ts`'s rule for switching
  // tours, E2 plan review #12).
  if (
    unsavedWork() &&
    !window.confirm(
      "Your changes are not saved yet. Open another tour anyway? They will be lost.",
    )
  ) {
    return;
  }
  showModal(true);
});

// Everything above is wired: the open dialog's controls answer from here
// on (a keyboard press before the module ran would go nowhere - the e2e
// waits for this).
document.body.dataset["editor"] = "ready";
