/**
 * What a travelling surface gives the travelling box's controller
 * (`travelling-box.ts`): one painted texture drawn on a plate in the world
 * or on a quad flying to and docked at the screen, and an invisible DOM
 * ghost that lays it out at the dock and takes the fingers there. The
 * sign's words are the first surface (`travelling-box-sign.ts`); the
 * controller knows nothing of words, voices or signs.
 *
 * @see travel-surface.ts.md
 */
import type { Mesh, Texture } from "three";

import type {
  PlateMetrics,
  TravelGate,
  TravelHideWhy,
  TravellingBoxKnobs,
} from "./travelling-box-rules.js";

/** The screen slot a surface docks in. */
type TravelSlot = "bottom" | "corner";

type TravelKind = "words" | "bubble" | "video" | "note" | "pin";

/** A rectangle on the page (CSS px). */
export interface TravelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The surface's painted size, as its ghost lays it out. The controller
 *  sizes the canvas and hangs the plate anew when this object changes (a
 *  surface returns the same object until it lays out anew). */
export interface TravelLayout {
  /** The ghost's size (CSS px). */
  readonly cssW: number;
  readonly cssH: number;
  /** One em and one line of its text (CSS px), for the metrics. */
  readonly fontPx: number;
  readonly lineHeightPx: number;
  /** The canvas it paints into (device px). */
  readonly canvasW: number;
  readonly canvasH: number;
}

/** A finger forwarded from the plate or the flying quad (page px). */
export interface TravelPress {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** One line of the text as the finger sees it (px). */
  readonly linePx: number;
}

export interface TravelSurface {
  /** Unique per open surface: the logs and the check hook carry it. */
  readonly id: string;
  readonly kind: TravelKind;
  readonly slot: TravelSlot;
  /** It shows a voice's words. */
  readonly voiced: boolean;
  /** The voice it answers to (its block id), or null for a silent surface. */
  answersTo(): string | null;
  /** The plate in the world: a unit plane (x and y from -0.5 to 0.5,
   *  facing +z) the surface scales and places. Its material's `map` and
   *  `opacity` are the controller's while it hangs. */
  readonly plate: Mesh;
  /** The surface travels at all now (its words are in travel mode). */
  travelling(): boolean;
  /** Why it hides now, or null. */
  hideWhy(): TravelHideWhy | null;
  /** It can fold into a mark when it would dock without its slot. */
  canFold(): boolean;
  /** The sizes the plate must reach on screen this frame. */
  gates(metrics: PlateMetrics, knobs: TravellingBoxKnobs): TravelGate[];
  /** The layout now, or null when there is nothing to paint. Called once
   *  per frame, before `paintKey` and `paint`. */
  layout(): TravelLayout | null;
  /** Changes whenever a paint would look different. */
  paintKey(): string;
  /** Paints into the canvas of the current layout's size. */
  paint(g: CanvasRenderingContext2D): void;
  /** Hangs `texture` on the plate at the layout's shape; `unhang` takes
   *  the plate down. */
  hang(texture: Texture, layout: TravelLayout): void;
  unhang(): void;
  /** The ghost's resting rectangle at the dock, or null when it has
   *  none. Read at layout, never per frame from the DOM. */
  restingRect(): TravelRect | null;
  setGhost(on: boolean): void;
  /** Whether the ghost takes pointers itself. */
  setPointer(on: boolean): void;
  /** A finger from the plate or the quad; false when one is down. */
  beginPress(press: TravelPress): boolean;
  movePress(x: number, y: number): void;
  endPress(kind: "up" | "cancel", x: number, y: number): void;
  /** A finger is down on the surface (forwarded or on the ghost). */
  pressing(): boolean;
}
