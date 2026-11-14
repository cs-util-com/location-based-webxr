/**
 * The 3D view's shell: the top bar's studio controls (Details, Undo and
 * Redo, Help), the Edit menu's Undo and Redo (where they fold at a
 * phone's width) and the View menu's Top view and Frame, the tree dock at
 * the left, the inspector dock at the right, the compass and the zoom
 * buttons at the bottom right, and the bottom bar's toggles with the
 * bottom panel they open (`bottom-panel.ts`: the tour's problems, the
 * edit history, the street map's loading and the view's frame times). The
 * page's own controls (the File menu, the view switch, the save status)
 * stay the page's.
 *
 * Everything it shows is drawn from the store - the tour from
 * `tourDocument`, the selection and the docks' and tree's folds from
 * `editorView` - so the map and the 3D view read one copy. A click on a
 * card follows the tree click rule (`tree-click.ts`): selected, unfolded
 * and flown to; a second click deselects and folds; a double click does
 * not toggle. On a narrow window the docks follow the dock rule
 * (`dock-rule.ts`). The camera commands are the 3D view's
 * (`ShellView`); the shell never imports the 3D view's code.
 *
 * The tree's editing (M3b): "+" adds a station at the centre of the view,
 * the scene's ground menu one where it was pressed (the kit's `scene-menu.ts`); a
 * card's grip reorders by drag (`tree-drag.ts`), the inspector's Earlier
 * and Later by the keyboard; the inspector's Delete and "Move to a new
 * station"; the bottom bar's power actions (`bar-actions.ts`). Each is the
 * page's command (`EditorShellDeps.stations`), one undo step.
 *
 * The inspector's editing: a typed field is one edit (`inspector-edits.ts`)
 * committed when the field is left or on Enter, and only when its text
 * changed; Escape puts the tour's value back. A selection that changes
 * with text still typed commits it first, to the selection it was typed
 * for. The card picture's choices, Add pin, and "Put on the ground" /
 * "Put items on the ground" - which wait, shown in progress, for ground
 * that has not loaded (`ground-wait.ts`) and say when they give up. Each
 * is the page's command (`EditorShellDeps.edits`), one undo step; a
 * field whose edit the tour did not take shows the tour's value again.
 *
 * @see editor-shell.ts.md
 */
import {
  isTourFolder,
  tourChildPlace,
} from "gps-plus-slam-app-framework/ar/tour-story";
import type { UnknownAction } from "@reduxjs/toolkit";

import type { Editor3dView } from "../../editor3d/editor3d-scene.js";
import type { PlaceEdit } from "../../placement/place-edits.js";
import { createLongPress, LONG_PRESS } from "../long-press.js";
import {
  folderDropRefusal,
  freeItemUnsaved,
  manifestToWrite,
  nextStep,
  type StationCharacterEdit,
  type StationEdit,
  type TourDocumentState,
} from "../../tour-document.js";
import {
  editorViewActions,
  isStationLocked,
  pointerDragRuns,
  type EditorViewState,
  type ShellLayer,
  type TreeSection,
} from "../editor-view.js";
import {
  FOLDER_PREFIX,
  STATION_PREFIX,
  STORY_PREFIX,
  selectedStationOf,
} from "../editor-model.js";
import {
  folderName,
  groupRows,
  pickedGroupRefusal,
  plainFolderOf,
  selectionBarOf,
  type FolderCommands,
} from "../folder-commands.js";
import type { ModelEdit } from "../model-edits.js";
import {
  inComposite,
  inField,
  inMenu,
  closeOpenMenu,
  setItemDisabled,
  docksAfter,
  type DockChange,
  waitForGround,
  createSceneMenu,
  type GroundPlace,
  placeShellIcons,
  shellIcon,
  type ShellIcon,
  createNestDrag,
  createTreeDrag,
  movedTo,
  NO_TREE_CLICK,
  treeClick,
  treeClickPlan,
  type TreeClickMemory,
} from "gps-plus-slam-editor-kit/chrome";
import {
  ALIGNED_DEG,
  barActions,
  positionText,
  type BarAction,
} from "./bar-actions.js";
import {
  groundEdit,
  inspectorEdit,
  type EntryAdvance,
} from "./inspector-edits.js";
import {
  stepWithAnswer,
  stepWithGoto,
  stepWithoutAnswer,
  stepWithRight,
  type StepKind,
  type StoryStep,
} from "../story-step-edits.js";
import {
  buildInspector,
  detailsOnPhone,
  inspectorCrumb,
  inspectorHint,
  sceneHint,
  type InspectorCode,
  type InspectorModel,
} from "./inspector-model.js";
import { inspectorFileOf, REPLACE_FILE_ACT } from "./inspector-file.js";
import {
  controlName,
  drawInspector,
  focusControl,
  inspectorDrawing,
} from "./shell-inspector.js";
import { createBottomPanel } from "./bottom-panel.js";
import type { DockBadge, DockHost, mountDockHost } from "./dock-host.js";
import { docksAt, isBottomPanelId, type DockPanelId } from "./dock-layout.js";
import { watchKeyboard } from "./phone-keyboard.js";
import {
  SHELL_DOCK_LAYOUT,
  phoneSheets,
  wirePhoneSheets,
  type SheetKind,
} from "./phone-sheet.js";
import { wireRadiusSlider } from "./radius-slider.js";
import { wireFieldSliders } from "./field-sliders.js";
import { createShellPictures } from "./shell-pictures.js";
import { tourProblems } from "./tour-problems.js";
import { drawSelectionBar, drawTree, type TreeRenaming } from "./shell-tree.js";
import {
  FREE_LIST,
  STORIES_LIST,
  childDropTo,
  childMayGo,
  childStepTo,
  movedToStation,
  type ChildMoveTo,
} from "../../station-children-moves.js";
import { createTreeAddMenu } from "./tree-add-menu.js";
import type { AddKind } from "../../kinds/edit-kinds.js";
import { createAddPalette, isPaletteKey } from "./add-palette.js";
import { stationTitle } from "../../station-run.js";
import {
  buildTree,
  stationGroups,
  type TreeFolder,
  type TreeModel,
} from "./tree-model.js";
import { createKindPanels } from "../kind-panels/kind-panels.js";
import type { NarrationChange, NarrationFacts } from "../editor-session.js";

/** A stamp per read-along texts object of the tour document: the reducer
 *  makes a new one on each change of them. */
const timingStamps = new WeakMap<object, string>();
let timingStampCount = 0;
function timingsStampOf(timings: object): string {
  let stamp = timingStamps.get(timings);
  if (stamp === undefined) {
    stamp = String(++timingStampCount);
    timingStamps.set(timings, stamp);
  }
  return stamp;
}

/** The 3D view's commands the shell drives. */
type ShellView = Pick<
  Editor3dView,
  | "flyTo"
  | "frame"
  | "setTop"
  | "zoom"
  | "northUp"
  | "readout"
  | "setLayers"
  | "centre"
  | "turn"
  | "previewRadius"
  | "groundAt"
  | "origin"
  | "mapTiles"
  | "retryMap"
  | "lastMapRetry"
>;

/** The page's station commands the tree and the bars give: each one undo
 *  step, its outcome said by the page. */
interface ShellStationCommands {
  /** A new station at `at`: the view's centre ("+") or where the ground
   *  menu was opened ("here"). */
  add(at: GroundPlace, where: "centre" | "here"): void;
  /** The stations in `order` (every station once). */
  reorder(order: readonly string[]): void;
  /** A station's item (a story by its id) moved within its station or
   *  onto another (asked first): whether it moved. */
  moveChild(id: string, to: ChildMoveTo): boolean;
  /** An item into a station of its own, where it stands. */
  split(itemId: string): void;
  /** The selection (`station:<id>` or an item's id) copied beside itself. */
  duplicate(selection: string): void;
  /** The selection deleted (its Undo in the page's toast). */
  remove(selection: string): void;
}

/** Whether the page wrote a typed edit or refused it (a text over the
 *  format's cap, said by the page): a refused one keeps its text in the
 *  field. */
export type TypedEditOutcome = "written" | "refused";

/** The page's edits the inspector gives: each one undo step, a refusal
 *  said by the page. */
export interface ShellEditCommands {
  /** A station's name, description, found radius or card picture. */
  station(stationId: string, edit: StationEdit): TypedEditOutcome;
  /** A pin's text. */
  text(itemId: string, text: string): TypedEditOutcome;
  /** One of a free block's other text fields (`block-fields.ts`). */
  block(itemId: string, field: string, value: string): TypedEditOutcome;
  /** A free block's view (`TOUR_BLOCK_VIEWS`): a long text's sign. */
  view(itemId: string, view: string): TypedEditOutcome;
  /** A picture's tag shown or hidden (a cut-out's); absent: the page
   *  has no such edit and the switch is not drawn. */
  pictureTag?(itemId: string, shown: boolean): TypedEditOutcome;
  /** One of a model's own edits (`model-edits.ts`): its view, a note,
   *  a section, its clip. */
  model(itemId: string, edit: ModelEdit): TypedEditOutcome;
  /** A pose or a size, as the 3D view's gestures write them: whether it
   *  was written (false: refused, and the page said why). */
  scene(edit: PlaceEdit): boolean;
  /** Items' heights (the ground under each, or a typed height), as one
   *  step; their places and turns kept. */
  groundItems(
    items: readonly { readonly id: string; readonly alt: number }[],
  ): void;
  /** A new item of `kind` in the station, at a free spot near its
   *  anchor. */
  addItem(stationId: string, kind: AddKind): void;
  /** A new story in the station, selected, one undo step. */
  addStory(stationId: string): void;
  /** A new entry of `kind` in the story, selected, one undo step. */
  addToStory(storyId: string, kind: AddKind): void;
  /** A new choice or quiz at the end of the story, selected, one undo
   *  step. */
  addStepToStory(storyId: string, kind: StepKind): void;
  /** The add menu's Character: the character maker opens on a new
   *  character, which is then added to the station (standing free) or to
   *  the end of the story. */
  addCharacter(to: {
    readonly kind: "station" | "story";
    readonly id: string;
  }): void;
  /** A story's title, typed in its inspector. */
  storyTitle(storyId: string, title: string): TypedEditOutcome;
  /** How a story's block moves on. */
  storyAdvance(id: string, advance: EntryAdvance): TypedEditOutcome;
  /** A story's choice or quiz written whole: its question, its answers,
   *  where each leads, the right one, its points. */
  storyStep(step: StoryStep): TypedEditOutcome;
  /** A long text's narration as it stands (`EditorSession.narration`). */
  narration(
    itemId: string,
  ): Promise<
    NarrationFacts | { readonly kind: "refused"; readonly reason: string }
  >;
  /** One change of it: one undo step, a refusal said by the page. */
  editNarration(
    itemId: string,
    change: NarrationChange,
  ): Promise<TypedEditOutcome>;
  /** Another file for the item `itemId` (its inspector's "Replace..."):
   *  picked and given by the page, one undo step; none: no such row's
   *  button does anything. */
  replaceFile?(itemId: string): void;
  /** The largest voice file a long text takes (the page's autosave cap;
   *  none: the default cap). */
  readonly voiceMaxBytes?: number;
}

/** The page's store, as the shell reads it. */
interface ShellStore {
  getState(): {
    readonly tourDocument: TourDocumentState;
    readonly editorView: EditorViewState;
  };
  subscribe(listener: () => void): () => void;
  dispatch(action: UnknownAction): unknown;
}

