/**
 * The desktop editor's page (`/tour/edit.html`): the composition root.
 * Opens a tour (a file chosen or dropped, or the sample), shows it in the
 * 3D view on the globe - the editor itself (`view3d-opener.ts`; the 3D
 * view's code, `src/editor3d/`, is a dynamic import made only then) - and
 * edits it: undo and redo of every edit (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y),
 * and a Save that downloads the tour to put in place of the old file - or,
 * where the browser allows it (Chromium's file picker), writes the opened
 * file in place - by itself too, a few seconds after a change
 * (`autosave.ts`). The tour's name in the top bar opens its details
 * (`details-dialog.ts`). The top bar's File menu opens, saves, saves
 * a copy, adds debug data and "Share and publish…" (it says where the
 * changes are and what is left to do, and moves the walk out,
 * `done-dialog.ts`); its View menu holds the 3D view's commands
 * (`menu-button.ts`). The save status is the bottom bar's, with a mark
 * beside File while changes are not saved. Where the 3D view cannot open,
 * a page of its own says why and keeps the File actions within reach
 * (`view3d-failed-page.ts`). A tour whose file carries a walk shows its
 * debug camera captures on the globe once it has opened
 * (`debug-capture-layer.ts`; debug data, never the tour's content), behind
 * View's "Show debug data". Linked from the setup page's "You already have
 * a tour?" box and its step 5 on a device without AR.
 *
 * @see edit-main.ts.md
 */

import {
  tourChildPlace,
  tourStories,
  type TourStory,
} from "gps-plus-slam-app-framework/ar/tour-story";
import {
  downloadZip,
  requestPersistentStorage,
  writeFileOrAbort,
} from "gps-plus-slam-app-framework/storage";
import { createTourViewerStore } from "../tour-viewer-session.js";
import {
  editorViewActions,
  editorViewReducer,
  isEntryIdle,
  isStationLocked,
  selectEditorView,
  type EditorViewState,
} from "./editor-view.js";
import { DRAFT_DELETING } from "../draft-edit-gate.js";
import { createDraftOffer, type DraftOfferView } from "./draft-offer.js";
import { selectTourDraft, tourDraftActions } from "../tour-draft-slice.js";
import {
  childMoveChange,
  manifestToWrite,
  selectTourDocument,
  stationDeleteRefusal,
  tourDocumentActions,
  type TourSaveHolder,
  type TourSaveStatus,
} from "../tour-document.js";
import type { ChildMoveTo } from "../station-children-moves.js";
import { stationMoveQuestion } from "./station-move-question.js";
import { describeIntegrityError, olderFormatRefusal } from "../open-errors.js";
import { debugCapturesOf, type DebugCapture } from "../debug-captures.js";
import { pictureProblem } from "../image-cap.js";
import {
  isFileAddKind,
  KIND_EDIT,
  kindNoun,
  kindWithArticle,
  type AddKind,
  type FileAddKind,
} from "../kinds/edit-kinds.js";
import { objectTitle } from "../object-describe.js";
import { scanEntryNames } from "../tour-read-set.js";
import { openDraftStore } from "../draft-store-root.js";
import { DRAFT_PART_UNREAD } from "../tour-document-draft.js";
import {
  openTourFile,
  tourFileKeyOfFile,
  type TourSession,
} from "../tour-session.js";
import {
  createDebugCaptureLayer,
  decodeDebugThumbnail,
  revokeDebugThumbnail,
  type DebugLayer,
} from "./debug-capture-layer.js";
import {
  debugLayerActions,
  debugLayerReducer,
  selectDebugLayer,
} from "./debug-layer-slice.js";
import { createDebugThumbs } from "./debug-thumbs.js";
import { walkAfterDraw, walkAtLayerStart } from "./tour-walk-kept.js";
import {
  FOLDER_PREFIX,
  STATION_PREFIX,
  STORY_PREFIX,
  selectedStationOf,
  type EditorModel,
} from "./editor-model.js";
import {
  createFolderCommands,
  folderName,
  plainFolderOf,
} from "./folder-commands.js";
import { NEW_STATION_PLACE } from "./editor-shell/add-palette-model.js";
import { storyRows } from "./editor-shell/tree-model.js";
import { applyPlaceEdit, type PlaceEdit } from "../placement/place-edits.js";
import { askMove, moveNote } from "../move-question.js";
import { confirmPausingFrames } from "./browser-question.js";
import {
  copyOf,
  cutGone,
  cutOf,
  type PasteOutcome,
  pasteOf,
} from "./clipboard.js";
import { EDIT_STILL_RUNNING, isHeld, runHeldEdit } from "./held-edit-flow.js";
import {
  openedNoticeLines,
  openTourForEditing,
  showOpenedNotices,
} from "./editor-open.js";
import {
  createStatusLines,
  createMenuButton,
  menuItemControl,
  setItemDisabled,
  inComposite,
  inField,
  inMenu,
  type GroundPlace,
} from "gps-plus-slam-editor-kit/chrome";
import {
  doneHostedName,
  fetchTourFile,
  linkFileName,
  linkHostedName,
  linkOpenErrorText,
} from "./editor-link.js";
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
import { placeToasts, toastSpot } from "./toast-spot.js";
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
  assetPlaces,
  TOUR_COVER_SELECTION,
} from "./asset-shelf/asset-places.js";
import { createShelfPageActions } from "./asset-shelf/shelf-page-actions.js";
import { undoTap } from "./undo-offer.js";
import {
  selectShelfRows,
  shelfRowUses,
} from "./asset-shelf/asset-shelf-slice.js";
import {
  createShelfPanel,
  type ShelfPanel,
} from "./asset-shelf/shelf-panel.js";
import {
  shelfSqueezed,
  shelvedWords,
} from "./asset-shelf/shelf-panel-model.js";
import {
  TOUR_HOSTS,
  hostOfLink,
  readTourHost,
  type TourHost,
} from "../tour-host.js";
import {
  AUTOSAVE_MAX_BYTES,
  autosaveFits,
  createAutosave,
  type AutosaveDeps,
  type AutosaveOutcome,
} from "gps-plus-slam-app-framework/storage/autosave";
import {
  childCalled,
  copyFileName,
  createEditorSession,
  EDITOR_SESSION_SLICES,
  datedFileName,
  type EditorHeld,
  type EditorSave,
  type EditorSession,
  type NarrationChange,
} from "./editor-session.js";
import type { StepKind } from "./story-step-edits.js";
import { videoLookOf } from "./video-poster.js";
import { waitForSaveSlot } from "gps-plus-slam-app-framework/storage/save-slot-wait";
import { guardSlidersIn } from "gps-plus-slam-app-framework/utils/slider-scroll-guard";
import {
  bundleMatchesTour,
  debugBundleFileName,
  readDebugBundle,
  type DebugBundleTour,
} from "../debug-bundle.js";
import {
  addedDebugLine,
  createAddDebugButton,
  notAddedLine,
} from "./added-debug-data.js";
import {
  classifyEditorFile,
  classifyEditorFiles,
  type EditorFileKind,
} from "./classify-editor-file.js";
import {
  addScanSafely,
  entryStepLine,
  notOpenedLine,
  openWithScan,
  type AddScanOutcome,
  type OpenWithScanOutcome,
} from "./editor-entry.js";
import { startNewTour } from "./new-tour.js";
import {
  SHOW_SCAN_AGAIN_LABELS,
  createScanMemory,
  indexedDbHandleStore,
  type HandleStore,
  reopenScan,
  runShowScanAgain,
  scanRememberedLine,
  type ScanHandle,
} from "./scan-memory.js";
import {
  EMPTY_GLOBE_HINT,
  NEW_TOUR_SAVE_QUESTION,
  editorStartActions,
  editorStartReducer,
  scanKeptInsteadLine,
  selectEditorStart,
  sortScanPick,
  sortTourPick,
  startCardView,
  type StartFrom,
} from "./start-card.js";
import { noGpsWarnings } from "./no-gps-check.js";
import { createView3dOpener, type View3dHandle } from "./view3d-opener.js";
import { wireView3dFailedPage } from "./view3d-failed-page.js";
import {
  createEditorShell,
  type TypedEditOutcome,
} from "./editor-shell/editor-shell.js";
import {
  inspectorWriteCommands,
  writeTypedEdit,
  type SessionWrite,
} from "./after-edit.js";
import { escapeAction, holdOutside } from "./editor-modals.js";
import { addNewCharacter, addNewItem } from "./new-pin.js";
import {
  createCharacterLibrary,
  type CharacterLibrary,
} from "../characters/character-library.js";
import { opfsLibraryStore } from "../characters/opfs-library-store.js";
import {
  createCharactersPanel,
  type CharactersPanelTour,
} from "./characters-panel.js";
import { tourFileId } from "./tour-files.js";
import {
  addFileItem,
  FILE_ADD_FAILED,
  FILE_NOT_KEPT,
  placeFileItem,
  type FileAddTarget,
} from "./add-file-item.js";
import { createFilePicker } from "./file-picker.js";
import { createStoryPreview } from "./story-preview.js";
import {
  dragHasFiles,
  FILE_FIELD_ATTR,
  fileAddKindOf,
  fileAddKindOfAsset,
  fileDropTarget,
  leftoverTarget,
  type FileDropTarget,
} from "./file-drop.js";
import {
  useInChoices,
  useInTarget,
  type UseInTarget,
} from "./asset-shelf/use-in-choices.js";
import { importDelivery } from "./model-convert/import-delivery.js";
import { planImport } from "./model-convert/import-plan.js";
import { fileBlockOf } from "./editor-shell/inspector-file.js";
import { blockFileKind } from "../block-file.js";
import { fileItemTitle, type FileItemSource } from "./new-file-item.js";
import { newObjectId } from "../content-placement.js";
import type { InspectorCode } from "./editor-shell/inspector-model.js";
import { stationTitle } from "../station-run.js";
import {
  folderDeleteQuestion,
  stationDeleteQuestion,
  storyDeleteQuestion,
} from "./delete-questions.js";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import type {
  Editor3dDeps,
  Editor3dStats,
  Editor3dView,
} from "../editor3d/editor3d-view.js";
import {
  globeQualityChoiceLabel,
  globeQualityChoiceToast,
  nextGlobeQualityChoice,
  qualityToOpenWith,
  readGlobeQualityChoice,
  writeGlobeQualityChoice,
} from "./globe-quality-choice.js";
import { readGlobeSwitch } from "./globe-switch.js";
import {
  adoptsSavedFile,
  createSaveTarget,
  holdEditorDraftLock,
  holdEditorLock,
  isSameFile,
  pickSaveFile,
  releaseUnusedPick,
  pickScanFile,
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
import { startErrorReporting } from "gps-plus-slam-app-framework/utils/sentry-options";

// Error reporting starts in this module's first statement (production builds
// only; the sentry-test page flag sends one harmless test report). ES imports
// run first, so an error thrown while an imported module loads is not
// reported. What a report may carry: the framework's utils/sentry-options.ts.md.
startErrorReporting({
  app: "tour-viewer",
  prod: import.meta.env.PROD,
});

// A vertical swipe that starts on a slider scrolls its panel (a phone).
guardSlidersIn(document);

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

/**
 * Where scans are remembered: the browser's IndexedDB, except in the dev
 * server an e2e may set `window.__tourEditorScanStore` (an init script),
 * because a real file handle read back from IndexedDB crashes the headless
 * test browsers. Inert in a production build, as `autosaveSettings`.
 */
function scanStore(): HandleStore | null {
  if (import.meta.env.DEV && !import.meta.env.VITEST) {
    const set = (window as { __tourEditorScanStore?: HandleStore })
      .__tourEditorScanStore;
    if (set !== undefined) return set;
  }
  return indexedDbHandleStore(
    typeof indexedDB === "undefined" ? undefined : indexedDB,
  );
}

/**
 * The globe view's approach for the next 3D open, or undefined for none:
 * set when a tour opens without a draft to restore (a restored draft goes
 * straight to the tour), taken by the first 3D open after it. In the dev
 * server an e2e may set `window.__tourEditorApproach` (an init script):
 * `{ off: true }` opens at the tour as before, `{ durationMs }` sets the
 * flight's length. Inert in a production build.
 */
let approachNext = false;
function takeApproach(): { durationMs?: number } | undefined {
  const due = approachNext;
  approachNext = false;
  if (!due) return undefined;
  if (import.meta.env.DEV && !import.meta.env.VITEST) {
    const knob = (
      window as {
        __tourEditorApproach?: { off?: boolean; durationMs?: number };
      }
    ).__tourEditorApproach;
    if (knob?.off === true) return undefined;
    const positive = (v: unknown): v is number =>
      typeof v === "number" && v > 0;
    return positive(knob?.durationMs) ? { durationMs: knob.durationMs } : {};
  }
  return {};
}

/** The tour's own recorded walk as its debug layer last drew it, for the
 *  3D view's walk: one array per drawing, so the view sees a new walk by
 *  its identity. Debug data added from elsewhere never sets it (it may be
 *  another tour's walk); null while none is drawn. */
let walkGeo: readonly DebugCapture["geo"][] | null = null;

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
  editorStart: editorStartReducer,
  debugLayer: debugLayerReducer,
  ...EDITOR_SESSION_SLICES,
});

/** The page's chrome state (`editorView`): what is selected and in
 *  flight. */
function ui(): EditorViewState {
  return selectEditorView(store.getState());
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
const openStatus = element("open-status");
const openError = element("open-error");
const cancelButton = element<HTMLButtonElement>("open-cancel");
// The start card (start-card.ts): question 1's answers, the tour picker,
// question 2's scan, and the one button that opens the editor.
const startAnswers = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="start-from"]'),
);
const startTourStep = element("start-tour-step");
const startTourHeld = element("start-tour-held");
const startScanStep = element("start-scan-step");
const startScanHeld = element("start-scan-held");
const startScanButton = element<HTMLButtonElement>("start-scan-btn");
const startScanRemove = element<HTMLButtonElement>("start-scan-remove");
const startScanInput = element<HTMLInputElement>("start-scan-input");
const startSummary = element("start-summary");
const startOpen = element<HTMLButtonElement>("start-open");
/** The tour picker's title while no tour file is held. */
const TOUR_PICK_TITLE = "Choose the tour file (.zip)";
const topbar = element("topbar");
/** The tour's name in the top bar: it opens the tour's details (W2). */
const tourName = element<HTMLButtonElement>("tour-name");
/** The name's words inside its button (the pen beside them stays). */
const tourNameText = element("tour-name-text");
const coverList = element("details-covers");
const coversNone = element("details-covers-none");
const toasts = element("toasts");
/** The docked panels' elements, held from the start: docked, a panel
 *  behind another tab is out of the page, where a lookup by id finds
 *  nothing. */
const shellTree = element("shell-tree");
const shellShelf = element("shell-shelf");
const shellInspector = element("shell-inspector");
/** The File menu's Save (`edit.html`; the menu: `menu-button.ts`). */
const saveButton = element<HTMLButtonElement>("file-save");
/** "Save a copy…": the tour as it stands into a file of its own. */
const saveCopyButton = element<HTMLButtonElement>("file-save-copy");
/** "Share and publish…" (W2, once "Done"): saves what is pending, then
 *  opens its dialog. */
const doneButton = element<HTMLButtonElement>("file-publish");
const fileDetailsButton = element<HTMLButtonElement>("file-details");
/** "Characters…": the tour's characters and the ones on this device. */
const fileCharactersButton = element<HTMLButtonElement>("file-characters");
const fileMenuButton = element<HTMLButtonElement>("file-menu-btn");
const saveStatus = element("save-status");
/** The mark beside File while changes are not saved (the status's words
 *  are the bottom bar's). */
const unsavedMark = element("unsaved-mark");
/** The bottom bar: the save status in both views. */
const shellBar = element("shell-bar");
/** "Keep the debug data in the tour file", a checkbox item of File. */
const keepWalk = element<HTMLButtonElement>("file-keep-walk");
/** The debug layer's switch (View's "Show debug data") and its line
 *  (`debug-capture-layer.ts`). */
const debugPanel = element("debug-panel");
const debugSwitch = element<HTMLButtonElement>("view-debug");
/** The View menu's Real time: the globe view's clock (the globe view only). */
const realTimeSwitch = element<HTMLButtonElement>("view-realtime");
/** The View menu's Clouds: the globe view's heavy clouds (the globe view only). */
const cloudsSwitch = element<HTMLButtonElement>("view-clouds");
/** The View menu's Quality: the tier of the next globe view's open. */
const qualitySwitch = element<HTMLButtonElement>("view-quality");
const debugStatus = element("debug-status");
/** "Add debug data…" and its file input (M2 step 5 of the debug-captures
 *  plan). */
const debugAddButton = element<HTMLButtonElement>("debug-add");
const debugAddInput = element<HTMLInputElement>("debug-add-input");
/** File's "Add debug data…": the same add as the debug panel's button. */
const fileDebugAdd = element<HTMLButtonElement>("file-debug-add");

/** A checkbox item's state (`aria-checked`). */
function isChecked(item: HTMLElement): boolean {
  return item.getAttribute("aria-checked") === "true";
}

function setChecked(item: HTMLElement, on: boolean): void {
  item.setAttribute("aria-checked", String(on));
}

/** The top bar's File, Edit and View menus (`menu-button.ts`); Edit is
 *  the 3D view's, at a phone's width (its items are the shell's). */
createMenuButton({
  button: fileMenuButton,
  menu: element("file-menu"),
});
createMenuButton({
  button: element<HTMLButtonElement>("edit-menu-btn"),
  menu: element("edit-menu"),
});
createMenuButton({
  button: element<HTMLButtonElement>("view-menu-btn"),
  menu: element("view-menu"),
});
/** The tour's "needs no GPS" setting in Tour details, and its warnings'
 *  live region: never hidden (an empty one is zero-height), and its lines
 *  replaced only when their words change, so a refresh does not announce
 *  the same warning again. */
