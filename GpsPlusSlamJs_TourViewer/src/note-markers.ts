/**
 * A `hotspots` model's notes on the screen: each note a numbered disc
 * floating off the model's surface, a leader line down to the point it
 * describes, and its title beside the disc for the note the visitor is
 * looking at. The discs are buttons on the page's overlay, so a tap on one
 * is the overlay's (never an AR select) and opens that note.
 *
 * `layoutNoteMarkers` is the pure part: where each disc goes from the
 * notes' projected points - a disc whose note faces away fades (never
 * below 0.22, so the visitor still sees there is one), discs too close
 * are pushed apart (their leaders keep the true point), and the one label
 * shown is the open note's, or else the note nearest the screen's centre
 * that faces the visitor within 16 m. `createNoteMarkers` keeps one
 * button and one leader per note on the overlay and moves them each frame.
 *
 * @see note-markers.ts.md
 */

import * as THREE from "three";

import type { ModelViewHandle } from "./model-views.js";

/** One note as the camera sees it this frame. */
export interface NoteOnScreen {
  /** The note's key: its block's id and index (`noteKey`). */
  readonly key: string;
  /** The surface point and the marker point, in screen pixels. */
  readonly surface: { readonly x: number; readonly y: number };
  readonly marker: { readonly x: number; readonly y: number };
  /** Whether either point is behind the camera. */
  readonly behind: boolean;
  /** The note's normal against the direction to the camera (-1..1). */
  readonly facing: number;
  /** The camera's distance to the note's surface point (m). */
  readonly distanceM: number;
}

/** Where one disc goes this frame. */
export interface NotePlacement {
  readonly key: string;
  /** On the screen (else hidden). */
  readonly on: boolean;
  /** The disc's centre after the push apart, and the leader's foot. */
  readonly x: number;
  readonly y: number;
  readonly surfaceX: number;
  readonly surfaceY: number;
  /** The opacity the disc fades toward. */
  readonly opacity: number;
  /** Whether its title is shown. */
  readonly label: boolean;
}

/** The smallest gap between two discs' centres (px). */
export const NOTE_MIN_GAP_PX = 46;
/** A note's disc never fades below this. */
export const NOTE_MIN_OPACITY = 0.22;
/** The farthest a note's title shows by itself (m). */
export const NOTE_LABEL_RANGE_M = 16;
/** A disc this far past the screen's edge still counts as on it (px). */
const EDGE_SLACK_PX = 20;
const PUSH_ROUNDS = 6;

/** The key of note `index` of `blockId`. */
export function noteKey(blockId: string, index: number): string {
  return `${blockId}#${index}`;
}

/** Hermite between `a` and `b` (GLSL's smoothstep). */
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** How visible a note is that faces the camera by `facing` (-1..1). */
export function noteOpacity(facing: number): number {
  if (!Number.isFinite(facing)) return NOTE_MIN_OPACITY;
  return Math.max(NOTE_MIN_OPACITY, smooth(-0.2, 0.3, facing));
}

/**
 * Where every disc goes this frame, on a screen `width` x `height`, with
 * `openKey` the note whose card is open (null: none).
 */
export function layoutNoteMarkers(
  notes: readonly NoteOnScreen[],
  screen: { readonly width: number; readonly height: number },
  openKey: string | null,
): NotePlacement[] {
  const { width: w, height: h } = screen;
  const placed = notes.map((n) => {
    const finite = [n.marker.x, n.marker.y, n.surface.x, n.surface.y].every(
      Number.isFinite,
    );
    const on =
      finite &&
      !n.behind &&
      n.marker.x > -EDGE_SLACK_PX &&
      n.marker.x < w + EDGE_SLACK_PX &&
      n.marker.y > -EDGE_SLACK_PX &&
      n.marker.y < h + EDGE_SLACK_PX;
    return { note: n, on, x: n.marker.x, y: n.marker.y };
  });
  // The note the visitor looks at: nearest the screen's centre (a little
  // above it, where a phone held up looks), facing them.
  let best: string | null = null;
  let bestD = Infinity;
  for (const p of placed) {
    if (!p.on || p.note.facing <= 0.25) continue;
    const d = Math.hypot(p.x - w / 2, p.y - h * 0.45);
    if (d < bestD) {
      bestD = d;
      best = p.note.key;
    }
  }
  for (let round = 0; round < PUSH_ROUNDS; round++) {
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        if (!a.on || !b.on) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= NOTE_MIN_GAP_PX) continue;
        if (d < 0.01) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (NOTE_MIN_GAP_PX - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
  }
  return placed.map((p) => ({
    key: p.note.key,
    on: p.on,
    x: p.x,
    y: p.y,
    surfaceX: p.note.surface.x,
    surfaceY: p.note.surface.y,
    opacity: noteOpacity(p.note.facing),
    label:
      p.note.key === openKey ||
      (openKey === null &&
        p.note.key === best &&
        p.note.distanceM < NOTE_LABEL_RANGE_M),
  }));
}

/** The notes of `handles` as `camera` sees them on a `width` x `height`
 *  screen. */