export interface EditorShellDeps {
  readonly store: ShellStore;
  /** The page's selection (the map's markers and card follow it). */
  readonly select: (id: string | null) => void;
  /** One step of the edit history, as Ctrl+Z and Ctrl+Shift+Z. */
  readonly step: (which: "undo" | "redo") => void;
  /** The open tour's codes, in the phone's numbering. */
  readonly codes: () => readonly InspectorCode[];
  /** The name a file was brought in under, by its asset id (the shelf's);
   *  none: the inspector names a file by its entry. */
  readonly fileNameOf?: (assetId: string) => string | undefined;
  /** A picture's bytes from the open tour (its content path). */
  readonly loadPicture: (path: string) => Promise<Blob>;
  /** A dialog of the page shows: the shell's keys stay out of it. */
  readonly dialogOpen: () => boolean;
  readonly stations: ShellStationCommands;
  readonly edits: ShellEditCommands;
  /** The plain folders' commands (Group, Ungroup, a move into or out of a
   *  folder, a rename): each one undo step, its outcome said. */
  readonly folders: FolderCommands;
  /** A passing line (the page's toast). */
  readonly say: (text: string) => void;
  /** Loads the docked layout (a dynamic import, so the docking library
   *  comes with the 3D view); absent, the panels never dock. */
  readonly dock?: () => Promise<{
    readonly mountDockHost: typeof mountDockHost;
  }>;
  /** The panels docked or undocked (the asset shelf redraws for it). */
  readonly onDocked?: (docked: boolean) => void;
  /** Docked, the Files panel came into sight or went out of it (the
   *  asset shelf's toggle says which). */
  readonly onFilesShown?: (shown: boolean) => void;
}

export interface EditorShell {
  /** The 3D view shows: the shell drives `view` until `hide`. With
   *  `approach` the view opens on its approach: the tree stays folded
   *  until `approachEnded`. */
  show(view: ShellView, options?: { readonly approach?: boolean }): void;
  hide(): void;
  /** The approach's bar went. After a landing the tree folded for it
   *  unfolds (animated, unless reduced motion), as the dock rule allows at
   *  this width; after a takeover it stays a tab for the creator to open.
   *  Once; a creator's fold or unfold before it ends the hold. */
  approachEnded(how: "landed" | "taken"): void;
  /** Writes the typing not yet in the tour (an inspector field being
   *  typed in, a long text's writer before its pause): the page calls it
   *  before a save, which writes the tour as the store holds it. */
  flush(): void;
  /** The scene's ground menu at `point` (px on the 3D canvas), for the
   *  ground's `place` there (null: none has loaded). */
  groundMenu(point: { x: number; y: number }, place: GroundPlace | null): void;
  /** Empties the tree's search: something the page just made is shown,
   *  and its name would match none of the words typed. */
  clearSearch(): void;
  /** Whether the panels are docked around the 3D view now. */
  docked(): boolean;
  /** Docked, shows a panel (its side unfolded, it the shown tab); else
   *  nothing. */
  reveal(id: DockPanelId): void;
  /** Docked, takes a shown panel out of sight: `instead` shown in its
   *  place when its group holds it, else the group's next panel, or, alone
   *  in its group, the group hidden; else nothing. */
  conceal(id: DockPanelId, instead?: DockPanelId): void;
  /** Docked, whether the Files panel shows: its group shown and it the
   *  group's shown tab. Undocked: false. */
  filesShown(): boolean;
  /** The count on a docked panel's tab (null: none), kept for when the
   *  panels dock. */
  badge(id: DockPanelId, badge: DockBadge | null): void;
}

const BAR_ICON: Readonly<Record<BarAction, ShellIcon>> = {
  duplicate: "dup",
  align: "align",
  copy: "copy",
};

/** An inspector field to type in: a line (an input) or prose (a text
 *  area). */
type TypedField = HTMLInputElement | HTMLTextAreaElement;

function isTyped(target: EventTarget | null): target is TypedField {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  );
}

/** `deg` as a turn of -180 to 180 degrees. */
function signedDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** The layers this view draws, a chip each (the others come with what
 *  they show). */
const SHELL_LAYERS: readonly ShellLayer[] = ["codes", "names"];

/** How often the compass, the view line and the readout follow the
 *  camera (ms). */
const READOUT_MS = 200;

/** Inside an open menu (not on a menu's button): its own Escape closes
 *  it. */
function insideMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="menu"]') !== null;
}

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`edit.html lacks #${id}`);
  return found as T;
}

/** How long a story's block waits when "After a while" is chosen (s). */
const ENTRY_AUTO_S = 5;

/** A chip of how a story's block moves on, as the page's edit, or null for
 *  another act and for the chip already pressed (`characterChipEdit`). */
function entryAdvanceEdit(
  model: InspectorModel | null,
  act: string,
): { id: string; advance: EntryAdvance } | null {
  const chip = ENTRY_ADVANCE.exec(act);
  if (chip === null || model?.kind !== "storyEntry") return null;
  const [, id = "", mode] = chip;
  if (id !== model.id || mode === model.advance.mode) return null;
  if (mode === "tap") return { id, advance: { mode: "tap" } };
  return mode === "auto"
    ? { id, advance: { mode: "auto", afterS: ENTRY_AUTO_S } }
    : null;
}

/** A chip of how a story's block moves on: its block and its mode. */
const ENTRY_ADVANCE = /^entry-advance:(.+):([^:]+)$/;

/** A step's jump picker: `step-goto:<answer id>`. */
const STEP_GOTO = "step-goto:";

/** A step's Add, an answer's Remove (`step-remove:<answer id>`) or its
 *  right-answer radio (`step-right:<answer id>`) as the whole step it
 *  writes; null for another act, a selection that is no edited step,
 *  and one that changes nothing (the right one ticked again, Add at four,
 *  Remove at two). */
function stepActEdit(
  model: InspectorModel | null,
  act: string,
): StoryStep | null {
  const step = model?.kind === "storyStep" ? model.form?.step : undefined;
  if (step === undefined) return null;
  if (act === "step-add") return stepWithAnswer(step);
  if (act.startsWith("step-remove:")) {
    return stepWithoutAnswer(step, act.slice("step-remove:".length));
  }
  if (act.startsWith("step-right:") && step.kind === "quiz") {
    return stepWithRight(step, act.slice("step-right:".length));
  }
  return null;
}

/** A story character's chip (`character-view:<block>:<view>` or
 *  `character-advance:<block>:<mode>`) as his station's edit, or null for
 *  another act and for the chip already pressed (writing it would be an
 *  undo step that changed nothing). */
function characterChipEdit(
  model: InspectorModel | null,
  act: string,
): StationCharacterEdit | null {
  const chip = CHARACTER_CHIP.exec(act);
  if (chip === null || model?.kind !== "storyEntry") return null;
  const [, what, block, value] = chip as unknown as [
    string,
    "view" | "advance",
    string,
    string,
  ];
  const now = model.block.id === block ? model.block.character : undefined;
  if (now === undefined || now[what] === value) return null;
  if (what === "view") return { block, view: value };
  // Only the two advance chips are drawn: another value is no chip's.
  return value === "tap" || value === "lineEnd"
    ? { block, advance: value }
    : null;
}

/** A story character's chip: its kind, his block and the chip's value. */
const CHARACTER_CHIP = /^character-(view|advance):(.+):([^:]+)$/;

/** A field that writes text of several lines (a text area, an editable
 *  element): its keys are its own, Ctrl+K among them. */
function inWritingField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** The id the move rule knows a selection by: a story's own id for its
 *  `story:<id>`, an item's id as it is. */
function childIdOf(selected: string): string {
  return selected.startsWith(STORY_PREFIX)
    ? selected.slice(STORY_PREFIX.length)
    : selected;
}