const detailsNoGpsInput = element<HTMLInputElement>("details-no-gps");
const detailsNoGpsLines = createStatusLines(
  element("details-no-gps-warnings"),
  (line) => {
    const p = document.createElement("p");
    p.className = "note-line warn";
    p.textContent = line;
    return p;
  },
);

let session: TourSession | null = null;
/** The written file, for the tour's photos once a save replaced the bytes
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
/** Scans remembered in this browser by tour id: where the file is (its
 *  handle), never its bytes, never in the tour (`scan-memory.ts`). */
const scanMemory = createScanMemory(scanStore());
/** The handle a picked file came through, keyed by the File (a side
 *  table: files and handles are resources, never store state). A scan
 *  added with one is remembered; one dropped or given through a file
 *  input has none. */
const scanHandles = new WeakMap<File, ScanHandle>();
let editor: EditorSession | null = null;

/** The character maker's library on this device, opened once. */
let characterLibrary: Promise<CharacterLibrary> | null = null;
function characterLibraryNow(): Promise<CharacterLibrary> {
  characterLibrary ??= opfsLibraryStore().then((libraryStore) =>
    createCharacterLibrary(libraryStore),
  );
  characterLibrary.catch(() => {
    characterLibrary = null;
  });
  return characterLibrary;
}

/** The open tour as the Characters list sees it: each change one step,
 *  told to the autosave like any edit. */
function charactersTour(): CharactersPanelTour | null {
  const open = editor;
  if (open === null) return null;
  const changed = <T>(out: T): T => {
    refresh();
    tourChanged();
    return out;
  };
  return {
    characters: () => open.characters(),
    declare: async (input) => {
      endUndo();
      return changed(await open.declareCharacter(input));
    },
    fileId: async (file) =>
      tourFileId(new Uint8Array(await file.arrayBuffer())),
    remove: (id) => {
      endUndo();
      return changed(open.removeCharacter(id));
    },
    restore: (character) => {
      endUndo();
      return changed(open.restoreCharacter(character));
    },
    image: (id) => open.characterImage(id),
    title: () => open.details().name,
  };
}

/** The Characters list (File, "Characters…") and the maker over the
 *  editor (`characters-panel.ts`). */
const characters = createCharactersPanel({
  dom: {
    panel: element<HTMLDialogElement>("characters-panel"),
    close: element<HTMLButtonElement>("characters-close"),
    tourList: element<HTMLUListElement>("characters-tour"),
    tourCount: element("characters-tour-count"),
    pickup: element("characters-pickup"),
    libList: element<HTMLUListElement>("characters-lib"),
    libStatus: element("characters-lib-status"),
    make: element<HTMLButtonElement>("characters-make"),
    importButton: element<HTMLButtonElement>("characters-import"),
    importFile: element<HTMLInputElement>("characters-import-file"),
    importError: element("characters-import-error"),
    importAsk: element("characters-import-ask"),
    manage: element<HTMLButtonElement>("characters-manage"),
    toasts: element("characters-toasts"),
    undoBox: element("characters-undo"),
    maker: element<HTMLDialogElement>("characters-maker"),
    makerFrame: element<HTMLIFrameElement>("characters-maker-frame"),
    makerBack: element<HTMLButtonElement>("characters-maker-back"),
    makerTour: element("characters-maker-tour"),
  },
  tour: charactersTour,
  library: characterLibraryNow,
  makerUrl: "./characters.html",
  makerShown: (shown) => {
    shown3d?.setPaused(shown);
  },
  say: (text) => {
    toast(text);
  },
});
/** The open tour's codes as opened (the 3D view draws them; read-only). */
let openedLevels: ReadonlyMap<string, QrLevel> = new Map();
/** The 3D view while it shows (the opener holds its handle too). */
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
/** The open delete's Undo toast, until it times out or a newer edit
 *  comes. */
let undoOffer: { toast: HTMLElement; timer: number } | null = null;
/** The quiet time after the last step, before its resave (D33). */
let resaveTimer: number | null = null;
/** The last in-place refusal's toast: a new one takes its place. */
let refusalToast: HTMLElement | null = null;
/** The host of the link the open tour was fetched from, if it was. */
let linkHost: TourHost | null = null;
/** The name of the file at that link (`linkHostedName`; null: the link
 *  names none), which Done tells the creator to upload under; undefined
 *  for a tour not fetched from a link. */
let linkHosted: string | null | undefined;
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

/** Edits being made that a save must not cut into: a delete's undo while
 *  its toast offers it, a gesture of the 3D view, an inspector field being
 *  typed in (`shell.dirty`). The delete reaches the file only once its
 *  Undo has lapsed: an undo after the save that wrote it still works in
 *  this tab (the edit stack), but a draft does not bring the note back
 *  after a closed tab (`editor-draft.ts` places nothing new). */
