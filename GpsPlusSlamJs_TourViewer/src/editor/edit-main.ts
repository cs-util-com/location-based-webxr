/**
 * The desktop editor's page (`/tour/edit.html`, M6 E1, E2a): the
 * composition root. Opens a tour (a file chosen or dropped, or the
 * sample), draws it in the chosen variant 1 layout (full map, the left
 * rail, the card beside the selected marker), and edits it: a pin's text,
 * Move and Delete, undo and redo of every edit (Ctrl+Z, Ctrl+Shift+Z,
 * Ctrl+Y; W2), and a Save that downloads the tour to put in
 * place of the old file - or, where the browser allows it (Chromium's file
 * picker, M6 E2b-1), writes the opened file in place - by itself too, a
 * few seconds after a change (M6 E2b-2, `autosave.ts`). The tour's name in
 * the top bar opens its details (W2 of the tour editor plan,
 * `details-dialog.ts`); "Done" says where the changes are and what is
 * left to do, and moves the walk out (`done-dialog.ts`). A tour whose file
 * carries a walk shows its debug camera captures on the map once it has
 * opened (`debug-capture-layer.ts`; debug data, never the tour's
 * content), behind a "Show debug data" switch. The view switch opens the
 * same tour in 3D over the map (`view-switch.ts`; the 3D view's code,
 * `src/editor3d/`, is a dynamic import made only then). Linked from the
 * setup page's "You already have a tour?" box and its step 5 on a device
 * without AR.
 *
 * @see edit-main.ts.md
 */

import {
  downloadZip,
  requestPersistentStorage,
  writeFileOrAbort,
} from "gps-plus-slam-app-framework/storage";
import { createTourViewerStore } from "../tour-viewer-session.js";
import {
  editorViewActions,
  editorViewReducer,
  isStationLocked,
  selectEditorView,
  type EditorMessage,
  type EditorViewState,
} from "./editor-view.js";
import {
  manifestToWrite,
  selectTourDocument,
  tourDocumentActions,
  type TourSaveHolder,
  type TourSaveStatus,
} from "../tour-document.js";
import { describeIntegrityError } from "../open-errors.js";
import { debugCapturesOf } from "../debug-captures.js";
import { pictureProblem } from "../image-cap.js";
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
  createDebugCaptureLayer,
  decodeDebugThumbnail,
  revokeDebugThumbnail,
  type DebugLayer,
} from "./debug-capture-layer.js";
import {
  STATION_PREFIX,
  photoSource,
  type EditorItem,
  type EditorModel,
} from "./editor-model.js";
import { applySceneEdit } from "./scene-edits.js";
import type { GestureEdit } from "../editor3d/gesture.js";
import {
  droppedDetailsLine,
  droppedStationFieldsLine,
  openTourForEditing,
} from "./editor-open.js";
import { holdPageInert } from "./page-inert.js";
import { fetchTourFile, linkOpenErrorText } from "./editor-link.js";
import { driveProxyBaseUrl } from "../drive-proxy-url.js";
import {
  createEditorDraft,
  restoredLine,
  type EditorDraftOffer,
  type EditorTourDraft,
  type NoBackupReason,
} from "./editor-draft.js";
import { createPhotoCopies } from "./photo-copy.js";
import { savedToastWords } from "./save-toast.js";
import { wireDetailsDialog } from "./details-dialog.js";
import {
  DRIVE_MOUNT_TIP_SHOWN,
  SAVE_DEBUG_LABELS,
  debugSaveResultLine,
  wireDoneDialog,
  type DebugSaveOutcome,
  type DoneSaved,
  type WalkMoveOutcome,
} from "./done-dialog.js";
import {
  TOUR_HOSTS,
  hostOfLink,
  readTourHost,
  type TourHost,
} from "../tour-host.js";
import { createEditorRail } from "./editor-rail.js";
import {
  AUTOSAVE_MAX_BYTES,
  autosaveFits,
  createAutosave,
  type AutosaveDeps,
  type AutosaveOutcome,
} from "./autosave.js";
import {
  createEditorSession,
  type EditorSave,
  type EditorSession,
} from "./editor-session.js";
import {
  bundleMatchesTour,
  debugBundleFileName,
  readDebugBundle,
  type DebugBundleTour,
} from "../debug-bundle.js";
import {
  ADD_DEBUG_LABELS,
  addedDebugLine,
  createAddDebugButton,
  notAddedLine,
  type AddDebugButtonDom,
} from "./added-debug-data.js";
import { noGpsWarnings } from "./no-gps-check.js";
import { revealPadding, type Box } from "./popover-place.js";
import { createStatusLines } from "./status-lines.js";
import { createViewSwitch, type View3dHandle } from "./view-switch.js";
import { createEditorShell } from "./editor-shell/editor-shell.js";
import type { InspectorCode } from "./editor-shell/inspector-model.js";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  Editor3dStats,
  Editor3dView,
} from "../editor3d/editor3d-scene.js";
import {
  adoptsSavedFile,
  createSaveTarget,
  holdEditorDraftLock,
  holdEditorLock,
  isSameFile,
  pickSaveFile,
  pickTourFile,
  saveFinePrint,
  InPlaceRefusal,
  type EditorLock,
  type PickerWindow,
  type SaveFilePick,
  type SavePickerWindow,
  type SaveTarget,
  type WritableFileHandle,
} from "./save-target.js";

/** The committed sample tour (`public/samples/`), beside this page. */
const SAMPLE_URL = "samples/marienplatz-tour.zip";
const SAMPLE_NAME = "marienplatz-tour.zip";

/** The page's own title (`edit.html`), after the tour's name. */
const EDITOR_TITLE = "Tour editor";

/** Said when the details dialog's Apply changed something, or nothing. */
const DETAILS_CHANGED = "Tour details changed - not saved yet.";
const DETAILS_UNCHANGED = "The tour details are as they were.";

/** Save's answer when there is nothing to save. */
const NOTHING_TO_SAVE =
  "Nothing to save: there are no changes since the tour was opened or last saved.";

/** The gap between the panels and the window's edges (`--gap`). */
const EDGE_PX = 12;
/** Below this width the rail starts folded (the prototype's 760 px). */
const NARROW_PX = 760;
/** How long a delete's toast offers its Undo - the phone's hold
 *  (`object-editing.ts` `OUTCOME_HOLD_MS`) - and holds autosave (M4a
 *  review #2). Ctrl+Z undoes it later too (W2: the session's edit stack),
 *  also after a save wrote it; a newer edit ends the toast, whose Undo
 *  would no longer take back the delete. */
const UNDO_MS = 8000;

/** The quiet after the last undo or redo before a step across the
 *  in-place file is written (D33, `resaveIfDue`): a run of steps at a
 *  person's pace (a few hundred ms apart) is one write of where it ended,
 *  instead of a rebuild per step that refuses the next. Shorter brings the
 *  refusals back for a slower hand; longer widens the window in which a
 *  closed tab loses the restore (the draft does not cover it; a reload
 *  asks first, `beforeunload`). */
const RESAVE_QUIET_MS = 700;

/** Said when "Delete it" did not land: nothing was thrown away. */
const DISCARD_FAILED =
  "The earlier changes could not be deleted - they are still kept, and offered again next time.";

/** Said once per opened tour when its edits are not backed up in this
 *  browser (M6 E2c, the E2c plan review #6, #10). */
const NO_BACKUP: Readonly<Record<NoBackupReason, string>> = {
  storage:
    "This page keeps no backup copy of your edits in this browser - save before you close it.",
  "other-tab":
    "Another tab has this tour open, so this page keeps no backup copy of your edits - save before you close it. To have one, close the other tab, then open the tour again here.",
};

/** The autosave's timings, and the size above which it is off. */
type AutosaveSettings = Pick<AutosaveDeps, "delayMs" | "maxWaitMs"> & {
  maxBytes?: number;
};

/**
 * The autosave's settings: the module's defaults, except in the dev server
 * an e2e may set `window.__tourEditorAutosave` (an init script) to move
 * autosave out of the way of a walk that times its own saves, or to lower
 * the size cap. Inert in a production build: `import.meta.env.DEV` is
 * statically false there, so the read is stripped (`seams.ts`'s
 * guarantee).
 */
function autosaveSettings(): AutosaveSettings {
  if (import.meta.env.DEV && !import.meta.env.VITEST) {
    const set = (window as { __tourEditorAutosave?: AutosaveSettings })
      .__tourEditorAutosave;
    if (set !== undefined) return set;
  }
  return {};
}

const { maxBytes: autosaveMaxBytes = AUTOSAVE_MAX_BYTES, ...autosaveTimings } =
  autosaveSettings();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`edit.html lacks #${id}`);
  return found as T;
}

// The page's store: the tour document (D29-D31) - the open tour, its edits,
// its history and its save status - lives here, not in this module's
// variables. Creating it also starts the library's licence (its geo maths
// runs once a store exists).
const store = createTourViewerStore(undefined, {
  editorView: editorViewReducer,
});

/** The page's chrome state (`editorView`): what is selected, in flight,
 *  dragged, and the card's last line. */
function ui(): EditorViewState {
  return selectEditorView(store.getState());
}

/** The card's outcome line for an item, or none. */
function say(message: EditorMessage | null): void {
  store.dispatch(editorViewActions.said({ message }));
}

/** A save the browser did not deliver, or none: kept here (it holds a
 *  Blob), and its waiting said to the store. */
function setUndelivered(save: EditorSave | null): void {
  undelivered = save;
  store.dispatch(
    editorViewActions.undeliveredChanged({ waits: save !== null }),
  );
}

/** The open tour's save status (`tour-document.ts`). */
function saveState(): TourSaveStatus {
  return selectTourDocument(store.getState()).save;
}

/** A save, or a step of the walk's move, holds the page's one save slot. */
function saving(): boolean {
  return saveState().by !== null;
}

/** The walk is being moved out (a step of the move holds the save): Done
 *  stays disabled (the M4b milestone review #1). */
function walkMoving(): boolean {
  return saveState().by === "walk";
}

/** Let the save slot go (`error`: why the save failed). */
function releaseSave(error?: string): void {
  store.dispatch(
    tourDocumentActions.saveReleased(error === undefined ? {} : { error }),
  );
}

const modal = element("open-modal");
const drop = element("drop");
const zipInput = element<HTMLInputElement>("zip-input");
/** The chooser's own button: the label and its hidden input are not in the
 *  tab order, so a keyboard user reaches the chooser here (PR #612 review);
 *  its click is the drop box's. */
const chooseButton = element<HTMLButtonElement>("choose-btn");
const linkForm = element<HTMLFormElement>("link-form");
const linkInput = element<HTMLInputElement>("link-input");
const linkButton = element<HTMLButtonElement>("link-btn");
const openStatus = element("open-status");
const openError = element("open-error");
const sampleButton = element<HTMLButtonElement>("sample-btn");
const cancelButton = element<HTMLButtonElement>("open-cancel");
const topbar = element("topbar");
/** The tour's name in the top bar: it opens the tour's details (W2). */
const tourName = element<HTMLButtonElement>("tour-name");
const coverList = element("details-covers");
const coversNone = element("details-covers-none");
const toasts = element("toasts");
const saveButton = element<HTMLButtonElement>("save-btn");
/** "Done" (W2): saves what is pending, then opens its dialog. */
const doneButton = element<HTMLButtonElement>("done-btn");
const saveStatus = element("save-status");
const keepWalk = element("keep-walk");
const keepWalkInput = element<HTMLInputElement>("keep-walk-input");
/** The debug layer's switch and its line (`debug-capture-layer.ts`). */
const debugPanel = element("debug-panel");
const debugSwitch = element("debug-switch");
const debugInput = element<HTMLInputElement>("debug-data-input");
const debugStatus = element("debug-status");
/** "Add debug data…" and its file input (M2 step 5 of the debug-captures
 *  plan). */