export function createEditorShell(deps: EditorShellDeps): EditorShell {
  const { store } = deps;
  const tree = {
    root: byId("shell-tree"),
    stationsHead: byId<HTMLButtonElement>("tree-stations"),
    fold: byId<HTMLButtonElement>("tree-fold"),
    add: byId<HTMLButtonElement>("tree-add"),
    collapse: byId<HTMLButtonElement>("tree-collapse"),
    search: byId<HTMLInputElement>("tree-search"),
    body: byId("tree-body"),
    selectMode: byId<HTMLButtonElement>("tree-select"),
    selbar: byId("tree-selbar"),
  };
  /** The plain folder whose name is being typed in the tree, as typed. */
  let renaming: TreeRenaming | null = null;
  // A row's "+" and an empty station's "Add content": one type menu.
  const addMenu = createTreeAddMenu({
    body: tree.body,
    host: document.body,
    choose: (id, kind) => {
      if (kind === "story") {
        addStoryIn(id);
        return;
      }
      if (kind === "character") {
        clearSearch();
        store.dispatch(editorViewActions.stationFolded({ id, open: true }));
        deps.edits.addCharacter({ kind: "station", id });
        return;
      }
      addInPlace(id, kind);
      // Added from the details on a phone: the draw took the button away.
      if (document.activeElement === document.body) {
        focusControl(inspector.root, '[data-act="close"]');
      }
    },
    chooseForStory: (id, kind) => {
      if (kind === "character") {
        clearSearch();
        revealStory(id);
        deps.edits.addCharacter({ kind: "story", id });
        return;
      }
      // Added into a story: its station and its folder unfolded first.
      clearSearch();
      revealStory(id);
      if (kind === "choice" || kind === "quiz") {
        deps.edits.addStepToStory(id, kind);
      } else {
        deps.edits.addToStory(id, kind);
      }
      if (document.activeElement === document.body) {
        focusControl(inspector.root, '[data-act="close"]');
      }
    },
  });
  // Ctrl+K: a kind and a place in one query.
  const palette = createAddPalette({
    host: document.body,
    stations: () =>
      (manifest()?.stations ?? []).map((station, index) => ({
        id: station.id,
        number: index + 1,
        title: stationTitle(station, index + 1),
      })),
    selectedStation: () => selectedStationId(),
    add: (what) => {
      if (what.kind === "station") addStationAtCentre();
      else addInPlace(what.stationId, what.kind);
    },
  });
  /** Add to a station, unfolded first so the new row shows (and the
   *  focus that follows it has a row to land on); a search runs no more,
   *  as the new item's name would match none of its words. */
  function addInPlace(id: string, kind: AddKind): void {
    clearSearch();
    store.dispatch(editorViewActions.stationFolded({ id, open: true }));
    deps.edits.addItem(id, kind);
  }
  /** Add a story to a station, unfolded first; its new row opens and its
   *  name in the head is ready to type over. */
  function addStoryIn(id: string): void {
    clearSearch();
    store.dispatch(editorViewActions.stationFolded({ id, open: true }));
    deps.edits.addStory(id);
    draw();
    const title = inspector.head.querySelector<HTMLInputElement>(
      '[data-field="story-title"]',
    );
    title?.focus();
    title?.select();
  }
  /** The folder of the story as last drawn. */
  function drawnFolder(id: string): TreeFolder | undefined {
    return drawnTree?.cards.flatMap((c) => c.folders).find((f) => f.id === id);
  }
  /** The story's station and its folder unfolded. */
  function revealStory(storyId: string): void {
    const stationId = selectedStationOf(
      `${STORY_PREFIX}${storyId}`,
      manifest(),
    );
    if (stationId !== null) {
      store.dispatch(
        editorViewActions.stationFolded({ id: stationId, open: true }),
      );
    }
    store.dispatch(editorViewActions.storyFolded({ id: storyId, open: true }));
  }
  /** The view on `selection`, else on its station (a story and its entries
   *  stand nowhere in it). */
  function flyToSelection(selection: string): void {
    if (view === null || view.flyTo(selection)) return;
    const stationId = selectedStationOf(selection, manifest());
    if (stationId !== null) view.flyTo(`${STATION_PREFIX}${stationId}`);
  }
  // The top bar's Add (the Edit menu's at a phone's width): the palette
  // for a touch screen, with no keys.
  byId("studio-add").addEventListener("click", () => {
    palette.open();
  });
  byId("edit-add").addEventListener("click", () => {
    // Its menu closes under it, so the palette goes back to the menu's button.
    byId("edit-menu-btn").focus();
    palette.open();
  });
  /** The tree as last drawn, and the stations a search unfolded whose
   *  arrow folded them since (`TreeInput.searchFolded`), for the tour
   *  of `searchedTour` (its open count) the search was typed over. */
  let drawnTree: TreeModel | null = null;
  const searchFolded = new Set<string>();
  let searchedTour = store.getState().tourDocument.generation;
  const inspector = {
    root: byId("shell-inspector"),
    head: byId("inspector-head"),
    body: byId("inspector-body"),
  };
  const bar = {
    acts: byId("shell-acts"),
  };
  const top = {
    undo: byId<HTMLButtonElement>("studio-undo"),
    redo: byId<HTMLButtonElement>("studio-redo"),
    editUndo: byId<HTMLButtonElement>("edit-undo"),
    editRedo: byId<HTMLButtonElement>("edit-redo"),
    frame: byId<HTMLButtonElement>("studio-frame"),
    topView: byId<HTMLButtonElement>("studio-top"),
    help: byId<HTMLButtonElement>("studio-help"),
    list: byId<HTMLButtonElement>("studio-list"),
  };
  const helpBox = byId("shell-help");
  const needle = byId<HTMLElement>("compass-needle");
  /** The selection's hint, in the help (what a click there does). */
  const helpHint = byId("shell-help-hint");
  /** The line over the 3D view for the selection (a folder's). */
  const sceneHintLine = byId("shell-scene-hint");
  for (const root of [byId("topbar"), byId("view3d")]) placeShellIcons(root);

  const pictures = createShellPictures({
    load: (path) => deps.loadPicture(path),
    // The list's and the details' cards, in the page or behind another
    // docked tab.
    owns: (el) => tree.root.contains(el) || inspector.root.contains(el),
  });
  const viewBox = byId("view3d");
  /** The kinds' own parts of the inspector (`kind-panels.ts`): a long
   *  text's writer and its preview over the 3D view, a model's notes and
   *  sections. */
  const panels = createKindPanels({
    document,
    box: viewBox,
    inspectorRoot: inspector.root,
    treeRoot: tree.root,
    edits: deps.edits,
    loadPicture: (path) => deps.loadPicture(path),
    say: (text) => {
      deps.say(text);
    },
    changed: () => {
      draw();
    },
    pickAsked: (pick) => {
      store.dispatch(editorViewActions.modelPickAsked({ pick }));
    },
    pointPickAsked: (on) => {
      store.dispatch(editorViewActions.pointPickAsked({ on }));
    },
    focused: (focus) => {
      store.dispatch(editorViewActions.modelFocused({ focus }));
    },
  });
  const said = byId("shell-said");
  const ground = createSceneMenu({
    box: viewBox,
    menu: byId("scene-menu"),
    item: byId("scene-new-station"),
    // The view's box takes the focus back (`tabindex="-1"`): the view's
    // keys are the window's, and work from there.
    returnFocus: viewBox,
    choose: (place) => {
      deps.stations.add(place, "here");
    },
  });

  let view: ShellView | null = null;
  /** The docked layout while the panels dock (below). */
  let dockHost: DockHost | null = null;
  /** The on-screen keyboard's height as last read: a layout docked while
   *  it is up is told at once, not only at its next change. */
  let keyboardPx = 0;
  // When each history step was made: stamped on first sight by a
  // subscription as long-lived as the page, so the steps made while the 2D
  // map shows are timed too (the base the history opens from is not).
  const stepTimes = new WeakMap<object, number>();
  const stampSteps = () => {
    const doc = store.getState().tourDocument;
    const at = Date.now();
    for (const step of [...doc.past, ...doc.future]) {
      if (!stepTimes.has(step)) stepTimes.set(step, at);
    }
  };
  stampSteps();
  store.subscribe(stampSteps);
  const panel = createBottomPanel({
    panel: byId("shell-panel"),
    toggles: byId("shell-toggles"),
    box: viewBox,
    choose: (selection) => {
      deps.select(selection);
      view?.flyTo(selection);
    },
    fix: (selection, fix) => {
      deps.select(selection);
      if ("split" in fix) {
        deps.stations.split(selection);
        return;
      }
      let written: boolean;
      try {
        written = deps.edits.scene(fix.edit(groundAt));
      } catch (error) {
        deps.say(
          `Could not mend it: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      // Refused: the page has said why; announcing the mend would be false.
      if (written) deps.say(fix.done);
    },
    map: {
      tiles: (limit) => view?.mapTiles(limit) ?? [],
      retry: () =>
        view?.retryMap() ?? { tiles: 0, refused: "map-off", retry: 0 },
      lastRetry: () => view?.lastMapRetry() ?? null,
    },
    stepTime: (step) => stepTimes.get(step),
    step: (which) => {
      deps.step(which);
    },
    storage: (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
  });
  let unsubscribe: (() => void) | null = null;
  let timer: number | null = null;
  let memory: TreeClickMemory = NO_TREE_CLICK;
  let positionOpen = false;
  /** A station's Contents unfolded: kept from one station to the next. */
  let contentsOpen = true;
  /** A ground command waiting for the ground: the inspector shows it in
   *  progress; a new selection or the view hidden calls it off. */
  let busy: {
    readonly act: string;
    readonly stop: AbortController;
  } | null = null;
  /** What was drawn from: the shell draws again only when it changed. */
  let drawn: {
    doc: TourDocumentState;
    ui: EditorViewState;
    positionOpen: boolean;
    contentsOpen: boolean;
    busy: string | null;
  } | null = null;

  const state = () => store.getState();
  const manifest = () => manifestToWrite(state().tourDocument);

  /** The ground as the view has it loaded; none while no view shows. */
  const groundAt = (place: { readonly lat: number; readonly lon: number }) =>
    view?.groundAt(place) ?? null;

  const inspectorModel = (ui: EditorViewState) => {
    // Nothing to show: no tour built for it (the readout asks 5 times a
    // second).
    if (ui.selected === null) return null;
    const tour = manifest();
    const built = buildInspector({
      selected: ui.selected,
      stations: tour?.stations ?? [],
      assets: tour?.assets ?? [],
      codes: deps.codes(),
      unlockedStations: ui.unlockedStations,
      origin: view?.origin() ?? null,
      groundAt,
      modelFocus: ui.modelFocus,
      modelPick: ui.modelPick,
      pointPick: ui.pointPick,
      timingsStamp: timingsStampOf(state().tourDocument.timings),
      selectedFileUnsaved: freeItemUnsaved(state().tourDocument, ui.selected),
    });
    const file = inspectorFileOf(
      ui.selected,
      tour?.stations ?? [],
      tour?.assets ?? [],
      deps.fileNameOf,
    );
    return built === null || file === null ? built : { ...built, file };
  };

  /** `model` as the docks and a phone's sheets see it: none on a phone
   *  for a selection with no details there (`detailsOnPhone`), whose tap
   *  keeps the list. */
  const sheetModel = (model: InspectorModel | null): InspectorModel | null =>
    model !== null && phoneSheets(window.innerWidth) && !detailsOnPhone(model)
      ? null
      : model;

  /** The inspector drawn from the store and the ground now (a draw that
   *  changes nothing is skipped): also each readout tick, so the ground
   *  arriving shows. */
  const drawInspectorNow = (model: InspectorModel | null) => {
    drawInspector(
      inspector,
      model,
      {
        folded: state().editorView.foldedDocks.inspector,
        positionOpen,
        contentsOpen,
        busy: busy?.act ?? null,
        // Only for a selection shown: nothing selected builds no tour.
        ...(model === null
          ? {}
          : {
              crumb: inspectorCrumb({
                selected: state().editorView.selected,
                stations: manifest()?.stations ?? [],
                codes: deps.codes(),
              }),
            }),
      },
      pictures,
      panels.sync(model),
    );
    // A phone ticking rows in the Select mode keeps its sheet the list.
    const wasHidden = inspector.root.hidden;
    inspector.root.hidden =
      sheetModel(model) === null || shownSheet(model) === "tree";
    // Docked, a selection shows its details over the files beside them.
    if (
      dockHost !== null &&
      wasHidden &&
      !inspector.root.hidden &&
      !state().editorView.foldedDocks.inspector
    ) {
      dockHost.reveal("details");
    }
  };

  /** The tree is folded for the approach, not by the creator. */
  let approachHold = false;
  /** The tree's fold when the approach began, given back by a close
   *  mid-flight. */
  let foldBeforeApproach = false;
  /** The tree's unfolding animation (`dock-unfold`) ends: its class goes. */
  const endUnfolding = (event?: AnimationEvent) => {
    if (event !== undefined && event.animationName !== "dock-unfold") return;
    tree.root.classList.remove("unfolding");
  };
  tree.root.addEventListener("animationend", endUnfolding);
  tree.root.addEventListener("animationcancel", endUnfolding);
  /** The creator folds or unfolds the tree: the approach's hold ends. */
  const creatorTouchesTree = () => {
    approachHold = false;
    endUnfolding();
  };

  /** The docks after `change` by the dock rule, stored. */
  let onPhone = phoneSheets(window.innerWidth);
  const applyDocks = (
    change: DockChange,
    model: InspectorModel | null = inspectorModel(state().editorView),
  ) => {
    const ui = state().editorView;
    const inspectorShows = sheetModel(model) !== null;
    const phone = phoneSheets(window.innerWidth);
    // Turned sideways, the list the details covered stands beside them.
    const turnedWide = change === "resized" && onPhone && !phone;
    onPhone = phone;
    // Docked, a side never folds to make room for the other: the 3D view
    // gives way, and each side folds only when the creator folds it.
    if (deps.dock !== undefined && docksAt(window.innerWidth)) {
      if (turnedWide && ui.foldedDocks.tree) {
        store.dispatch(
          editorViewActions.dockFolded({ dock: "tree", folded: false }),
        );
      }
      return;
    }
    const folded = {
      tree: ui.foldedDocks.tree && !turnedWide,
      // A phone's details are a whole sheet, with no head to unfold it by.
      inspector: ui.foldedDocks.inspector && !(phone && inspectorShows),
    };
    const after = docksAfter(
      change,
      { widthPx: window.innerWidth, folded, inspectorShows },
      SHELL_DOCK_LAYOUT,
    );
    for (const dock of ["tree", "inspector"] as const) {
      if (after[dock] !== ui.foldedDocks[dock]) {
        store.dispatch(
          editorViewActions.dockFolded({ dock, folded: after[dock] }),
        );
      }
    }
  };

  /** The sheet a phone shows now: the details over the list, except in
   *  the Select mode, whose ticks need the list. `model` is the
   *  inspector's, when the caller has it built. */
  const shownSheet = (
    model: InspectorModel | null = inspectorModel(state().editorView),
  ): SheetKind | null => {
    const ui = state().editorView;
    if (!phoneSheets(window.innerWidth)) return null;
    if (ui.selectMode) return "tree";
    if (sheetModel(model) !== null) return "details";
    return ui.foldedDocks.tree ? null : "tree";
  };
  /** The selection let go and the list shown: on a phone, the way back
   *  from the details. */
  const showList = () => {
    creatorTouchesTree();
    if (state().editorView.selected !== null) deps.select(null);
    store.dispatch(
      editorViewActions.dockFolded({ dock: "tree", folded: false }),
    );
  };
  const sheets = wirePhoneSheets({
    tree: tree.root,
    details: inspector.root,
    spacePx: () => {
      const panelPx = Number.parseFloat(
        getComputedStyle(document.body).getPropertyValue("--s-panel-h"),
      );
      const viewPx = tree.root.parentElement?.clientHeight ?? 0;
      return viewPx - (Number.isFinite(panelPx) ? panelPx : 0);
    },
    dismiss: (which) => {
      if (which === "details") {
        deps.select(null);
        return;
      }
      creatorTouchesTree();
      store.dispatch(
        editorViewActions.dockFolded({ dock: "tree", folded: true }),
      );
    },
  });
  let stopKeyboard: (() => void) | null = null;

  const drawHistory = (doc: TourDocumentState) => {
    for (const which of ["undo", "redo"] as const) {
      const next = nextStep(doc, which);
      const key = which === "undo" ? "Ctrl+Z" : "Ctrl+Shift+Z";
      const verb = which === "undo" ? "Undo" : "Redo";
      // The bar's button and the Edit menu's item say the same; the
      // item is disabled the menu pattern's way, its focus kept.
      const [barButton, item] =
        which === "undo" ? [top.undo, top.editUndo] : [top.redo, top.editRedo];
      barButton.disabled = next === undefined;
      setItemDisabled(item, next === undefined);
      for (const button of [barButton, item]) {
        button.title =
          next === undefined
            ? `Nothing to ${which}`
            : `${verb} ${next.what} (${key})`;
      }
    }
    panel.history({
      past: doc.past,
      future: doc.future,
      position: doc.position,
      savedAt: doc.save.inPlaceAt,
    });
  };

  /** The bottom bar's power actions for the selection; a draw keeps the
   *  focus on the action that had it. */
  const drawActs = (model: InspectorModel | null) => {
    const active = document.activeElement;
    const had =
      active instanceof HTMLElement && bar.acts.contains(active)
        ? active.dataset["bar"]
        : undefined;
    bar.acts.replaceChildren(
      ...barActions(model).map((act) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sact";
        button.dataset["bar"] = act.action;
        button.title = act.title;
        button.setAttribute("aria-label", act.label);
        const words = document.createElement("span");
        words.className = "lbl";
        words.textContent = act.label;
        button.append(shellIcon(BAR_ICON[act.action]), words);
        return button;
      }),
    );
    if (had !== undefined) {
      bar.acts.querySelector<HTMLElement>(`[data-bar="${had}"]`)?.focus();
    }
  };

  /** Whether the tree is being drawn: a focus lost to its redraw (the
   *  folder's name field replaced while typed in) ends no rename. */
  let drawingTree = false;
  /** The tree drawn from the store and its search as they stand; a
   *  search typed over another tour is emptied first. */
  const drawTreeNow = () => {
    drawingTree = true;
    try {
      drawTreeOnce();
    } finally {
      drawingTree = false;
    }
  };
  const drawTreeOnce = () => {
    const tour = manifest();
    const { editorView: ui, tourDocument: doc } = state();
    if (doc.generation !== searchedTour) {
      searchedTour = doc.generation;
      tree.search.value = "";
      searchFolded.clear();
    }
    drawnTree = buildTree({
      stations: tour?.stations ?? [],
      assets: tour?.assets ?? [],
      codes: deps.codes(),
      view: ui,
      layers: SHELL_LAYERS,
      query: tree.search.value,
      searchFolded: [...searchFolded],
    });
    drawTree(tree, drawnTree, ui.foldedDocks.tree, pictures, {
      renaming,
      selectMode: ui.selectMode,
      groupHint: ui.selected === null && !ui.selectMode,
    });
    const rows = groupRows(doc, ui);
    drawSelectionBar(
      tree.selbar,
      selectionBarOf({
        rows,
        selectMode: ui.selectMode,
        refusal: pickedGroupRefusal(doc, rows),
      }),
    );
    tree.selectMode.setAttribute("aria-pressed", String(ui.selectMode));
  };

  const draw = () => {
    const { tourDocument: doc, editorView: ui } = state();
    const busyAct = busy?.act ?? null;
    if (
      drawn !== null &&
      drawn.doc === doc &&
      drawn.ui === ui &&
      drawn.positionOpen === positionOpen &&
      drawn.contentsOpen === contentsOpen &&
      drawn.busy === busyAct
    ) {
      return;
    }
    const docChanged = drawn?.doc !== doc;
    const uiChanged = drawn?.ui !== ui;
    const before = drawn?.ui ?? null;
    drawn = { doc, ui, positionOpen, contentsOpen, busy: busyAct };
    const tour = manifest();
    if (docChanged || uiChanged) drawTreeNow();
    const model = inspectorModel(ui);
    drawInspectorNow(model);
    drawActs(model);
    helpHint.textContent = inspectorHint(model);
    const overScene = sceneHint(model);
    sceneHintLine.hidden = overScene === null;
    sceneHintLine.textContent = overScene ?? "";
    panel.problems(tourProblems(tour?.stations ?? []), ui.selected);
    // The cards and the thumbnail a draw replaced are no longer watched.
    pictures.sweep();
    drawHistory(doc);
    if (before === null || before.hiddenLayers !== ui.hiddenLayers) {
      view?.setLayers(ui.hiddenLayers);
    }
    sheets.sync(shownSheet(model));
  };

  // --- the inspector's fields and commands ---------------------------------

  const radius = wireRadiusSlider({
    root: inspector.root,
    // Read on every step of a drag: the manifest's station, not a whole
    // inspector built.
    station: () => {
      const selected = state().editorView.selected;
      if (selected?.startsWith(STATION_PREFIX) !== true) return null;
      const id = selected.slice(STATION_PREFIX.length);
      const station = manifest()?.stations.find((s) => s.id === id);
      return station === undefined
        ? null
        : { id, radiusM: station.foundRadiusM };
    },
    preview: (id, radiusM) => view?.previewRadius(id, radiusM),
    write: (id, foundRadiusM) => {
      deps.edits.station(id, { foundRadiusM });
    },
  });
  // A block's sliders write as their number would be typed: one edit.
  const fieldSliders = wireFieldSliders({
    root: inspector.root,
    selected: () => state().editorView.selected,
    write: (box, text) => {
      box.value = text;
      commitField(box, state().editorView.selected);
    },
  });

  /** The inspector's field that has the focus, with text typed and not
   *  yet committed; null for none. */
  const typedField = (): TypedField | null => {
    const active = document.activeElement;
    return isTyped(active) &&
      active.dataset["field"] !== undefined &&
      inspector.root.contains(active) &&
      !active.readOnly &&
      active.value !== active.defaultValue
      ? active
      : null;
  };

  /** `input`'s text written as the edit it types for `selected`: one
   *  undo step. The field shows the tour's value again first, so a draw
   *  the edit causes carries nothing over, and a value that is no number
   *  leaves the tour's value showing. A text the page refuses (over its
   *  cap) is put back in the field, so the typing is not lost: the
   *  refusal changes no state, so no draw replaces the field. The text
   *  put back is not sent again until it changes: Enter and then leaving
   *  the field would otherwise say the same refusal twice. */
  let lastRefused: string | null = null;
  const commitField = (input: TypedField, selected: string | null) => {
    const value = input.value;
    if (selected === null || value === input.defaultValue || input.readOnly) {
      return;
    }
    const field = input.dataset["field"] ?? "";
    const typing = JSON.stringify([selected, field, value]);
    if (typing === lastRefused) return;
    lastRefused = null;
    input.value = input.defaultValue;
    const edit = inspectorEdit({
      selected,
      stations: manifest()?.stations ?? [],
      origin: view?.origin() ?? null,
      field,
      value,
    });
    let outcome: TypedEditOutcome = "written";
    if (edit.kind === "invalid") deps.say(edit.reason);
    else if (edit.kind === "station")
      outcome = deps.edits.station(edit.stationId, edit.edit);
    else if (edit.kind === "text")
      outcome = deps.edits.text(edit.id, edit.text);
    else if (edit.kind === "story-title")
      outcome = deps.edits.storyTitle(edit.id, edit.title);
    else if (edit.kind === "story-advance")
      outcome = deps.edits.storyAdvance(edit.id, edit.advance);
    else if (edit.kind === "story-step")
      outcome = deps.edits.storyStep(edit.step);
    else if (edit.kind === "block") {
      outcome = deps.edits.block(edit.id, edit.field, edit.value);
    } else if (edit.kind === "model") {
      outcome = deps.edits.model(edit.id, edit.edit);
    } else if (edit.kind === "scene") deps.edits.scene(edit.edit);
    else if (edit.kind === "turn") view?.turn(edit.selection, edit.deg);
    else if (edit.kind === "height") {
      deps.edits.groundItems([{ id: edit.id, alt: edit.alt }]);
    }
    if (outcome === "refused") {
      input.value = value;
      lastRefused = typing;
    }
  };

  /** A ground command on the selection: run at once with the ground
   *  loaded, else shown in progress while it waits for it; said when done,
   *  when there is nothing to do, and when it gives up. */
  const runGround = async (which: "ground" | "ground-items") => {
    const selected = state().editorView.selected;
    if (selected === null || busy !== null) return;
    const plan = () =>
      groundEdit({
        selected,
        stations: manifest()?.stations ?? [],
        which,
        groundAt,
      });
    const stop = new AbortController();
    const first = plan();
    let waited: Awaited<
      ReturnType<typeof waitForGround<NonNullable<typeof first>>>
    >;
    if (first === null) {
      busy = { act: which, stop };
      draw();
      waited = await waitForGround(plan, { signal: stop.signal });
      if (busy?.stop === stop) busy = null;
      draw();
    } else {
      waited = { kind: "ground", value: first };
    }
    if (waited.kind === "stopped") return;
    if (waited.kind === "timeout") {
      deps.say("The ground here has not loaded yet - try again once it shows");
      return;
    }
    const edit = waited.value;
    if (edit.kind === "none") {
      deps.say(
        which === "ground-items"
          ? "Every item already stands on the ground"
          : "Already on the ground",
      );
      return;
    }
    const before = state().tourDocument;
    if (edit.kind === "scene") deps.edits.scene(edit.edit);
    else deps.edits.groundItems(edit.items);
    if (state().tourDocument === before) return;
    const count = edit.kind === "ground-items" ? edit.items.length : 1;
    deps.say(
      which === "ground-items"
        ? `Put ${String(count)} ${count === 1 ? "item" : "items"} on the ground`
        : "Put on the ground",
    );
  };

  /** The selection changed: the inspector may open, and on a narrow
   *  window it folds the tree. Text still typed is committed first, to
   *  the selection it was typed for; a ground command waiting is called
   *  off. */
  let lastSelected: string | null = null;
  let lastSelectMode = state().editorView.selectMode;
  const onStore = () => {
    const { selected, selectMode } = state().editorView;
    // A tick in the Select mode selects its row but lays out no docks (a
    // phone's details would cover the list being ticked); Done does.
    const ticked = selectMode !== lastSelectMode;
    lastSelectMode = selectMode;
    if (
      ticked &&
      !selectMode &&
      selected !== null &&
      selected === lastSelected
    ) {
      applyDocks("selected");
    }
    if (selected !== lastSelected) {
      const was = lastSelected;
      lastSelected = selected;
      positionOpen = false;
      radius.cancel();
      fieldSliders.cancel();
      busy?.stop.abort();
      busy = null;
      const pending = typedField();
      if (pending !== null) commitField(pending, was);
      panels.flush();
      if (selected !== null && !selectMode) applyDocks("selected");
    }
    draw();
  };

  const readout = () => {
    if (view === null) return;
    const r = view.readout();
    needle.setAttribute("transform", `rotate(${String(-r.headingDeg)} 12 12)`);
    // A checkbox item of the View menu.
    top.topView.setAttribute("aria-checked", String(r.top));
    panel.tick(r);
    // The ground loads while the view shows: what stands off it shows
    // once it has.
    drawInspectorNow(inspectorModel(state().editorView));
  };

  const showHelp = (on: boolean) => {
    helpBox.classList.toggle("show", on);
    top.help.classList.toggle("on", on);
    top.help.setAttribute("aria-expanded", String(on));
  };

  /** The station `id` one place `way` in the tour; false at an end. */
  const stepStation = (id: string, way: "earlier" | "later"): boolean => {
    const ids = (manifest()?.stations ?? []).map((s) => s.id);
    const from = ids.indexOf(id);
    const slot = way === "earlier" ? from - 1 : from + 2;
    const order =
      from < 0 || slot < 0 || slot > ids.length
        ? null
        : movedTo(ids, from, slot);
    if (order === null) return false;
    deps.stations.reorder(order);
    return true;
  };

  /** A story, or a story's entry, one place `way` in its list; false at
   *  an end and for a free item (the free items have no order). */
  const stepChild = (id: string, way: "earlier" | "later"): boolean => {
    const tour = manifest();
    const place = tour === null ? null : tourChildPlace(tour, id);
    const to = place === null ? null : childStepTo(place.station, id, way);
    if (to === null) return false;
    deps.stations.moveChild(id, to);
    return true;
  };

  /** The selected station one place earlier or later in the tour, or the
   *  selected story or entry in its list (the inspector's buttons), the
   *  focus kept on the buttons and the new place said (the inspector's
   *  line, "Station n of N" for a station). */
  const moveSelected = (selected: string, way: "earlier" | "later") => {
    const moved = selected.startsWith(STATION_PREFIX)
      ? stepStation(selected.slice(STATION_PREFIX.length), way)
      : stepChild(childIdOf(selected), way);
    if (!moved) return;
    // The inspector was drawn again: the same button, or at an end the
    // other one.
    const again = (name: string) =>
      inspector.body.querySelector<HTMLButtonElement>(`[data-act="${name}"]`);
    const same = again(way);
    (same !== null && !same.disabled
      ? same
      : again(way === "earlier" ? "later" : "earlier")
    )?.focus();
    const place = inspector.body.querySelector(".sub")?.textContent ?? "";
    said.textContent = place === "" ? "" : `Now ${place.trim()}`;
  };

  /** The inspector's "Move to" (`move-to:<list>`): the selection to the
   *  end of that list of its station (out of its story, into another),
   *  the focus kept on the inspector's first "Move to" (the one it had
   *  may be gone: the list it named is now the item's own). */
  const moveSelectedTo = (selected: string, list: string) => {
    const id = childIdOf(selected);
    const tour = manifest();
    const place = tour === null ? null : tourChildPlace(tour, id);
    const to =
      place === null ? null : childDropTo(place.station, list, { into: true });
    if (to === null) return;
    deps.stations.moveChild(id, to);
    (
      inspector.body.querySelector<HTMLElement>('[data-act^="move-to:"]') ??
      inspector.body.querySelector<HTMLElement>('[data-act="earlier"]')
    )?.focus();
  };

  /** The station child `id` moved onto the station `station` (the drag
   *  onto its card, the inspector's Move to station); where it went, the
   *  view flies to that station's centre, where the item now stands. */
  const moveToStation = (id: string, station: string): boolean => {
    if (!deps.stations.moveChild(id, { place: "station", station })) {
      return false;
    }
    view?.flyTo(`${STATION_PREFIX}${station}`);
    return true;
  };

  /** After the inspector's Delete the focus would fall to the page: it
   *  goes to the tree card that took the deleted station's place (the one
   *  before it at the end), for an item to its station's card, and to the
   *  view when the tree is folded or empty. */
  const deleteSelected = (selected: string) => {
    const stations = manifest()?.stations ?? [];
    const stationId = selected.startsWith(STATION_PREFIX)
      ? selected.slice(STATION_PREFIX.length)
      : selectedStationOf(selected, manifest());
    const index = stations.findIndex((s) => s.id === stationId);
    deps.stations.remove(selected);
    // A station's or a story's delete asks first: answered no, it stays
    // selected, and the focus stays on the Delete that was pressed.
    if (state().editorView.selected === selected) return;
    const picks = [
      ...tree.body.querySelectorAll<HTMLElement>(
        ".card[data-station] > .head > .pick",
      ),
    ];
    const own = selected.startsWith(STATION_PREFIX)
      ? undefined
      : picks.find(
          (pick) =>
            pick.closest<HTMLElement>(".card")?.dataset["station"] ===
            stationId,
        );
    const target = own ?? picks[Math.min(Math.max(index, 0), picks.length - 1)];
    if (target !== undefined && target.getClientRects().length > 0) {
      target.focus();
    } else {
      viewBox.focus();
    }
  };

  /** The bar's action on the selection. */
  const runBarAction = (action: BarAction) => {
    const ui = state().editorView;
    const selected = ui.selected;
    if (selected === null) return;
    const model = inspectorModel(ui);
    if (action === "duplicate") {
      deps.stations.duplicate(selected);
      return;
    }
    if (action === "copy") {
      const text = positionText(model);
      if (text === null) return;
      // A browser without the clipboard, or one that refuses it, still
      // shows the text to copy by hand.
      const copied =
        typeof navigator.clipboard?.writeText === "function"
          ? navigator.clipboard.writeText(text)
          : Promise.reject(new Error("no clipboard"));
      copied.then(
        () => {
          deps.say(`Position copied: ${text}`);
        },
        () => {
          deps.say(`Copying was blocked - the position: ${text}`);
        },
      );
      return;
    }
    if (model?.kind !== "item") return;
    if (model.headingDeg === null) {
      deps.say(`${model.title} has no heading to turn`);
      return;
    }
    const off = signedDeg(model.headingDeg);
    if (Math.abs(off) < ALIGNED_DEG) {
      deps.say(`${model.title} already faces the way its station faces`);
      return;
    }
    view?.turn(selected, -off);
    // Said only once the tour carries it (a refusal is the page's to say).
    const after = inspectorModel(state().editorView);
    if (
      after?.kind === "item" &&
      after.headingDeg !== null &&
      Math.abs(signedDeg(after.headingDeg)) < ALIGNED_DEG
    ) {
      deps.say(`Turned ${model.title} to face the way its station faces`);
    }
  };

  // --- the tree's and the inspector's clicks ------------------------------
  tree.body.addEventListener("click", (event) => {
    const target = event.target as Element;
    const adder = target.closest<HTMLElement>("[data-add], [data-fill]");
    if (adder !== null) {
      const id = adder.dataset["add"] ?? adder.dataset["fill"] ?? "";
      const title =
        adder.closest(".card")?.querySelector<HTMLElement>(".pick")?.title ??
        "";
      addMenu.openFor(adder, id, title);
      return;
    }
    const storyAdder = target.closest<HTMLElement>(
      "[data-storyadd], [data-storyfill]",
    );
    if (storyAdder !== null) {
      const id =
        storyAdder.dataset["storyadd"] ?? storyAdder.dataset["storyfill"] ?? "";
      addMenu.openForStory(storyAdder, id, drawnFolder(id)?.title ?? "");
      return;
    }
    const section = target.closest<HTMLElement>("[data-section]");
    if (section !== null) {
      const key = section.dataset["section"] as TreeSection;
      const open = state().editorView.openSections[key];
      store.dispatch(
        editorViewActions.sectionFolded({ section: key, open: !open }),
      );
      return;
    }
    const chip = target.closest<HTMLElement>("[data-layer]");
    if (chip !== null) {
      const layer = chip.dataset["layer"] as ShellLayer;
      const shown = state().editorView.hiddenLayers.includes(layer);
      store.dispatch(editorViewActions.layerShown({ layer, shown }));
      // A hidden code cannot stay selected.
      const { selected } = state().editorView;
      if (
        layer === "codes" &&
        !shown &&
        deps.codes().some((c) => c.id === selected)
      ) {
        deps.select(null);
      }
      return;
    }
    const unfold = target.closest<HTMLElement>("[data-unfold]");
    if (unfold !== null) {
      const id = unfold.dataset["unfold"] ?? "";
      if (drawnTree?.cards.find((c) => c.id === id)?.searchOpened === true) {
        // The search unfolded it: its fold is the search's.
        if (!searchFolded.delete(id)) searchFolded.add(id);
        drawTreeNow();
        pictures.sweep();
        return;
      }
      const open = state().editorView.openStations.includes(id);
      store.dispatch(editorViewActions.stationFolded({ id, open: !open }));
      return;
    }
    const arrow = target.closest<HTMLElement>("[data-folder]");
    if (arrow !== null) {
      const story = arrow.dataset["folder"] ?? "";
      if (drawnFolder(story)?.searchOpened === true) {
        // The search unfolded it: its fold is the search's.
        const key = `${STORY_PREFIX}${story}`;
        if (!searchFolded.delete(key)) searchFolded.add(key);
        drawTreeNow();
        pictures.sweep();
        return;
      }
      const open = state().editorView.openStories.includes(story);
      store.dispatch(editorViewActions.storyFolded({ id: story, open: !open }));
      return;
    }
    const plainFold = target.closest<HTMLElement>("[data-pfold]");
    if (plainFold !== null) {
      const id = plainFold.dataset["pfold"] ?? "";
      const folded = state().editorView.foldedFolders.includes(id);
      store.dispatch(editorViewActions.folderFolded({ id, folded: !folded }));
      return;
    }
    const pen = target.closest<HTMLElement>("[data-rename]");
    if (pen !== null) {
      startRename(pen.dataset["rename"] ?? "");
      return;
    }
    const row = target.closest<HTMLElement>("[data-select]");
    const id = row?.dataset["select"];
    if (id === undefined) return;
    if (pressed) {
      // A long press picked the row already (and began the Select mode).
      pressed = false;
      return;
    }
    const ui = state().editorView;
    if (
      pickable(id) &&
      (event.ctrlKey || event.metaKey || event.shiftKey || ui.selectMode)
    ) {
      pickRows(event.shiftKey && !ui.selectMode ? rangeTo(id) : toggled(id));
      return;
    }
    // A row that takes no tick ends the Select mode: it is selected alone.
    if (ui.selectMode) {
      store.dispatch(editorViewActions.selectModeSet({ on: false }));
    }
    const click = treeClick({
      id,
      at: event.timeStamp,
      detail: event.detail,
      selected: state().editorView.selected,
      last: memory,
    });
    memory = click.memory;
    const plan = treeClickPlan(
      click.outcome,
      id,
      stationGroups(manifest()?.stations ?? []),
      { groupPrefix: STATION_PREFIX },
    );
    if (plan === null) return;
    deps.select(plan.select);
    plan.unfold.forEach((holder, depth) => {
      store.dispatch(
        depth === 0
          ? editorViewActions.stationFolded({ id: holder, open: true })
          : isPlainFolder(holder)
            ? editorViewActions.folderFolded({ id: holder, folded: false })
            : editorViewActions.storyFolded({ id: holder, open: true }),
      );
    });
    if (plan.toggle !== null && isPlainFolder(plan.toggle)) {
      const folded = state().editorView.foldedFolders.includes(plan.toggle);
      store.dispatch(
        editorViewActions.folderFolded({ id: plan.toggle, folded: !folded }),
      );
    } else if (plan.toggle !== null) {
      const open = state().editorView.openStories.includes(plan.toggle);
      store.dispatch(
        editorViewActions.storyFolded({ id: plan.toggle, open: !open }),
      );
    }
    if (plan.fold !== null) {
      store.dispatch(
        editorViewActions.stationFolded({ id: plan.fold, open: false }),
      );
    }
    if (plan.ungrouped) {
      store.dispatch(
        editorViewActions.sectionFolded({ section: "codes", open: true }),
      );
    }
    if (plan.fly && plan.select !== null) flyToSelection(plan.select);
  });
  // --- the plain folders: picking several rows, Group, Ungroup, rename ----
  /** Whether `id` is a plain folder of the open tour. */
  function isPlainFolder(id: string): boolean {
    return plainFolderOf(state().tourDocument, id) !== null;
  }
  /** Whether a row (its selection id) can be picked with others: a free
   *  item or a plain folder (`groupRows`). */
  function pickable(id: string): boolean {
    return (
      groupRows(state().tourDocument, { selected: null, picked: [id] }).length >
      0
    );
  }
  /** The rows picked now (the selection alone when none is). */
  function pickedRows(): string[] {
    return groupRows(state().tourDocument, state().editorView);
  }
  /** The picked rows with `id` added, or taken out when it was in. */
  function toggled(id: string): string[] {
    const rows = pickedRows();
    return rows.includes(id) ? rows.filter((r) => r !== id) : [...rows, id];
  }
  /** The rows from the selection to `id`, as the tree shows them, `id`
   *  last; `id` alone without a selection among them. */
  function rangeTo(id: string): string[] {
    const shown = [
      ...new Set(
        [...tree.body.querySelectorAll<HTMLElement>("[data-select]")]
          .map((e) => e.dataset["select"] ?? "")
          .filter(pickable),
      ),
    ];
    const anchor = state().editorView.selected;
    const from = anchor === null ? -1 : shown.indexOf(anchor);
    const to = shown.indexOf(id);
    if (from < 0 || to < 0) return [id];
    return from <= to
      ? shown.slice(from, to + 1)
      : shown.slice(to, from + 1).reverse();
  }
  /** `ids` picked, the last one the selection (none: nothing selected). */
  function pickRows(ids: readonly string[]): void {
    const last = ids.at(-1);
    if (last === undefined) {
      deps.select(null);
      return;
    }
    deps.select(last);
    store.dispatch(editorViewActions.picked({ ids }));
  }
  /** Group (Ctrl+G, the bar's Group): the picked rows in a new folder,
   *  shown and selected, its name field open to type in. */
  function groupPicked(): void {
    const id = deps.folders.group(pickedRows());
    if (id === null) return;
    const place = plainFolderOf(state().tourDocument, id);
    if (place !== null) {
      store.dispatch(
        editorViewActions.stationFolded({ id: place.stationId, open: true }),
      );
    }
    store.dispatch(editorViewActions.selectModeSet({ on: false }));
    deps.select(`${FOLDER_PREFIX}${id}`);
    startRename(id);
  }
  /** Ungroup (Ctrl+Shift+G, the bar's Ungroup): each picked folder taken
   *  apart, the items it held picked. */
  function ungroupPicked(): void {
    const folders = pickedRows().filter((r) => r.startsWith(FOLDER_PREFIX));
    if (folders.length === 0) {
      deps.say("Pick a folder to ungroup it");
      return;
    }
    const freed = folders.flatMap(
      (r) => deps.folders.ungroup(r.slice(FOLDER_PREFIX.length)) ?? [],
    );
    store.dispatch(editorViewActions.selectModeSet({ on: false }));
    pickRows(freed);
  }
  /** The folder's name field in place of its name, its text selected. */
  function startRename(id: string): void {
    const place = plainFolderOf(state().tourDocument, id);
    if (place === null) return;
    renaming = { id, text: folderName(place.folder) };
    drawTreeNow();
    const field = tree.body.querySelector<HTMLInputElement>("input.renin");
    field?.focus();
    field?.select();
  }
  /** The name typed written (a blank or unchanged one writes nothing), or
   *  dropped; the focus back on the folder's row. */
  function endRename(write: boolean): void {
    const typed = renaming;
    if (typed === null) return;
    renaming = null;
    if (write) deps.folders.rename(typed.id, typed.text);
    drawTreeNow();
    const selection = `${FOLDER_PREFIX}${typed.id}`;
    [...tree.body.querySelectorAll<HTMLElement>("[data-select]")]
      .find((e) => e.dataset["select"] === selection)
      ?.focus();
  }
  tree.body.addEventListener("input", (event) => {
    const field = event.target;
    if (
      field instanceof HTMLInputElement &&
      renaming !== null &&
      field.dataset["ren"] === renaming.id
    ) {
      renaming = { id: renaming.id, text: field.value };
    }
  });
  tree.body.addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (event.target.dataset["ren"] === undefined) return;
    if (event.key === "Enter") {
      event.preventDefault();
      endRename(true);
    } else if (event.key === "Escape") {
      // The page's Escape (drop the selection) waits for the next press.
      event.stopPropagation();
      endRename(false);
    }
  });
  tree.body.addEventListener("focusout", (event) => {
    if (
      !drawingTree &&
      event.target instanceof HTMLInputElement &&
      event.target.dataset["ren"] === renaming?.id
    ) {
      endRename(true);
    }
  });
  tree.selbar.addEventListener("click", (event) => {
    const what = (event.target as Element).closest<HTMLElement>("[data-selbar]")
      ?.dataset["selbar"];
    if (what === "group") groupPicked();
    else if (what === "ungroup") ungroupPicked();
    else if (what === "done") {
      store.dispatch(editorViewActions.selectModeSet({ on: false }));
    }
  });
  tree.selectMode.addEventListener("click", () => {
    const on = !state().editorView.selectMode;
    store.dispatch(editorViewActions.selectModeSet({ on }));
  });
  // A finger's long press on a row starts the Select mode with that row
  // ticked (a mouse has Ctrl and Shift); the click that ends it is spent.
  let pressed = false;
  let pressRow: string | null = null;
  const longPress = createLongPress({
    holdMs: LONG_PRESS.holdMs,
    tolerancePx: LONG_PRESS.tolerancePx,
    schedule: (run, ms) => window.setTimeout(run, ms),
    cancel: (hold) => {
      window.clearTimeout(hold);
    },
    fire: () => {
      const id = pressRow;
      if (id === null || !pickable(id)) return;
      pressed = true;
      store.dispatch(editorViewActions.selectModeSet({ on: true }));
      const rows = pickedRows();
      pickRows(rows.includes(id) ? rows : [...rows, id]);
    },
  });
  tree.body.addEventListener("pointerdown", (event) => {
    pressed = false;
    pressRow = null;
    if (event.pointerType === "mouse") return;
    const at = event.target as Element;
    // A grip's press is the drag's.
    if (at.closest("[data-move], [data-drag]") !== null) return;
    const id = at.closest<HTMLElement>("[data-select]")?.dataset["select"];
    if (id === undefined || !pickable(id)) return;
    pressRow = id;
    longPress.down(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  tree.body.addEventListener("pointermove", (event) => {
    longPress.move(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  for (const end of ["pointerup", "pointercancel"] as const) {
    tree.body.addEventListener(end, (event) => {
      longPress.end(event.pointerId);
    });
  }
  tree.body.addEventListener("contextmenu", (event) => {
    // The browser's own menu for the long press would cover the ticks.
    if (pressed) event.preventDefault();
  });
  tree.stationsHead.addEventListener("click", () => {
    creatorTouchesTree();
    const { openSections, foldedDocks } = state().editorView;
    // On a folded dock the header is the larger target of its head: a tap
    // there only unfolds the dock, its sections as they were.
    if (foldedDocks.tree) {
      store.dispatch(
        editorViewActions.dockFolded({ dock: "tree", folded: false }),
      );
      applyDocks("tree-unfolded");
      return;
    }
    store.dispatch(
      editorViewActions.sectionFolded({
        section: "stations",
        open: !openSections.stations,
      }),
    );
  });
  // The search draws the tree again as it is typed; the field is the
  // page's, never redrawn, so it keeps its focus and its text.
  tree.search.addEventListener("input", () => {
    searchFolded.clear();
    drawTreeNow();
    pictures.sweep();
  });
  tree.search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || tree.search.value === "") return;
    // Escape empties the search first; the shell's Escape (drop the
    // selection) waits for the next press.
    event.stopPropagation();
    clearSearch();
  });
  tree.collapse.addEventListener("click", () => {
    creatorTouchesTree();
    for (const id of state().editorView.openStations) {
      store.dispatch(editorViewActions.stationFolded({ id, open: false }));
    }
  });
  /** The search emptied, and the tree drawn without it where it shows. */
  function clearSearch(): void {
    if (tree.search.value === "") return;
    tree.search.value = "";
    searchFolded.clear();
    if (view === null) return;
    drawTreeNow();
    pictures.sweep();
  }
  /** A new station at the centre of the view: the tree's "+" and the
   *  palette's New station. */
  function addStationAtCentre(): void {
    if (view === null) return;
    const place = view.centre();
    if (place === null) {
      deps.say("Come closer to the ground to add a station here");
      return;
    }
    deps.stations.add(place, "centre");
  }
  /** The station the selection is, or holds the selected item; null. */
  function selectedStationId(): string | null {
    const selected = state().editorView.selected;
    if (selected === null) return null;
    if (selected.startsWith(STATION_PREFIX)) {
      return selected.slice(STATION_PREFIX.length);
    }
    return selectedStationOf(selected, manifest());
  }
  tree.add.addEventListener("click", addStationAtCentre);
  // A search hides stations, so a drop would order the hidden ones
  // unseen: its grips drag nothing (`shell-tree.ts`), and say why.
  tree.body.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest(".grip.off") !== null) {
      deps.say("Clear the search to change the order of the stations");
    }
  });
  createTreeDrag({
    body: tree.body,
    cards: ".card[data-station]",
    idAttribute: "station",
    reorder: (order) => {
      deps.stations.reorder(order);
    },
  });
  // An item's or a story's grip (`shell-tree.ts`): among the stories,
  // between a story and another or the station's free items, or onto
  // another station's card as a whole (asked first, `moveToStation`). A
  // list offered is one the move takes; a free item among the free items
  // is no move (they have no order), and one whose file the tour on disk
  // lacks goes into no story (`freeItemUnsaved`). A plain folder at its
  // station's top moves among the station's folders only: its row's
  // place among them, or the last place for a drop on the station's row.
  /** The ids of the plain folders at the top of `folderId`'s station, in
   *  order, when it is one of them; else null. */
  const topFoldersBeside = (folderId: string): string[] | null => {
    const place = plainFolderOf(state().tourDocument, folderId);
    const station = manifest()?.stations.find((s) => s.id === place?.stationId);
    const ids = (station?.children ?? []).filter(isTourFolder).map((f) => f.id);
    return ids.includes(folderId) ? ids : null;
  };
  /** Where among its station's top folders a folder dropped at `drop`
   *  lands: the folders drawn before the drop's slot (itself left out),
   *  or the last place for a drop into the free items. */
  const folderIndexAt = (
    folderId: string,
    tops: readonly string[],
    drop: { readonly slot: number } | { readonly into: true },
  ): number => {
    if ("into" in drop) return tops.length - 1;
    const card = [
      ...tree.body.querySelectorAll<HTMLElement>(".card[data-station]"),
    ].find((c) =>
      [...c.querySelectorAll<HTMLElement>("[data-item]")].some(
        (r) => r.dataset["item"] === folderId,
      ),
    );
    const listed = [
      ...(card?.querySelectorAll<HTMLElement>("[data-list][data-item]") ?? []),
    ].filter((r) => r.dataset["list"] === FREE_LIST);
    return listed.slice(0, drop.slot).filter((r) => {
      const id = r.dataset["item"] ?? "";
      return id !== folderId && tops.includes(id);
    }).length;
  };
  createNestDrag({
    body: tree.body,
    grip: "[data-move]",
    rows: ".head, .folder, .kid, .emptyrow",
    scope: ".card[data-station]",
    placeOf: (row) => {
      const { list, item } = row.dataset;
      return list === undefined || item === undefined
        ? null
        : { list, id: item };
    },
    intoOf: (row) => row.dataset["into"] ?? null,
    label: (row) => row.querySelector(".nm")?.textContent ?? "",
    across: {
      keyOf: (card) => card.dataset["station"] ?? null,
      accepts: (from, key) => {
        // A folder and a folder's item stay in their station.
        if (
          from.list.startsWith(FOLDER_PREFIX) ||
          plainFolderOf(state().tourDocument, from.id) !== null
        ) {
          return false;
        }
        const tour = manifest();
        const place = tour === null ? null : tourChildPlace(tour, from.id);
        const target = tour?.stations.find((s) => s.id === key);
        return (
          place !== null &&
          target !== undefined &&
          !("refused" in movedToStation(place.station, target, from.id))
        );
      },
    },
    accepts: (from, to) => {
      const doc = state().tourDocument;
      // A folder moves among its station's folders: one level of folders,
      // and none in a story (the drag says "Not possible here").
      if (plainFolderOf(doc, from.id) !== null) {
        return to === FREE_LIST && topFoldersBeside(from.id) !== null;
      }
      if (to.startsWith(FOLDER_PREFIX)) {
        if (from.list === to) return false;
        return (
          folderDropRefusal(
            doc,
            {
              kind: from.list === STORIES_LIST ? "story" : "item",
              id: from.id,
            },
            { kind: "folder", id: to.slice(FOLDER_PREFIX.length) },
          ) === null
        );
      }
      // Out of a folder: to its station's other free items only.
      if (from.list.startsWith(FOLDER_PREFIX)) return to === FREE_LIST;
      if (from.list === FREE_LIST && to === FREE_LIST) return false;
      if (to !== FREE_LIST && freeItemUnsaved(state().tourDocument, from.id)) {
        return false;
      }
      const tour = manifest();
      const place = tour === null ? null : tourChildPlace(tour, from.id);
      return place !== null && childMayGo(place.station, from.id, to);
    },
    move: (from, drop) => {
      if ("across" in drop) {
        moveToStation(from.id, drop.across);
        return;
      }
      if (drop.list.startsWith(FOLDER_PREFIX)) {
        deps.folders.moveInto(from.id, drop.list.slice(FOLDER_PREFIX.length));
        return;
      }
      const tops = topFoldersBeside(from.id);
      if (tops !== null) {
        deps.folders.reorder(from.id, folderIndexAt(from.id, tops, drop));
        return;
      }
      if (from.list.startsWith(FOLDER_PREFIX)) {
        deps.folders.moveInto(from.id, null);
        return;
      }
      const tour = manifest();
      const place = tour === null ? null : tourChildPlace(tour, from.id);
      const to =
        place === null ? null : childDropTo(place.station, drop.list, drop);
      if (to !== null) deps.stations.moveChild(from.id, to);
    },
  });
  bar.acts.addEventListener("click", (event) => {
    const action = (event.target as Element).closest<HTMLElement>("[data-bar]")
      ?.dataset["bar"];
    if (action === "duplicate" || action === "align" || action === "copy") {
      runBarAction(action);
    }
  });
  top.list.addEventListener("click", showList);
  tree.fold.addEventListener("click", () => {
    creatorTouchesTree();
    const folded = !state().editorView.foldedDocks.tree;
    store.dispatch(editorViewActions.dockFolded({ dock: "tree", folded }));
    if (!folded) applyDocks("tree-unfolded");
  });
  inspector.root.addEventListener("click", (event) => {
    const act = (event.target as Element).closest<HTMLElement>("[data-act]")
      ?.dataset["act"];
    const chosen = state().editorView.selected;
    if (
      act !== undefined &&
      chosen !== null &&
      panels.act(act, inspectorModel(state().editorView), chosen)
    ) {
      draw();
      return;
    }
    if (act === "close") deps.select(null);
    if (act === "back" || act?.startsWith("nav:") === true) {
      // Back goes one level up (the crumb's last-but-one part); a crumb
      // part goes to its level. The whole tour is the list.
      const to =
        act === "back"
          ? (inspectorCrumb({
              selected: chosen,
              stations: manifest()?.stations ?? [],
              codes: deps.codes(),
            }).at(-2)?.select ?? null)
          : act.slice("nav:".length) || null;
      if (to === null) showList();
      else deps.select(to);
      return;
    }
    if (act === "lock") {
      // The selected station's position locked or unlocked: view state,
      // never an edit; the session refuses its moves while locked.
      const ui = state().editorView;
      if (ui.selected?.startsWith(STATION_PREFIX) === true) {
        const id = ui.selected.slice(STATION_PREFIX.length);
        store.dispatch(
          editorViewActions.stationLocked({
            id,
            locked: !isStationLocked(ui, id),
          }),
        );
      }
    }
    if (act === "position") {
      positionOpen = !positionOpen;
      draw();
    }
    if (act === "contents") {
      contentsOpen = !contentsOpen;
      draw();
    }
    const { selected } = state().editorView;
    if (selected === null) return;
    if (act === "add-content" && selected.startsWith(STATION_PREFIX)) {
      const button = (event.target as Element).closest<HTMLElement>(
        "[data-act]",
      );
      const model = inspectorModel(state().editorView);
      if (button !== null && model !== null) {
        addMenu.openFor(
          button,
          selected.slice(STATION_PREFIX.length),
          model.title,
        );
      }
    }
    if (act === "add-entry") {
      const button = (event.target as Element).closest<HTMLElement>(
        "[data-act]",
      );
      const model = inspectorModel(state().editorView);
      if (button !== null && model?.kind === "story") {
        addMenu.openForStory(button, model.storyId, model.title);
      }
    }
    if (act?.startsWith("goto:") === true) {
      const item = act.slice("goto:".length);
      deps.select(item);
      const tour = manifest();
      const story =
        tour === null ? undefined : tourChildPlace(tour, item)?.story;
      if (story !== undefined) revealStory(story.id);
      flyToSelection(item);
    }
    if (act === "earlier" || act === "later") moveSelected(selected, act);
    if (act?.startsWith("move-to:") === true) {
      moveSelectedTo(selected, act.slice("move-to:".length));
    }
    if (act === REPLACE_FILE_ACT) {
      const model = inspectorModel(state().editorView);
      if (model?.file !== undefined)
        deps.edits.replaceFile?.(model.file.blockId);
    }
    if (act === "delete") deleteSelected(selected);
    if (act === "split") deps.stations.split(selected);
    // An item's "Select the folder": the 3D view's way to its folder.
    if (act?.startsWith("select:") === true)
      deps.select(act.slice("select:".length));
    // A folder's Pivot to centre and Select its items.
    if (act === "pivot-centre" || act === "select-items") {
      const model = inspectorModel(state().editorView);
      if (model?.kind === "folder" && act === "pivot-centre")
        deps.folders.pivotToCentre(model.folderId);
      if (model?.kind === "folder" && act === "select-items")
        pickRows(model.items.map((item) => item.id));
    }
    if (act === "ground" || act === "ground-items") void runGround(act);
    if (
      act?.startsWith("image:") === true &&
      selected.startsWith(STATION_PREFIX)
    ) {
      const model = inspectorModel(state().editorView);
      const image = act.slice("image:".length);
      if (model?.kind === "station" && model.imageId !== image) {
        deps.edits.station(selected.slice(STATION_PREFIX.length), { image });
      }
    }
    if (act !== undefined) {
      const model = inspectorModel(state().editorView);
      const edit = characterChipEdit(model, act);
      if (edit !== null && model?.kind === "storyEntry") {
        deps.edits.station(model.stationId, { character: edit });
      }
      const advance = entryAdvanceEdit(model, act);
      if (advance !== null) {
        deps.edits.storyAdvance(advance.id, advance.advance);
      }
      const step = stepActEdit(model, act);
      if (step !== null) deps.edits.storyStep(step);
    }
    if (act === "fold") {
      const folded = !state().editorView.foldedDocks.inspector;
      store.dispatch(
        editorViewActions.dockFolded({ dock: "inspector", folded }),
      );
      if (!folded) applyDocks("inspector-unfolded");
    }
  });

  // A field is committed when it is left (and a line on Enter). One a
  // draw takes out of the page is not "left": the browser fires its
  // focusout during the draw, which carries the typed text over to the
  // field drawn again. The commit draws the inspector at once, which takes
  // the control the focus is moving to out of the page too, and Chromium
  // then drops the focus to the page: it goes to that control as drawn
  // again, found by its name.
  let tabPressed = false;
  inspector.root.addEventListener("focusout", (event) => {
    const tabbed = tabPressed;
    tabPressed = false;
    const input = event.target;
    // Only a field drawn under its name: a long text's writer and its link
    // line keep their own text and write it themselves.
    if (
      isTyped(input) &&
      input.dataset["field"] !== undefined &&
      inspector.root.contains(input) &&
      !inspectorDrawing(inspector.root)
    ) {
      const next = controlName(inspector.root, event.relatedTarget);
      commitField(input, state().editorView.selected);
      focusControl(inspector.root, next, tabbed);
    }
  });
  // A step's jump picker (`step-goto:<answer id>`) and its right-answer
  // radio (`step-right:<answer id>`, answered on its click): each writes
  // the whole step; the control drawn again keeps the focus.
  inspector.root.addEventListener("change", (event) => {
    const pick = event.target;
    if (!(pick instanceof HTMLSelectElement)) return;
    const act = pick.dataset["act"];
    if (act?.startsWith(STEP_GOTO) !== true) return;
    const model = inspectorModel(state().editorView);
    const step = model?.kind === "storyStep" ? model.form?.step : undefined;
    if (step?.kind !== "choice") return;
    const edited = stepWithGoto(step, act.slice(STEP_GOTO.length), pick.value);
    if (edited !== null) deps.edits.storyStep(edited);
    focusControl(inspector.root, `[data-act="${act}"]`);
  });
  // The inspector's Move to station (`data-move-station`): a choice moves
  // the selection there, and the picker, drawn again, keeps the focus.
  inspector.root.addEventListener("change", (event) => {
    const pick = event.target;
    if (
      !(pick instanceof HTMLSelectElement) ||
      pick.dataset["moveStation"] === undefined
    ) {
      return;
    }
    const station = pick.value;
    pick.value = "";
    const { selected } = state().editorView;
    if (selected === null || station === "") return;
    moveToStation(childIdOf(selected), station);
    inspector.body
      .querySelector<HTMLElement>("select[data-move-station]")
      ?.focus();
  });
  inspector.root.addEventListener("keydown", (event) => {
    const input = event.target;
    if (!isTyped(input) || input.dataset["field"] === undefined) return;
    if (event.key === "Tab") tabPressed = true;
    // Enter keeps a line; in prose (a text area) it starts a new line.
    if (
      event.key === "Enter" &&
      !event.isComposing &&
      input instanceof HTMLInputElement
    ) {
      event.preventDefault();
      commitField(input, state().editorView.selected);
    } else if (event.key === "Escape" && input.value !== input.defaultValue) {
      // The tour's value back; the next Escape is the page's again.
      event.preventDefault();
      event.stopPropagation();
      input.value = input.defaultValue;
    }
  });

  // --- the top bar, the map controls and the bottom bar --------------------
  for (const button of [top.undo, top.editUndo]) {
    button.addEventListener("click", () => {
      deps.step("undo");
    });
  }
  for (const button of [top.redo, top.editRedo]) {
    button.addEventListener("click", () => {
      deps.step("redo");
    });
  }
  const frame = (whole: boolean) => {
    view?.frame(whole ? null : state().editorView.selected);
  };
  const toggleTop = () => {
    if (view === null) return;
    view.setTop(!view.readout().top);
    readout();
  };
  top.frame.addEventListener("click", () => {
    frame(false);
  });
  top.topView.addEventListener("click", toggleTop);
  top.help.addEventListener("click", (event) => {
    event.stopPropagation();
    showHelp(!helpBox.classList.contains("show"));
  });
  byId("compass").addEventListener("click", () => view?.northUp());
  byId("zoom-in").addEventListener("click", () => view?.zoom(1));
  byId("zoom-out").addEventListener("click", () => view?.zoom(-1));

  // --- while the view shows ------------------------------------------------
  const onKey = (event: KeyboardEvent) => {
    // An open menu is the newest popover: Escape closes it first (the
    // focus back on its button), whether the focus is in it or has left
    // it, even with the help open; the help goes on the next Escape.
    if (event.key === "Escape" && closeOpenMenu()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // The palette is a layer over everything else, the help too.
    if (event.key === "Escape" && palette.isOpen()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      palette.close(true);
      return;
    }
    if (
      event.key === "Escape" &&
      helpBox.classList.contains("show") &&
      !insideMenu(event.target)
    ) {
      // Esc closes the help first, as a popover; the next deselects. On a
      // closed menu's button too (where an Escape just closed its menu).
      event.stopImmediatePropagation();
      showHelp(false);
      return;
    }
    // Every other key in a menu is the menu's, and on a menu's button the
    // keys that open or move in it (`key-target.ts`).
    if (inMenu(event.target, event.key)) return;
    // A toolbar's and a radio group's arrows, Home and End are theirs.
    if (inComposite(event.target, event.key)) return;
    // The bottom panel's keys (Ctrl+J, Ctrl+Shift+M, Escape inside it).
    // Its Escape goes no further (the page would deselect on it).
    if (!deps.dialogOpen() && panel.key(event)) {
      event.stopPropagation();
      return;
    }
    // Ctrl+K adds anything (`add-palette.ts`), from a line field too (the
    // browser's own Ctrl+K never runs); in a text of several lines it is
    // the field's (the long-text writer's Link key).
    if (
      isPaletteKey(event) &&
      !inWritingField(event.target) &&
      !deps.dialogOpen()
    ) {
      event.preventDefault();
      event.stopPropagation();
      palette.open();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.code === "KeyG" &&
      !inField(event.target) &&
      !deps.dialogOpen()
    ) {
      // The browser's own Ctrl+G (find again) never runs here.
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) ungroupPicked();
      else groupPicked();
      return;
    }
    const chosen = state().editorView.selected;
    if (
      event.key === "F2" &&
      chosen?.startsWith(FOLDER_PREFIX) === true &&
      !inField(event.target) &&
      !deps.dialogOpen()
    ) {
      event.preventDefault();
      startRename(chosen.slice(FOLDER_PREFIX.length));
      return;
    }
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      inField(event.target) ||
      deps.dialogOpen() ||
      // The camera stands still during a drag of the gizmo.
      pointerDragRuns(state().editorView)
    ) {
      return;
    }
    if (event.code === "KeyT") toggleTop();
    else if (event.code === "KeyF") frame(false);
    else if (event.code === "Home") frame(true);
  };
  const onOutside = (event: PointerEvent) => {
    const at = event.target as Element | null;
    if (at?.closest("#shell-help, #studio-help") == null) showHelp(false);
  };
  const onResize = () => {
    const model = inspectorModel(state().editorView);
    applyDocks("resized", model);
    sheets.sync(shownSheet(model));
    syncDock();
  };

  // --- the docked layout ---------------------------------------------------
  // From `DOCK_MIN_PX` wide the panels dock around the 3D view (the
  // docking library loaded with it, `dock-host.ts`); narrower, they are
  // today's docks and a phone's sheets. The folds stay the store's: a
  // folded side hides its group, its folded head back over the view.
  let dockLoading = false;
  /** The docking failed to load: said once, not tried again on every
   *  resize (a module that failed to load fails again at once). */
  let dockFailed = false;
  let filesWereShown = false;
  const filesShown = () =>
    dockHost !== null &&
    dockHost.groupShown("files") &&
    dockHost.activeIn("files") === "files";
  const syncFilesShown = () => {
    const shown = filesShown();
    if (shown === filesWereShown) return;
    filesWereShown = shown;
    deps.onFilesShown?.(shown);
  };
  let stopDockFolds: (() => void) | null = null;
  const dockEmpty = document.createElement("p");
  dockEmpty.className = "dock-empty";
  dockEmpty.textContent =
    "Select a station or an item, in the list or in the view.";
  /** Each tab's count, for the layout when it docks. */
  const dockBadges = new Map<DockPanelId, DockBadge>();
  /** The side folds last carried between the store and the docking: each
   *  side hears only the other's changes, so two panels sharing a group
   *  (one fold for both) never undo each other. */
  let carried = { tree: false, inspector: false };
  const FOLDING = [
    ["tree", "list"],
    ["inspector", "details"],
  ] as const;
  /** The bottom panel and the store learn what the docking's own
   *  controls did. */
  const syncFromDock = () => {
    syncFilesShown();
    if (dockHost === null) return;
    for (const [dock, id] of FOLDING) {
      const folded = dockHost.folded(id);
      if (folded === carried[dock]) continue;
      carried = { ...carried, [dock]: folded };
      if (dock === "tree" && !folded) creatorTouchesTree();
      if (state().editorView.foldedDocks[dock] !== folded) {
        store.dispatch(editorViewActions.dockFolded({ dock, folded }));
      }
    }
    const tab = dockHost.activeIn("problems");
    if (!dockHost.groupShown("problems")) {
      panel.docked({ open: false, tab: "problems" });
    } else if (tab !== null && isBottomPanelId(tab)) {
      panel.docked({ open: true, tab });
    }
  };
  const foldDocked = () => {
    if (dockHost === null) return;
    for (const [dock, id] of FOLDING) {
      // Read per side: a fold re-enters through syncFromDock (a shared
      // group folds both panels), so a value read before it is stale.
      const folded = state().editorView.foldedDocks[dock];
      if (folded === carried[dock]) continue;
      carried = { ...carried, [dock]: folded };
      dockHost.fold(id, folded);
    }
  };
  const mountDock = (mount: typeof mountDockHost) => {
    if (dockHost !== null || view === null || !docksAt(window.innerWidth)) {
      return;
    }
    const host = mount({ box: viewBox, onChange: syncFromDock });
    dockHost = host;
    host.content("details").append(dockEmpty);
    for (const [id, badge] of dockBadges) host.badge(id, badge);
    carried = { tree: host.folded("list"), inspector: host.folded("details") };
    foldDocked();
    stopDockFolds = store.subscribe(foldDocked);
    panel.dock({
      show: (tab) => {
        host.reveal(tab);
      },
      hide: () => {
        host.hideGroupOf("problems");
      },
    });
    if (keyboardPx > 0) host.keyboard(keyboardPx);
    deps.onDocked?.(true);
  };
  const syncDock = () => {
    const load = deps.dock;
    if (view !== null && load !== undefined && docksAt(window.innerWidth)) {
      if (dockHost !== null || dockLoading || dockFailed) return;
      dockLoading = true;
      load().then(
        ({ mountDockHost: mount }) => {
          dockLoading = false;
          // The view may have closed, or the window narrowed, meanwhile.
          mountDock(mount);
        },
        (error: unknown) => {
          dockLoading = false;
          dockFailed = true;
          deps.say(
            `The panels could not be docked: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
      return;
    }
    if (dockHost === null) return;
    stopDockFolds?.();
    stopDockFolds = null;
    panel.dock(null);
    dockEmpty.remove();
    dockHost.dispose();
    dockHost = null;
    syncFilesShown();
    deps.onDocked?.(false);
  };

  return {
    clearSearch,
    docked: () => dockHost !== null,
    filesShown,
    conceal(id, instead) {
      dockHost?.conceal(id, instead);
    },
    reveal(id) {
      // The store learns of an unfold from the docking (`syncFromDock`).
      dockHost?.reveal(id);
    },
    badge(id, badge) {
      if (badge === null) dockBadges.delete(id);
      else dockBadges.set(id, badge);
      dockHost?.badge(id, badge);
    },
    show(next, options) {
      view = next;
      drawn = null;
      lastSelected = state().editorView.selected;
      applyDocks("opened");
      approachHold = options?.approach === true;
      foldBeforeApproach = state().editorView.foldedDocks.tree;
      endUnfolding();
      // During the approach the tree is a folded tab: the flight is the
      // view's to show.
      if (approachHold && !state().editorView.foldedDocks.tree) {
        store.dispatch(
          editorViewActions.dockFolded({ dock: "tree", folded: true }),
        );
      }
      unsubscribe?.();
      unsubscribe = store.subscribe(onStore);
      draw();
      readout();
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(readout, READOUT_MS);
      // Capture: Esc reaches the help before the page's own handler.
      window.addEventListener("keydown", onKey, true);
      document.addEventListener("pointerdown", onOutside);
      window.addEventListener("resize", onResize);
      // The view holds every panel, docked or not (a docked one sits in a
      // pane of its own).
      stopKeyboard?.();
      stopKeyboard = watchKeyboard(window, viewBox, (px) => {
        keyboardPx = px;
        dockHost?.keyboard(px);
      });
      syncDock();
    },
    flush() {
      const pending = typedField();
      if (pending !== null) commitField(pending, lastSelected);
      panels.flush();
    },
    hide() {
      // Closed mid-approach: the fold was the approach's, so the tree
      // gets back the fold it had at the open (folded or not).
      if (approachHold) {
        approachHold = false;
        store.dispatch(
          editorViewActions.dockFolded({
            dock: "tree",
            folded: foldBeforeApproach,
          }),
        );
      }
      endUnfolding();
      radius.cancel();
      fieldSliders.cancel();
      const pending = typedField();
      if (pending !== null) commitField(pending, lastSelected);
      panels.flush();
      panels.sync(null);
      busy?.stop.abort();
      busy = null;
      view = null;
      syncDock();
      unsubscribe?.();
      unsubscribe = null;
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onOutside);
      window.removeEventListener("resize", onResize);
      stopKeyboard?.();
      stopKeyboard = null;
      keyboardPx = 0;
      sheets.sync(null);
      showHelp(false);
      addMenu.close(false);
      palette.close(false);
      panel.hide();
      ground.close();
      // Emptied before the pictures go: a later draw of the same selection
      // would otherwise be skipped and keep a card picture let go here.
      drawInspector(
        inspector,
        null,
        { folded: false, positionOpen: false },
        pictures,
      );
      pictures.clear();
      drawn = null;
    },
    groundMenu(point, place) {
      if (view === null) return;
      // The point is the canvas's, and the canvas covers only the view
      // between the docks: the menu is placed in the view's box.
      const canvas = viewBox.querySelector(".view3d-canvas");
      if (canvas === null) {
        ground.openAt(point, place);
        return;
      }
      const c = canvas.getBoundingClientRect();
      const b = viewBox.getBoundingClientRect();
      ground.openAt(
        { x: point.x + c.left - b.left, y: point.y + c.top - b.top },
        place,
      );
    },
    approachEnded(how) {
      if (!approachHold || view === null) return;
      approachHold = false;
      // A takeover can come at any height: the rail stays a tab rather
      // than opening over the whole globe.
      if (how === "taken") return;
      const ui = state().editorView;
      if (!ui.foldedDocks.tree) return;
      // The rule as at an open with the tree unfolded: it stays a tab on a
      // narrow window, or where the inspector already has the room.
      const after = docksAfter(
        "opened",
        {
          widthPx: window.innerWidth,
          folded: { tree: false, inspector: ui.foldedDocks.inspector },
          inspectorShows: sheetModel(inspectorModel(ui)) !== null,
        },
        SHELL_DOCK_LAYOUT,
      );
      if (after.tree) return;
      const still =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
        true;
      if (!still) tree.root.classList.add("unfolding");
      store.dispatch(
        editorViewActions.dockFolded({ dock: "tree", folded: false }),
      );
    },
  };
}