function editing(): boolean {
  return undoOffer !== null || ui().gesture !== null || shell.dirty();
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
 * name). `edit(write)` runs one through the inspector's own commit path
 * (`writeInspectorEdit`: a delete's Undo offer ended first, then the
 * refresh, a refusal toasted, the autosave told) and answers the
 * session's outcome kind. `edited()` only follows edits the e2e already
 * made (an async one, or several at once): the refresh and the autosave
 * told, with no Undo offer ended, so it is for setup with no delete toast
 * up, where the two paths do the same: with one up it throws rather than
 * diverge from the page. Inert in
 * a production build: `import.meta.env.DEV` is statically false there, so
 * the hook is stripped (`seams.ts`'s guarantee).
 */
if (import.meta.env.DEV && !import.meta.env.VITEST) {
  (
    window as {
      __tourEditor?: {
        editor: () => EditorSession | null;
        edit: (
          write: (session: EditorSession) => { readonly kind: string },
        ) => string;
        edited: () => void;
        view3d: () => Editor3dStats | null;
        view3dTilt: (deg: number) => void;
        view3dDistance: (m: number) => void;
        view3dHeading: (deg: number) => void;
        view3dBuildings: (on: boolean) => void;
        view3dPointOf: (
          selection: string,
        ) => readonly [number, number, number] | null;
        view3dScreenOf: (selection: string) => readonly [number, number] | null;
        view3dUnder: (
          x: number,
          y: number,
        ) => { readonly pick: string | null; readonly onDisc: boolean } | null;
        view3dHandle: (
          part: "middle" | "knob" | "dot",
        ) => readonly [number, number] | null;
        view3dGizmoSizes: () => ReturnType<Editor3dView["gizmoSizes"]>;
        view3dModelParts: () => ReturnType<Editor3dView["modelParts"]> | null;
        view3dFolderOutlines: () => ReturnType<
          Editor3dView["folderOutlines"]
        > | null;
        view3dModelScreen: (
          id: string,
          at: readonly [number, number, number],
        ) => readonly [number, number] | null;
        view3dSoundIcons: (on: boolean) => void;
        view3dCharacter: (
          id: string,
        ) => ReturnType<Editor3dView["characterCheck"]> | null;
        manifest: () => ReturnType<typeof manifestToWrite>;
        selected: () => string | null;
        picked: () => readonly string[];
        dropTour: (reason: string) => void;
        deleteSelection: (id: string) => void;
      };
    }
  ).__tourEditor = {
    editor: () => editor,
    edit: (write) => {
      let kind = "refused";
      writeInspectorEdit((open) => {
        const outcome = write(open);
        kind = outcome.kind;
        return outcome;
      });
      return kind;
    },
    edited: () => {
      if (undoOffer !== null) {
        throw new Error(
          "edited() skips the Undo offer's end: use edit() while a delete toast is up",
        );
      }
      refresh();
      tourChanged();
    },
    view3d: () => shown3d?.stats() ?? null,
    view3dTilt: (deg) => {
      shown3d?.setTilt(deg);
    },
    view3dDistance: (m) => {
      shown3d?.setDistance(m);
    },
    view3dHeading: (deg) => {
      shown3d?.setHeading(deg);
    },
    view3dBuildings: (on) => {
      shown3d?.setBuildings(on);
    },
    view3dPointOf: (selection) => shown3d?.pointOf(selection) ?? null,
    view3dScreenOf: (selection) => shown3d?.screenOf(selection) ?? null,
    view3dUnder: (x, y) => shown3d?.underAt(x, y) ?? null,
    view3dHandle: (part) => shown3d?.handleScreen(part) ?? null,
    view3dGizmoSizes: () => shown3d?.gizmoSizes() ?? null,
    view3dModelParts: () => shown3d?.modelParts() ?? null,
    view3dFolderOutlines: () => shown3d?.folderOutlines() ?? null,
    view3dModelScreen: (id, at) => shown3d?.modelScreenOf(id, at) ?? null,
    view3dSoundIcons: (on) => {
      shown3d?.showSoundIcons(on);
    },
    view3dCharacter: (id) => shown3d?.characterCheck(id) ?? null,
    manifest: () => manifestToWrite(store.getState().tourDocument),
    selected: () => ui().selected,
    picked: () => ui().picked,
    // What a late integrity failure does to the open tour (`openFile`'s
    // `onIntegrityFailure`), at the moment an e2e chooses.
    dropTour,
    // The page's own Delete (its "Deleted ..." toast with Undo), for an
    // e2e with no view to select from.
    deleteSelection: (id) => {
      deleteSelection(id);
    },
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
  unreadDraft: () => {
    unreadDraftNote = DRAFT_PART_UNREAD;
    if (!ui().busy) sayUnreadDraft();
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

/** The unread-draft line not yet shown: as the no-backup line, it waits
 *  until the tour shows. */
let unreadDraftNote: string | null = null;

function sayUnreadDraft(): void {
  if (unreadDraftNote === null) return;
  fileToasts.push(toast(unreadDraftNote, undefined, null));
  unreadDraftNote = null;
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
  // In a short window, at the 3D view's foot, clear of its gizmo.
  placeToasts(
    toasts,
    document.body.dataset.view === "3d"
      ? toastSpot(
          document.querySelector("#view3d canvas")?.getBoundingClientRect() ??
            null,
          document.getElementById("map-controls")?.getBoundingClientRect() ??
            null,
          { width: window.innerWidth, height: window.innerHeight },
        )
      : null,
  );
  toasts.append(t);
  return t;
}

function select(id: string | null): void {
  store.dispatch(editorViewActions.selected({ id }));
}

/** The save status: its state and its words, the words also its title
 *  (the 3D view's top bar cuts a long line short with an ellipsis; the
 *  whole line stays announced, and shows on hover). */
function showSaveStatus(
  state: string,
  text: string,
  // Beside File, the bar's one warning against losing work: changes not
  // saved, or a save that did not arrive.
  unsaved = state === "pending" || state === "error",
): void {
  saveStatus.dataset["state"] = state;
  saveStatus.textContent = text;
  saveStatus.title = text;
  unsavedMark.hidden = !unsaved;
  unsavedMark.title = unsaved ? text : "";
}

/** The File menu's items that follow the open tour and the save slot. */
function renderFileItems(): void {
  if (!ui().doneBusy) {
    setItemDisabled(doneButton, editor === null || walkMoving());
  }
  setItemDisabled(fileDetailsButton, editor === null);
  setItemDisabled(fileCharactersButton, editor === null);
  // On whenever a tour is open and no save runs: a click commits the
  // inspector's typing first, so a disabled button would swallow the first
  // edit (E2a review #3).
  setItemDisabled(saveButton, editor === null || saving());
  setItemDisabled(saveCopyButton, editor === null || saving());
}

function renderSaveState(): void {
  const count = editor?.changeCount() ?? 0;
  renderFileItems();
  if (saving()) {
    // A copy is not the tour's save: the mark stays while the tour's own
    // file is still due its changes.
    if (saveState().by === "copy") {
      showSaveStatus(
        "saving",
        "Saving a copy…",
        count > 0 || undelivered !== null || saveState().error !== null,
      );
    } else if (saveState().by === "open") {
      showSaveStatus(
        "saving",
        `Saving into ${openWriting ?? "the chosen file"}…`,
        count > 0,
      );
    } else {
      showSaveStatus("saving", "Saving…");
    }
    return;
  }
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
  // No file saved into by itself (a browser without the save dialog, a
  // phone, a dismissed dialog): the browser's draft is all there is until
  // Save, so the line says so - the one warning against losing work on
  // such a browser. "Kept" only when the draft does keep them.
  if (target === null && draft.backsUp()) {
    return " - kept in this browser until you save";
  }
  return "";
}

/** The tour's name in the top bar and the tab's title (W2: link titles
 *  use the tour's name, not the app's). */
function renderTourName(): void {
  const title = model?.title;
  tourNameText.textContent = title ?? "";
  document.title =
    title === undefined ? EDITOR_TITLE : `${title} - ${EDITOR_TITLE}`;
}

/** Whether the selection `id` is still in the tour: one of the editor
 *  model's items, or a block the editor model does not list
 *  (`editor-model.ts`) but the 3D view selects and edits - a 3D model, a
 *  free long text. */
function stillInTour(id: string): boolean {
  if (model?.items.some((i) => i.id === id) === true) return true;
  return (
    selectedStationOf(id, manifestToWrite(store.getState().tourDocument)) !==
    null
  );
}

/** After an edit: the tour's name and the status follow (the 3D view
 *  reads the store). */
function refresh(): void {
  if (editor === null) return;
  model = editor.model();
  renderTourName();
  const { selected } = ui();
  if (selected !== null && !stillInTour(selected)) {
    store.dispatch(editorViewActions.selected({ id: null }));
  }
  // A cut whose item an edit or an undo removed has nothing left to move.
  if (cutGone(store.getState().tourDocument, ui())) {
    store.dispatch(editorViewActions.clipboardCleared());
  }
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
  const tourNow = () => manifestToWrite(store.getState().tourDocument);
  const heldBy = selectedStationOf(ui().selected, tourNow());
  const outcome = which === "undo" ? editor.undo() : editor.redo();
  // A step that took the selected row away (an undone paste's copy) leaves
  // its station selected, so a Paste after it still has a target.
  const station = heldBy === null ? null : `${STATION_PREFIX}${heldBy}`;
  if (
    station !== null &&
    selectedStationOf(ui().selected, tourNow()) === null &&
    selectedStationOf(station, tourNow()) !== null
  ) {
    select(station);
  }
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
  tourChanged();
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

/** What a toast calls `id`: its listed title (a pin, a photo, a
 *  station), else, for a free block the model does not list, its name by
 *  the one rule (`objectTitle`: its own text, else its kind's word); "the
 *  note" for an id the tour does not have. */
function itemCalled(id: string): string {
  const listed = model?.items.find((i) => i.id === id)?.title;
  if (listed !== undefined) return listed;
  const block = manifestToWrite(store.getState().tourDocument)
    ?.stations.flatMap((s) => tourFreeBlocks(s))
    .find((b) => b.id === id);
  return block === undefined ? "the note" : objectTitle(block);
}

/**
 * Delete a note, a folder with everything in it (`folder:<id>`), or a
 * station with its notes (`station:<id>`; the 3D view's Del) once its
 * creator said yes: one step. The toast offers its Undo while it is the
 * newest edit; a refusal deletes nothing and is said.
 */
function deleteSelection(id: string): void {
  if (editor === null) return;
  const tour = manifestToWrite(store.getState().tourDocument);
  if (id.startsWith(STORY_PREFIX)) {
    deleteStorySelection(id.slice(STORY_PREFIX.length));
    return;
  }
  if (id.startsWith(FOLDER_PREFIX)) {
    deleteFolderSelection(id.slice(FOLDER_PREFIX.length));
    return;
  }
  const place = tour === null ? null : tourChildPlace(tour, id);
  if (place?.story !== undefined) {
    deleteStoryEntry(id, place.story);
    return;
  }
  const called = itemCalled(id);
  if (id.startsWith(STATION_PREFIX)) {
    const stationId = id.slice(STATION_PREFIX.length);
    const station = tour?.stations.find((s) => s.id === stationId);
    // A delete the tour refuses (its last station) is not asked about:
    // the refusal is said instead.
    if (
      station !== undefined &&
      stationDeleteRefusal(store.getState().tourDocument, stationId) === null &&
      !confirmPausingFrames(
        stationDeleteQuestion(station, stationTitleOf(stationId)),
      )
    ) {
      return;
    }
  }
  // One delete toast at a time: its Undo takes back the newest edit.
  endUndo();
  const outcome = id.startsWith(STATION_PREFIX)
    ? editor.deleteStation(id.slice(STATION_PREFIX.length))
    : editor.remove(id);
  deleted(outcome, `Deleted ${called}`);
}

/** After a delete: the selection gone, the page redrawn and the toast with
 *  its Undo, or a refusal said. */
function deleted(
  outcome: { readonly kind: "refused"; readonly reason: string } | object,
  said: string,
): void {
  if (editor === null) return;
  if ("reason" in outcome) {
    // Nothing was deleted: no "Deleted" toast, and no Undo offered - it
    // would only answer that there is nothing to take back.
    select(null);
    refresh();
    toast(outcome.reason);
    return;
  }
  select(null);
  refresh();
  offerUndo(said);
}

/** The toast saying `said` of the step just made, with its Undo: the
 *  edit stack's while that step is the newest edit; a newer one ends the
 *  toast. The autosave waits for it (`editing`). */
function offerUndo(said: string): void {
  if (editor === null) return;
  const mine = editor;
  const at = editor.revision();
  const t = toast(said, {
    label: "Undo",
    run: undoTap(mine, at, {
      current: () => editor,
      end: endUndo,
      undo: () => {
        runStep("undo");
      },
      say: (text) => toast(text),
    }),
  });
  undoOffer = {
    toast: t,
    timer: window.setTimeout(endUndo, UNDO_MS),
  };
  tourChanged();
}

/** The story `id` of the tour as it stands. */
function storyNamed(id: string): TourStory | undefined {
  return manifestToWrite(store.getState().tourDocument)
    ?.stations.flatMap((s) => tourStories(s))
    .find((s) => s.id === id);
}

/** Delete a story and its entries, once its creator said yes: one step,
 *  which Undo takes back. */
function deleteStorySelection(storyId: string): void {
  const story = storyNamed(storyId);
  const question = storyDeleteQuestion(store.getState().tourDocument, storyId);
  if (editor === null || story === undefined || question === null) return;
  if (!confirmPausingFrames(question)) return;
  endUndo();
  const outcome = editor.deleteStory(storyId);
  deleted(
    outcome,
    `Deleted the story "${story.title}"${
      "stationGone" in outcome && outcome.stationGone
        ? ", and its station, which held nothing else"
        : ""
    }`,
  );
}

/** Delete a plain folder with everything in it, once its creator said
 *  yes to a question that counts it: one step, which Undo takes back. */
function deleteFolderSelection(folderId: string): void {
  const doc = store.getState().tourDocument;
  const place = plainFolderOf(doc, folderId);
  const question = folderDeleteQuestion(doc, folderId);
  if (editor === null || place === null || question === null) return;
  if (!confirmPausingFrames(question)) return;
  endUndo();
  const outcome = editor.deleteFolder(folderId);
  const n = outcome.kind === "deleted" ? outcome.items : 0;
  deleted(
    outcome,
    `Deleted the folder "${folderName(place.folder)}"${
      n === 0 ? "" : ` and its ${n === 1 ? "item" : `${String(n)} items`}`
    }`,
  );
}

/** Delete an entry of `story`: one step; the toast says when answers that
 *  led to it changed. */
function deleteStoryEntry(id: string, story: TourStory): void {
  if (editor === null) return;
  const title = storyRows(story).find((r) => r.id === id)?.title ?? "the entry";
  endUndo();
  const outcome = editor.deleteStoryChild(id);
  const n = outcome.kind === "deleted" ? outcome.answers : 0;
  const said = `Deleted ${title}`;
  deleted(
    outcome,
    n === 0
      ? said
      : `${said}. ${String(n)} ${n === 1 ? "answer no longer leads" : "answers no longer lead"} to it.`,
  );
}

/**
 * Copy (the Edit menu's, Ctrl+C): the picked rows, or the one selected,
 * on the editor's clipboard when each is a note or a plain folder
 * (`clipboard.ts`), said by a toast; otherwise the toast says why and the
 * clipboard keeps what it held. Copy changes nothing in the tour.
 */
function copySelection(): void {
  if (editor === null) return;
  const outcome = copyOf(store.getState().tourDocument, ui());
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  store.dispatch(editorViewActions.copied({ ids: outcome.ids }));
  const [only] = outcome.ids;
  toast(
    outcome.ids.length > 1 || only === undefined
      ? `Copied ${String(outcome.ids.length)} items`
      : only.startsWith(FOLDER_PREFIX)
        ? "Copied the folder"
        : `Copied ${itemCalled(only)}`,
  );
}

/**
 * Cut (the Edit menu's, Ctrl+X): the picked rows, or the one selected, on
 * the editor's clipboard as a cut when each is a station or each is in
 * one (`cutOf`), shown dimmed in the tree until a Paste moves them or
 * Escape cancels it. Cut changes nothing in the tour: the Paste moves.
 */
function cutSelection(): void {
  if (editor === null) return;
  const outcome = cutOf(store.getState().tourDocument, ui());
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  store.dispatch(editorViewActions.copied({ ids: outcome.ids, mode: "cut" }));
  const [only] = outcome.ids;
  const what =
    outcome.ids.length > 1 || only === undefined
      ? `${String(outcome.ids.length)} items`
      : only.startsWith(FOLDER_PREFIX)
        ? "the folder"
        : only.startsWith(STORY_PREFIX)
          ? "the story"
          : itemCalled(only);
  toast(`Cut ${what}: select where it goes and paste. Escape cancels.`);
}

/** `outcome` said by `say` now, or, for an edit held by the draft gate,
 *  once it lands while the editor `mine` is still the page's; nothing
 *  when it never lands (the gate says that itself). */
async function sayLanded<T>(
  mine: EditorSession,
  outcome: T | EditorHeld<T>,
  say: (outcome: T) => void,
): Promise<void> {
  if (!isHeld<T>(outcome)) {
    say(outcome);
    return;
  }
  refresh();
  const landed = await outcome.landed;
  if (landed === null || editor !== mine) return;
  say(landed);
}

/** A Paste of a cut: its items moved onto the target station, or its
 *  stations put after it, ONE step that keeps their ids; the clipboard
 *  emptied and the first moved row selected, once the move is in the
 *  tour (one held by the draft question, when it lands). No question
 *  first (the cut was the question); the toast says that a moved item
 *  stands at the station's centre and what else changed. */
function pasteCut(
  plan: Extract<PasteOutcome, { kind: "move" | "reorder" }>,
): void {
  const mine = editor;
  if (mine === null) return;
  const first = ui().clipboard?.ids[0] ?? null;
  endUndo();
  if (plan.kind === "reorder") {
    void sayLanded(mine, mine.reorderStations(plan.order), (outcome) => {
      if (cutLanded(outcome, first)) {
        toast(`Moved after "${stationTitleOf(plan.afterStationId)}"`);
      }
    });
    return;
  }
  void sayLanded(mine, mine.moveChildren(plan.moves), (outcome) => {
    if (outcome.kind === "moved") showRowsOf(plan.toStationId);
    if (cutLanded(outcome, first) && outcome.kind === "moved") {
      sayMoved(plan, outcome);
    }
  });
}

/** What a Paste of a cut moved, said: where the items stand now, the
 *  answers that lost their jump and the items that took their kind's
 *  usual view. */
function sayMoved(
  plan: Extract<PasteOutcome, { kind: "move" }>,
  outcome: { readonly answers: number; readonly floored: boolean },
): void {
  const n = plan.moves.length;
  const where = stationTitleOf(plan.toStationId);
  const notes = [
    n === 1
      ? `Moved it to "${where}": it stands at the station's centre; place it again there.`
      : `Moved ${String(n)} items to "${where}": they stand at the station's centre; place them again there.`,
  ];
  if (outcome.answers > 0) {
    notes.push(
      outcome.answers === 1
        ? "1 answer that led to it now goes on to the next entry."
        : `${String(outcome.answers)} answers that led to it now go on to the next entry.`,
    );
  }
  if (outcome.floored) {
    notes.push(
      n === 1
        ? "It now stands in the world in its kind's usual view."
        : "Some now stand in the world in their kind's usual view.",
    );
  }
  toast(notes.join(" "));
}

/** After a Paste of a cut was written or refused: the page redrawn and a
 *  refusal said; a move made empties the clipboard, selects `first` (the
 *  cut kept its ids) and counts as a change. Whether it moved. */
function cutLanded(
  outcome:
    | { readonly kind: "moved" | "reordered" | "unchanged" }
    | { readonly kind: "refused"; readonly reason: string },
  first: string | null,
): boolean {
  if (outcome.kind === "refused") {
    refresh();
    toast(outcome.reason);
    return false;
  }
  if (outcome.kind === "unchanged") return false;
  store.dispatch(editorViewActions.clipboardCleared());
  refresh();
  select(first);
  tourChanged();
  return true;
}

/**
 * Paste (the Edit menu's, Ctrl+V): what the clipboard holds, by
 * `clipboard.ts`'s `pasteOf` - copies of its notes and folders into the
 * selected station, or the station of the selected row; copies of its
 * stations after the selected one; copies of its stories into the
 * station; or a cut moved there - ONE step; the copies selected and a
 * toast saying how many. A photo's picture is read first, said by a held
 * "Pasting..." toast; while a Paste or a Duplicate still runs, any Paste
 * makes nothing and says so (the `duplicating` flag), and a tour
 * switched meanwhile drops the result. A refusal pastes nothing and is
 * said. A paste that waits for the draft question is said only once it
 * lands (`held-edit-flow.ts`).
 */
async function pasteSelection(): Promise<void> {
  const mine = editor;
  if (mine === null) return;
  const plan = pasteOf(store.getState().tourDocument, ui());
  if (ui().duplicating) {
    toast(EDIT_STILL_RUNNING);
    return;
  }
  if (plan.kind === "refused") {
    toast(plan.reason);
    return;
  }
  if (plan.kind === "pasteStories") {
    pasteStories(mine, plan);
    return;
  }
  if (plan.kind === "pasteStations") {
    endUndo();
    await runHeldEdit({
      ...heldEditOnPage(mine, "Pasting..."),
      run: () => mine.pasteStations(plan),
      made: (outcome) => {
        const n = outcome.stations.length;
        const [first] = outcome.stations;
        if (first === undefined) return;
        showNewStation(first, () =>
          n === 1 ? "Pasted a copy" : `Pasted ${String(n)} copies`,
        );
      },
    });
    return;
  }
  if (plan.kind !== "paste") {
    pasteCut(plan);
    return;
  }
  endUndo();
  const clipboard = store.getState().editorView.clipboard;
  await runHeldEdit({
    ...heldEditOnPage(mine, "Pasting..."),
    run: () => mine.paste(plan),
    made: (outcome) => {
      // Counted for the clipboard pasted only: the next paste of it into
      // this station stands further east (`pasteOf`).
      if (store.getState().editorView.clipboard === clipboard) {
        store.dispatch(
          editorViewActions.clipboardPastedInto({
            stationId: plan.toStationId,
          }),
        );
      }
      showRowsOf(plan.toStationId);
      // Every copy selected, as its source was picked: a Ctrl+X moves them
      // on, a Delete takes them back.
      const copies = [
        ...outcome.objects,
        ...outcome.folders.map((id) => `${FOLDER_PREFIX}${id}`),
      ];
      const [only] = copies;
      if (copies.length > 1) {
        store.dispatch(editorViewActions.picked({ ids: copies }));
      } else {
        select(only ?? null);
      }
      const n = copies.length;
      toast(n === 1 ? "Pasted a copy" : `Pasted ${String(n)} copies`);
      tourChanged();
    },
  });
}

/** A Paste of copied stories into `plan.toStationId` (`pasteOf`): one
 *  step; the first copy selected and its station shown; a refusal said. */
function pasteStories(
  mine: EditorSession,
  plan: Extract<PasteOutcome, { kind: "pasteStories" }>,
): void {
  endUndo();
  void sayLanded(mine, mine.pasteStories(plan), (outcome) => {
    refresh();
    if (outcome.kind === "refused") {
      toast(outcome.reason);
      return;
    }
    const [first] = outcome.stories;
    showRowsOf(plan.toStationId);
    if (first !== undefined) {
      store.dispatch(editorViewActions.storyFolded({ id: first, open: true }));
      select(`${STORY_PREFIX}${first}`);
    }
    const n = outcome.stories.length;
    toast(n === 1 ? "Pasted a copy" : `Pasted ${String(n)} copies`);
    tourChanged();
  });
}

/** What `runHeldEdit` takes from the page for an edit by `mine`: the
 *  `duplicating` flag, the page's toasts and redraw. */
function heldEditOnPage(mine: EditorSession, working: string) {
  return {
    working,
    current: () => editor === mine,
    running: () => ui().duplicating,
    busy: (on: boolean) =>
      store.dispatch(editorViewActions.duplicatingChanged({ duplicating: on })),
    toast: (text: string, held: boolean) =>
      held ? toast(text, undefined, null, false) : toast(text),
    refresh,
  };
}

/**
 * Copy a note, a story (`story:<id>`, right after itself), a folder with
 * everything in it (`folder:<id>`), or a station with its notes, beside
 * itself (the bar's Duplicate, the 3D view's Ctrl+D): one step; the copy
 * is selected and a toast names it. A photo's picture is read first,
 * said by a held toast: another Duplicate meanwhile makes nothing and
 * says so; a tour switched meanwhile drops the result. A story's entry has no Duplicate
 * (the bar offers none), so its Ctrl+D does nothing.
 */
async function duplicateSelection(id: string): Promise<void> {
  const mine = editor;
  if (mine === null) return;
  if (id.startsWith(STORY_PREFIX)) {
    if (ui().duplicating) toast(EDIT_STILL_RUNNING);
    else duplicateStorySelection(id.slice(STORY_PREFIX.length));
    return;
  }
  if (id.startsWith(FOLDER_PREFIX)) {
    await duplicateFolderSelection(mine, id.slice(FOLDER_PREFIX.length));
    return;
  }
  const tour = manifestToWrite(store.getState().tourDocument);
  if (tour !== null && tourChildPlace(tour, id)?.story !== undefined) return;
  await duplicateItemSelection(mine, id);
}

/** A note or a station (`station:<id>`) copied beside itself: the copy
 *  selected and named, said once it was made (for one that waits for the
 *  draft question, once it lands); one step. */
async function duplicateItemSelection(
  mine: EditorSession,
  id: string,
): Promise<void> {
  const said = `Duplicated ${itemCalled(id)}`;
  endUndo();
  if (id.startsWith(STATION_PREFIX)) {
    await runHeldEdit({
      ...heldEditOnPage(mine, "Duplicating..."),
      run: () => mine.duplicateStation(id.slice(STATION_PREFIX.length)),
      made: (outcome) => showNewStation(outcome.stationId, () => said),
    });
    return;
  }
  await runHeldEdit({
    ...heldEditOnPage(mine, "Duplicating..."),
    run: () => mine.duplicateObject(id),
    made: (outcome) => {
      const home = manifestToWrite(
        store.getState().tourDocument,
      )?.stations.find((s) =>
        tourFreeBlocks(s).some((i) => i.id === outcome.id),
      );
      if (home !== undefined) showRowsOf(home.id);
      select(outcome.id);
      toast(said);
      tourChanged();
    },
  });
}

/** The plain folder `folderId` copied beside itself with everything in
 *  it: the copy selected in its station's rows, said once it was made
 *  (for one that waits for the draft question, once it lands); one step.
 *  A tour switched meanwhile drops the result. */
async function duplicateFolderSelection(
  mine: EditorSession,
  folderId: string,
): Promise<void> {
  endUndo();
  await runHeldEdit({
    ...heldEditOnPage(mine, "Duplicating..."),
    run: () => mine.duplicateFolder(folderId),
    made: (outcome) => {
      const doc = store.getState().tourDocument;
      const copy = plainFolderOf(doc, outcome.folderId);
      if (copy !== null) showRowsOf(copy.stationId);
      select(`${FOLDER_PREFIX}${outcome.folderId}`);
      toast(
        `Duplicated the folder${copy === null ? "" : ` as "${folderName(copy.folder)}"`}`,
      );
      tourChanged();
    },
  });
}

/** The story `storyId` copied right after itself: the copy selected
 *  with its folder open, said once it was made (for one that waits for
 *  the draft question, once it lands); one step. */
function duplicateStorySelection(storyId: string): void {
  const mine = editor;
  if (mine === null) return;
  endUndo();
  void sayLanded(mine, mine.duplicateStory(storyId), (outcome) => {
    refresh();
    if (outcome.kind === "refused") {
      toast(outcome.reason);
      return;
    }
    const copy = manifestToWrite(store.getState().tourDocument)
      ?.stations.flatMap((s) => tourStories(s))
      .find((s) => s.id === outcome.id);
    store.dispatch(
      editorViewActions.storyFolded({ id: outcome.id, open: true }),
    );
    select(`${STORY_PREFIX}${outcome.id}`);
    toast(`Duplicated ${copy === undefined ? "the story" : `"${copy.title}"`}`);
    tourChanged();
  });
}

/** A placement edit of the 3D view or the inspector written
 *  (`../placement/place-edits.ts`): one step; a refusal is said. Whether
 *  it was written. */
function commitSceneEdit(edit: PlaceEdit): boolean {
  if (editor === null) return false;
  endUndo();
  const before = store.getState().tourDocument;
  const movedBlock =
    edit.kind === "pose" && edit.ref.kind === "block" ? edit.ref.id : null;
  const joinStation =
    movedBlock !== null && edit.kind === "pose"
      ? askMove(before, movedBlock, edit.geo, confirmPausingFrames)
      : undefined;
  const outcome = applyPlaceEdit(editor, edit, joinStation);
  refresh();
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return false;
  }
  if (joinStation !== undefined) showRowsOf(joinStation);
  if (movedBlock !== null) {
    const note = moveNote(before, store.getState().tourDocument, movedBlock);
    if (note !== null) toast(note);
  }
  tourChanged();
  return true;
}

/** An edit the 3D inspector typed or pressed, written through `write`:
 *  one step; a refusal is said, a change counted. Its outcome tells the
 *  inspector whether to keep the typed text (`refused`, no tour open
 *  included: nothing was written). */
function writeInspectorEdit(write: SessionWrite): TypedEditOutcome {
  return writeTypedEdit(
    {
      session: () => editor,
      endUndo,
      refresh,
      say: (text) => {
        toast(text);
      },
      changed: tourChanged,
    },
    write,
  );
}

/** A narration change from the Narration section, as an inspector edit:
 *  one step, the page refreshed once the session holds it, a refusal
 *  toasted, the autosave told. */
async function writeNarrationEdit(
  id: string,
  change: NarrationChange,
): Promise<TypedEditOutcome> {
  if (editor === null) return "refused";
  endUndo();
  let outcome: Awaited<ReturnType<EditorSession["editNarration"]>>;
  try {
    outcome = await editor.editNarration(id, change);
  } catch {
    outcome = {
      kind: "refused",
      reason: "The narration could not be changed.",
    };
  }
  refresh();
  if ("reason" in outcome) {
    toast(outcome.reason);
    return "refused";
  }
  if (outcome.notBackedUp === true) toast(FILE_NOT_KEPT);
  if (outcome.kind === "unchanged") judgeAutosave();
  else tourChanged();
  return "written";
}

/** The inspector's "Use current frame": the picture made the video's
 *  poster, one step, as an inspector edit: refreshed once the session
 *  holds it, a refusal toasted, the autosave told. */
async function writeVideoPoster(
  id: string,
  image: Blob,
): Promise<TypedEditOutcome> {
  const open = editor;
  if (open === null) return "refused";
  endUndo();
  let outcome: Awaited<ReturnType<EditorSession["setVideoPoster"]>>;
  try {
    outcome = await open.setVideoPoster(id, image);
  } catch {
    outcome = { kind: "refused", reason: "The poster could not be kept." };
  }
  if (editor !== open) return "refused";
  refresh();
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return "refused";
  }
  if (!outcome.backedUp) toast(FILE_NOT_KEPT);
  if (outcome.kind === "edited") tourChanged();
  else judgeAutosave();
  return "written";
}

/** An edit made: the autosave's cap judged again (an edit may drop the
 *  redo steps naming a file brought in, so the next save no longer writes
 *  it), then the autosave told. */
function tourChanged(): void {
  judgeAutosave();
  autosave.changed();
}

/** The autosave's cap judged again: the cost of an in-place save is the
 *  tour's whole size, judged on what the next one rewrites (the newest
 *  written file and what it adds and keeps: `nextSaveBytes`). Both ways - a file
 *  brought in may take the tour over the cap, and an edit that drops the
 *  last step naming it (an undo alone keeps it: its redo does), or a save
 *  writing less, may bring it back under. Asked after every edit, step and
 *  save; a file that is not written in place, or no longer can be, is left
 *  as it is. */
function judgeAutosave(): void {
  if (editor === null || target === null || saveState().cannotSave) return;
  const largeTour = !autosaveFits(editor.nextSaveBytes(), autosaveMaxBytes);
  if (largeTour === saveState().largeTour) return;
  store.dispatch(tourDocumentActions.saveLimited({ largeTour }));
  autosave.enable(!largeTour);
  renderSaveState();
}

/** The tree's add in place and the palette's: a new item of `kind` in
 *  `stationId`, clear of its items and on the ground where that has
 *  loaded (`new-pin.ts`), selected and said once it was placed, its
 *  refusal (a gone station's too) toasted; one step. */
function addItemTo(stationId: string, kind: AddKind): void {
  const open = editor;
  if (open === null) return;
  if (isFileAddKind(kind)) {
    void addFromFile(kind, { kind: "station", stationId });
    return;
  }
  const outcome = addNewItem({
    stations: manifestToWrite(store.getState().tourDocument)?.stations ?? [],
    stationId,
    kind,
    id: newObjectId(),
    nowIso: new Date().toISOString(),
    groundAt: (place) => shown3d?.groundAt(place) ?? null,
    place: (item) => {
      endUndo();
      const placed = open.place(item);
      refresh();
      return placed;
    },
  });
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  select(outcome.item.id);
  toast(`Added ${kindWithArticle(kind)} to "${stationTitleOf(stationId)}"`);
  tourChanged();
}

/** The add menu's Character: the maker opens on a new character, which
 *  then stands free in the station (`addNewCharacter`) or ends the story
 *  as a card; selected and said once it was added, a refusal toasted. The
 *  declaration and the add are a step each. From the maker's close until
 *  the outcome a held toast with a Close says the work is under way
 *  (copying his pictures in takes a moment; `makeForTour` takes it down). */
async function addCharacterTo(to: {
  readonly kind: "station" | "story";
  readonly id: string;
}): Promise<void> {
  let made: Awaited<ReturnType<typeof characters.makeForTour>>;
  try {
    made = await characters.makeForTour({
      // Held with a Close, as the page's other held toasts are: an add
      // that never settles must not leave a line nobody can take away.
      hold: (text) => {
        const working = toast(text, undefined, null);
        working.setAttribute("aria-busy", "true");
        return () => {
          working.remove();
        };
      },
    });
  } catch (error) {
    toast(
      `The character was not added: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      null,
    );
    return;
  }
  const open = editor;
  if (made === null || open === null) return;
  if (to.kind === "story") {
    endUndo();
    const out = open.addCharacterToStory(
      to.id,
      made.id,
      (place) => shown3d?.groundAt(place) ?? null,
    );
    refresh();
    if (out.kind === "refused") {
      toast(out.reason);
      return;
    }
    select(out.id);
    toast(
      `Added ${made.name} to the story "${storyNamed(to.id)?.title ?? ""}"`,
    );
    tourChanged();
    return;
  }
  const outcome = addNewCharacter({
    stations: manifestToWrite(store.getState().tourDocument)?.stations ?? [],
    stationId: to.id,
    character: made,
    id: newObjectId(),
    nowIso: new Date().toISOString(),
    groundAt: (place) => shown3d?.groundAt(place) ?? null,
    place: (item) => {
      endUndo();
      const placed = open.place(item);
      refresh();
      return placed;
    },
  });
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  select(outcome.item.id);
  toast(`Added ${made.name} to "${stationTitleOf(to.id)}"`);
  tourChanged();
}

/** The tree's add of a story to `stationId`: a new story, selected with its
 *  folder open, said once it was made; one step. */
function addStoryTo(stationId: string): void {
  if (editor === null) return;
  endUndo();
  const outcome = editor.addStory(stationId);
  refresh();
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  store.dispatch(editorViewActions.storyFolded({ id: outcome.id, open: true }));
  select(`${STORY_PREFIX}${outcome.id}`);
  toast(`Added a story to "${stationTitleOf(stationId)}"`);
  tourChanged();
}

/** The story menu's Choice or Quiz: a new step at the story's end (or
 *  before its child at `at`), selected, its inspector open on its
 *  fields. */
function addStepToStoryEntry(
  storyId: string,
  kind: StepKind,
  at?: number,
): void {
  if (editor === null) return;
  endUndo();
  const outcome = editor.addStepToStory(storyId, kind, at);
  refresh();
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  select(outcome.id);
  toast(`Added a ${kind} to the story "${storyNamed(storyId)?.title ?? ""}"`);
  tourChanged();
}

/** The tree's add into the story `storyId`: a new entry of `kind` (at
 *  its end, or before its child at `at`), selected, said once it was
 *  made; one step. */
function addToStoryEntry(storyId: string, kind: AddKind, at?: number): void {
  if (editor === null) return;
  if (isFileAddKind(kind)) {
    void addFromFile(kind, { kind: "story", storyId, at });
    return;
  }
  endUndo();
  const outcome = editor.addToStory(storyId, kind, at);
  refresh();
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  select(outcome.id);
  toast(
    `Added ${kindWithArticle(kind)} to the story "${storyNamed(storyId)?.title ?? ""}"`,
  );
  tourChanged();
}

/** The file picker the add menu's file kinds open. */
const filePicker = createFilePicker(document.body);

/** A story played as a visitor meets it (`story-preview.ts`), from the
 *  tour as it is now, unsaved edits included. */
const storyPreview = createStoryPreview({
  doc: document,
  tour: () => manifestToWrite(store.getState().tourDocument),
  loadAsset: readContent,
});

/** The asset shelf's panel of the open tour (`asset-shelf/shelf-panel.ts`). */
let shelfPanel: ShelfPanel | null = null;

/** The editor's panels docked around the 3D view (`editor-shell/`): the
 *  shelf is its Files panel then. */
let panelsDocked = false;

/** Docked, the Files tab shown: the shelf opened (its toggle), or files
 *  put on it loose (its add, a drop on the page), so their processing is
 *  in sight. An add that makes or changes an item keeps its Details in
 *  sight instead: its next step is there, and the toggle's badge carries
 *  the processing. */
function showShelfDocked(): void {
  if (panelsDocked) shell.reveal("files");
}

/** Docked, Files out of sight: the shelf's pressed toggle pressed again.
 *  Details takes its place where they share a group, else the group's
 *  next panel; Files alone, its group hides. */
function hideShelfDocked(): void {
  if (panelsDocked) shell.conceal("files", "details");
}

/** A phone's layout: the shelf is a sheet (shelf-panel.css's width). */
const phoneLayout = window.matchMedia("(width <= 700px)");
phoneLayout.addEventListener("change", () => {
  shelfPanel?.refresh();
});

/** The details (the inspector dock) open: shown and not folded. */
function detailsOpen(): boolean {
  return (
    !shellInspector.hidden && !shellInspector.classList.contains("collapsed")
  );
}

// The shelf's squeeze follows the details and the window's width: a
// redraw whenever either changes (the shell draws the details).
new MutationObserver(() => {
  shelfPanel?.refresh();
}).observe(shellInspector, {
  attributes: true,
  attributeFilter: ["hidden", "class"],
});
window.addEventListener("resize", () => {
  shelfPanel?.refresh();
});

/** A toast of the shelf's, its button (an Undo) pressed once. */
function shelfToast(
  text: string,
  action?: { readonly label: string; readonly run: () => void },
): void {
  toast(
    text,
    action === undefined
      ? undefined
      : {
          label: action.label,
          run: (button) => {
            button.disabled = true;
            action.run();
          },
        },
  );
}

/** The shelf's commands on the page: its adds, the delete of a file in
 *  use and "Replace everywhere", with their toasts. */
const shelfActions = createShelfPageActions({
  current: () => editor,
  toast: shelfToast,
  busy: (text, testId) => {
    const shown = toast(text, undefined, null, false);
    shown.dataset["testid"] = testId;
    return shown;
  },
  pick: (kind) => filePicker.pick(kind),
  pickMany: () => filePicker.pickMany(),
  reveal: (id) => {
    shelfPanel?.reveal(id);
  },
  refresh,
  endUndo,
  offerUndo,
  deleted,
  nameOf: (id) => store.getState().assetShelf.entries[id]?.name,
});

/** The shelf's panel for the tour just opened, on its session's shelf. */
function openShelfPanel(open: EditorSession): void {
  shelfPanel?.destroy();
  shelfPanel = createShelfPanel({
    root: shellShelf,
    toggle: element<HTMLButtonElement>("shelf-toggle"),
    pill: element<HTMLButtonElement>("shelf-pill"),
    host: document.body,
    rows: () => selectShelfRows(store.getState()),
    subscribe: (listener) => store.subscribe(listener),
    retry: (id) => open.shelf.retry(id),
    imports: {
      retry: (id) => {
        open.imports.retry(id);
      },
      remove: (id) => open.imports.remove(id),
    },
    useOriginal: (id) => open.shelf.useOriginal(id),
    setDetail: (id, share) => open.shelf.setDetail(id, share),
    remove: (id) => open.shelf.remove(id),
    // A file in use goes with its uses in one step, said and undone like
    // any delete (the shelf puts its card back with the items).
    removeUsed: {
      plan: (id) => open.deletePlan(id),
      run: (id) => {
        shelfActions.deleteInUse(open, id);
      },
    },
    replace: {
      count: (id) => open.replaceCount(id),
      run: (id) => shelfActions.replaceEverywhere(open, id),
    },
    optimizeTour: () => open.shelf.optimizeTour(),
    // Picked files go the way dropped ones on no row do: a model to
    // convert among them is converted first.
    addFiles: () => {
      void shelfActions.addFiles(open, (files) => dropFiles(files, null));
    },
    thumbOf: (row) =>
      open.addedFileOf(row.kind === "video" ? (row.posterId ?? "") : row.id),
    // A character's entry: where his files are used, not he himself.
    placesOf: (id) => {
      const root = store.getState();
      return assetPlaces(
        manifestToWrite(root.tourDocument)?.stations ?? [],
        shelfRowUses(root, id),
      );
    },
    show: (selection) => {
      if (selection === TOUR_COVER_SELECTION) openDetails();
      else select(selection);
    },
    useIn: {
      choices: (id) => {
        const asset = open.assetOf(id);
        return asset === undefined
          ? []
          : useInChoices(
              { id, kind: asset.kind },
              manifestToWrite(store.getState().tourDocument)?.stations ?? [],
            );
      },
      use: (id, key) => {
        useShelfFileIn(open, id, key);
      },
    },
    toast: shelfToast,
    storage: browserStorage(),
    phone: () => phoneLayout.matches,
    // Sideways on a phone the open shelf leaves the view no room beside
    // the details: its rail then, and opening it folds the details.
    squeezed: () => shelfSqueezed(window.innerWidth, detailsOpen()),
    makeRoom: () => {
      store.dispatch(
        editorViewActions.dockFolded({ dock: "inspector", folded: true }),
      );
    },
    dock: {
      active: () => panelsDocked,
      reveal: showShelfDocked,
      shown: () => shell.filesShown(),
      hide: hideShelfDocked,
      badge: (badge) => {
        shell.badge("files", badge);
      },
    },
  });
}

/**
 * The add of a `kind` item from a file at `at` (`add-file-item.ts`):
 * `file` when given (a drop), else the one picked. While the file is read
 * a toast says so; then the new item is selected and named with its
 * place, or the refusal is said; a cancelled picker says nothing. One
 * step. Resolves once it is all said.
 */
async function addFromFile(
  kind: FileAddKind,
  at: FileAddTarget,
  file?: File,
): Promise<void> {
  const open = editor;
  if (open === null) return;
  const outcome = await addFileItem(
    kind,
    at,
    {
      pick: (k) => filePicker.pick(KIND_EDIT[k].add.file),
      busy: (name) => {
        const shown = toast(`Adding "${name}"...`, undefined, null, false);
        shown.dataset["testid"] = "add-file-busy";
        return () => {
          shown.remove();
        };
      },
      addFile: (blob, name, kinds) => open.addFile(blob, name, kinds),
      place: (to, source) => placeFrom(open, to, source),
    },
    file,
  );
  if (outcome.kind === "cancelled") return;
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  select(outcome.id);
  // Where a file lands may be off screen: the view frames it, as a choice in the tree does.
  shell.frame(outcome.id);
  sayAdded(kind, at, outcome.fileName);
  if (!outcome.backedUp) toast(FILE_NOT_KEPT);
  tourChanged();
}

/** The item `source` makes placed at `to` (`placeFileItem`): one step. */
function placeFrom(
  open: EditorSession,
  to: FileAddTarget,
  source: FileItemSource,
): ReturnType<typeof placeFileItem> {
  endUndo();
  const placed = placeFileItem({
    target: to,
    source,
    stations: manifestToWrite(store.getState().tourDocument)?.stations ?? [],
    id: newObjectId(),
    nowIso: new Date().toISOString(),
    groundAt: (place) => shown3d?.groundAt(place) ?? null,
    place: (object) => open.place(object),
    addEntryToStory: (storyId, child, at) =>
      open.addEntryToStory(storyId, child, at),
  });
  refresh();
  return placed;
}

/** Says which `kind` item, made from `fileName`, was added at `at`. */
function sayAdded(
  kind: FileAddKind,
  at: FileAddTarget,
  fileName: string,
): void {
  const title = fileItemTitle(fileName, kind);
  const where =
    at.kind === "station"
      ? `"${stationTitleOf(at.stationId)}"`
      : `the story "${storyNamed(at.storyId)?.title ?? ""}"`;
  const word = KIND_EDIT[kind].add.label;
  toast(
    `Added the ${word.charAt(0).toLowerCase()}${word.slice(1)} "${title}" to ${where}`,
  );
}

/**
 * The shelf's "Use in..." of the file `assetId`: the choice `key`
 * (`use-in-choices.ts`) adds an item made from it at a station or a
 * story, or makes an item of its kind show it. One step; the outcome or
 * the refusal is said.
 */
function useShelfFileIn(
  open: EditorSession,
  assetId: string,
  key: string,
): void {
  const chosen = useInTarget(key);
  if (chosen !== null) useFileAt(open, assetId, chosen);
}

/** The file `assetId` the tour lists used at `chosen`: an item made
 *  from it at a station or a story, or an item of its kind showing it.
 *  One step; the outcome or the refusal is said. */
function useFileAt(
  open: EditorSession,
  assetId: string,
  chosen: UseInTarget,
): void {
  const asset = open.assetOf(assetId);
  if (asset === undefined) return;
  const fileName =
    store.getState().assetShelf.entries[assetId]?.name ?? "the file";
  if (chosen.kind === "item") {
    endUndo();
    const outcome = open.setItemAsset(chosen.id, assetId);
    refresh();
    if (outcome.kind === "refused") {
      toast(outcome.reason);
      return;
    }
    toast(`The item now shows "${fileName}"`);
    if (outcome.kind === "edited") tourChanged();
    return;
  }
  const kind = fileAddKindOfAsset(asset.kind);
  if (kind === null) return;
  const poster = open.posterOf(assetId);
  const placed = placeFrom(open, chosen, {
    kind,
    asset,
    fileName,
    ...(poster === undefined ? {} : { poster }),
  });
  if (placed.kind === "refused") {
    toast(placed.reason);
    return;
  }
  select(placed.id);
  shell.frame(placed.id);
  sayAdded(kind, chosen, fileName);
  tourChanged();
}

/**
 * The item `id` made from `file` from now on (a file dropped on its file
 * field, or chosen with its "Replace..."): a toast while the file is
 * read, then the outcome said, a refusal on the error toast; one step.
 */
async function useAsItemFile(id: string, file: File): Promise<void> {
  const open = editor;
  if (open === null) return;
  const shown = toast(`Reading "${file.name}"...`, undefined, null, false);
  shown.dataset["testid"] = "replace-file-busy";
  endUndo();
  let outcome: Awaited<ReturnType<EditorSession["setItemFile"]>>;
  try {
    outcome = await open.setItemFile(id, file, file.name);
  } catch {
    outcome = { kind: "refused", reason: FILE_ADD_FAILED };
  } finally {
    shown.remove();
  }
  if (editor !== open) return;
  refresh();
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return;
  }
  toast(`The item now shows "${file.name}"`);
  if (!outcome.backedUp) toast(FILE_NOT_KEPT);
  if (outcome.kind === "edited") tourChanged();
  else judgeAutosave();
}

/** The inspector's "Replace..." of the item `id`: a file of its own kind
 *  picked, then used (`useAsItemFile`); a cancelled picker does nothing. */
async function replaceItemFile(id: string): Promise<void> {
  const block = fileBlockOf(
    id,
    manifestToWrite(store.getState().tourDocument)?.stations ?? [],
  );
  const kind = block === null ? null : blockFileKind(block);
  if (kind === null) return;
  let picked: File | null;
  try {
    picked = await filePicker.pick(kind);
  } catch {
    toast(FILE_ADD_FAILED);
    return;
  }
  if (picked !== null) await useAsItemFile(id, picked);
}

/**
 * Files dropped in the open editor (`file-drop.ts`): each onto the shelf,
 * and used where it was dropped - a station's or a story's row adds the
 * item there (`addFromFile`, one step each), an item's file field gives
 * the item that file (`useAsItemFile`). A model to convert (a glTF with
 * its parts, a zip of its folder; `import-plan.ts`) is converted first,
 * shown on the shelf while it is, then goes the same way
 * (`import-delivery.ts`); the pictures dropped with it wait for it. A
 * part dropped alone, or a file a tour does not take, is said by name and
 * left out.
 */
async function dropFiles(
  files: readonly File[],
  at: Element | null,
): Promise<void> {
  const open = editor;
  if (open === null) return;
  const dropTarget = fileDropTarget(at, shellTree);
  const plan = planImport(files.map((f) => f.name));
  for (const refused of plan.refused) toast(refused.reason);
  if (plan.imports.length > 0) {
    const [first] = open.imports.start({
      files,
      plan,
      deliver: importDelivery(dropTarget, {
        open: () => editor === open,
        addFile: (file) => open.addFile(file, file.name, ["model"]),
        use: (where, assetId) => {
          useFileAt(open, assetId, where);
        },
        shelved: (assetId, fileName, notes) => {
          shelfPanel?.reveal(assetId);
          toast(shelvedWords(fileName, notes));
        },
        notKept: () => {
          toast(FILE_NOT_KEPT);
        },
      }),
      // The pictures the model did not use go where the drop was made,
      // as a plain drop's would; onto the shelf from an item's file
      // field, which took the model.
      release: (pictures) => {
        void placeDropped(open, pictures, leftoverTarget(dropTarget));
      },
    });
    if (first !== undefined) shelfPanel?.reveal(first);
  }
  const taken = [...plan.plain, ...plan.unknown].sort((a, b) => a - b);
  await placeDropped(
    open,
    taken.map((i) => files[i]!),
    dropTarget,
  );
}

/** Dropped files a tour takes as they are, each where the drop was made
 *  (`dropFiles`): onto the shelf for a drop on no row, else into the row
 *  or the item's file field; a file of no kind a tour takes is said. Does
 *  nothing once `open` is no longer the open tour. */
async function placeDropped(
  open: EditorSession,
  files: readonly File[],
  dropTarget: FileDropTarget | null,
): Promise<void> {
  const loose: File[] = [];
  for (const file of files) {
    if (editor !== open) return;
    const kind = fileAddKindOf(file.name);
    if (kind === null) {
      toast(`"${file.name}" is not a picture, sound, video or 3D model.`);
      continue;
    }
    if (dropTarget === null) loose.push(file);
    else if (dropTarget.kind === "item") {
      await useAsItemFile(dropTarget.id, file);
    } else await addFromFile(kind, dropTarget, file);
  }
  await shelfActions.addToShelf(open, loose);
}

/** A station made in this session (added, split off, copied) starts
 *  unlocked: nothing was placed on site by it yet, so placing it is the
 *  next thing its creator does. */
function unlockMade(stationId: string): void {
  store.dispatch(
    editorViewActions.stationLocked({ id: stationId, locked: false }),
  );
}

/** A station's title, as the tree numbers it, or a stand-in. */
function stationTitleOf(stationId: string): string {
  const stations =
    manifestToWrite(store.getState().tourDocument)?.stations ?? [];
  const index = stations.findIndex((s) => s.id === stationId);
  const station = stations[index];
  return station === undefined
    ? "the station"
    : stationTitle(station, index + 1);
}

/** A station's rows in the list, for what was just made there: no search
 *  hides them (a new name matches nothing typed), its card unfolded. */
function showRowsOf(stationId: string): void {
  shell.clearSearch();
  store.dispatch(
    editorViewActions.stationFolded({ id: stationId, open: true }),
  );
}

/** A station the page made: in the list, unlocked, selected, its card
 *  unfolded, said. */
function showNewStation(stationId: string, said: (title: string) => string) {
  showRowsOf(stationId);
  unlockMade(stationId);
  refresh();
  select(`${STATION_PREFIX}${stationId}`);
  toast(said(stationTitleOf(stationId)));
  tourChanged();
}

/**
 * A new station at `at` (the 3D tree's "+" under the camera, or the
 * ground menu's "New station here"): one step; a refusal is said.
 */
function addStationAt(at: GroundPlace, where: "centre" | "here"): void {
  if (editor === null) return;
  endUndo();
  const outcome = editor.addStation(at);
  if (outcome.kind === "refused") {
    refresh();
    toast(outcome.reason);
    return;
  }
  showNewStation(
    outcome.stationId,
    (title) =>
      `Added "${title}" ${where === "centre" ? NEW_STATION_PLACE : "here"}`,
  );
}

/** The stations put in `order` (the 3D tree's drag, the inspector's
 *  Earlier and Later): one step. */
function reorderStations(order: readonly string[]): void {
  if (editor === null) return;
  endUndo();
  const outcome = editor.reorderStations(order);
  refresh();
  if (outcome.kind === "refused") toast(outcome.reason);
  else if (outcome.kind === "reordered") tourChanged();
}

/** A station's item moved within its station (the tree's drag, the
 *  inspector's Move to, Earlier and Later) or onto another one (the drag
 *  onto its card, the inspector's Move to station): one step, the
 *  selection kept. A move onto another station asks first
 *  (`stationMoveQuestion`: the item will stand at its centre); answered
 *  no, nothing is written. What the move changed beyond its place is
 *  said: answers that led to it now go on, or the view it took to stand in
 *  the world. Whether it moved. */
function moveChild(id: string, to: ChildMoveTo): boolean {
  if (editor === null) return false;
  if (
    to.place === "station" &&
    childMoveChange(store.getState().tourDocument, id, to).kind === "moved" &&
    !confirmPausingFrames(
      stationMoveQuestion(movingSubject(id), stationTitleOf(to.station)),
    )
  ) {
    return false;
  }
  endUndo();
  const outcome = editor.moveChild(id, to);
  refresh();
  if (outcome.kind === "refused") {
    toast(outcome.reason);
    return false;
  }
  if (outcome.kind !== "moved") return false;
  tourChanged();
  // A story goes whole, its steps keeping their layout around the new
  // station's centre; a single item stands at that centre.
  const across =
    movingSubject(id).kind === "story"
      ? "its steps keep their layout around the station's centre; place it again there."
      : "it stands at the station's centre; place it again there.";
  const notes: string[] =
    to.place === "station"
      ? [`Moved to "${stationTitleOf(to.station)}": ${across}`]
      : [];
  if (outcome.answers > 0) {
    notes.push(
      outcome.answers === 1
        ? "1 answer that led to it now goes on to the next entry."
        : `${String(outcome.answers)} answers that led to it now go on to the next entry.`,
    );
  }
  if (outcome.floored) {
    notes.push(
      `"${itemCalled(id)}" now stands in the world in its kind's usual view.`,
    );
  }
  if (notes.length > 0) toast(notes.join(" "));
  return true;
}

/** What a move of the station child `id` moves, named as the history
 *  names it (`childCalled`): a story, or one item. */
function movingSubject(id: string): {
  kind: "story" | "item";
  name: string;
} {
  const tour = manifestToWrite(store.getState().tourDocument);
  if (tour === null) return { kind: "item", name: "" };
  const story = tour.stations.some((s) =>
    tourStories(s).some((t) => t.id === id),
  );
  return { kind: story ? "story" : "item", name: childCalled(tour, id) };
}

/** An item given a station of its own where it stands ("Move to a new
 *  station"): one step; the new station is selected and said. */
function splitItem(id: string): void {
  if (editor === null) return;
  const kind = manifestToWrite(store.getState().tourDocument)
    ?.stations.flatMap((s) => tourFreeBlocks(s))
    .find((i) => i.id === id)?.kind;
  endUndo();
  const outcome = editor.moveToNewStation(id);
  if (outcome.kind === "refused") {
    refresh();
    toast(outcome.reason);
    return;
  }
  // The pages' word (a pin, a photo), never the file's block kind.
  const word = kind === undefined ? "item" : kindNoun(kind);
  showNewStation(
    outcome.stationId,
    (title) => `New station "${title}" with the ${word} in it`,
  );
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
  for (const c of choices) {
    const title = model?.items.find((i) => i.id === c.id)?.title ?? c.id;
    const { choice, thumb } = coverChoice(c.id, title, c.id === chosen);
    coverList.append(choice);
    const urls = coverUrls;
    // A file brought in here is read from the session (`readContent`).
    void readContent(c.image)
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
  apply: (next, needsNoGps) =>
    editor?.setDetails(next, needsNoGps) ?? {
      kind: "refused",
      reason: "No tour is open.",
    },
  onApplied: (kind) => {
    if (kind === "changed") endUndo();
    refresh();
    toast(kind === "changed" ? DETAILS_CHANGED : DETAILS_UNCHANGED);
    if (kind === "changed") tourChanged();
  },
  // Written with the details by Apply: one change, one toast.
  noGps: {
    input: detailsNoGpsInput,
    current: () => editor?.needsNoGps() ?? false,
    preview: (on) => {
      detailsNoGpsLines.show(
        editor === null || !on ? [] : noGpsWarnings(editor.noGpsCheck()),
      );
    },
  },
  onClose: () => {
    releaseOutside?.();
    releaseOutside = null;
    releaseCoverThumbs();
    coverList.replaceChildren();
    if (!topbar.hidden) tourName.focus();
  },
});

/** The tour's details dialog: from the tour's name (and its pen), and
 *  from File's Tour details…. */
function openDetails(): void {
  if (editor === null || ui().busy) return;
  details.open();
  releaseOutside = holdOutside(element("details-modal"));
}

tourName.addEventListener("click", openDetails);

/** One of the page's dialogs shows. */
function dialogOpen(): boolean {
  return (
    !modal.hidden ||
    storyPreview.isOpen() ||
    details.isOpen() ||
    done.isOpen() ||
    characters.dialogOpen()
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

/** Whether the editor's own keys may act on `event`: a field's, a menu's
 *  and a toolbar's keys are their own (`key-target.ts`), and none acts
 *  over a dialog, the start card or a busy page. */
function editKeysFree(event: KeyboardEvent): boolean {
  return (
    !inField(event.target) &&
    !inMenu(event.target, event.key) &&
    !inComposite(event.target, event.key) &&
    !dialogOpen() &&
    Boolean(modal.hidden) &&
    !ui().busy
  );
}

/** Ctrl+C, Ctrl+X and Ctrl+V on the page: Copy, Cut and Paste
 *  (`copySelection`, `cutSelection`, `pasteSelection`); whether the key
 *  was the page's.
 *  Wherever the editor's keys are not free, and while text is selected
 *  on the page, they stay the browser's, so text still copies as text. */
function clipboardKeys(event: KeyboardEvent): boolean {
  const c = commandKey(event, "c");
  const x = commandKey(event, "x");
  const v = commandKey(event, "v");
  if ((!c && !x && !v) || event.shiftKey || editor === null) return false;
  if (!editKeysFree(event) || window.getSelection()?.isCollapsed === false) {
    return false;
  }
  event.preventDefault();
  // A held key repeats; one press copies or pastes once (a held Ctrl+C
  // would flood the page with toasts).
  if (event.repeat) return true;
  if (c) copySelection();
  else if (x) cutSelection();
  else void pasteSelection();
  return true;
}

function showModal(on: boolean): void {
  modal.hidden = !on;
  // Cancel returns to the open tour; with none there is nothing to return to.
  cancelButton.hidden = session === null;
  if (on) {
    openError.hidden = true;
    resetStartCard();
  }
  // An autosave held while the dialog showed may start now, and so may a
  // resave (D33).
  else {
    autosave.poke();
    void resaveIfDue();
  }
}

/** Leaving would lose edits: changes not saved, a save not delivered, or
 *  an inspector field being typed in (in no tour and no draft yet). */
function unsavedWork(): boolean {
  return (
    saving() ||
    undelivered !== null ||
    (editor?.changeCount() ?? 0) > 0 ||
    // An edit waiting for the draft question is work not yet applied.
    store.draftGate.waiting() ||
    shell.dirty()
  );
}

/** Set once the page asked before leaving itself (a reload of the
 *  cannot-open page): the browser's prompt would ask a second time. */
let leavingOnPurpose = false;
window.addEventListener("beforeunload", (event) => {
  if (!leavingOnPurpose && unsavedWork()) event.preventDefault();
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
  if (clipboardKeys(event)) return;
  if (event.key !== "Escape") return;
  switch (
    escapeAction({
      charactersOpen: characters.dialogOpen(),
      detailsOpen: details.isOpen(),
      doneOpen: done.isOpen(),
      pointPick: ui().pointPick,
      startShown: !modal.hidden,
      tourOpen: session !== null,
      busy: ui().busy,
      cutPending: ui().clipboard?.mode === "cut",
    })
  ) {
    // The dialog's own Escape closes it (a native modal dialog).
    case "native":
      return;
    case "details":
      details.close();
      return;
    case "done":
      done.close();
      return;
    // "Pick in 3D" armed: Escape disarms it and keeps the selection.
    case "pointPick":
      store.dispatch(editorViewActions.pointPickAsked({ on: false }));
      return;
    case "closeStart":
      showModal(false);
      return;
    // A pending Cut: Escape cancels it, the tour as it was.
    case "clearCut":
      store.dispatch(editorViewActions.clipboardCleared());
      toast("Cut cancelled");
      return;
    case "deselect":
      select(null);
  }
});

function setBusy(on: boolean, text: string): void {
  store.dispatch(editorViewActions.busyChanged({ busy: on }));
  cancelButton.disabled = on;
  openStatus.textContent = text;
  renderStartCard();
}

/**
 * The files held for the start card's answers, until "Open the editor":
 * the tour picked (with what it may be saved through) and the scan. A
 * File is never store state (the root rule's side table for Blobs): the
 * store's `editorStart` holds their names, which is what every view reads,
 * and these go with them (`holdTour`, `holdScan`, `resetStartCard`).
 */
const startFiles: { tour: PickedTourFile | null; scan: File | null } = {
  tour: null,
  scan: null,
};

function holdTour(picked: PickedTourFile | null): void {
  startFiles.tour = picked;
  store.dispatch(
    editorStartActions.tourHeld({ name: picked?.file.name ?? null }),
  );
}

function holdScan(scan: File | null): void {
  startFiles.scan = scan;
  store.dispatch(editorStartActions.scanHeld({ name: scan?.name ?? null }));
}

/** The card shown afresh: nothing answered, nothing held. */
function resetStartCard(): void {
  startFiles.tour = null;
  startFiles.scan = null;
  linkInput.value = "";
  store.dispatch(editorStartActions.startReset());
}

/** The start card drawn from the store (`startCardView`). */
function renderStartCard(): void {
  const start = selectEditorStart(store.getState());
  const view = startCardView(start, linkInput.value);
  const idle = isEntryIdle(ui());
  for (const answer of startAnswers) {
    answer.checked = answer.value === start.from;
    answer.disabled = !idle;
  }
  startTourStep.hidden = !view.tourStep;
  startScanStep.hidden = !view.scanStep;
  startTourHeld.textContent =
    start.tour === null ? TOUR_PICK_TITLE : `Your tour: ${start.tour}`;
  startScanHeld.textContent =
    start.scan === null ? "No scan" : `Scan: ${start.scan}`;
  startScanRemove.hidden = start.scan === null;
  startScanButton.textContent =
    start.scan === null ? "Add a scan…" : "Another scan…";
  // Every control that starts an entry, off while one runs: an open, or a
  // tour's scan being added after it (`isEntryIdle`).
  startScanButton.disabled = !idle;
  startScanRemove.disabled = !idle;
  zipInput.disabled = !idle;
  chooseButton.disabled = !idle;
  linkInput.disabled = !idle;
  startSummary.textContent = view.summary;
  startOpen.disabled = !idle || !view.canOpen;
}

/** The opened file's hold and target, and the written bytes' session, go
 *  with the tour they belong to. */
function leaveFile(): void {
  // The shelf's jobs and the model import's belong to the tour that leaves.
  editor?.imports.close();
  editor?.shelf.close();
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
  store.dispatch(debugLayerActions.statusSaid({ line: "" }));
}

/** The open tour's debug layer: view state only, never in the tour
 *  document, a save or the draft. What it drew and its switch are the
 *  store's (`debugLayer`), which the 3D view draws. */
let debugLayer: DebugLayer | null = null;
/** Its decoded thumbnails, keyed as the store's captures: decoded
 *  pictures stay out of the store. */
const debugThumbs = createDebugThumbs();
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
const debugAdd = createAddDebugButton(
  debugAddButton,
  menuItemControl(fileDebugAdd),
);

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
    // once a save rewrote it, as the tour's photos do.
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
  // The tour's own walk is kept while added debug data is shown
  // (`tour-walk-kept.ts`).
  walkGeo = walkAtLayerStart(walkGeo, addedDebug !== null);
  const from = debugSource();
  debugSwitch.hidden = from === null;
  store.dispatch(debugLayerActions.statusSaid({ line: from?.line ?? "" }));
  if (from === null) return;
  store.dispatch(
    debugLayerActions.started({
      source: addedDebug !== null ? "added" : "walk",
    }),
  );
  const layer = createDebugCaptureLayer<HTMLImageElement>({
    read: (options) => debugCapturesOf(from.source, options),
    loadPicture: from.loadPicture,
    pictureProblem,
    thumbnail: decodeDebugThumbnail,
    view: {
      draw: (captures) => {
        walkGeo = walkAfterDraw(walkGeo, from.source, tourWalk, captures);
        debugThumbs.clear();
        store.dispatch(
          debugLayerActions.drawn({
            captures: captures.map((c) => ({
              image: c.image,
              lat: c.geo.lat,
              lon: c.geo.lon,
              alt: c.geo.alt,
            })),
          }),
        );
      },
      thumb: (image, picture) => {
        debugThumbs.set(image, picture);
      },
      clear: () => {
        debugThumbs.clear();
        store.dispatch(debugLayerActions.cleared());
      },
    },
    status: (line) => {
      store.dispatch(
        debugLayerActions.statusSaid({
          line: from.line === null ? line : `${from.line} ${line}`,
        }),
      );
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
async function addDebugData(file: File): Promise<AddScanOutcome | null> {
  const mine = editor;
  if (mine === null) return null;
  return debugAdd.run(async (): Promise<AddScanOutcome | null> => {
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
      return null;
    }
    if (added.kind === "refused") {
      return { kind: "refused", reason: added.reason };
    }
    forgetAddedDebug();
    addedDebug = { session: added.session, line: added.line };
    startDebugLayer();
    rememberScan(mine, file);
    return { kind: "added" };
  });
}

/**
 * The scan just added becomes the one this tour offers to show again
 * after a reload: its handle remembered by the tour's id. A scan with no
 * handle (dropped, or from a file input) cannot be read again, so the
 * one remembered before is forgotten: "again" never means an older scan
 * than the last one shown.
 */
function rememberScan(mine: EditorSession, file: File): void {
  const tourId = mine.debugTour().tourId;
  const handle = scanHandles.get(file);
  void (handle === undefined
    ? scanMemory.forget(tourId)
    : scanMemory.remember(tourId, handle));
}

/**
 * After a tour opened with no scan: when this browser remembers one for
 * it, a held toast offers "Show the scan again" (`runShowScanAgain`:
 * read permission asked in the click, busy meanwhile, a failure said; a
 * scan gone since is forgotten and the offer withdrawn).
 */
async function offerRememberedScan(mine: EditorSession): Promise<void> {
  const tourId = mine.debugTour().tourId;
  const handle = await scanMemory.recall(tourId);
  if (handle === null || editor !== mine || addedDebug !== null) return;
  const offer = toast(
    scanRememberedLine(handle.name),
    {
      label: SHOW_SCAN_AGAIN_LABELS.idle,
      run: (button) => {
        void runShowScanAgain(button, handle.name, {
          reopen: () => reopenScan(handle),
          add: (file) => {
            scanHandles.set(file, handle);
            return addScan(file);
          },
          forget: () => {
            void scanMemory.forget(tourId);
          },
        }).then((result) => {
          if (result.kind === "done" || !result.keepOffer) offer.remove();
          if (result.kind === "failed") {
            fileToasts.push(toast(result.line, undefined, null));
          }
        });
      },
    },
    null,
  );
  fileToasts.push(offer);
}

/**
 * A scan chosen through the browser's picker (its handle kept, so the
 * scan can be remembered), else through `input`, for `use`.
 */
async function chooseScan(
  input: HTMLInputElement,
  use: (file: File) => Promise<void>,
): Promise<void> {
  const outcome = await pickScanFile(window as unknown as PickerWindow);
  if (outcome.kind === "unavailable") {
    input.click();
    return;
  }
  if (outcome.kind === "cancelled") return;
  if (outcome.kind === "unreadable") {
    toast(`The chosen file could not be read: ${outcome.reason}`);
    return;
  }
  scanHandles.set(outcome.file, outcome.handle);
  await use(outcome.file);
}

/** Said when a scan started no add: another add ran. */
const SCAN_NOT_STARTED = "another scan was being added at the same time.";

/**
 * One add of a scan as every caller starts it: refused in words while
 * another add runs, a throw said as a refusal (`addScanSafely`). Null -
 * no tour, or another tour opened meanwhile - says nothing: the scan was
 * never that tour's. The debug panel's status line stands in the 3D view,
 * hidden while the view loads or cannot open: an add that lands then is
 * said in a toast instead.
 */
async function addScan(file: File): Promise<AddScanOutcome | null> {
  if (debugAdd.busy()) {
    return { kind: "refused", reason: SCAN_NOT_STARTED };
  }
  const outcome = await addScanSafely(() => addDebugData(file));
  if (outcome?.kind === "added" && !ui().view3dShown) {
    fileToasts.push(toast(addedOffViewLine(file.name)));
  }
  return outcome;
}

/** What an add says when the 3D view, which draws it, does not show. */
const addedOffViewLine = (name: string): string =>
  `Added ${name} as debug data: it shows once the 3D view opens.`;

/** {@link addScan} from its own button or panel: a refusal said in a
 *  toast. */
async function addDebugDataSaying(file: File): Promise<void> {
  const outcome = await addScan(file);
  if (outcome?.kind === "refused") {
    fileToasts.push(toast(notAddedLine(outcome.reason)));
  }
}

/** The file the browser's picker gave, with what it may be saved through. */
interface PickedTourFile {
  readonly file: File;
  readonly handle: WritableFileHandle | null;
  readonly picked: FileSystemHandle | null;
}

/** The files sorted (`classifyEditorFiles`), the card busy meanwhile. */
async function readKinds(files: readonly File[]): Promise<EditorFileKind[]> {
  openError.hidden = true;
  const [only] = files;
  setBusy(
    true,
    files.length === 1 && only !== undefined
      ? `Reading ${only.name}…`
      : `Reading ${String(files.length)} files…`,
  );
  try {
    return await classifyEditorFiles(files);
  } finally {
    setBusy(false, "");
  }
}

/**
 * Files chosen in, or dropped on, the start card's tour picker: sorted
 * first (`classifyEditorFiles`, their zip directories only), then held
 * (`sortTourPick`) until "Open the editor" - a tour as the tour, a scan
 * that came along (or came alone) as question 2's scan. Nothing opens
 * here. A refusal is said in the card. Resolves true when a tour is held.
 */
async function holdTourFiles(
  files: readonly File[],
  picked: PickedTourFile | null = null,
): Promise<boolean> {
  if (!isEntryIdle(ui()) || files.length === 0) return false;
  const pick = sortTourPick(await readKinds(files));
  if (pick.kind === "refuse") {
    openError.textContent = pick.reason;
    openError.hidden = false;
    return false;
  }
  for (const left of pick.ignored) {
    toast(`Left out ${left.file.name}: ${left.reason}`);
  }
  if (pick.scan !== null) holdScan(pick.scan);
  if (pick.tour === null) {
    // Only a scan came: kept for question 2 (a refusal names no file).
    openStatus.textContent = scanKeptInsteadLine(pick.scan?.name ?? "");
    return false;
  }
  // One tour at a time: a file chosen replaces a link typed.
  linkInput.value = "";
  holdTour(
    picked !== null && picked.file === pick.tour
      ? picked
      : { file: pick.tour, handle: null, picked: null },
  );
  return true;
}

/**
 * Opens `tour`, then adds `scan` beside it when one is given, as one busy
 * state (`openWithScan`, the store's `entryStep`, a held line meanwhile).
 * `picked` is what the tour may be saved through when it came from the
 * browser's picker. The outcome's failures are said here.
 */
async function openTourWithScan(
  tour: File,
  scan: File | null,
  picked: PickedTourFile | null,
): Promise<OpenWithScanOutcome> {
  let stepLine: HTMLElement | null = null;
  const outcome = await openWithScan(tour, scan, {
    open: (file) =>
      picked !== null && file === picked.file
        ? openFile(file, picked.handle, picked.picked)
        : openFile(file),
    addScan,
    step: (step) => {
      store.dispatch(editorViewActions.entryStepChanged({ step }));
      stepLine?.remove();
      stepLine =
        step === null || scan === null
          ? null
          : toast(
              entryStepLine(step, tour.name, scan.name),
              undefined,
              null,
              false,
            );
    },
  });
  if (outcome.kind === "scan-failed") {
    fileToasts.push(toast(outcome.line, undefined, null));
  }
  if (outcome.kind === "opened" && scan === null && editor !== null) {
    void offerRememberedScan(editor);
  }
  const thrown = notOpenedLine(outcome);
  if (thrown !== null) {
    // The open threw past its own refusals: it said nothing, and left
    // its busy state on.
    setBusy(false, "");
    openError.textContent = thrown;
    openError.hidden = false;
  }
  return outcome;
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
  setUndelivered(null);
  delete saveStatus.dataset["saved"];
}

/** The tour is gone (a late integrity failure): nothing of it stays on
 *  screen, and the dialog says why. */
function dropTour(reason: string): void {
  details.close();
  // Closed even while a move runs: its tour is gone.
  done.close(true);
  view3d.close();
  select(null);
  const open = session;
  session = null;
  editor = null;
  shelfPanel?.destroy();
  shelfPanel = null;
  model = null;
  fileKey = null;
  tourDraft = null;
  savedIntoChosen = false;
  chosenAtOpen = false;
  draft.close();
  store.dispatch(tourDocumentActions.closed());
  resetEditing();
  leaveFile();
  void open?.close().catch(() => undefined);
  topbar.hidden = true;
  shellBar.hidden = true;
  renderTourName();
  showModal(true);
  openError.textContent = reason;
  openError.hidden = false;
}

/**
 * The page's own save target for a file picked with write permission: one
 * tab per file name, and a second tab may still choose to edit here.
 * Resolves to whether the target is attached now (false while another tab
 * holds the name, or when the file cannot be saved in place).
 */
async function attachTarget(
  mine: EditorSession,
  handle: WritableFileHandle,
  file: File,
): Promise<boolean> {
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
    return false;
  }
  const take = async (): Promise<boolean> => {
    try {
      const made = await createSaveTarget(handle, file);
      if (editor !== mine) return false;
      target = made;
      // Written in place from now on, so it saves by itself too (edits made
      // before the target came are saved once the delay has passed) -
      // unless every save of it would rewrite more than the cap (E2b-2
      // milestone review #3: the cost is linear in the file's size).
      // The files brought in before the target came ride along too - those
      // the write keeps: one nothing names is left out of it. Judged as
      // `judgeAutosave` judges it after every edit (`nextSaveBytes`): on
      // the tour's size, not the attached file's, which falls behind once
      // a copy was saved before the target came (editor-files.spec.js).
      const largeTour = !autosaveFits(mine.nextSaveBytes(), autosaveMaxBytes);
      store.dispatch(tourDocumentActions.saveLimited({ largeTour }));
      autosave.enable(!largeTour);
      renderSaveState();
      return true;
    } catch (err) {
      if (editor !== mine) return false;
      fileToasts.push(
        toast(
          `This file cannot be saved in place (${err instanceof Error ? err.message : String(err)}), so Save downloads a copy.`,
        ),
      );
      return false;
    }
  };
  if (held.granted) {
    lock = held;
    return take();
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
  return false;
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
    const older = outcome.olderFormat;
    if (older !== undefined) {
      // Its draft has nothing left to be restored into: deleted, and the
      // refusal says so once it is gone.
      void draft.forget(older.fileKey).then((forgotten) => {
        if (forgotten && openError.textContent === outcome.reason) {
          openError.textContent = olderFormatRefusal(older.error, true);
        }
      });
    }
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
  // The store's draft question for this open (`tour-draft-slice.ts`).
  store.dispatch(tourDraftActions.readStarted());
  const question = selectTourDraft(store.getState()).generation;
  // The opened file's entries: a smaller file it already holds at its
  // path (a save by download) is no work of the draft's any more.
  const wrap = outcome.session.manifestWrap;
  const entries = new Map(outcome.session.entries.map((e) => [e.filename, e]));
  const drafted = await draft.open(
    outcome.session.archive.url,
    outcome.manifest,
    (path) => entries.get(`${wrap}${path}`),
  );
  setBusy(false, "");
  details.close();
  done.close(true);
  // The 3D view showed the tour that goes now.
  view3d.close();
  linkHost = null;
  linkHosted = undefined;
  datedSave = false;
  select(null);
  const previous = session;
  session = outcome.session;
  void previous?.close().catch(() => undefined);
  resetEditing();
  leaveFile();
  openedFile = { name: outcome.fileName, handle: picked };
  savedIntoChosen = false;
  chosenAtOpen = false;
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
    // A model brought in is measured, and a video's poster minted, by the
    // browser here: three's loader on first use, a video element.
    fileReaders: {
      measureModel: async (blob) => {
        const [{ loadGlbModel }, { largestSide }] = await Promise.all([
          import("../glb-model.js"),
          import("../model-scale.js"),
        ]);
        return largestSide(await loadGlbModel(blob));
      },
      videoLookOf: (blob) => videoLookOf(blob),
    },
  });
  model = editor.model();
  openedLevels = outcome.levels;
  openShelfPanel(editor);
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
  setChecked(keepWalk, false);
  keepWalk.hidden = !carriesWalk;
  store.dispatch(editorViewActions.walkChanged({ openedWalk: carriesWalk }));
  renderTourName();
  element("tour-file").textContent = outcome.fileName;
  topbar.hidden = false;
  shellBar.hidden = false;
  showModal(false);
  renderSaveState();
  toast(`Opened ${outcome.fileName}: ${openedSummary(model)}`);
  sayNoBackup();
  sayUnreadDraft();
  keepStorage();
  // What the reader dropped is said, never lost silently by the next
  // save; kept until closed, as an instruction.
  fileToasts.push(
    ...showOpenedNotices(
      openedNoticeLines(outcome.dropped, outcome.manifest),
      drafted.superseded,
      toast,
    ),
  );
  // A tour opened afresh into the 3D view flies in; a draft to restore
  // goes straight to it.
  approachNext = drafted.offer === null;
  if (drafted.offer !== null) offerDraft(editor, drafted.offer, question);
  else store.dispatch(tourDraftActions.noneFound({ generation: question }));
  if (handle !== null) void attachTarget(editor, handle, file);
  // After the open, never before it: the replay must not hold up the tour.
  tourWalk = carriesWalk ? opened : null;
  debugPanel.hidden = false;
  startDebugLayer();
  // The 3D view is the default (its load is said in the bottom bar; a
  // failure is said on its own page, `view3d-failed-page.ts`).
  view3d.open();
  return true;
}

/**
 * What an earlier visit left, offered with the tour: Restore puts it back,
 * Not now leaves it for the next open, Delete it throws it away. It stays
 * until answered. Its answers are `draft-offer.ts`'s; this renders them.
 */
function offerDraft(
  mine: EditorSession,
  offer: EditorDraftOffer,
  question: number,
): void {
  let shown: HTMLElement | null = null;
  const render = (view: DraftOfferView | null): void => {
    shown?.remove();
    shown = null;
    if (view === null) return;
    const t = toast(
      view.text,
      [
        { label: "Restore", run: () => answers.restore() },
        { label: "Not now", run: () => answers.notNow() },
        {
          label: view.deleting ? DRAFT_DELETING : "Delete it",
          run: () => void answers.deleteIt(),
        },
      ],
      null,
      false,
    );
    t.classList.add("draft-offer");
    // In progress (async-ui-feedback): no answer while "Delete it" runs,
    // a re-show included.
    if (view.deleting) {
      for (const b of t.querySelectorAll("button")) b.disabled = true;
    }
    fileToasts.push(t);
    shown = t;
  };
  const answers = createDraftOffer({
    store,
    question,
    text: offer.text,
    render,
    say: (text, error = false) => {
      if (error) toast(text, undefined, null);
      else toast(text);
    },
    current: () => editor === mine,
    restore: () => {
      const applied = mine.restore(offer);
      draft.restored();
      const count = applied.changed + applied.deleted;
      return { count, line: restoredLine(count, offer) };
    },
    discard: () => draft.discard(),
    discardFailed: DISCARD_FAILED,
    changed: (count, restored) => {
      if (restored && count > 0) endUndo();
      refresh();
      // Restored work is pending work: saved by itself like any edit.
      if (count > 0) tourChanged();
    },
  });
}

/** "Choose…" and the drop box: the browser's file picker where it exists,
 *  for a file that can be saved in place, else the file input. */
async function chooseTour(): Promise<void> {
  if (!isEntryIdle(ui()) || ui().picking) return;
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
  // A scan chosen here instead of a tour may be remembered too.
  scanHandles.set(outcome.file, outcome.handle);
  await holdTourFiles([outcome.file], {
    file: outcome.file,
    handle: outcome.writable ? outcome.handle : null,
    picked: outcome.handle,
  });
}

/** Said, once the tour opened, when its picked file may not be written. */
const NOT_WRITABLE_LINE =
  "The browser did not allow saving to this file, so Save downloads a copy.";

/**
 * "Open the editor" (and Enter in the link field): what the start card's
 * answers name, opened (`startCardView`). The unsaved-work guard came
 * before the card showed (`openAnotherTour`). Each start asks its save
 * question IN this click where it asks one (a new tour, a link): a
 * browser opens the dialog only close to a click. The example asks none:
 * it is looked at first, and its first Save asks.
 */
function openFromStart(): void {
  if (!isEntryIdle(ui())) return;
  const start = selectEditorStart(store.getState());
  const view = startCardView(start, linkInput.value);
  if (!view.canOpen || start.from === null) return;
  const scan = view.scanStep ? startFiles.scan : null;
  openError.hidden = true;
  const run: Record<StartFrom, () => void> = {
    example: () => {
      void openExample();
    },
    new: () => {
      startNew(scan);
    },
    tour: () => {
      const held = startFiles.tour;
      if (held === null) {
        openLink(linkInput.value, scan);
        return;
      }
      void openTourWithScan(held.file, scan, held).then((outcome) => {
        // Said about the tour just opened, never over the one that stayed.
        if (
          outcome.kind !== "not-opened" &&
          held.picked !== null &&
          held.handle === null
        ) {
          toast(NOT_WRITABLE_LINE);
        }
      });
    },
  };
  run[start.from]();
}

/** The example tour, fetched and opened, with no save question: it is
 *  looked at first, and Save asks where once there is something to keep. */
async function openExample(): Promise<void> {
  setBusy(true, "Fetching the example tour…");
  let file: File;
  try {
    const response = await fetch(SAMPLE_URL);
    if (!response.ok) {
      throw new Error(`the example answered ${String(response.status)}`);
    }
    file = new File([await response.blob()], SAMPLE_NAME, {
      type: "application/zip",
    });
  } catch (err) {
    setBusy(false, "");
    openError.textContent = `The example tour could not be fetched: ${
      err instanceof Error ? err.message : String(err)
    }`;
    openError.hidden = false;
    return;
  }
  setBusy(false, "");
  if ((await openTourWithScan(file, null, null)).kind !== "not-opened") {
    datedSave = true;
  }
}

/**
 * A new, empty tour (`startNewTour`, its own minted id, so its own draft),
 * then the scan beside it when one is held. The save dialog is asked IN
 * the click; a toast asks the card's question while it is open.
 */
function startNew(scan: File | null): void {
  let asking: HTMLElement | null = null;
  void startNewTour<Promise<SaveFilePick> | null>({
    askSaveFile: (name) => {
      const pick = askOpenSaveFile(name);
      if (pick !== null) {
        asking = toast(NEW_TOUR_SAVE_QUESTION, undefined, null, false);
        void pick.finally(() => asking?.remove());
      }
      return pick;
    },
    open: async (file) =>
      (await openTourWithScan(file, scan, null)).kind !== "not-opened",
    keepInChosenFile: (file, pick) => {
      if (pick === null) return; // no save dialog here: Save downloads
      // The tour may have been dropped while its scan was added (a late
      // integrity failure): nothing is written into the pick then.
      if (editor === null) settleUnusedPick(pick);
      else void keepInChosenFile(editor, file, pick);
    },
    settleUnusedPick,
    failed: (reason) => {
      openError.textContent = `The new tour could not be started: ${reason}`;
      openError.hidden = false;
    },
  }).then((opened) => {
    if (!opened) return;
    datedSave = true;
    // Over the whole Earth, or at the scan: where the first station goes.
    fileToasts.push(toast(EMPTY_GLOBE_HINT, undefined, null));
  });
}

/**
 * A hosted tour, from its link (tour editor plan 2026-10-17-1816, W1): the
 * viewer's transport fetches it whole, then it opens as a chosen file does
 * (no file handle: Save downloads the new copy), with the held scan
 * beside it. Where to save it is asked first, in the click.
 */
function openLink(link: string, scan: File | null): void {
  const pick = askOpenSaveFile(linkFileName(link));
  setBusy(true, "Fetching the tour from its link…");
  fetchTourFile(link, {
    corsProxyBaseUrl: driveProxyBaseUrl(location.hostname),
  })
    .then(async (file) => {
      setBusy(false, "");
      const outcome = await openTourWithScan(file, scan, null);
      if (outcome.kind === "not-opened" || editor === null) {
        settleUnusedPick(pick);
        return;
      }
      // Done names the host the tour was fetched from (W2); a link to no
      // cloud host is an own server's (GitHub Pages included).
      linkHost = hostOfLink(link) ?? "own";
      // ... and the name its file has there, which the saved one (dated)
      // does not carry.
      linkHosted = linkHostedName(link);
      datedSave = true;
      if (pick !== null) void keepInChosenFile(editor, file, pick);
    })
    .catch((err: unknown) => {
      setBusy(false, "");
      openError.textContent = linkOpenErrorText(err, link);
      openError.hidden = false;
      settleUnusedPick(pick);
    });
}

/** Question 2's file: a scan is held, anything else refused in words. */
async function holdScanFile(file: File): Promise<void> {
  if (!isEntryIdle(ui())) return;
  openError.hidden = true;
  setBusy(true, `Reading ${file.name}…`);
  let kind: EditorFileKind;
  try {
    kind = await classifyEditorFile(file);
  } finally {
    setBusy(false, "");
  }
  const pick = sortScanPick(kind);
  if (pick.kind === "refuse") {
    openError.textContent = pick.reason;
    openError.hidden = false;
    return;
  }
  holdScan(pick.scan);
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
    writes?.landed(save.written, writtenKey, save.wrote);
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
    writes?.landed(save.written, writtenKey, save.wrote);
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
): Promise<boolean> {
  let file: File;
  try {
    file = await handle.getFile();
  } catch (err) {
    // Saved all the same, but not adopted: the next Save asks again. Said,
    // or the creator would wait for saves by itself that never come.
    if (editor === mine) {
      fileToasts.push(
        toast(
          `Your tour is saved in ${handle.name}, but the editor could not keep saving into that file (${err instanceof Error ? err.message : String(err)}), so the next Save asks for a file again.`,
          undefined,
          null,
        ),
      );
    }
    return false;
  }
  if (editor !== mine) return false;
  openedFile = { name: handle.name, handle };
  element("tour-file").textContent = handle.name;
  return attachTarget(mine, handle, file);
}

/**
 * The first Save of a tour without a file to save into (from a link, the
 * sample, a drop or the file input) asks where to save it - IN the click,
 * before any await: Chromium opens the dialog only within a few seconds of
 * a click, and the build can take longer (the walk's move's rule). Null
 * where there is nothing to ask: no tour, a file to save into (or one the
 * page may not write: that stays a download), nothing to save, a save
 * running, or a browser that does not adopt (`adoptsSavedFile`: one
 * without both file dialogs).
 */
function askSaveFile(): Promise<SaveFilePick> | null {
  const mine = editor;
  if (
    mine === null ||
    target !== null ||
    (openedFile?.handle ?? null) !== null ||
    saving() ||
    !unsavedWork() ||
    !adoptsSavedFile(window as unknown as PickerWindow & SavePickerWindow)
  ) {
    return null;
  }
  return pickSaveFile(
    window as unknown as SavePickerWindow,
    datedSave ? datedFileName(mine.savedName(), new Date()) : mine.savedName(),
  );
}

/** The open tour came from a link or the sample: its first Save suggests
 *  the name dated to the second, as its open's dialog did, so it does not
 *  suggest the file that holds an earlier edit of the same tour. Reset by
 *  every open. */
let datedSave = false;

/** The open tour's changes were last delivered into a file the first Save
 *  asked for (`askSaveFile`), not into one opened: Done names it as the
 *  file chosen then. Reset by every open. */
let savedIntoChosen = false;

/** The open tour from a link or the sample was written into the file its
 *  open asked for (`keepInChosenFile`): Done names it as the file chosen
 *  then. Reset by every open. */
let chosenAtOpen = false;

/** The name of the file the open's write is filling while it holds the
 *  save slot (`keepInChosenFile`, the "open" claim); null otherwise. */
let openWriting: string | null = null;

/** The tour whose open waits to write into the file it asked for
 *  (`keepInChosenFile`), from the open until that write holds the save
 *  slot or is given up. A Save queued for it meanwhile waits for that
 *  file (`runQueuedSave`) instead of finding none and being dropped. */
let openWriteOf: EditorSession | null = null;

/**
 * A tour from a link or the sample asks where to save it IN the open's
 * click, before any await (Chromium opens the dialog only within a few
 * seconds of a click, and the fetch can take longer), so it is a file from
 * its first edit. Only where the browser adopts a saved file
 * (`adoptsSavedFile`): without the save dialog the tour stays in this
 * browser's draft until Save, as before. Null there, and for text that is
 * not a link (`name` null: the open refuses it). The dialog suggests the
 * name dated to the second (`datedFileName`): the same link reopened must
 * not suggest the file that holds its edited tour.
 */
function askOpenSaveFile(name: string | null): Promise<SaveFilePick> | null {
  if (
    name === null ||
    !adoptsSavedFile(window as unknown as PickerWindow & SavePickerWindow)
  ) {
    return null;
  }
  return pickSaveFile(
    window as unknown as SavePickerWindow,
    datedFileName(name, new Date()),
  );
}

/** The file picked at the open of `mine`, while it is still the open tour
 *  and saves into no file yet (a Save may have asked meanwhile); null once
 *  the dialog was dismissed or refused, or the tour changed. */
async function stillToChoose(
  mine: EditorSession,
  pick: Promise<SaveFilePick>,
): Promise<FileSystemFileHandle | null> {
  const picked = await pick;
  if (picked.kind !== "picked" || editor !== mine) return null;
  if (target !== null || (openedFile?.handle ?? null) !== null) return null;
  return picked.handle;
}

/** The file picked at the open could not be written: a toast that stays
 *  says why, what became of the file (`left`, `releaseUnusedPick`'s
 *  sentence) and what follows. Save asks for a file again only once there
 *  is something to save, so the toast does not promise it (r955 review
 *  #2). */
function chosenFileUnwritten(
  name: string,
  err: unknown,
  left: string | null,
): void {
  fileToasts.push(
    toast(
      `The tour is open, but ${name} could not be written (${err instanceof Error ? err.message : String(err)}).${left === null ? "" : ` ${left}`} Your changes are kept in this browser until you save.`,
      undefined,
      null,
    ),
  );
}

/**
 * The file picked at an open that did not happen (the fetch failed, or the
 * tour was refused): it is released (`releaseUnusedPick`: kept, never
 * deleted), and what became of it is said in a toast that stays, beside
 * the open's error: it holds whatever that error became meanwhile.
 */
function settleUnusedPick(pick: Promise<SaveFilePick> | null): void {
  if (pick === null) return;
  void releaseUnusedPick(pick).then((line) => {
    if (line !== null) fileToasts.push(toast(line, undefined, null));
  });
}

/**
 * The tour `mine`, just opened from `fetched` (a link's or the sample's
 * bytes), becomes the file its open asked for (`askOpenSaveFile`): once
 * the creator picked one, the fetched bytes are written there unchanged and
 * the file is adopted - saved into in place from then on, and by itself,
 * as a chosen file is (`adoptChosen`). Called only once the tour opened:
 * a failed fetch or a refused file writes nothing into the picked file. A
 * dismissed dialog writes nothing either; the first Save asks again. The
 * write says itself in the status line while it runs, and its outcome in a
 * toast.
 */
async function keepInChosenFile(
  mine: EditorSession,
  fetched: File,
  pick: Promise<SaveFilePick>,
): Promise<void> {
  // A save the creator started meanwhile runs out first; the slot is then
  // this write's until the file is adopted, since a save in between could
  // adopt another file: Save is unavailable during the write, Ctrl+S is
  // queued and runs after it, and Share and publish waits for it
  // (`savesSettled`). No await lies between the wait's last check and the
  // claim (`waitForSaveSlot`).
  openWriteOf = mine;
  let handle: FileSystemFileHandle | null;
  try {
    handle = await waitForSaveSlot(
      { busy: saving, end: () => saveEnd, settled: savesSettled },
      () => stillToChoose(mine, pick),
    );
  } finally {
    // From here the write holds the slot (no await before its claim), or
    // there is no write: a queued Save no longer waits for it.
    if (openWriteOf === mine) openWriteOf = null;
  }
  if (handle === null) {
    // A Save queued while the open waited (the dialog was dismissed, or
    // a Save chose a file meanwhile) runs now that no write will come.
    if (editor !== null) runQueuedSave(editor);
    // Picked, but no longer to be written (another tour opened, or a Save
    // chose a file meanwhile): not left behind empty and unexplained, in
    // a toast that stays.
    void releaseUnusedPick(pick).then((line) => {
      if (line !== null) fileToasts.push(toast(line, undefined, null));
    });
    return;
  }
  openWriting = handle.name;
  const ended = claimSave("open");
  const myEnd = saveEnd;
  renderSaveState();
  let adopted = false;
  let attached = false;
  try {
    await writeFileOrAbort(handle, fetched);
    if (editor !== mine) return;
    chosenAtOpen = true;
    attached = await adoptChosen(mine, handle);
    adopted = editor === mine && openedFile?.handle === handle;
  } catch (err) {
    if (editor === mine) {
      const left = await releaseUnusedPick(
        Promise.resolve({ kind: "picked", handle }),
      );
      if (editor === mine) chosenFileUnwritten(handle.name, err, left);
    }
  } finally {
    openWriting = null;
    // Let go while the slot is still this write's - also when another tour
    // opened meanwhile (an open keeps the slot): a claim left set would
    // hold every save of the next tour.
    if (saveEnd === myEnd) releaseSave();
    ended();
    renderSaveState();
    // A Save asked for (Ctrl+S) during the write runs now, into the
    // adopted file, as one waiting behind an autosave does - or into the
    // tour opened meanwhile, which it was pressed for (every open drops a
    // Save queued before it).
    if (editor !== null) runQueuedSave(editor);
    // An autosave held back during the write runs now, into the adopted
    // file, and so does a resave that fell due meanwhile.
    autosave.poke();
    if (editor === mine) void resaveIfDue();
  }
  if (adopted) {
    // "By themselves" only when the file is saved into in place and the
    // autosave runs for it: not while another tab holds its name, nor when
    // it cannot be saved in place (their toasts say why), nor for a tour
    // too large to be saved after every change.
    toast(
      attached && !saveState().largeTour
        ? `Saved to ${handle.name}. Your changes are saved into it by themselves.`
        : `Saved to ${handle.name}.`,
    );
  }
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
  // A Save queued now was pressed in the tour that shows (every open drops
  // one queued before it): it stays, and the save's end runs it there.
  renderSaveState();
  return "held";
}

/** The tour whose Save (`runSave`) runs now, or null: an open keeps the
 *  save slot's holder, so "explicit" alone cannot tell this tour's Save
 *  from the closed tour's. */
let explicitSaveOf: EditorSession | null = null;

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
    const by = saveState().by;
    if (by !== "explicit" || explicitSaveOf !== editor) {
      // Committed now, saved right after what holds the save (the
      // autosave, the write at the open, a copy, a move of the debug
      // data, or a Save of a tour closed since: an open keeps the slot's
      // holder). A second Save during this tour's own Save is the same
      // Save.
      shell.flush();
      store.dispatch(tourDocumentActions.saveQueued({ queued: true }));
    }
    return;
  }
  const mine = editor;
  explicitSaveOf = mine;
  let outcome: AutosaveOutcome;
  try {
    outcome = await saveTour("explicit", pick);
  } finally {
    if (explicitSaveOf === mine) explicitSaveOf = null;
  }
  if (editor !== mine || outcome === "held") return;
  if (outcome === "saved") autosave.saved();
  else autosave.failed();
}

/** A Save asked for while something else held the save (`runSave`)
 *  runs once the slot is free, and only for the tour it was asked for. */
function runQueuedSave(mine: EditorSession): void {
  if (!saveState().queued || editor !== mine || saving()) return;
  // The open's write into its chosen file is still to come: the Save
  // stays queued and runs into that file once it is adopted (a save
  // that ends before the write claims the slot would otherwise find no
  // file, and drop the Save).
  if (openWriteOf === mine) return;
  store.dispatch(tourDocumentActions.saveQueued({ queued: false }));
  // A tour with no file to save into asks where to save it, which the
  // browser allows only within a key press or a click - long gone now.
  // Run here, it would download the tour instead: Save asks.
  // With nothing to save, Save only says so: it asks for no file then.
  if (
    target === null &&
    (openedFile?.handle ?? null) === null &&
    unsavedWork() &&
    adoptsSavedFile(window as unknown as PickerWindow & SavePickerWindow)
  ) {
    toast(PRESS_SAVE_TO_CHOOSE);
    return;
  }
  void runSave();
}

/** Said when a queued Ctrl+S finds no file to save into (`runQueuedSave`). */
const PRESS_SAVE_TO_CHOOSE = "Press Save to choose where to save the tour.";

/**
 * "Save a copy…": the tour as it stands, built as a save is, into a file
 * of its own - the save dialog where the browser has one (asked IN the
 * click, before any await, as Save's), else a download. The tour's own
 * file and its pending edits stay as they were: a copy is not the tour's
 * save, so the status line keeps saying what is not saved. It keeps the
 * debug data only when "Keep the debug data in the tour file" is ticked
 * (a copy is what gets shared). It holds the page's save while it is
 * built ("Saving…"), and its outcome is said in a toast.
 */
async function saveCopy(): Promise<void> {
  const mine = editor;
  if (mine === null || saving()) return;
  // First, before any await: the dialog needs the click.
  const pick = pickSaveFile(
    window as unknown as SavePickerWindow,
    copyFileName(mine.savedName()),
  );
  const source = openedFile;
  // A copy's own claim: the tour's due resave and its last error stay.
  const ended = claimSave("copy");
  const myEnd = saveEnd;
  renderSaveState();
  try {
    const picked = await pick;
    if (editor !== mine || picked.kind === "cancelled") return;
    // The tour's own file chosen: the copy would land over it, and the
    // tour would no longer know what its file holds. Refused before
    // anything is built or written.
    if (
      picked.kind === "picked" &&
      ((source !== null && (await isSameFile(source, picked.handle))) ||
        (await target?.isSame(picked.handle)) === true)
    ) {
      toast(
        `${picked.handle.name} is the tour's own file - save the copy under another name. Nothing was written.`,
        undefined,
        null,
      );
      return;
    }
    const copy = await mine.saveCopy({ keepScan: isChecked(keepWalk) });
    if (editor !== mine) return;
    let name = copy.filename;
    if (picked.kind === "picked") {
      await writeFileOrAbort(picked.handle, copy.blob);
      name = picked.handle.name;
    } else if (!(await download(copy))) {
      return;
    }
    if (editor !== mine) return;
    toast(
      `Saved a copy as ${name}${
        copy.scanLeftOut.length > 0 ? ", without the debug data" : ""
      }. The tour's own file is as it was.`,
    );
  } catch (err) {
    if (editor === mine) {
      toast(
        `The copy was not saved: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        null,
      );
    }
  } finally {
    // Let go while the slot is still this copy's, whichever tour is open
    // now (`keepInChosenFile`'s rule).
    if (saveEnd === myEnd) releaseSave();
    ended();
    renderSaveState();
    // A Save asked for while the copy was built runs now - for the tour
    // that shows, which it was pressed for also when another tour opened
    // meanwhile (every open drops a Save queued before it).
    if (editor !== null) runQueuedSave(editor);
    // An autosave held back while the copy was built runs now, and so
    // does a resave (D33) that fell due meanwhile.
    autosave.poke();
    if (editor === mine) void resaveIfDue();
  }
}

/**
 * Build and deliver one save. `auto` is the autosave's: it commits
 * nothing (it never runs during a gesture of the 3D view), ends
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
      shell.flush();
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
    if (editor === mine) judgeAutosave();
    // A Save asked for while this save ran runs now, for the tour that
    // shows - also when another tour opened meanwhile (`saveCopy`'s rule).
    if (editor !== null) runQueuedSave(editor);
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
          // the creator's only copy of it (E2b plan review #1). A save
          // into the file its click asked for (`pick`) is in place too:
          // that file becomes the tour's own (`adoptChosen`), so it keeps
          // the walk, and an undo across this save writes it again (D33).
          await mine.save({
            keepScan: ui().keepsWalk || isChecked(keepWalk) || pick !== null,
            inPlace: into !== null || pick !== null,
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
      noteDelivered(inPlace, into, save, chosen);
      if (chosen !== undefined) {
        savedIntoChosen = true;
        void adoptChosen(mine, chosen);
      }
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
    setItemDisabled(saveButton, false);
    return "failed";
  }
}

saveButton.addEventListener("click", () => {
  void runSave(askSaveFile());
});
saveCopyButton.addEventListener("click", () => {
  void saveCopy();
});
fileDetailsButton.addEventListener("click", () => {
  openDetails();
});
fileCharactersButton.addEventListener("click", () => {
  if (editor !== null) characters.open();
});
// "Keep the debug data in the tour file": what the next save keeps, until
// a save was built (the switch then hides).
keepWalk.addEventListener("click", () => {
  setChecked(keepWalk, !isChecked(keepWalk));
});
// The debug layer's switch: view state only - no edit, nothing pending.
// The store holds it and the panel's status line; the switch, the line
// and the layer follow the store.
debugSwitch.addEventListener("click", () => {
  store.dispatch(
    debugLayerActions.shownChanged({
      on: !selectDebugLayer(store.getState()).shown,
    }),
  );
});
let debugShownDrawn = selectDebugLayer(store.getState()).shown;
setChecked(debugSwitch, debugShownDrawn);
store.subscribe(() => {
  const { shown, status } = selectDebugLayer(store.getState());
  if (debugStatus.textContent !== status) debugStatus.textContent = status;
  if (shown === debugShownDrawn) return;
  debugShownDrawn = shown;
  setChecked(debugSwitch, shown);
});
// "Add debug data…": its file input, or a file dropped on the panel. The
// document's own drop guard keeps the browser from opening the file.
for (const button of [debugAddButton, fileDebugAdd]) {
  button.addEventListener("click", () => {
    void chooseScan(debugAddInput, addDebugDataSaying);
  });
}
debugAddInput.addEventListener("change", () => {
  const file = debugAddInput.files?.[0];
  debugAddInput.value = "";
  if (file !== undefined) void addDebugDataSaying(file);
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
  if (file !== undefined) void addDebugDataSaying(file);
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
  // A tour and a scan may be chosen together.
  const files = Array.from(zipInput.files ?? []);
  zipInput.value = "";
  void holdTourFiles(files);
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
  // Every file dropped: a tour and a scan may come together.
  void holdTourFiles(Array.from(event.dataTransfer?.files ?? []));
});
// A file dragged over the open editor: the page shows that it takes files
// (`body.file-drag`), and the row or file field it would be used in
// (`.file-over`). The opening page's drop box and the debug panel keep
// their own drops.
let fileDropOver: Element | null = null;
function markFileDrop(next: Element | null): void {
  if (next === fileDropOver) return;
  fileDropOver?.classList.remove("file-over");
  fileDropOver = next;
  fileDropOver?.classList.add("file-over");
}
/** The element a file drag is over, when the editor takes it there. */
function fileDragAt(event: DragEvent): Element | null | undefined {
  if (editor === null || !dragHasFiles(event)) return undefined;
  const at = event.target instanceof Element ? event.target : null;
  if (at !== null && (drop.contains(at) || debugPanel.contains(at))) {
    return undefined;
  }
  return at;
}
document.addEventListener("dragover", (event) => {
  const at = fileDragAt(event);
  if (at === undefined) return;
  document.body.classList.add("file-drag");
  markFileDrop(
    fileDropTarget(at, shellTree) === null
      ? null
      : (at?.closest(`[${FILE_FIELD_ATTR}], [data-select]`) ?? null),
  );
});
document.addEventListener("dragleave", (event) => {
  if (event.relatedTarget === null) {
    document.body.classList.remove("file-drag");
    markFileDrop(null);
  }
});
document.addEventListener("drop", (event) => {
  document.body.classList.remove("file-drag");
  markFileDrop(null);
  const at = fileDragAt(event);
  if (at === undefined) return;
  void dropFiles(Array.from(event.dataTransfer?.files ?? []), at);
});
// The start card: question 1's answers, question 2's scan, and the one
// button. Nothing opens before "Open the editor" (`openFromStart`).
for (const answer of startAnswers) {
  answer.addEventListener("change", () => {
    if (!answer.checked) return;
    openError.hidden = true;
    openStatus.textContent = "";
    store.dispatch(
      editorStartActions.startChosen({ from: answer.value as StartFrom }),
    );
  });
}
linkInput.addEventListener("input", () => {
  // One tour at a time: a link typed replaces a file chosen.
  if (linkInput.value.trim() !== "" && startFiles.tour !== null) {
    holdTour(null);
  }
  renderStartCard();
});
// Enter in the link field opens the editor, as the button does.
linkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  openFromStart();
});
startOpen.addEventListener("click", openFromStart);
startScanButton.addEventListener("click", () => {
  void chooseScan(startScanInput, holdScanFile);
});
startScanInput.addEventListener("change", () => {
  const file = startScanInput.files?.[0];
  startScanInput.value = "";
  if (file !== undefined) void holdScanFile(file);
});
startScanRemove.addEventListener("click", () => {
  holdScan(null);
});
store.subscribe(renderStartCard);
renderStartCard();
cancelButton.addEventListener("click", () => {
  showModal(false);
});
/** File's Open…: the open dialog, after the unsaved-work guard. */
function openAnotherTour(): void {
  // The same guard as leaving the page (`main.ts`'s rule for switching
  // tours, E2 plan review #12).
  if (
    unsavedWork() &&
    !confirmPausingFrames(
      "Your changes are not saved yet. Open another tour anyway? They will be lost.",
    )
  ) {
    return;
  }
  showModal(true);
}
element<HTMLButtonElement>("file-open").addEventListener(
  "click",
  openAnotherTour,
);

/** Said when Share and publish's save did not land: the dialog waits
 *  for it. */
const DONE_NOT_SAVED =
  "Not ready to share yet: your changes are not saved (the status line at the bottom says why). Save them, then choose Share and publish again.";

/** The words of File's "Share and publish…" item (W2's "Done"). */
const PUBLISH_LABEL = "Share and publish…";

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
      ? {
          kind: "in-place",
          name: delivered.name,
          ...(savedIntoChosen
            ? { chosenAtSave: true }
            : chosenAtOpen
              ? { chosenAtOpen: true }
              : {}),
        }
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
  // In the click, before any await: the save dialog needs it.
  const pick = askSaveFile();
  if (unsavedWork()) {
    store.dispatch(editorViewActions.doneBusyChanged({ busy: true }));
    setItemDisabled(doneButton, true);
    doneButton.textContent = "Saving…";
    try {
      // An autosave that runs ends first (and one queued behind it).
      await savesSettled();
      if (editor === mine && unsavedWork()) await runSave(pick);
      await savesSettled();
    } finally {
      store.dispatch(editorViewActions.doneBusyChanged({ busy: false }));
      doneButton.textContent = PUBLISH_LABEL;
      setItemDisabled(doneButton, editor === null);
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
  const saved = doneSaved();
  const hostedName = doneHostedName(saved.name, {
    linkHosted,
    sampleName: SAMPLE_NAME,
  });
  done.open({
    saved,
    host: doneHost(),
    carriesWalk: walk === null ? "unknown" : walk.length > 0,
    // A file opened for writing keeps its walk (`keepsWalk`): only a save
    // as a new file can leave it out.
    debugLeftOut:
      ui().openedWalk && !ui().keepsWalk && walk !== null && walk.length === 0,
    driveMountTip: DRIVE_MOUNT_TIP_SHOWN,
    ...(hostedName === undefined ? {} : { hostedName }),
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
    if (editor === mine) refresh();
    else renderSaveState();
    // A Save asked for during the move runs now, for the tour that shows -
    // also when another tour opened meanwhile (`saveCopy`'s rule).
    if (editor !== null) runQueuedSave(editor);
    if (editor === mine) autosave.poke();
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
    // The item that opened it is in the closed menu: its menu's button.
    if (!topbar.hidden) fileMenuButton.focus();
  },
});

doneButton.addEventListener("click", () => {
  void finishEditing();
});

// What Save does in this browser (W2): a chosen file is written in place
// only where the file picker exists.
element("open-fineprint").textContent = saveFinePrint(
  window as unknown as PickerWindow & SavePickerWindow,
);

/**
 * The 3D view opener (`view3d-opener.ts`). The view's code is imported
 * here, when a tour opens, never before; it reads the tour and the
 * selection from the store, and its photos and models from the copy the
 * page reads now. A failure ends on its own page (`view3d-failed-page.ts`).
 */
const view3dBox = element("view3d");

/** A content entry of the open tour, from the copy the page reads now. */
function readContent(name: string): Promise<Blob> {
  // A file brought in is held by the session until a save writes it.
  const added = editor?.contentOf(name);
  if (added !== undefined) return Promise.resolve(added);
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
 *  selection is the page's (`select`), so the 3D view follows it. */
const shell = createEditorShell({
  store,
  // The docking library comes with the 3D view, never with the page.
  dock: () => import("./editor-shell/dock-host.js"),
  onDocked: (docked) => {
    panelsDocked = docked;
    shelfPanel?.refresh();
  },
  onFilesShown: () => {
    shelfPanel?.refresh();
  },
  select: (id) => {
    select(id);
  },
  step: runStep,
  codes: shellCodes,
  fileNameOf: (id) => store.getState().assetShelf.entries[id]?.name,
  loadPicture: readContent,
  dialogOpen,
  previewStory: (storyId, opener) => {
    const refused = storyPreview.open(storyId, opener);
    if (refused !== null) toast(refused);
  },
  stations: {
    add: addStationAt,
    reorder: reorderStations,
    moveChild,
    split: splitItem,
    duplicate: (selection) => {
      void duplicateSelection(selection);
    },
    remove: deleteSelection,
  },
  clipboard: {
    copy: copySelection,
    cut: cutSelection,
    paste: () => {
      void pasteSelection();
    },
  },
  edits: {
    ...inspectorWriteCommands(writeInspectorEdit),
    scene: commitSceneEdit,
    addItem: addItemTo,
    addStory: addStoryTo,
    addToStory: addToStoryEntry,
    addStepToStory: addStepToStoryEntry,
    addCharacter: (to) => {
      void addCharacterTo(to);
    },
    narration: (id) =>
      editor === null
        ? Promise.resolve({
            kind: "refused" as const,
            reason: "No tour is open.",
          })
        : editor.narration(id),
    editNarration: writeNarrationEdit,
    replaceFile: (id) => {
      void replaceItemFile(id);
    },
    voiceMaxBytes: autosaveMaxBytes,
    poster: writeVideoPoster,
  },
  // The tree's Group, Ungroup, moves into and out of a folder and its
  // rename: each one step, its outcome said in a toast.
  folders: createFolderCommands({
    getState: () => store.getState().tourDocument,
    dispatch: (action) => store.dispatch(action),
    before: endUndo,
    changed: () => {
      refresh();
      tourChanged();
    },
    say: (text) => {
      toast(text);
    },
  }),
  say: (text) => {
    toast(text);
  },
});
/** The link's knobs of the 3D view on the whole globe. */
const globeSwitch = readGlobeSwitch(location.search);
/** True from a 3D open with an approach until its bar goes: the shell
 *  keeps the tree folded meanwhile and unfolds it at the landing. */
let approachHolds = false;
/** The globe view's approach, the recorded walk and the debug layer's
 *  thumbnails. */
function globeOpening(): Pick<
  Editor3dDeps,
  "approach" | "walk" | "debugThumbs"
> {
  const approach = takeApproach();
  approachHolds = approach !== undefined;
  return {
    ...(approach === undefined
      ? {}
      : {
          approach: {
            ...approach,
            ended: (how) => {
              approachHolds = false;
              shell.approachEnded(how);
            },
          },
        }),
    walk: () => walkGeo,
    debugThumbs,
  };
}
/** Local storage where the browser allows it (a private window may not). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
let qualityChoice = readGlobeQualityChoice(browserStorage());
qualitySwitch.textContent = globeQualityChoiceLabel(qualityChoice);
qualitySwitch.addEventListener("click", () => {
  qualityChoice = nextGlobeQualityChoice(qualityChoice);
  const label = globeQualityChoiceLabel(qualityChoice);
  qualitySwitch.textContent = label;
  const kept = writeGlobeQualityChoice(browserStorage(), qualityChoice);
  toast(globeQualityChoiceToast(label, kept, globeSwitch.quality));
});
// In the dev server an e2e may set `window.__tourEditorClouds` (an init
// script) to `{ off: true }`: Clouds starts unticked, as if a creator had
// unticked it, so every open applies it from its first frame. Inert in a
// production build.
if (import.meta.env.DEV && !import.meta.env.VITEST) {
  const knob = (window as { __tourEditorClouds?: { off?: boolean } })
    .__tourEditorClouds;
  if (knob?.off === true) setChecked(cloudsSwitch, false);
}
// View state only - no edit, nothing pending; kept for the next open.
realTimeSwitch.addEventListener("click", () => {
  const on = !isChecked(realTimeSwitch);
  setChecked(realTimeSwitch, on);
  shown3d?.setRealTime(on);
});
cloudsSwitch.addEventListener("click", () => {
  const on = !isChecked(cloudsSwitch);
  setChecked(cloudsSwitch, on);
  shown3d?.setClouds(on);
});
const view3d = createView3dOpener({
  status: element("view-loading"),
  store,
  open: async (events) => {
    // A module that does not arrive is the connection's (`chunk`).
    const openView = await import("../editor3d/editor3d-globe.js")
      .then(
        ({ openGlobeEditor }) =>
          (deps: Editor3dDeps) =>
            openGlobeEditor(deps, {
              ...globeSwitch,
              quality: qualityToOpenWith(globeSwitch.quality, qualityChoice),
            }),
      )
      .catch((error: unknown) => {
        throw Object.assign(
          new Error(`the 3D view did not load: ${String(error)}`),
          { reason: "chunk" },
        );
      });
    approachHolds = false;
    const view = await openView({
      container: view3dBox,
      credits: element("view3d-credits"),
      store,
      levels: () => openedLevels,
      loadContent: readContent,
      events,
      ...globeOpening(),
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
        groundMenu: (point, place) => {
          shell.groundMenu(point, place);
        },
        model: (id, edit) =>
          writeInspectorEdit((e) => e.editModel(id, edit)) === "written",
        keysFree: editKeysFree,
      },
    });
    shown3d = view;
    if (isChecked(realTimeSwitch)) view.setRealTime(true);
    if (!isChecked(cloudsSwitch)) view.setClouds(false);
    const handle: View3dHandle = {
      dispose: () => {
        if (shown3d === view) shown3d = null;
        view.dispose();
      },
    };
    return handle;
  },
  onShown: (on) => {
    view3dBox.hidden = !on;
    // The page's look follows the view: the studio's dark shell while it
    // shows (`editor-shell.css`); an e2e waits for `data-view="3d"`.
    if (on) document.body.dataset["view"] = "3d";
    else delete document.body.dataset["view"];
    if (on && shown3d !== null) {
      shell.show(shown3d, { approach: approachHolds });
    } else shell.hide();
  },
});
// Where the 3D view cannot open, a page says so, with the File actions.
wireView3dFailedPage({
  dom: {
    root: element("view3d-failed"),
    heading: element("view3d-failed-title"),
    reason: element("view3d-failed-reason"),
    retry: element("view3d-failed-retry"),
    open: element("view3d-failed-open"),
    save: element("view3d-failed-save"),
    saveCopy: element("view3d-failed-save-copy"),
    details: element("view3d-failed-details"),
  },
  store,
  toasts: {
    height: () => toasts.offsetHeight,
    watch: (changed) => {
      const observer = new ResizeObserver(changed);
      observer.observe(toasts);
      return () => {
        observer.disconnect();
      };
    },
  },
  actions: {
    retry: () => {
      view3d.open();
    },
    // The browser keeps a failed import's answer for the page's life:
    // only a reload fetches the 3D view's code again. After the same guard
    // as leaving, which then holds back the browser's own second prompt.
    reload: () => {
      if (
        unsavedWork() &&
        !confirmPausingFrames(
          "Your changes are not saved yet. Reload the page anyway? Any change not yet in the editor's draft will be lost.",
        )
      ) {
        return;
      }
      leavingOnPurpose = true;
      window.location.reload();
    },
    open: openAnotherTour,
    save: () => {
      void runSave(askSaveFile());
    },
    saveCopy: () => {
      void saveCopy();
    },
    details: openDetails,
  },
});

// Everything above is wired: the open dialog's controls answer from here
// on (a keyboard press before the module ran would go nowhere - the e2e
// waits for this).
document.body.dataset["editor"] = "ready";
