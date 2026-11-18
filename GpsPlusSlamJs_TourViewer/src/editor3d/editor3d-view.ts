/**
 * The contract between the editor page and its 3D view on the globe
 * (`editor3d-globe.ts`): what the page hands the view (`Editor3dDeps`),
 * what the view hands back (`Editor3dView`), and the figures it reads out
 * for the shell and the tests (`Editor3dReadout`, `Editor3dStats`).
 * Types only, so the page and the shell can name the view without
 * loading it.
 *
 * @see editor3d-view.ts.md
 */
import type { UnknownAction } from "@reduxjs/toolkit";

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import type { TourDocumentState } from "../tour-document.js";
import type { EditorViewState, ShellLayer } from "../editor/editor-view.js";
import type { GroundPlace } from "gps-plus-slam-editor-kit/chrome";
import type { FolderOutlineShown } from "./folder-outline.js";
import type {
  OsmMapLoad,
  OsmMapTile,
  OsmRetryAsk,
  OsmRetryOutcome,
} from "gps-plus-slam-globe/editor";
import type { GizmoPart } from "./editor3d-editing.js";
import type { InputPage } from "./editor3d-input.js";
import type { ModelEdit } from "../editor/model-edits.js";
import type { CharacterCheck } from "../kinds/character/world.js";
import type { EditorCityStats } from "./editor3d-globe-city.js";

/** The store, as the 3D view reads it. */
interface Editor3dStore {
  getState(): {
    readonly tourDocument: TourDocumentState;
    readonly editorView: EditorViewState;
  };
  subscribe(listener: () => void): () => void;
  dispatch(action: UnknownAction): unknown;
}

/** The page's edits the view asks for (`editor3d-input.ts`'s page, less
 *  the store the view reads itself). */
type Editor3dEdits = Omit<InputPage, "dispatch" | "selected"> & {
  /** A model's own edit (a note or a section placed by a click on it):
   *  true when written; a refusal is said by the page. */
  model(id: string, edit: ModelEdit): boolean;
};

/** What the page hands the 3D view. */
export interface Editor3dDeps {
  /** The view's box, over the map (`#view3d`). */
  readonly container: HTMLElement;
  /** The box of the credits' button and overlay, in it. */
  readonly credits: HTMLElement;
  readonly store: Editor3dStore;
  /** The open tour's codes, by level id. */
  levels(): ReadonlyMap<string, QrLevel>;
  /** A content entry of the open tour (photos, models). */
  loadContent(entryName: string): Promise<Blob>;
  /** A lost context or an error once the view shows (before, the open
   *  rejects instead). */
  readonly events: { contextLost(): void; failed(): void };
  readonly edits: Editor3dEdits;
  /**
   * The globe view's approach on opening a tour: given, the view flies in
   * from high above the Earth (`durationMs` overrides the flight's length,
   * for the page's checks only); absent, it opens at the tour.
   */
  readonly approach?: {
    readonly durationMs?: number;
    /** Called once when the approach's bar goes, with how it ended (the
     *  landing, or the creator's takeover); not when the view closes
     *  before. */
    readonly ended?: (how: "landed" | "taken") => void;
  };
  /** The recorded walk's camera captures in their order (the globe view
   *  draws them as a line after its arrival), null while none is known. */
  walk?():
    | readonly {
        readonly lat: number;
        readonly lon: number;
        readonly alt: number;
      }[]
    | null;
}