const debugAddButton = element<HTMLButtonElement>("debug-add");
const debugAddInput = element<HTMLInputElement>("debug-add-input");
const studioDebugAdd = element<HTMLButtonElement>("studio-debug-add");
/** The tour's "needs no GPS" setting and its warnings (QR-first M1b-2). */
const noGpsInput = element<HTMLInputElement>("no-gps-input");
/** Its warnings' live region: never hidden (an empty one is zero-height),
 *  and its lines replaced only when their words change, so a refresh does
 *  not announce the same warning again (M1b-2 milestone review #5). */
const noGpsLines = createStatusLines(element("no-gps-warnings"), (line) => {
  const p = document.createElement("p");
  p.className = "note-line warn";
  p.textContent = line;
  return p;
});

let session: TourSession | null = null;
/** The written file, for the card's photos once a save replaced the bytes
 *  the opened file had (E2b plan review #2, #5): the rebuild keeps the
 *  opened session, only the reads move - one copy opened at a time, so
 *  the whole-archive checks never pile up (E2b-2 milestone review #3). */
const photos = createPhotoCopies((file) => openTourFile(file));
/** The open tour's draft writes, bound to it: a save of a tour closed
 *  meanwhile moves nothing of the next one's (E2b-2 milestone review #1). */
let tourDraft: EditorTourDraft | null = null;
/** The opened file itself, when it may be written in place (E2b-1). */
let target: SaveTarget | null = null;
/** The opened tour's file: its name, and the handle it was picked through
 *  (writable or not; null from the file input, a drop or a link). "Save
 *  the debug data" reads it, so never writes over it (r901 review #5). */
let openedFile: {
  readonly name: string;
  readonly handle: FileSystemHandle | null;
} | null = null;
/** This tab's hold on the opened file's name (E2b plan review #6), and
 *  when the last one let go: the same name asked again before that is
 *  refused (E2b-1 review #3). */
let lock: EditorLock | null = null;
let letGo: Promise<void> = Promise.resolve();
/** Toasts about this file that mean nothing once another tour is open. */
const fileToasts: HTMLElement[] = [];
let editor: EditorSession | null = null;
/** The open tour's codes as opened (the 3D view draws them; read-only). */
let openedLevels: ReadonlyMap<string, QrLevel> = new Map();
/** The 3D view while it shows (the view switch holds its handle too). */
let shown3d: Editor3dView | null = null;
/** The open tour's draft key: its opened file's, then the key of each
 *  in-place write that landed (M6 E2c) and of a download whose key differs
 *  (the first save that wrote the tour's own id, Q-I). */
let fileKey: string | null = null;
let model: EditorModel | null = null;
/** A save the browser did not deliver (the picker dismissed, a failed
 *  download): Save offers it again before anything else. The save holds
 *  its zip (a Blob, never state), so it stays here; `editorView` holds
 *  only that one waits (`setUndelivered`). */
let undelivered: EditorSave | null = null;
/** Notes moved since the last save: their card says the height was kept. */
const moved = new Set<string>();
/** The open delete's Undo toast, until it times out or a newer edit
 *  comes. */
let undoOffer: { toast: HTMLElement; timer: number } | null = null;
/** The quiet time after the last step, before its resave (D33). */
let resaveTimer: number | null = null;
/** The last in-place refusal's toast: a new one takes its place. */
let refusalToast: HTMLElement | null = null;
/** The host of the link the open tour was fetched from, if it was. */
let linkHost: TourHost | null = null;
/** The end of the save that runs, for Done to wait on. */
let saveEnd: Promise<void> = Promise.resolve();
/** A move of the walk, as the session builds it. */
type WalkMove = Extract<
  Awaited<ReturnType<EditorSession["moveWalkOut"]>>,
  { kind: "ready" }
>;

/**
 * Claim the page's one save slot - a save, or a step of a walk's move:
 * the save status names `by`, and a new `saveEnd` for Done to wait on; the returned
 * function ends it. Every claimant replaces `saveEnd` (the M4b milestone
 * review #1: a move that did not left Done waiting, in a loop, on a
 * promise long settled - the tab froze).
 */
function claimSave(by: TourSaveHolder): () => void {
  store.dispatch(tourDocumentActions.saveClaimed({ by }));
  let ended = (): void => undefined;
  saveEnd = new Promise((resolve) => {
    ended = resolve;
  });
  return ended;
}

/** Wait until no save runs. A claim still set on an ended promise is a
 *  bug, not a wait: it never spins the tab. */
async function savesSettled(): Promise<void> {
  while (saving()) {
    const end = saveEnd;
    await end;
    if (saving() && saveEnd === end) return;
  }
}

/** Edits being made that a save must not cut into (M6 E2b-2, the E2b plan
 *  review #3, #7): a delete's undo while its toast offers it, typing not
 *  yet committed, a marker being moved. The delete reaches the file only
 *  once its Undo has lapsed (M4a review #2): an undo after the save that
 *  wrote it still works in this tab (the edit stack), but a draft does not
 *  bring the note back after a closed tab (`editor-draft.ts` places
 *  nothing new). */
function editing(): boolean {
  return (
    undoOffer !== null ||
    card.dirty() ||
    ui().moving !== null ||
    ui().gesture !== null
  );
}

/** The page saves by itself, a few seconds after a committed change, while
 *  the open tour is written in place (M6 E2b-2). Quiet: the status line
 *  shows "Saving…" and then where it saved - no toast; a failure shows
 *  the in-place refusal and pauses it (`autosave.ts`). `body[data-autosave]`
 *  is its state, the e2e's readiness mark. Held while another tour is
 *  being chosen or opened (E2b-2 milestone review #1): a save landing in
 *  the middle of an open would belong to neither tour cleanly. */
const autosave = createAutosave({
  ...autosaveTimings,
  held: () => saving() || ui().busy || !modal.hidden || editing(),
  pending: () => (editor?.changeCount() ?? 0) > 0,
  save: () => saveTour("auto"),
  onState: (state) => {
    document.body.dataset["autosave"] = state;
    renderSaveState();
  },
});
document.body.dataset["autosave"] = autosave.state();

/**
 * The dev server's test hook (`window.__tourEditor`): an e2e reaches the
 * editor session's edits no control of this page offers yet (a station's
 * name), then `edited()` follows them as an edit made here would - the
 * rail, the map, the card and the status, and the autosave told. Inert in
 * a production build: `import.meta.env.DEV` is statically false there, so
 * the hook is stripped (`seams.ts`'s guarantee).
 */
if (import.meta.env.DEV && !import.meta.env.VITEST) {
  (
    window as {
      __tourEditor?: {
        editor: () => EditorSession | null;
        edited: () => void;
        view3d: () => Editor3dStats | null;
        view3dTilt: (deg: number) => void;
        view3dDistance: (m: number) => void;
        view3dPointOf: (
          selection: string,
        ) => readonly [number, number, number] | null;
        view3dScreenOf: (selection: string) => readonly [number, number] | null;
        view3dHandle: (
          part: "middle" | "knob" | "dot",
        ) => readonly [number, number] | null;
        view3dGizmoSizes: () => ReturnType<Editor3dView["gizmoSizes"]>;
        manifest: () => ReturnType<typeof manifestToWrite>;
        selected: () => string | null;
      };
    }
  ).__tourEditor = {
    editor: () => editor,
    edited: () => {
      refresh();
      autosave.changed();
    },
    view3d: () => shown3d?.stats() ?? null,
    view3dTilt: (deg) => {
      shown3d?.setTilt(deg);
    },
    view3dDistance: (m) => {
      shown3d?.setDistance(m);
    },
    view3dPointOf: (selection) => shown3d?.pointOf(selection) ?? null,
    view3dScreenOf: (selection) => shown3d?.screenOf(selection) ?? null,
    view3dHandle: (part) => shown3d?.handleScreen(part) ?? null,
    view3dGizmoSizes: () => shown3d?.gizmoSizes() ?? null,
    manifest: () => manifestToWrite(store.getState().tourDocument),
    selected: () => ui().selected,
  };
}

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
    if (!ui().busy) sayNoBackup();
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
  /** Called in the click, with the action's own button. */
  readonly run: (button: HTMLButtonElement) => void;
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
    b.addEventListener("click", () => {
      a.run(b);
    });
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

/** The debug panel's box while it shows: the card keeps clear of it
 *  (r901 review #4; the panel shares the window's lower right corner). */