export function notesOnScreen(
  handles: readonly ModelViewHandle[],
  camera: THREE.Camera,
  screen: { readonly width: number; readonly height: number },
): NoteOnScreen[] {
  camera.updateMatrixWorld();
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const toPx = (v: THREE.Vector3): { x: number; y: number; z: number } => {
    const p = v.clone().project(camera);
    return {
      x: ((p.x + 1) / 2) * screen.width,
      y: ((1 - p.y) / 2) * screen.height,
      z: p.z,
    };
  };
  const out: NoteOnScreen[] = [];
  for (const handle of handles) {
    handle.notePoints().forEach((points, index) => {
      const surface = toPx(points.surface);
      const marker = toPx(points.marker);
      const toEye = eye.clone().sub(points.surface);
      const distanceM = toEye.length();
      out.push({
        key: noteKey(handle.blockId, index),
        surface,
        marker,
        behind: surface.z > 1 || marker.z > 1,
        facing: distanceM > 0 ? points.normal.dot(toEye.normalize()) : 1,
        distanceM,
      });
    });
  }
  return out;
}

/** What the markers need from the page. */
export interface NoteMarkersDom {
  /** The layer the discs are buttons on (covers the screen). */
  readonly layer: HTMLElement;
  /** The SVG the leaders are drawn in (covers the screen). */
  readonly leaders: SVGSVGElement;
}

export interface NoteMarkers {
  /** One frame: the discs of `handles`' notes, `openKey` the note whose
   *  card is open; no camera hides them all. */
  sync(
    handles: readonly ModelViewHandle[],
    camera: THREE.Camera | null,
    openKey: string | null,
  ): void;
  /** Every disc and leader removed. */
  clear(): void;
}

const SVG = "http://www.w3.org/2000/svg";

interface MarkerEls {
  readonly button: HTMLButtonElement;
  readonly leader: SVGGElement;
  readonly lines: readonly SVGLineElement[];
  readonly dot: SVGCircleElement;
  opacity: number;
}

/** The discs and leaders on the page; `onOpen(handle, index)` when a disc
 *  is tapped. */
export function createNoteMarkers(
  dom: NoteMarkersDom,
  onOpen: (handle: ModelViewHandle, index: number) => void,
): NoteMarkers {
  const doc = dom.layer.ownerDocument;
  const els = new Map<string, MarkerEls>();
  const owners = new Map<string, { handle: ModelViewHandle; index: number }>();

  const make = (key: string, title: string, number: number): MarkerEls => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "note-marker";
    button.dataset["note"] = key;
    button.setAttribute("aria-label", `Note ${number}: ${title}`);
    const disc = doc.createElement("span");
    disc.className = "note-disc";
    disc.textContent = String(number);
    const label = doc.createElement("span");
    label.className = "note-label";
    label.textContent = title;
    button.append(disc, label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const owner = owners.get(key);
      if (owner !== undefined) onOpen(owner.handle, owner.index);
    });
    dom.layer.append(button);
    const leader = doc.createElementNS(SVG, "g");
    const under = doc.createElementNS(SVG, "line");
    under.setAttribute("class", "note-leader-under");
    const over = doc.createElementNS(SVG, "line");
    over.setAttribute("class", "note-leader");
    const dot = doc.createElementNS(SVG, "circle");
    dot.setAttribute("class", "note-dot");
    dot.setAttribute("r", "3.2");
    leader.append(under, over, dot);
    dom.leaders.append(leader);
    return { button, leader, lines: [under, over], dot, opacity: 0 };
  };

  const remove = (key: string): void => {
    const el = els.get(key);
    el?.button.remove();
    el?.leader.remove();
    els.delete(key);
    owners.delete(key);
  };

  return {
    sync(handles, camera, openKey) {
      const width = dom.layer.clientWidth;
      const height = dom.layer.clientHeight;
      const wanted = new Set<string>();
      owners.clear();
      for (const handle of handles) {
        handle.notes.forEach((note, index) => {
          const key = noteKey(handle.blockId, index);
          wanted.add(key);
          owners.set(key, { handle, index });
          if (!els.has(key)) els.set(key, make(key, note.title, index + 1));
        });
      }
      for (const key of [...els.keys()]) if (!wanted.has(key)) remove(key);
      dom.leaders.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const placements =
        camera === null || width === 0 || height === 0
          ? []
          : layoutNoteMarkers(
              notesOnScreen(handles, camera, { width, height }),
              { width, height },
              openKey,
            );
      const byKey = new Map(placements.map((p) => [p.key, p]));
      for (const [key, el] of els) {
        const p = byKey.get(key);
        if (p === undefined || !p.on) {
          el.button.hidden = true;
          el.leader.style.display = "none";
          continue;
        }
        el.opacity += (p.opacity - el.opacity) * 0.25;
        el.button.hidden = false;
        el.leader.style.display = "";
        el.button.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        el.button.style.opacity = el.opacity.toFixed(3);
        el.leader.style.opacity = (el.opacity * 0.95).toFixed(3);
        el.button.classList.toggle("open", key === openKey);
        el.button.classList.toggle("labelled", p.label);
        for (const line of el.lines) {
          line.setAttribute("x1", String(p.surfaceX));
          line.setAttribute("y1", String(p.surfaceY));
          line.setAttribute("x2", String(p.x));
          line.setAttribute("y2", String(p.y));
        }
        el.dot.setAttribute("cx", String(p.surfaceX));
        el.dot.setAttribute("cy", String(p.surfaceY));
      }
    },
    clear() {
      for (const key of [...els.keys()]) remove(key);
    },
  };
}