/** A shown 3D view. */
export interface Editor3dView {
  dispose(): void;
  /** For the page's checks (the dev server's test hook). */
  stats(): Editor3dStats;
  /** Tilt the camera to `deg` from straight down where it stands, keeping
   *  its heading (the page's checks; no control of the page uses it). */
  setTilt(deg: number): void;
  /** Move the camera to `m` from the tour's centre along its line of
   *  sight, keeping its tilt and heading (the page's checks). */
  setDistance(m: number): void;
  /** Turn the camera to the heading `deg` (as `readout` reads it) round
   *  the point its line of sight meets, keeping its distance to that
   *  point and its tilt (the page's checks). */
  setHeading(deg: number): void;
  /** Fly to the page's selection (`station:<id>`, an item's id or a
   *  code's level id): a station framed, an item or a code brought to a
   *  working distance. False for one the tour has no place for. */
  flyTo(selection: string): boolean;
  /** Stand the camera at the viewpoint of the picture `selection` (its
   *  id), looking where the picture hangs from it through the viewpoint's
   *  lens (`editor3d-lens.ts`): the camera's own field of view is back on
   *  the creator's next gesture or camera verb, or another selection.
   *  False for one that is no picture with a viewpoint. */
  lookFrom(selection: string): boolean;
  /** Fit the selection (null: the whole tour) into the view. */
  frame(selection: string | null): void;
  /** Look straight down (the left button then pans like a map), or go
   *  back to the tilt from before. */
  setTop(on: boolean): void;
  /** One zoom step in (1) or out (-1). */
  zoom(step: 1 | -1): void;
  /** Turn the view north up. */
  northUp(): void;
  /** Stop drawing (true) while something covers the whole view, such as
   *  the character maker, so its work gets the machine; false draws
   *  again. The gap counts as no slow frame. */
  setPaused(on: boolean): void;
  /** The globe view's clock: the sky at the real time now (true), or held
   *  in daylight over the tour (false, its default). */
  setRealTime(on: boolean): void;
  /** The globe view's heavy clouds on (true, their default) or off. */
  setClouds(on: boolean): void;
  /** The globe view's OSM buildings (with their trees and roads) shown
   *  (true, their default) or hidden: hiding stops a load that runs, and
   *  while hidden nothing more is loaded for them and they are not drawn. Where
   *  the link turned them off (`buildings=0`) this does nothing. */
  setBuildings(on: boolean): void;
  /** What the shell shows of the camera and the drawing. */
  readout(): Editor3dReadout;
  /** The street map's near tiles, failed first (the Map loading tab). */
  mapTiles(limit: number): readonly OsmMapTile[];
  /** Ask for the street map's failed tiles again now: how many, or why
   *  none (the map off, none failed). */
  retryMap(): OsmRetryAsk;
  /** What became of the last retry's tiles (null before it ran). */
  lastMapRetry(): OsmRetryOutcome | null;
  /** The layers turned off (the station names and the codes are drawn
   *  here; the others have nothing to draw yet). */
  setLayers(hidden: readonly ShellLayer[]): void;
  /** The ground under the camera (the tree's "+"): the globe's eye
   *  stands at street level, so a new item lands where the creator stands,
   *  not where the view looks; null where it has none to give (high over a
   *  ground not loaded yet). */
  centre(): GroundPlace | null;
  /** Turn the selection `deg` clockwise about up, as one edit through the
   *  page (the bar's Align to station); false for one without a pose. */
  turn(selection: string, deg: number): boolean;
  /** A station's ring and radius dots drawn at `radiusM` (null: as the
   *  tour has them); no edit. The inspector's slider, during its drag. */
  previewRadius(stationId: string, radiusM: number | null): void;
  /** Where the selection stands in the world (the page's checks). */
  pointOf(selection: string): readonly [number, number, number] | null;
  /** The ground's ellipsoidal height at a place, as loaded (null where
   *  none has loaded yet): "Put on the ground" waits for it. */
  groundAt(place: {
    readonly lat: number;
    readonly lon: number;
  }): number | null;
  /** The view's origin: the tour's centre when the view opened, which its
   *  frame is built on (the inspector's east and north are measured from
   *  it). */
  origin(): { readonly lat: number; readonly lng: number };
  /** Cancel a gesture under way, writing nothing (an undo, a redo). */
  cancelGesture(): void;
  /** Where the selection (a station's point, an item's or a code's
   *  drawing), or a part of its gizmo, is on the canvas (CSS px; the
   *  page's checks). */
  screenOf(selection: string): readonly [number, number] | null;
  handleScreen(part: GizmoPart): readonly [number, number] | null;
  /** What a press at a canvas point (CSS px) lies on: the object it
   *  picks and whether it meets the move disc (the page's checks). */
  underAt(
    x: number,
    y: number,
  ): { readonly pick: string | null; readonly onDisc: boolean };
  /** The gizmo's drawn sizes (px), or null without one (the page's
   *  checks). */
  gizmoSizes(): {
    readonly knobPx: number;
    readonly dotPx: number;
    readonly ringPx: number;
  } | null;
  /** The selected model's note discs on the canvas (CSS px; null for one
   *  that does not show) and its section planes drawn (the page's
   *  checks). */
  modelParts(): {
    readonly discs: readonly (readonly [number, number] | null)[];
    readonly planes: number;
  };
  /** Show (true) or hide every sound's speaker icon (the page's checks:
   *  the same pixels with the icon and without it). */
  showSoundIcons(on: boolean): void;
  /** How many items of a selected plain folder show their outline box,
   *  and its dashed outline and name tag (the page's checks). */
  folderOutlines(): FolderOutlineShown;
  /** Where a point of a drawn model (its own space) is on the canvas
   *  (CSS px), or null until it is drawn (the page's checks). */
  modelScreenOf(
    id: string,
    at: readonly [number, number, number],
  ): readonly [number, number] | null;
  /** What a drawn character shows now, or null (the page's checks). */
  characterCheck(id: string): CharacterCheck | null;
}