function debugPanelBox(): Box | null {
  if (debugPanel.hidden) return null;
  const r = debugPanel.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function placeCard(): void {
  const { selected } = ui();
  if (selected === null) return;
  card.place(map.anchorOf(selected), freeArea(), debugPanelBox());
}

/** A pin or photo of the tour can be edited; codes and stations cannot
 *  (yet). */
function editable(item: EditorItem): boolean {
  return item.kind === "pin" || item.kind === "photo";
}

function viewOf(item: EditorItem): CardView {
  const { moving, message } = ui();
  return {
    editable: editable(item),
    moving: moving?.id === item.id,
    moved: moved.has(item.id),
    message: message?.id === item.id ? message.text : "",
  };
}

function showCard(): void {
  const item = model?.items.find((i) => i.id === ui().selected) ?? null;
  // The card points at a marker of the map: not over the 3D view, whose
  // panels come later. The selection stays (the store's).
  if (item === null || ui().viewMode === "3d") {
    card.hide();
    return;
  }
  card.show(item, viewOf(item));
  placeCard();
}

function select(id: string | null, pan = false): void {
  // Typing in the card's field is committed before it shows something else.
  if (id !== ui().selected) {
    card.commit();
    // What was typed was refused, and the card is about to show something
    // else: the refusal goes to a toast, never silently away (PR #611
    // review).
    const { message, selected } = ui();
    if (message?.refused === true && message.id === selected) {
      toast(message.text);
    }
  }
  const { moving } = ui();
  if (moving !== null && moving.id !== id) cancelMove();
  store.dispatch(editorViewActions.selected({ id }));
  say(null);
  map.select(id);
  rail.select(id);
  showCard();
  if (pan && id !== null) {
    reveal(id);
    placeCard();
  }
}

/** The save status: its state and its words, the words also its title
 *  (the 3D view's top bar cuts a long line short with an ellipsis; the
 *  whole line stays announced, and shows on hover). */
function showSaveStatus(state: string, text: string): void {
  saveStatus.dataset["state"] = state;
  saveStatus.textContent = text;
  saveStatus.title = text;
}

function renderSaveState(): void {
  const count = editor?.changeCount() ?? 0;
  if (!ui().doneBusy) doneButton.disabled = editor === null || walkMoving();
  if (saving()) {
    showSaveStatus("saving", "Saving…");
    saveButton.disabled = true;
    return;
  }
  // On whenever a tour is open: a click commits the card's typing first,
  // so a disabled button would swallow the first edit (E2a review #3).
  saveButton.disabled = editor === null;
  if (undelivered !== null && count === 0) {
    showSaveStatus("error", "Not saved yet - tap Save again");
    return;
  }
  if (count === 0) {
    showSaveStatus("clean", savedLine() ?? "No changes");
    return;
  }
  const changes = `${String(count)} ${count === 1 ? "change" : "changes"} not saved`;
  // A pause is said where the creator looks for the save's state (M6
  // E2b-2), and so are the two cases where Save is the only way - or no
  // way at all (milestone review #3, #8).
  showSaveStatus("pending", `${changes}${pendingSuffix()}`);
}

/** Why the pending changes are not saved by themselves, if they are not. */
function pendingSuffix(): string {
  if (saveState().cannotSave) {
    return " - it cannot be saved here: open the file again";
  }
  if (autosave.state() === "paused") {
    return " - not saved by itself until you Save";
  }
  if (saveState().largeTour && target !== null) {
    // "Kept" only when the draft does keep them (E2c).
    return draft.backsUp()
      ? " - large tour: saved when you press Save; your changes are kept in this browser meanwhile"
      : " - large tour: saved when you press Save";
  }
  return "";
}

/** The "needs no GPS" setting as the session holds it, and - while it is
 *  on - what visitors without location will meet (QR-first M1b-2): plain
 *  lines, never blocking the save. */
function renderNoGps(): void {
  const on = editor?.needsNoGps() ?? false;
  noGpsInput.checked = on;
  noGpsInput.disabled = editor === null;
  noGpsLines.show(
    editor === null || !on ? [] : noGpsWarnings(editor.noGpsCheck()),
  );
}

/** The tour's name in the top bar and the tab's title (W2: link titles
 *  use the tour's name, not the app's). */
function renderTourName(): void {
  const title = model?.title;
  tourName.textContent = title ?? "";
  document.title =
    title === undefined ? EDITOR_TITLE : `${title} - ${EDITOR_TITLE}`;
}

/** After an edit: the rail, the markers, the card and the status follow. */
function refresh(): void {
  if (editor === null) return;
  model = editor.model();
  renderTourName();
  rail.update(model);
  map.update(model);
  const { selected } = ui();
  if (selected !== null && !model.items.some((i) => i.id === selected)) {
    store.dispatch(editorViewActions.selected({ id: null }));
  }
  map.select(ui().selected);
  rail.select(ui().selected);
  showCard();
  renderNoGps();
  renderSaveState();
}

function endUndo(): void {
  if (undoOffer === null) return;
  clearTimeout(undoOffer.timer);
  undoOffer.toast.remove();
  undoOffer = null;
  // An autosave held for the delete's Undo may start now, and so may a
  // resave that fell due meanwhile.
  autosave.poke();
  void resaveIfDue();
}

/** Said for each undo or redo (the async-UI rule's confirmation: the keys
 *  change things off screen as often as on it). */
const STEP_WORDS = {
  undo: { done: "Undone", none: "Nothing to undo." },
  redo: { done: "Redone", none: "Nothing to redo." },
} as const;

/** Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y), and the delete toast's Undo: one
 *  step of the session's edit stack (W2), an edit like any other. */
function runStep(which: "undo" | "redo"): void {
  if (editor === null) return;
  // A drag or a held key of the 3D view ends unwritten: the step acts on
  // the tour as it was.
  shown3d?.cancelGesture();
  if (ui().moving !== null) cancelMove();
  card.commit();
  const outcome = which === "undo" ? editor.undo() : editor.redo();
  say(null);
  refresh();
  if (outcome.kind === "refused") {
    // A delete toast stays: its Undo can be tapped again once the save ends.
    toast(outcome.reason);
    return;
  }
  if (outcome.kind === "nothing") {
    endUndo();
    toast(STEP_WORDS[which].none);
    return;
  }
  // Restarted by every step: the resave writes where a run of steps ended.
  // Before the undo offer ends, whose end asks for a due resave: the quiet
  // time must already hold it.
  stopResaveTimer();
  resaveTimer = window.setTimeout(() => {
    resaveTimer = null;
    void resaveIfDue();
  }, RESAVE_QUIET_MS);
  endUndo();
  toast(`${STEP_WORDS[which].done}: ${outcome.what}.`);
  autosave.changed();
}

function stopResaveTimer(): void {
  if (resaveTimer === null) return;
  clearTimeout(resaveTimer);
  resaveTimer = null;
}

/**
 * An undo or a redo that crossed the file written in place (D33, the
 * slice's `save.resave`, `tour-document.ts` `stepCrossesInPlaceSave`)
 * writes it again once the steps paused (`RESAVE_QUIET_MS` after the last
 * one), through the one save path: the file on disk then
 * holds what the editor shows, so a reload loses nothing (an open drops
 * every draft record of an id the file lacks). Quiet as an autosave - the
 * status line says "Saving…", then "Saved to <name>"; a refused or failed
 * write is said as an autosave's is, after the undo's own toast, and pauses
 * autosave as a failed Save does. Also for a large tour, whose autosave is
 * off. Never for downloads (`target` null): a download cannot be rewritten
 * silently. It waits - the resave staying due - while a save runs (that
 * save's end asks again, `saveTour`), while the steps' quiet time runs
 * (its end asks), while an edit is being made (`editing`: the end of the
 * delete's Undo offer, a committed field and a finished or cancelled move
 * ask), and while another tour is being chosen or opened (the open
 * dialog's close asks, `showModal`). Started during an edit it would be
 * claimed - which takes the resave on - and then held, and nothing would
 * write the file until Save on a large tour.
 */
async function resaveIfDue(): Promise<void> {
  const mine = editor;
  if (mine === null || !resaveMayStart()) return;
  const outcome = await saveTour("auto");
  if (editor !== mine || outcome === "held") return;
  if (outcome === "saved") autosave.saved();
  else autosave.failed();
}

/** A resave is due and nothing holds it: written in place, no save
 *  running, the steps' quiet time over, no edit being made, no other tour
 *  being opened. */
function resaveMayStart(): boolean {
  return (
    target !== null &&
    saveState().resave &&
    !saving() &&
    resaveTimer === null &&
    !editing() &&
    !ui().busy &&
    Boolean(modal.hidden)
  );
}

function startMove(id: string): void {
  store.dispatch(editorViewActions.moveStarted({ id }));
  map.drag(id, (lat, lng) => {
    store.dispatch(editorViewActions.moveDropped({ id, drop: { lat, lng } }));
  });
  showCard();
}

function finishMove(): void {
  const done = ui().moving;
  if (done === null || editor === null) return;
  map.drag(done.id, null);
  store.dispatch(editorViewActions.moveEnded());
  if (done.drop !== null) {
    try {
      const outcome = editor.move(done.id, done.drop.lat, done.drop.lng);
      if (outcome.kind === "moved") {
        moved.add(done.id);
        say({ id: done.id, text: "Moved - not saved yet." });
        endUndo();
        autosave.changed();
      } else {
        // Said, never dropped (PR #622 bot finding C).
        say({ id: done.id, text: outcome.reason, refused: true });
      }
    } catch (err) {
      say({
        id: done.id,
        text: `It cannot go there: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  refresh();
  autosave.poke();
  void resaveIfDue();
}

function cancelMove(): void {
  const done = ui().moving;
  if (done === null) return;
  map.drag(done.id, null);
  store.dispatch(editorViewActions.moveEnded());
  // Redrawn from the model: the marker goes back to where it was.
  refresh();
  autosave.poke();
  void resaveIfDue();
}

const mapBox = element("map");
const map = createEditorMap(mapBox, {
  onSelect: (id) => {
    select(id);
  },
  onHover: (id, on) => {
    map.hover(id, on);
    rail.hover(id, on);
  },
  onBackground: () => {
    if (ui().moving === null) select(null);
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
      // A photo an undo brought back after a save took it out: its picture
      // is the session's until the next save writes it (W2).
      const kept = editor?.pictureOf(item.id);
      if (kept !== undefined) return Promise.resolve(kept);
      const open = photos.current() ?? session;
      const source = photoSource(item);
      if (open === null || source === null) {
        return Promise.reject(new Error("no tour is open"));
      }
      return open.loadContentEntry(source);
    },
    onClose: () => {
      select(null);
    },
    onReveal: () => {
      const { selected } = ui();
      if (selected !== null) reveal(selected);
    },
    onText: (id, text) => {
      if (editor === null) return;
      const outcome = editor.editText(id, text);
      say(
        outcome.kind === "refused"
          ? { id, text: outcome.reason, refused: true }
          : outcome.kind === "edited"
            ? { id, text: "Changed - not saved yet." }
            : null,
      );
      // In place: the click that blurred the field must still land on the
      // button or row under the pointer (E2a review #3).
      model = editor.model();
      rail.update(model);
      map.update(model);
      card.note(ui().message?.text ?? "");
      renderSaveState();
      // Committed (or given back unchanged): the typing hold is over.
      if (outcome.kind === "edited") {
        endUndo();
        autosave.changed();
      }
      autosave.poke();
      void resaveIfDue();
    },
    onMove: startMove,
    onMoveDone: finishMove,
    onMoveCancel: cancelMove,
    onDelete: deleteSelection,
  },
);

/**
 * Delete a note, or a station with its notes (`station:<id>`; the 3D
 * view's Del): one step. The toast offers its Undo while it is the newest
 * edit; a refusal deletes nothing and is said.
 */
function deleteSelection(id: string): void {
  if (editor === null) return;
  const item = model?.items.find((i) => i.id === id);
  // One delete toast at a time: its Undo takes back the newest edit.
  endUndo();
  const outcome = id.startsWith(STATION_PREFIX)
    ? editor.deleteStation(id.slice(STATION_PREFIX.length))
    : editor.remove(id);
  if (outcome.kind === "refused") {
    // Nothing was deleted: no "Deleted" toast, and no Undo offered - it
    // would only answer that there is nothing to take back.
    select(null);
    refresh();
    toast(outcome.reason);
    return;
  }
  select(null);
  refresh();
  // The toast's Undo is the stack's (W2), while this delete is the
  // newest edit; a newer one ends the toast.
  const mine = editor;
  const at = editor.revision();
  const t = toast(`Deleted ${item?.title ?? "the note"}`, {
    label: "Undo",
    run: () => {
      if (editor !== mine || mine.revision() !== at) {
        endUndo();
        return;
      }
      runStep("undo");
    },
  });
  undoOffer = {
    toast: t,
    timer: window.setTimeout(endUndo, UNDO_MS),
  };
  autosave.changed();
}

/**
 * Copy a note, or a station with its notes, beside itself (the 3D view's
 * Ctrl+D): one step; the copy is selected and a toast names it. A photo's
 * picture is read first; a tour switched meanwhile drops the result.
 */
async function duplicateSelection(id: string): Promise<void> {
  const mine = editor;
  if (mine === null) return;
  const item = model?.items.find((i) => i.id === id);
  endUndo();
  const outcome = id.startsWith(STATION_PREFIX)
    ? await mine.duplicateStation(id.slice(STATION_PREFIX.length))
    : await mine.duplicateObject(id);
  if (editor !== mine) return;
  refresh();
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  select(
    "stationId" in outcome
      ? `${STATION_PREFIX}${outcome.stationId}`
      : outcome.id,
  );
  toast(`Duplicated ${item?.title ?? "the note"}`);
  autosave.changed();
}

/** A gesture of the 3D view written (`scene-edits.ts`): one step; a
 *  refusal is said. */
function commitSceneEdit(edit: GestureEdit): void {
  if (editor === null) return;
  endUndo();
  const outcome = applySceneEdit(editor, edit);
  say(null);
  refresh();
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  autosave.changed();
}

/** The cover choices' thumbnails, let go when the dialog closes. */
let coverUrls: string[] = [];

function releaseCoverThumbs(): void {
  for (const url of coverUrls) URL.revokeObjectURL(url);
  coverUrls = [];
}

/** One cover choice: a radio with its picture (or "None") and its name. */
function coverChoice(
  id: string,
  label: string,
  checked: boolean,
): { choice: HTMLLabelElement; thumb: HTMLElement } {
  const choice = document.createElement("label");
  choice.className = "cover-choice";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "details-cover";
  radio.value = id;
  radio.checked = checked;
  const thumb = document.createElement("span");
  thumb.className = "cover-thumb";
  const name = document.createElement("span");
  name.className = "cover-label";
  name.textContent = label;
  choice.append(radio, thumb, name);
  return { choice, thumb };
}

/** The cover picker: "None" and the tour's photos, `chosen` chosen. */
function showCovers(chosen: string | null): void {
  releaseCoverThumbs();
  coverList.replaceChildren();
  const choices = editor?.coverChoices() ?? [];
  coversNone.hidden = choices.length > 0;
  const none = coverChoice("", "None", chosen === null);
  none.thumb.textContent = "No cover";
  coverList.append(none.choice);
  const open = photos.current() ?? session;
  for (const c of choices) {
    const title = model?.items.find((i) => i.id === c.id)?.title ?? c.id;
    const { choice, thumb } = coverChoice(c.id, title, c.id === chosen);
    coverList.append(choice);
    if (open === null) continue;
    const urls = coverUrls;
    void open
      .loadContentEntry(c.image)
      .then((blob) => {
        // A dialog closed (or opened again) meanwhile has let go of these.
        if (urls !== coverUrls) return;
        const url = URL.createObjectURL(blob);
        coverUrls.push(url);
        const img = document.createElement("img");
        img.className = "cover-thumb";
        img.alt = "";
        img.src = url;
        thumb.replaceWith(img);
      })
      .catch(() => {
        thumb.textContent = "No preview";
      });
  }
}

/** The page's other parts while a dialog shows (`page-inert.ts`): its
 *  focus stays in the dialog (M4a review #12). */
function holdOutside(backdrop: HTMLElement): () => void {
  return holdPageInert(
    [...document.body.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && el !== backdrop && el.tagName !== "SCRIPT",
    ),
  );
}

/** The open dialog's hold on the rest of the page, until it closes. */
let releaseOutside: (() => void) | null = null;

/** The tour's details (W2), from the name in the top bar. */
const details = wireDetailsDialog({
  dom: {
    backdrop: element("details-modal"),
    form: element<HTMLFormElement>("details-form"),
    name: element<HTMLInputElement>("details-name"),
    description: element<HTMLTextAreaElement>("details-description"),
    contact: element<HTMLInputElement>("details-contact"),
    error: element("details-error"),
    cancel: element<HTMLButtonElement>("details-cancel"),
  },
  current: () =>
    editor?.details() ?? {
      name: "",
      description: "",
      cover: null,
      contact: "",
    },
  showCovers,
  chosenCover: () => {
    const checked = coverList.querySelector<HTMLInputElement>(
      'input[name="details-cover"]:checked',
    );
    return checked === null || checked.value === "" ? null : checked.value;
  },
  apply: (next) =>
    editor?.setDetails(next) ?? {
      kind: "refused",
      reason: "No tour is open.",
    },
  onApplied: (kind) => {
    if (kind === "changed") endUndo();
    refresh();
    toast(kind === "changed" ? DETAILS_CHANGED : DETAILS_UNCHANGED);
    if (kind === "changed") autosave.changed();
  },
  onClose: () => {
    releaseOutside?.();
    releaseOutside = null;
    releaseCoverThumbs();
    coverList.replaceChildren();
    if (!topbar.hidden) tourName.focus();
  },
});

/** The tour's details dialog: from the tour's name, and from the 3D
 *  view's pencil. */
function openDetails(): void {
  if (editor === null || ui().busy) return;
  // Typing in the card is committed first: the dialog shows the tour as it
  // stands.
  card.commit();
  details.open();
  releaseOutside = holdOutside(element("details-modal"));
}

tourName.addEventListener("click", openDetails);

/** Where a key goes to a field's own undo (typing in the card, a dialog,
 *  the search): the page's undo stays out of it. */
/** One of the page's dialogs shows. */
function dialogOpen(): boolean {
  return !modal.hidden || details.isOpen() || done.isOpen();
}

function inField(at: EventTarget | null): boolean {
  return (
    at instanceof HTMLElement &&
    (at.isContentEditable ||
      at instanceof HTMLInputElement ||
      at instanceof HTMLTextAreaElement ||
      at instanceof HTMLSelectElement)
  );
}

/** Whether `event` is the letter `letter` with Ctrl (or Cmd) and no Alt:
 *  by the key's letter, so Dvorak's and Colemak's work; by its position
 *  only where the layout's letter is not Latin (E2b-1 review #6). */
function commandKey(event: KeyboardEvent, letter: string): boolean {
  const byLetter =
    event.key.toLowerCase() === letter ||
    (event.code === `Key${letter.toUpperCase()}` &&
      !/^[a-z]$/i.test(event.key));
  return (event.ctrlKey || event.metaKey) && !event.altKey && byLetter;
}

/** Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y on the page (W2); whether the key was
 *  the page's. Inside a field, and over a dialog, they are left alone. */
function undoKeys(event: KeyboardEvent): boolean {
  const z = commandKey(event, "z");
  const y = commandKey(event, "y");
  if (!z && !y) return false;
  if (inField(event.target) || dialogOpen()) return true;
  event.preventDefault();
  runStep(y || event.shiftKey ? "redo" : "undo");
  return true;
}

function showModal(on: boolean): void {
  modal.hidden = !on;
  // Cancel returns to the open tour; with none there is nothing to return to.
  cancelButton.hidden = session === null;
  if (on) openError.hidden = true;
  // An autosave held while the dialog showed may start now, and so may a
  // resave (D33).
  else {
    autosave.poke();
    void resaveIfDue();
  }
}

/** Leaving would lose edits: changes not saved, or a save not delivered. */
function unsavedWork(): boolean {
  return (
    saving() ||
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
  if (commandKey(event, "s")) {
    event.preventDefault();
    if (modal.hidden) void runSave(askSaveFile());
    return;
  }
  if (undoKeys(event)) return;
  if (event.key !== "Escape") return;
  if (details.isOpen()) {
    details.close();
    return;
  }
  if (done.isOpen()) {
    done.close();
    return;
  }
  if (ui().moving !== null) {
    cancelMove();
    return;
  }
  if (!modal.hidden && session !== null && !ui().busy) showModal(false);
  else select(null);
});

function setBusy(on: boolean, text: string): void {
  store.dispatch(editorViewActions.busyChanged({ busy: on }));
  sampleButton.disabled = on;
  zipInput.disabled = on;
  chooseButton.disabled = on;
  linkInput.disabled = on;
  linkButton.disabled = on;
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
  openedFile = null;
  autosave.stop();
  stopResaveTimer();
  refusalToast = null;
  store.dispatch(
    editorViewActions.walkChanged({ keepsWalk: false, openedWalk: false }),
  );
  for (const t of fileToasts.splice(0)) t.remove();
  photos.clear();
  debugLayer?.stop();
  debugLayer = null;
  tourWalk = null;
  forgetAddedDebug();
  debugPanel.hidden = true;
  debugSwitch.hidden = true;
  debugStatus.textContent = "";
}

/** The open tour's debug layer: view state only, never in the tour
 *  document, a save or the draft. */
let debugLayer: DebugLayer | null = null;
/** The opened file, when it carries a walk: the layer's source unless
 *  debug data was added. */
let tourWalk: TourSession | null = null;
/** Debug data added beside the tour ("Add debug data…", M2 step 5 of the
 *  debug-captures plan): a second, read-only archive. Never saved, never
 *  drafted, gone at a reload (Q-H) and with the tour. */
let addedDebug: {
  readonly session: TourSession;
  readonly line: string;
} | null = null;
/** "Add debug data…" while an add reads its file: disabled, saying so,
 *  and a second add starts nothing (`createAddDebugButton`). */
const debugAdd = createAddDebugButton(debugAddButton, studioDebugAddDom());

/** The 3D view's top bar's "Add debug data" as the add drives it: its
 *  name says what it does or that it is adding, its short word too. */
function studioDebugAddDom(): AddDebugButtonDom {
  const label = studioDebugAdd.querySelector(".lbl");
  return {
    get disabled() {
      return studioDebugAdd.disabled;
    },
    set disabled(on: boolean) {
      studioDebugAdd.disabled = on;
    },
    get textContent() {
      return studioDebugAdd.getAttribute("aria-label");
    },
    set textContent(text: string | null) {
      const adding = text === ADD_DEBUG_LABELS.adding;
      studioDebugAdd.setAttribute("aria-label", text ?? "");
      if (label !== null) label.textContent = adding ? "Adding…" : "Debug data";
    },
  };
}

/** Where the debug layer reads (one seam, so a point cloud reads the
 *  same place): debug data added wins over the tour's own walk - the
 *  creator chose it - and its line says which it shows; null when there
 *  is neither. */
function debugSource(): {
  readonly source: TourSession;
  readonly loadPicture: (image: string) => Promise<Blob>;
  readonly line: string | null;
} | null {
  if (addedDebug !== null) {
    const added = addedDebug.session;
    return {
      source: added,
      loadPicture: (image) => added.loadEntry(image),
      line: addedDebug.line,
    };
  }
  const walk = tourWalk;
  if (walk === null) return null;
  return {
    source: walk,
    // From the copy the page reads now: the opened file stops reading
    // once a save rewrote it (as the card's photos, E2b plan review #2).
    loadPicture: (image) => (photos.current() ?? walk).loadEntry(image),
    line: null,
  };
}

/** The added debug data goes, its archive closed. */
function forgetAddedDebug(): void {
  const was = addedDebug;
  addedDebug = null;
  if (was !== null) void was.session.close().catch(() => undefined);
}

/**
 * Show the debug camera captures of `debugSource()`, after the tour
 * opened: the join replays the walk once (`debugCapturesOf`), then a
 * thumbnail per capture is decoded, one at a time. Shown by default; the
 * switch hides them. A tour closed meanwhile, or a source replaced, stops
 * it. With no source the panel offers only "Add debug data…".
 */
function startDebugLayer(): void {
  debugLayer?.stop();
  debugLayer = null;
  const from = debugSource();
  debugSwitch.hidden = from === null;
  debugStatus.textContent = from?.line ?? "";
  if (from === null) return;
  debugInput.checked = true;
  const layer = createDebugCaptureLayer<HTMLElement>({
    read: (options) => debugCapturesOf(from.source, options),
    loadPicture: from.loadPicture,
    pictureProblem,
    thumbnail: decodeDebugThumbnail,
    view: {
      draw: (captures) => {
        map.debugDraw(captures);
      },
      thumb: (image, picture) => {
        map.debugThumb(image, picture);
      },
      visible: (on) => {
        map.debugVisible(on);
      },
      clear: () => {
        map.debugClear();
      },
    },
    status: (line) => {
      debugStatus.textContent =
        from.line === null ? line : `${from.line} ${line}`;
    },
    discard: revokeDebugThumbnail,
  });
  debugLayer = layer;
  void layer.start();
}

/**
 * "Add debug data…" (M2 step 5 of the debug-captures plan): a debug
 * bundle or a plain Recorder zip, opened as any zip is (its archive caps,
 * and the picture cap for its thumbnails), read for whose it is
 * (`readDebugBundle`, `bundleMatchesTour`) and shown in place of the
 * tour's own walk. Another tour's is shown with a line saying so (Q-C);
 * a file that is no debug data is refused in words, the layer kept. The
 * button says it is reading meanwhile (the async-UI rule).
 */
async function addDebugData(file: File): Promise<void> {
  const mine = editor;
  if (mine === null) return;
  await debugAdd.run(async () => {
    const added = await readAddedDebug(
      file,
      mine.debugTour(),
      tourWalk !== null,
    );
    if (editor !== mine) {
      // Another tour opened meanwhile: this file is not its debug data.
      if (added.kind === "added") {
        void added.session.close().catch(() => undefined);
      }
      return;
    }
    if (added.kind === "refused") {
      fileToasts.push(toast(notAddedLine(added.reason)));
      return;
    }
    forgetAddedDebug();
    addedDebug = { session: added.session, line: added.line };
    startDebugLayer();
  });
}

/** A file added as debug data, opened and read for whose it is, or why
 *  not; a refused file's archive is closed. */
async function readAddedDebug(
  file: File,
  tour: DebugBundleTour,
  tourCarriesWalk: boolean,
): Promise<
  | {
      readonly kind: "added";
      readonly session: TourSession;
      readonly line: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
> {
  let opened: TourSession;
  try {
    opened = await openTourFile(file);
  } catch (err) {
    return {
      kind: "refused",
      reason: `${file.name} could not be read (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
  const read = await readDebugBundle(
    opened.entries.map((e) => e.filename),
    (name) => opened.loadEntry(name),
    {
      sizeOf: (name) => opened.entries.find((e) => e.filename === name)?.size,
    },
  );
  if (read.kind === "refused") {
    void opened.close().catch(() => undefined);
    return { kind: "refused", reason: read.reason };
  }
  return {
    kind: "added",
    session: opened,
    line: addedDebugLine({
      fileName: file.name,
      match: bundleMatchesTour(read, tour),
      identity: read.kind === "bundle" ? read.identity : null,
      tourCarriesWalk,
    }),
  };
}

/** What this page keeps of the tour beside the store's document (whose
 *  save status an open or a close resets). */
function resetEditing(): void {
  endUndo();
  store.dispatch(editorViewActions.moveEnded());
  moved.clear();
  say(null);
  setUndelivered(null);
  delete saveStatus.dataset["saved"];
}

/** The tour is gone (a late integrity failure): nothing of it stays on
 *  screen, and the dialog says why. */
function dropTour(reason: string): void {
  details.close();
  // Closed even while a move runs: its tour is gone.
  done.close(true);
  viewSwitch.close();
  viewSwitch.setEnabled(false);
  select(null);
  const open = session;
  session = null;
  editor = null;
  model = null;
  fileKey = null;
  tourDraft = null;
  draft.close();
  store.dispatch(tourDocumentActions.closed());
  resetEditing();
  leaveFile();
  void open?.close().catch(() => undefined);
  topbar.hidden = true;
  renderTourName();
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
  store.dispatch(editorViewActions.walkChanged({ keepsWalk: true }));
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
      // Written in place from now on, so it saves by itself too (edits made
      // before the target came are saved once the delay has passed) -
      // unless every save of it would rewrite more than the cap (E2b-2
      // milestone review #3: the cost is linear in the file's size).
      const largeTour = !autosaveFits(file.size, autosaveMaxBytes);
      store.dispatch(tourDocumentActions.saveLimited({ largeTour }));
      autosave.enable(!largeTour);
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
  /** The handle the file was picked through, writable or not. */
  picked: FileSystemHandle | null = handle,
): Promise<boolean> {
  if (ui().busy) return false;
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
  details.close();
  done.close(true);
  // The 3D view showed the tour that goes now.
  viewSwitch.close();
  linkHost = null;
  select(null);
  const previous = session;
  session = outcome.session;
  viewSwitch.setEnabled(true);
  void previous?.close().catch(() => undefined);
  resetEditing();
  leaveFile();
  openedFile = { name: outcome.fileName, handle: picked };
  fileKey = outcome.session.archive.url;
  const writes = draft.writes();
  tourDraft = writes;
  const opened = outcome.session;
  editor = createEditorSession({
    session: outcome.session,
    manifest: outcome.manifest,
    levels: outcome.levels,
    fileName: outcome.fileName,
    // A station's pose is locked until the inspector unlocks it: the
    // session refuses its moves, whichever control asked.
    stationLocked: (id) => isStationLocked(ui(), id),
    // A deleted photo's picture, from the copy the page reads now (the
    // opened file stops reading once something else rewrote it), for an
    // undo after a save took it out (W2).
    loadPhoto: (image) => (photos.current() ?? opened).loadContentEntry(image),
    // Bound to this tour: once another opens, this session's late writes
    // are dropped (E2c review #6).
    draft: writes,
    // The page's store: the document the views read (D29).
    store,
  });
  model = editor.model();
  openedLevels = outcome.levels;
  // The debug data switch only for a tour that carries a walk (S-D10:
  // the saved copy leaves it out unless asked, E2 plan review #4), and
  // unticked (M2 of the debug-captures plan, E2): the walk is saved apart.
  // A file opened to be written keeps its walk whatever the switch says
  // (`keepsWalk`, `attachTarget`).
  const carriesWalk =
    scanEntryNames(
      outcome.session.entries.map((e) => e.filename),
      outcome.manifest,
      outcome.session.manifestWrap,
    ).length > 0;
  keepWalkInput.checked = false;
  keepWalk.hidden = !carriesWalk;
  store.dispatch(editorViewActions.walkChanged({ openedWalk: carriesWalk }));
  renderTourName();
  element("tour-file").textContent = outcome.fileName;
  topbar.hidden = false;
  showModal(false);
  rail.render(model);
  // A narrow window starts with the rail folded, as the prototype does.
  if (window.innerWidth < NARROW_PX) rail.collapse(true);
  const free = freeArea();
  map.show(model, { left: free.left, top: free.top });
  renderNoGps();
  renderSaveState();
  toast(`Opened ${outcome.fileName}: ${openedSummary(model)}`);
  sayNoBackup();
  keepStorage();
  // Details, station descriptions and card images the reader dropped are
  // said, never lost silently by the next save (M4a review #6); kept until
  // closed, as an instruction.
  for (const line of [
    droppedDetailsLine(outcome.dropped),
    droppedStationFieldsLine(outcome.dropped, outcome.manifest),
  ]) {
    if (line !== null) fileToasts.push(toast(line, undefined, null));
  }
  if (drafted.superseded !== null) {
    fileToasts.push(toast(drafted.superseded, undefined, null));
  }
  if (drafted.offer !== null) offerDraft(editor, drafted.offer);
  if (handle !== null) void attachTarget(editor, handle, file);
  // After the open, never before it: the replay must not hold up the tour.
  tourWalk = carriesWalk ? opened : null;
  debugPanel.hidden = false;
  startDebugLayer();
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
          if (applied.changed + applied.deleted > 0) endUndo();
          refresh();
          toast(restoredLine(applied.changed + applied.deleted, offer));
          // Restored work is pending work: saved by itself like any edit.
          if (applied.changed + applied.deleted > 0) autosave.changed();
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
  if (ui().busy || ui().picking) return;
  store.dispatch(editorViewActions.pickingChanged({ picking: true }));
  const outcome = await pickTourFile(window as unknown as PickerWindow).finally(
    () => {
      store.dispatch(editorViewActions.pickingChanged({ picking: false }));
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
    outcome.handle,
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
    store.dispatch(tourDocumentActions.saveLimited({ cannotSave: true }));
    renderSaveState();
    refusalToast?.remove();
    refusalToast = toast(
      draft.backsUp()
        ? `Not saved to ${name}. ${why} This page can no longer read the file it opened, so these edits cannot be saved here - but this browser keeps a copy of them. Open the file again and they are offered back, if the change on disk left the notes you edited in it and the file is still the same tour (one built on a walk recording, or a listed tour, stays the same; a tour of notes alone does not).`
        : `Not saved to ${name}. ${why} This page can no longer read the file it opened, so these edits cannot be saved here. Open the file again to go on editing it.`,
      undefined,
      null,
    );
    fileToasts.push(refusalToast);
    return;
  }
  // One refusal on screen: an autosave's and then Save's say the same.
  refusalToast?.remove();
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
        // Downloads from now on: nothing to write in place by itself.
        autosave.enable(false);
        void runSave();
      },
    },
    null,
  );
  refusalToast = t;
  fileToasts.push(t);
}

/** Photos read from what was written from now on (E2b plan review #2),
 *  one copy opened at a time (`photo-copy.ts`). */
function readPhotosFrom(mine: EditorSession, written: File): Promise<void> {
  return photos.use(written, () => editor === mine);
}

/** Hand a zip to the browser as a download (or its save dialog); whether
 *  it arrived. */
async function download(file: {
  readonly blob: Blob;
  readonly filename: string;
}): Promise<boolean> {
  try {
    return await downloadZip(file.blob, file.filename);
  } catch {
    return false;
  }
}

/**
 * Deliver `save`: written over the opened file where the page may (the
 * file then backs the next rebuild and the photos), else downloaded. A
 * refused or failed in-place write keeps the save for "Save again" and
 * offers the download - unless `offerDownload` is false (the walk's move,
 * whose dialog says the refusal: the M4b milestone review #6 - its
 * "Download instead" downloaded nothing and detached the file); the
 * refusal's words come back as `refusal`.
 */
async function deliver(
  mine: EditorSession,
  save: EditorSave,
  into: SaveTarget | null,
  writes: EditorTourDraft | null,
  offerDownload = true,
  /** The file the first Save of a tour without one asked for in its
   *  click (`askSaveFile`): written here, and then adopted. */
  pick: Promise<SaveFilePick> | null = null,
): Promise<{
  arrived: boolean;
  inPlace: boolean;
  refusal?: string;
  /** The picked file the save was written into (to adopt). */
  chosen?: FileSystemFileHandle;
}> {
  if (into === null && pick !== null) {
    const picked = await pick;
    // Dismissed: nothing written, the save kept for "Save again".
    if (picked.kind === "cancelled") return { arrived: false, inPlace: false };
    if (picked.kind === "picked") {
      return writeChosen(mine, save, picked.handle, writes);
    }
    // No dialog after all (the browser refused it): the download below.
  }
  if (into === null) {
    const arrived = await download(save);
    if (arrived) {
      const saved = new File([save.blob], save.filename, {
        type: "application/zip",
      });
      // The first save of a tour without an id writes one, so the file it
      // makes opens under the id's key (Q-I): the draft follows it there,
      // or an edit made after the download is not offered by that file.
      // Unreadable (never for a zip this page built): the draft stays.
      const savedKey = await tourFileKeyOfFile(saved).catch(() => null);
      if (editor === mine && savedKey !== null && savedKey !== fileKey) {
        writes?.moved(savedKey);
        fileKey = savedKey;
      }
      await readPhotosFrom(mine, saved);
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
  } catch (err) {
    const refusal =
      err instanceof InPlaceRefusal
        ? err.message
        : `It could not be written: ${err instanceof Error ? err.message : String(err)}.`;
    if (offerDownload) refuseInPlace(mine, into.name, refusal, true);
    return { arrived: false, inPlace: true, refusal };
  }
  // The write landed: what follows can no longer make it "not written"
  // (the M4b fix re-review #4).
  if (editor === mine && writtenKey !== null) {
    // A no-op once another tour's draft began to open (review #1).
    writes?.landed(save.written, writtenKey);
    fileKey = writtenKey;
  }
  // The photos read from this page's copy of what it wrote, never from
  // the file on disk: once something else rewrites that file, a File
  // read from it no longer reads. The copy is the one the next rebuild
  // starts from anyway (the download path holds the same).
  await readPhotosFrom(
    mine,
    new File([save.blob], save.filename, { type: "application/zip" }),
  ).catch(() => undefined);
  return { arrived: true, inPlace: true };
}

/**
 * Write `save` into the file the first Save asked for (`deliver`): the
 * draft follows the written bytes as an in-place write's does, since the
 * file becomes the tour's own (`adoptChosen`). A failed write keeps the
 * save for "Save again" and says why.
 */
async function writeChosen(
  mine: EditorSession,
  save: EditorSave,
  handle: FileSystemFileHandle,
  writes: EditorTourDraft | null,
): Promise<{
  arrived: boolean;
  inPlace: boolean;
  chosen?: FileSystemFileHandle;
}> {
  const written = new File([save.blob], save.filename, {
    type: "application/zip",
  });
  const writtenKey = await tourFileKeyOfFile(written).catch(() => fileKey);
  try {
    await writeFileOrAbort(handle, save.blob);
  } catch (err) {
    if (editor === mine) {
      fileToasts.push(
        toast(
          `Not saved: ${handle.name} could not be written (${err instanceof Error ? err.message : String(err)}). Save again to choose a file.`,
          undefined,
          null,
        ),
      );
    }
    return { arrived: false, inPlace: false };
  }
  if (editor === mine && writtenKey !== null) {
    writes?.landed(save.written, writtenKey);
    fileKey = writtenKey;
  }
  await readPhotosFrom(mine, written).catch(() => undefined);
  return { arrived: true, inPlace: true, chosen: handle };
}

/**
 * The file the first Save wrote becomes the tour's: saved into in place
 * from now on, and by itself, as a file opened with "Choose..." is
 * (`attachTarget`). "Save the debug data" then refuses it as the tour
 * file it is.
 */
async function adoptChosen(
  mine: EditorSession,
  handle: FileSystemFileHandle,
): Promise<void> {
  let file: File;
  try {
    file = await handle.getFile();
  } catch {
    // Saved all the same; the next Save asks again.
    return;
  }
  if (editor !== mine) return;
  openedFile = { name: handle.name, handle };
  element("tour-file").textContent = handle.name;
  await attachTarget(mine, handle, file);
}

/**
 * The first Save of a tour without a file to save into (from a link, the
 * sample, a drop or the file input) asks where to save it - IN the click,
 * before any await: Chromium opens the dialog only within a few seconds of
 * a click, and the build can take longer (the walk's move's rule). Null
 * where there is nothing to ask: no tour, a file to save into (or one the
 * page may not write: that stays a download), nothing to save, a save
 * running, or a browser that does not adopt (`adoptsSavedFile`: none on
 * Android until a phone check).
 */
function askSaveFile(): Promise<SaveFilePick> | null {
  const mine = editor;
  if (
    mine === null ||
    target !== null ||
    (openedFile?.handle ?? null) !== null ||
    saving() ||
    !unsavedWork() ||
    !adoptsSavedFile(
      window as unknown as PickerWindow & SavePickerWindow,
      navigator,
    )
  ) {
    return null;
  }
  return pickSaveFile(window as unknown as SavePickerWindow, mine.savedName());
}

/** Whether the browser was asked to keep this site's storage (once). */
let storageAsked = false;

/** At the first open, ask the browser to keep this site's storage (the
 *  drafts of unsaved work) from being cleared to make room. A refusal
 *  changes nothing: the drafts are written either way. */
function keepStorage(): void {
  if (storageAsked) return;
  storageAsked = true;
  void requestPersistentStorage();
}

/** A save whose tour was closed meanwhile ends quietly; the open tour's
 *  page shows its own state. */
function abandon(): AutosaveOutcome {
  releaseSave();
  // Its tour is closed: nothing of it runs next - a Ctrl+S queued behind it
  // was pressed for a tour that no longer shows (E2b-2 milestone review #7).
  store.dispatch(tourDocumentActions.saveQueued({ queued: false }));
  renderSaveState();
  return "held";
}

/**
 * The explicit Save (the button, Ctrl+S, "Download instead"). Asked for
 * while an autosave runs, it waits for it and runs next; what it comes to
 * tells the autosave (a landed save ends a pause, a failed one pauses it).
 * `pick`: the file its click asked for (`askSaveFile`), if any.
 */
async function runSave(
  pick: Promise<SaveFilePick> | null = null,
): Promise<void> {
  if (editor === null) return;
  if (saving()) {
    if (saveState().by === "auto") {
      // Committed now, saved right after the autosave that runs.
      card.commit();
      if (ui().moving !== null) finishMove();
      store.dispatch(tourDocumentActions.saveQueued({ queued: true }));
    }
    return;
  }
  const mine = editor;
  const outcome = await saveTour("explicit", pick);
  if (editor !== mine || outcome === "held") return;
  if (outcome === "saved") autosave.saved();
  else autosave.failed();
}

/**
 * Build and deliver one save. `auto` is the autosave's: it commits
 * nothing (it never runs while a field is typed in or a marker moved), ends
 * no undo (it never runs during one), and says only in the status line
 * that it saved; it gives itself back as `held` when an edit began while
 * it checked the file, before the session took its snapshot.
 */
async function saveTour(
  mode: "explicit" | "auto",
  pick: Promise<SaveFilePick> | null = null,
): Promise<AutosaveOutcome> {
  if (editor === null || saving()) return "held";
  // A save belongs to the tour it started on: one opened meanwhile must not
  // receive it (E2a review #5). Claimed FIRST: the commit and the undo's
  // end below poke the autosave, which must find this save running.
  const mine = editor;
  const ended = claimSave(mode);
  try {
    if (mode === "explicit") {
      card.commit();
      if (ui().moving !== null) finishMove();
    }
    if (mine.changeCount() === 0 && undelivered === null) {
      releaseSave();
      renderSaveState();
      if (mode === "explicit") {
        showSaveStatus("clean", "Nothing to save");
        // Said where a click's answer is looked for too (plan
        // 2026-10-15-0348 M0): the status line already read "No changes",
        // so the swap alone looked like nothing happened.
        toast(NOTHING_TO_SAVE);
      }
      return "saved";
    }
    return await buildAndDeliver(mine, mode, pick);
  } finally {
    // Every path above has said its own state; this only lets go - and
    // never a save of a tour opened meanwhile.
    if (editor === mine) releaseSave();
    ended();
    if (saveState().queued && editor === mine && !saving()) {
      store.dispatch(tourDocumentActions.saveQueued({ queued: false }));
      void runSave();
    }
    // A step that crossed the file while this save wrote it (D33).
    if (editor === mine) void resaveIfDue();
    // A save that fell due while this autosave ran starts now. Not after
    // an explicit save: `runSave` tells the autosave its outcome first,
    // and a failed one must pause it, not start it (milestone review #5).
    if (mode === "auto") autosave.poke();
  }
}

/** Where a save arrived: the status line's words, and Done's facts. */
function noteDelivered(
  inPlace: boolean,
  into: SaveTarget | null,
  save: EditorSave,
  /** The file the first Save asked for, written in place of `into`. */
  chosen?: FileSystemFileHandle,
): void {
  const name =
    chosen?.name ?? (inPlace ? (into?.name ?? save.filename) : save.filename);
  store.dispatch(tourDocumentActions.saveDelivered({ inPlace, name }));
  // A view of the slice's `delivered` (the e2e reads it), never read back.
  const line = savedLine();
  if (line !== null) saveStatus.dataset["saved"] = line;
}

/** Where the last save arrived, in the status line's words; null while
 *  nothing was saved (the slice's `delivered`, which an open resets). */
function savedLine(): string | null {
  const delivered = saveState().delivered;
  if (delivered === null) return null;
  return delivered.inPlace
    ? `Saved to ${delivered.name}`
    : `Saved as ${delivered.name}`;
}

async function buildAndDeliver(
  mine: EditorSession,
  mode: "explicit" | "auto",
  pick: Promise<SaveFilePick> | null = null,
): Promise<AutosaveOutcome> {
  renderSaveState();
  // This tour's draft writes, taken before the first await (review #1).
  const writes = tourDraft;
  // Checked BEFORE the build too: the build reads the opened file, which
  // something else's write makes unreadable (E2b plan review #4).
  const into = target;
  if (into !== null) {
    const state = await into.check().catch(() => "same" as const);
    if (editor !== mine) return abandon();
    if (state !== "same") {
      releaseSave();
      renderSaveState();
      refuseInPlace(
        mine,
        into.name,
        new InPlaceRefusal(state).message,
        saveState().built,
      );
      return "failed";
    }
  }
  // An edit began while the file was checked (typing, a move): the
  // session would snapshot it half made - the autosave waits (E2b plan
  // review #3).
  if (mode === "auto" && editing()) {
    releaseSave();
    renderSaveState();
    return "held";
  }
  try {
    const save =
      undelivered !== null && mine.changeCount() === 0
        ? undelivered
        : // In place the walk always stays: the file written over may be
          // the creator's only copy of it (E2b plan review #1).
          await mine.save({
            keepScan: ui().keepsWalk || keepWalkInput.checked,
            inPlace: into !== null,
          });
    if (editor !== mine) return abandon();
    if (save !== undelivered) {
      // A build's versions are this browser's own work, delivered or not
      // (E2c plan review #1).
      writes?.built(save.written);
    }
    store.dispatch(tourDocumentActions.saveBuilt());
    // A later save rebuilds from this one's bytes, so the walk switch can
    // no longer change anything (the phone's rule, E2a review #1).
    keepWalk.hidden = true;
    // The target this save was checked against, even if "Edit here
    // anyway" attached one while it was built (E2b-1 review #1).
    const { arrived, inPlace, chosen } = await deliver(
      mine,
      save,
      into,
      writes,
      true,
      pick,
    );
    if (editor !== mine) return abandon();
    setUndelivered(arrived ? null : save);
    if (arrived) {
      // A move made during the save is still pending: its line stays.
      const pending = new Set(mine.pendingIds());
      for (const id of [...moved]) if (!pending.has(id)) moved.delete(id);
      say(null);
      noteDelivered(inPlace, into, save, chosen);
      if (chosen !== undefined) void adoptChosen(mine, chosen);
    }
    // Quiet: an autosave says it saved in the status line only (it is
    // always in place, which keeps the walk, so the result has nothing
    // more to say).
    if (arrived && mode === "explicit") {
      // The Finish's own result sentences (E2a review #2). A download
      // that left the walk out says to save it first, and offers that
      // save: it reads the opened file, which putting the copy in its
      // place overwrites (r901 review #1).
      const words = savedToastWords({
        inPlace,
        name:
          chosen?.name ??
          (inPlace ? (into?.name ?? save.filename) : save.filename),
        leftOut: save.scanLeftOut.length,
      });
      const saved = toast(
        words.text,
        words.offerDebugSave
          ? { label: SAVE_DEBUG_LABELS.idle, run: saveDebugFromToast }
          : undefined,
        // The download's result carries an instruction; in place it does not.
        inPlace ? UNDO_MS : null,
      );
      if (words.offerDebugSave) fileToasts.push(saved);
    }
    releaseSave();
    refresh();
    return arrived ? "saved" : "failed";
  } catch (err) {
    if (editor !== mine) return abandon();
    // The opened file changed on disk before any save (a sync client, an
    // other program): its bytes no longer read (E2b-1 review #4).
    const said =
      err instanceof DOMException && err.name === "NotReadableError"
        ? "Not saved: the opened file changed on disk and can no longer be read - open it again"
        : `Not saved: ${err instanceof Error ? err.message : String(err)}`;
    releaseSave(said);
    renderSaveState();
    showSaveStatus("error", said);
    saveButton.disabled = false;
    return "failed";
  }
}

saveButton.addEventListener("click", () => {
  void runSave(askSaveFile());
});
// The debug layer's switch: view state only - no edit, nothing pending.
debugInput.addEventListener("change", () => {
  debugLayer?.setVisible(debugInput.checked);
});
// "Add debug data…": its file input, or a file dropped on the panel. The
// document's own drop guard keeps the browser from opening the file.
for (const button of [debugAddButton, studioDebugAdd]) {
  button.addEventListener("click", () => {
    debugAddInput.click();
  });
}
debugAddInput.addEventListener("change", () => {
  const file = debugAddInput.files?.[0];
  debugAddInput.value = "";
  if (file !== undefined) void addDebugData(file);
});
debugPanel.addEventListener("dragover", (event) => {
  event.preventDefault();
  debugPanel.classList.add("over");
});
debugPanel.addEventListener("dragleave", () => {
  debugPanel.classList.remove("over");
});
debugPanel.addEventListener("drop", (event) => {
  event.preventDefault();
  debugPanel.classList.remove("over");
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) void addDebugData(file);
});
// A tour-level edit (QR-first M1b-2): pending like a note's, backed up by
// the draft, saved by itself like any change.
noGpsInput.addEventListener("change", () => {
  if (editor === null) return;
  const outcome = editor.setNeedsNoGps(noGpsInput.checked);
  renderNoGps();
  renderSaveState();
  if (outcome.kind === "changed") {
    endUndo();
    autosave.changed();
  }
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
  if (ui().busy) return;
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
// A hosted tour, from its link (tour editor plan 2026-10-17-1816, W1): the
// viewer's transport fetches it whole, then it opens as a chosen file does
// (no file handle: Save downloads the new copy).
linkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (ui().busy) return;
  const link = linkInput.value;
  openError.hidden = true;
  setBusy(true, "Fetching the tour from its link…");
  fetchTourFile(link, {
    corsProxyBaseUrl: driveProxyBaseUrl(location.hostname),
  })
    .then(async (file) => {
      setBusy(false, "");
      // Done names the host the tour was fetched from (W2).
      if (await openFile(file)) linkHost = hostOfLink(link);
    })
    .catch((err: unknown) => {
      setBusy(false, "");
      openError.textContent = linkOpenErrorText(err, link);
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

/** Said when Done's save did not land: the dialog waits for it. */
const DONE_NOT_SAVED =
  "Not done yet: your changes are not saved (the line beside Save says why). Save them, then press Done again.";

/** The host Done's steps start with: the link's the tour came from, else
 *  the one chosen in the setup's step 1, else Google Drive. */
function doneHost(): TourHost {
  let stored: TourHost | null = null;
  try {
    stored = readTourHost(window.localStorage);
  } catch {
    // Site data blocked: no stored choice.
  }
  return linkHost ?? stored ?? "drive";
}

/** Where the changes are, for Done. */
function doneSaved(): DoneSaved {
  const delivered = saveState().delivered;
  if (delivered !== null) {
    return delivered.inPlace
      ? { kind: "in-place", name: delivered.name }
      : { kind: "downloaded", name: delivered.name };
  }
  return {
    kind: "unchanged",
    name: target?.name ?? element("tour-file").textContent ?? "",
  };
}

/** "Done" (W2): what is pending is saved first - the button says so while
 *  it runs (the async-UI rule) - then the dialog opens; a save that did not
 *  land keeps it shut and says why. */
async function finishEditing(): Promise<void> {
  if (
    editor === null ||
    ui().busy ||
    ui().doneBusy ||
    walkMoving() ||
    dialogOpen()
  ) {
    return;
  }
  const mine = editor;
  card.commit();
  if (ui().moving !== null) finishMove();
  // In the click, before any await: the save dialog needs it.
  const pick = askSaveFile();
  if (unsavedWork()) {
    store.dispatch(editorViewActions.doneBusyChanged({ busy: true }));
    doneButton.disabled = true;
    doneButton.textContent = "Saving…";
    try {
      // An autosave that runs ends first (and one queued behind it).
      await savesSettled();
      if (editor === mine && unsavedWork()) await runSave(pick);
      await savesSettled();
    } finally {
      store.dispatch(editorViewActions.doneBusyChanged({ busy: false }));
      doneButton.textContent = "Done";
      doneButton.disabled = editor === null;
    }
    if (editor !== mine) return;
    if (unsavedWork()) {
      toast(DONE_NOT_SAVED);
      return;
    }
  }
  // A check that fails says the file may carry the walk, never that it
  // does not (the M4b milestone review #9).
  const walk = await mine.walkEntries().catch(() => null);
  if (editor !== mine || dialogOpen()) return;
  done.open({
    saved: doneSaved(),
    host: doneHost(),
    carriesWalk: walk === null ? "unknown" : walk.length > 0,
    // A file opened for writing keeps its walk (`keepsWalk`): only a save
    // as a new file can leave it out.
    debugLeftOut:
      ui().openedWalk && !ui().keepsWalk && walk !== null && walk.length === 0,
    driveMountTip: DRIVE_MOUNT_TIP_SHOWN,
  });
  releaseOutside = holdOutside(element("done-modal"));
}

/**
 * "Move the debug data out" (W2, D19): the debug bundle (`debug-bundle.ts`,
 * M2 of the debug-captures plan) is written first, then the tour without it - in place, or downloaded - and only once both
 * landed does the session take the walk-free bytes as its newest; a failed
 * write of either leaves the tour file as it was. The move holds the
 * page's save (`claimSave`): every save waits, and Done with it.
 *
 * The walk's file is asked for with the browser's save dialog IN the
 * click, before anything is awaited: Chromium opens it only within a few
 * seconds of a click, and the build takes longer (the M4b milestone review
 * #2). Where there is no such dialog the walk is downloaded, and the tour
 * is rewritten only on a second click - a download that started is not one
 * that landed.
 */
function moveWalk(): Promise<WalkMoveOutcome> {
  const mine = editor;
  if (mine === null || session === null) {
    return Promise.resolve({ kind: "refused", reason: "No tour is open." });
  }
  if (saving()) return Promise.resolve(SAVE_RUNS);
  // First, before any await: the dialog needs the click.
  const pick = pickSaveFile(
    window as unknown as SavePickerWindow,
    debugBundleFileName(mine.savedName()),
  );
  return holdForMove(mine, () => buildMove(mine, pick));
}

/**
 * "Save the debug data" (M2 of the debug-captures plan): after a save as a
 * new file left the walk out, the opened file still carries it, and the
 * debug bundle is built from it (`EditorSession.debugData`) - the newest
 * bytes have none. The file is asked for IN the click, as the move's
 * (`pickSaveFile`); without a save dialog it is downloaded. Nothing of the
 * tour changes, so it holds no save.
 */
function saveDebugData(): Promise<DebugSaveOutcome> {
  const mine = editor;
  if (mine === null) {
    return Promise.resolve({ kind: "refused", reason: "No tour is open." });
  }
  const source = openedFile;
  // First, before any await: the dialog needs the click.
  const pick = pickSaveFile(
    window as unknown as SavePickerWindow,
    debugBundleFileName(mine.savedName()),
  );
  return (async (): Promise<DebugSaveOutcome> => {
    const picked = await pick;
    if (editor !== mine || picked.kind === "cancelled") {
      return { kind: "cancelled" };
    }
    // The opened file chosen: the bundle would land over the file it is
    // read from, and the walk would be in neither (r901 review #5, the
    // move's rule). Refused before anything is read or written.
    if (
      picked.kind === "picked" &&
      ((source !== null && (await isSameFile(source, picked.handle))) ||
        (await target?.isSame(picked.handle)) === true)
    ) {
      return {
        kind: "refused",
        reason: `${picked.handle.name} has the name of the tour file you opened - save the debug data under another name, so it cannot land over the tour. Nothing was written.`,
      };
    }
    if (editor !== mine) return { kind: "cancelled" };
    const unused =
      picked.kind === "picked"
        ? ` Nothing was written into ${picked.handle.name}; if the save dialog created it as a new, empty file, delete it.`
        : "";
    let built: Awaited<ReturnType<EditorSession["debugData"]>>;
    try {
      built = await mine.debugData();
    } catch (err) {
      return {
        kind: "refused",
        reason: `The debug data was not saved: ${err instanceof Error ? err.message : String(err)}.${unused}`,
      };
    }
    if (editor !== mine) return { kind: "cancelled" };
    if (built.kind === "refused") {
      return { kind: "refused", reason: `${built.reason}${unused}` };
    }
    if (picked.kind === "picked") {
      try {
        await writeFileOrAbort(picked.handle, built.blob);
      } catch (err) {
        return {
          kind: "refused",
          reason: `The debug data could not be written into ${picked.handle.name} (${err instanceof Error ? err.message : String(err)}).`,
        };
      }
      return { kind: "saved", name: picked.handle.name };
    }
    if (!(await download(built))) return { kind: "cancelled" };
    return { kind: "saved", name: built.filename };
  })();
}

/** The lean download toast's "Save the debug data": the same save as
 *  the Done dialog's, its progress on the button, its result in a toast
 *  (the async-UI rule). Called in the click: the save dialog needs it. */
function saveDebugFromToast(button: HTMLButtonElement): void {
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = SAVE_DEBUG_LABELS.saving;
  const mine = editor;
  void saveDebugData()
    .catch((err: unknown): DebugSaveOutcome => ({
      kind: "refused",
      reason: `The debug data was not saved: ${err instanceof Error ? err.message : String(err)}.`,
    }))
    .then((outcome) => {
      button.disabled = false;
      button.textContent =
        outcome.kind === "saved"
          ? SAVE_DEBUG_LABELS.again
          : SAVE_DEBUG_LABELS.idle;
      if (editor !== mine) return;
      fileToasts.push(toast(debugSaveResultLine(outcome), undefined, null));
    });
}

const SAVE_RUNS: WalkMoveOutcome = {
  kind: "refused",
  reason: "A save is running - move the debug data once it has finished.",
};

/** Run one step of a move holding the page's save (review #1): Done is
 *  disabled meanwhile, and its wait ends with it. */
async function holdForMove(
  mine: EditorSession,
  step: () => Promise<WalkMoveOutcome>,
): Promise<WalkMoveOutcome> {
  const ended = claimSave("walk");
  renderSaveState();
  try {
    return await step();
  } catch (err) {
    if (editor !== mine) return { kind: "cancelled" };
    return {
      kind: "refused",
      reason: `The debug data was not moved: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    // Let go whatever happened to the tour: a claim left set would hold
    // every later save.
    releaseSave();
    ended();
    if (editor === mine) {
      refresh();
      autosave.poke();
    } else {
      renderSaveState();
    }
  }
}

async function buildMove(
  mine: EditorSession,
  pick: Promise<SaveFilePick>,
): Promise<WalkMoveOutcome> {
  const picked = await pick;
  if (editor !== mine || picked.kind === "cancelled") {
    return { kind: "cancelled" };
  }
  const into = target;
  // The tour file itself chosen for the walk: the walk's zip would land
  // over the tour, whose own write is then refused - leaving the tour's
  // content nowhere (the M4b fix re-review #1). Refused before any write.
  if (
    picked.kind === "picked" &&
    into !== null &&
    (await into.isSame(picked.handle))
  ) {
    return {
      kind: "refused",
      reason: `${into.name} is the tour itself - save the debug data under another name. Nothing was written, so the tour keeps its debug data.`,
    };
  }
  if (editor !== mine) return { kind: "cancelled" };
  /** Said after the dialog gave a file and nothing was written into it:
   *  the browser may have created it empty (the re-review #5). */
  const unused =
    picked.kind === "picked"
      ? ` Nothing was written into ${picked.handle.name}; if the save dialog created it as a new, empty file, delete it.`
      : "";
  if (into !== null) {
    const state = await into.check().catch(() => "same" as const);
    if (editor !== mine) return { kind: "cancelled" };
    if (state !== "same") {
      return {
        kind: "refused",
        reason: `${new InPlaceRefusal(state).message} The tour keeps its debug data.${unused}`,
      };
    }
  }
  const move = await mine.moveWalkOut();
  if (editor !== mine) return { kind: "cancelled" };
  if (move.kind === "refused") {
    return { kind: "refused", reason: `${move.reason}${unused}` };
  }
  if (picked.kind === "picked") {
    try {
      await writeFileOrAbort(picked.handle, move.walk.blob);
    } catch (err) {
      return {
        kind: "refused",
        reason: `The debug data could not be written into ${picked.handle.name} (${err instanceof Error ? err.message : String(err)}), so the tour keeps it.`,
      };
    }
    if (editor !== mine) return { kind: "cancelled" };
    const walkName = picked.handle.name;
    // No file to write the tour into (a sample, a link, a file input): its
    // download waits for a fresh click - the walk's write has used up the
    // click's window, and a download after it falls back unseen (the M4b
    // fix re-review #2).
    if (into === null) {
      return {
        kind: "walk-saved",
        walkName,
        confirm: secondClick(mine, move, into, walkName),
      };
    }
    return writeMovedTour(mine, move, into, walkName);
  }
  if (!(await download(move.walk))) return { kind: "cancelled" };
  if (editor !== mine) return { kind: "cancelled" };
  const walkName = move.walk.filename;
  return {
    kind: "downloaded",
    walkName,
    confirm: secondClick(mine, move, into, walkName),
  };
}

/** The move's second click: a fresh one, which a download of the tour
 *  needs too. */
function secondClick(
  mine: EditorSession,
  move: WalkMove,
  into: SaveTarget | null,
  walkName: string,
): () => Promise<WalkMoveOutcome> {
  return () => {
    if (editor !== mine) return Promise.resolve({ kind: "cancelled" });
    if (saving()) return Promise.resolve(SAVE_RUNS);
    return holdForMove(mine, () => writeMovedTour(mine, move, into, walkName));
  };
}

/** The walk is in its own file: write the tour without it, then make that
 *  the session's newest bytes. */
async function writeMovedTour(
  mine: EditorSession,
  move: WalkMove,
  into: SaveTarget | null,
  walkName: string,
): Promise<WalkMoveOutcome> {
  const name = into?.name ?? move.save.filename;
  // A save landed between the two clicks: this move's tour would drop it.
  if (!move.current()) {
    return {
      kind: "refused",
      reason: `${name} was saved meanwhile, so the debug data was not taken out of it - move it again.`,
    };
  }
  tourDraft?.built(move.save.written);
  const { arrived, inPlace, refusal } = await deliver(
    mine,
    move.save,
    into,
    tourDraft,
    false,
  );
  if (editor !== mine) return { kind: "cancelled" };
  if (!arrived) {
    return {
      kind: "refused",
      reason: `${walkName} was saved, but ${name} could not be written${refusal === undefined ? "" : ` (${refusal})`}, so the tour keeps its debug data.`,
    };
  }
  move.commit(inPlace);
  // Moved out into a file of its own: nothing is left to offer to save.
  store.dispatch(editorViewActions.walkChanged({ openedWalk: false }));
  store.dispatch(tourDocumentActions.saveBuilt());
  keepWalk.hidden = true;
  setUndelivered(null);
  noteDelivered(inPlace, into, move.save);
  return { kind: "moved", walkName, tourName: name, saved: doneSaved() };
}

const doneHostSelect = element<HTMLSelectElement>("done-host");
for (const host of TOUR_HOSTS) {
  const option = document.createElement("option");
  option.value = host.id;
  option.textContent = host.label;
  doneHostSelect.append(option);
}

const done = wireDoneDialog({
  dom: {
    backdrop: element("done-modal"),
    where: element("done-where"),
    host: doneHostSelect,
    update: element("done-update"),
    publicLine: element("done-public"),
    walk: element("done-walk"),
    walkText: element("done-walk-text"),
    moveButton: element<HTMLButtonElement>("done-move"),
    saveDebugButton: element<HTMLButtonElement>("done-save-debug"),
    moveStatus: element("done-move-status"),
    driveTip: element("done-drive-tip"),
    close: element<HTMLButtonElement>("done-close"),
  },
  moveWalk,
  saveDebugData,
  onClose: () => {
    releaseOutside?.();
    releaseOutside = null;
    if (!topbar.hidden) doneButton.focus();
  },
});

doneButton.addEventListener("click", () => {
  void finishEditing();
});

// What Save does in this browser (W2): a chosen file is written in place
// only where the file picker exists.
element("open-fineprint").textContent = saveFinePrint(
  window as unknown as PickerWindow & SavePickerWindow,
  navigator,
);

/**
 * The view switch (`view-switch.ts`): the 3D view over the map. Its code
 * is imported here, at the click, never before; it reads the tour and the
 * selection from the store, and its photos and models from the copy the
 * page reads now. A failure is said and kept until closed (the async-UI
 * rule: the creator asked for something that did not happen), or until a
 * later open shows the view: then it says what is no longer so.
 */
const view3dBox = element("view3d");
let view3dFailureToast: HTMLElement | null = null;

/** A content entry of the open tour, from the copy the page reads now. */
function readContent(name: string): Promise<Blob> {
  const open = photos.current() ?? session;
  if (open === null) return Promise.reject(new Error("no tour is open"));
  return open.loadContentEntry(name);
}

/** The open tour's codes for the 3D view's tree and inspector: the
 *  phone's numbering and lines, and each one's stored position and print
 *  size as opened. */
function shellCodes(): InspectorCode[] {
  return (model?.items ?? [])
    .filter((item) => item.kind === "code")
    .map((item) => {
      const qr = openedLevels.get(item.id)?.qr;
      return {
        id: item.id,
        title: item.title,
        meta: item.meta,
        geo: qr?.geo ?? null,
        printSizeM: qr?.physicalSizeM ?? null,
      };
    });
}

/** The 3D view's studio shell (`editor-shell/`): the tree, the inspector,
 *  the map controls and the bottom bar, while the 3D view shows. Its
 *  selection is the page's (`select`), so the map follows it. */
const shell = createEditorShell({
  store,
  select: (id) => {
    select(id);
  },
  step: runStep,
  openDetails,
  codes: shellCodes,
  loadPicture: readContent,
  dialogOpen,
});
const viewSwitch = createViewSwitch({
  button: element<HTMLButtonElement>("view-switch"),
  store,
  open: async (events) => {
    // A module that does not arrive is the connection's (`chunk`).
    const { openEditor3d } =
      await import("../editor3d/editor3d-scene.js").catch((error: unknown) => {
        throw Object.assign(
          new Error(`the 3D view did not load: ${String(error)}`),
          { reason: "chunk" },
        );
      });
    const view = await openEditor3d({
      container: view3dBox,
      credits: element("view3d-credits"),
      store,
      levels: () => openedLevels,
      loadContent: readContent,
      events,
      edits: {
        commit: commitSceneEdit,
        select: (id) => {
          select(id);
        },
        remove: deleteSelection,
        duplicate: (id) => {
          void duplicateSelection(id);
        },
        say: (text) => {
          toast(text);
        },
        keysFree: (event) =>
          !inField(event.target) &&
          !dialogOpen() &&
          Boolean(modal.hidden) &&
          !ui().busy,
      },
    });
    shown3d = view;
    const handle: View3dHandle = {
      dispose: () => {
        if (shown3d === view) shown3d = null;
        view.dispose();
      },
    };
    return handle;
  },
  say: (text) => {
    view3dFailureToast?.remove();
    view3dFailureToast = toast(text, undefined, null);
    fileToasts.push(view3dFailureToast);
  },
  onShown: (on) => {
    view3dBox.hidden = !on;
    // The page's look follows the view: the studio's dark shell in 3D
    // (`editor-shell.css`), the paper map page otherwise.
    document.body.dataset["view"] = on ? "3d" : "2d";
    // Covered by the 3D view, the map's markers and controls leave the
    // tab order and the accessibility tree.
    mapBox.inert = on;
    if (on && shown3d !== null) shell.show(shown3d);
    else shell.hide();
    if (on) {
      view3dFailureToast?.remove();
      view3dFailureToast = null;
    }
    // The card and its chip belong to the map; back on it, they return.
    showCard();
  },
});
// Nothing to show in 3D until a tour is open.
viewSwitch.setEnabled(session !== null);

// Everything above is wired: the open dialog's controls answer from here
// on (a keyboard press before the module ran would go nowhere - the e2e
// waits for this).
document.body.dataset["editor"] = "ready";