/** The camera, the drawing and the street map's loading, for the shell's
 *  compass, Top view item and bottom panel (its Performance and Map
 *  loading tabs). */
export interface Editor3dReadout {
  /** Degrees from straight down. */
  readonly tiltDeg: number;
  /** The bearing the camera looks toward (degrees clockwise from north). */
  readonly headingDeg: number;
  readonly top: boolean;
  readonly drawCalls: number;
  /** The triangles the last frame drew. */
  readonly triangles: number;
  /** The mean time between the last frames (ms, `frame-clock.ts`). */
  readonly frameMs: number;
  /** The longest of those (ms). */
  readonly worstFrameMs: number;
  /** The frames over 50 ms in the last five seconds. */
  readonly slowFrames: number;
  /** How many frame intervals were ever timed, and the last of them (ms,
   *  oldest first): the Performance tab's chart takes the new ones. */
  readonly frameCount: number;
  readonly recentFrameMs: readonly number[];
  /** The street map's loading state (the overlay's `mapLoad`). */
  readonly mapLoad: OsmMapLoad;
}

export interface Editor3dStats {
  readonly frames: number;
  /** The camera's clip planes in the last frame (m). */
  readonly near: number;
  readonly far: number;
  /** The camera's vertical field of view (degrees): the viewpoint's lens
   *  while looking from one, else the view's own. */
  readonly fovDeg: number;
  readonly tiltDeg: number;
  readonly standing: number;
  readonly stations: number;
  readonly codes: number;
  /** Each code's drawn size over its printed one (laid flat, it grows
   *  with the camera's distance). */
  readonly codeScales: readonly number[];
  /** Each code's drawn side on the canvas (CSS px): its square's corners
   *  projected by the camera of the last frame; 0 when it cannot be
   *  measured (any corner outside the view volume: behind the camera,
   *  nearer than the near plane or past the far one), so also for a code
   *  that straddles the near plane and is partly drawn. */
  readonly codePx: readonly number[];
  readonly shown: readonly string[];
  readonly renders: number;
  readonly osm: Record<string, unknown>;
  /** The street map's loading state (the overlay's `mapLoad`), for the
   *  shell to show. */
  readonly mapLoad: OsmMapLoad;
  /** The tour's centre, in the tour's frame (m). */
  readonly target: readonly [number, number, number];
  /** Where the line of sight meets the ground in the world (m): the
   *  ground under the screen's centre, else the tour's centre. Read with
   *  `camera` in one call: the world's frame follows the camera. */
  readonly look: readonly [number, number, number];
  /** The camera in the world (m). */
  readonly camera: readonly [number, number, number];
  readonly distanceM: number;
  /** A flight is under way. */
  readonly flying: boolean;
  readonly top: boolean;
  /** Each station's drawn height and the drawn ground under it (m over
   *  the ellipsoid; null where no ground has loaded). */
  readonly ground: readonly {
    id: string;
    drawnM: number;
    groundM: number | null;
  }[];
  /** The globe's own figures (`editor3d-globe.ts`): its pose, the
   *  altitude, the dust and the air among them. */
  readonly globe?: Record<string, unknown>;
  /** The globe view's buildings (`editor3d-globe-city.ts`: tiles,
   *  buildings, the worker's state, the height parity); null with
   *  `buildings=0` or without module workers. */
  readonly city?: EditorCityStats | null;
}
