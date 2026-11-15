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
 * are pushed apart where they can (a few rounds, each disc held wholly on
 * the screen, so a crowd may stay closer than the gap; their leaders keep
 * the true point), and the one label
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
  /** Whether the model's own body hides the note's point (absent: seen). */
  readonly occluded?: boolean;
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
const NOTE_LABEL_RANGE_M = 16;
/** A disc this far past the screen's edge still counts as on it (px):
 *  the slack decides only whether a disc is shown, never where. */
const NOTE_EDGE_SLACK_PX = 20;
/** How fast a disc eases toward its opacity, per second: the gap left
 *  after `dt` is `exp(-rate * dt)`, a quarter closed per frame at 60 Hz,
 *  and the same per second at any frame rate. */
const NOTE_FADE_RATE = -60 * Math.log(0.75);
/** A disc's radius (px): the stylesheet's 28 px button. A shown disc's
 *  centre is held this far inside every edge, so all of it can be
 *  tapped. */
export const NOTE_DISC_RADIUS_PX = 14;
/** Rounds of the push: enough to part a few neighbours, not a guarantee
 *  for a crowd (a disc held at the edge cannot give way). */
const PUSH_ROUNDS = 6;
/** A disc whose point the model hides is dimmed by this factor (the
 *  chosen page's 0.45), still never below `NOTE_MIN_OPACITY`. */
export const NOTE_OCCLUDED_DIM = 0.45;
/** A ray to a note's point that meets the model this share of its size
 *  as drawn (`drawnSizeM`, m in the world) short of the point is a
 *  cover; nearer is the point's own surface. The page's 2 %; swept
 *  0.5-5 % in the tests. */
export const NOTE_OCCLUSION_SLACK_SHARE = 0.02;
/** A note's cover is tested at most this often (s): the ray walks the
 *  model's triangles, and the disc's easing carries the change. */
export const NOTE_OCCLUSION_INTERVAL_S = 0.25;
/** At most this many cover rays a frame, the longest-waiting note first:
 *  a model with many notes spreads its tests over frames instead of
 *  paying for all of them in one. */
export const NOTE_COVER_TESTS_PER_FRAME = 1;
/** Over this many triangles a model is not cast against whole: its
 *  coarsest level of detail when it has one at or under the cap, else no
 *  ray at all (the facing fade still dims a note that faces away). The
 *  ray walks every triangle with no acceleration structure; the cap is a
 *  guess at a phone's budget, not yet measured on one. */
export const NOTE_COVER_MAX_TRIANGLES = 30_000;

const coverRay = new THREE.Raycaster();
const coverHits: THREE.Intersection[] = [];
const coverDir = new THREE.Vector3();

/**
 * Whether `model` hides `surface` from `eye`: a ray from the eye meets the
 * model more than `slackM` short of the point. The model's own extras
 * that take no ray (its shadow) never cover.
 */
export function noteHidden(
  model: THREE.Object3D,
  eye: THREE.Vector3,
  surface: THREE.Vector3,
  slackM: number,
): boolean {
  const dist = coverDir.subVectors(surface, eye).length();
  if (!(dist > 0) || !Number.isFinite(dist)) return false;
  coverRay.set(eye, coverDir.divideScalar(dist));
  coverRay.near = 0;
  coverRay.far = dist;
  coverHits.length = 0;
  coverRay.intersectObject(model, true, coverHits);
  const first = coverHits[0];
  coverHits.length = 0;
  const slack = Number.isFinite(slackM) && slackM > 0 ? slackM : 0;
  return first !== undefined && first.distance < dist - slack;
}

function trianglesIn(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    const g = mesh.geometry;
    const n =
      g.index !== null ? g.index.count : g.getAttribute("position")?.count;
    count += (n ?? 0) / 3;
  });
  return count;
}

const coverTargets = new WeakMap<THREE.Object3D, THREE.Object3D | null>();

/**
 * What a note's cover ray is cast against for `model`: the model itself
 * up to `NOTE_COVER_MAX_TRIANGLES`, else the coarsest level of its first
 * level of detail when that one is under the cap, else null (no ray).
 * Decided once per model: a mounted model's meshes do not change.
 */
export function coverTargetOf(model: THREE.Object3D): THREE.Object3D | null {
  const known = coverTargets.get(model);
  if (known !== undefined) return known;
  let target: THREE.Object3D | null = null;
  if (trianglesIn(model) <= NOTE_COVER_MAX_TRIANGLES) {
    target = model;
  } else {
    let lod: THREE.LOD | null = null;
    model.traverse((o) => {
      if (lod === null && (o as THREE.LOD).isLOD === true) lod = o as THREE.LOD;
    });
    const coarse = (lod as THREE.LOD | null)?.levels.at(-1)?.object;
    if (
      coarse !== undefined &&
      trianglesIn(coarse) <= NOTE_COVER_MAX_TRIANGLES
    ) {
      target = coarse;
    }
  }
  coverTargets.set(model, target);
  return target;
}

/** The key of note `index` of `blockId`. */
export function noteKey(blockId: string, index: number): string {
  return `${blockId}#${index}`;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Whether a disc at `marker` counts as on a `w` x `h` screen (with
 *  the edge slack). */
function onScreen(
  marker: { x: number; y: number },
  w: number,
  h: number,
): boolean {
  return (
    marker.x > -NOTE_EDGE_SLACK_PX &&
    marker.x < w + NOTE_EDGE_SLACK_PX &&
    marker.y > -NOTE_EDGE_SLACK_PX &&
    marker.y < h + NOTE_EDGE_SLACK_PX
  );
}

/** Hermite between `a` and `b` (GLSL's smoothstep). */
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** How visible a note is that faces the camera by `facing` (-1..1), and
 *  is hidden by its model's body when `occluded`. */
export function noteOpacity(facing: number, occluded = false): number {
  if (!Number.isFinite(facing)) return NOTE_MIN_OPACITY;
  const shown = smooth(-0.2, 0.3, facing) * (occluded ? NOTE_OCCLUDED_DIM : 1);
  return Math.max(NOTE_MIN_OPACITY, shown);
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
    const on = finite && !n.behind && onScreen(n.marker, w, h);
    return { note: n, on, x: n.marker.x, y: n.marker.y };
  });
  // The note the visitor looks at: nearest the screen's centre (a little
  // above it, where a phone held up looks), facing them.
  let best: string | null = null;
  let bestD = Infinity;
  for (const p of placed) {
    if (!p.on || p.note.occluded === true || p.note.facing <= 0.25) continue;
    const d = Math.hypot(p.x - w / 2, p.y - h * 0.45);
    if (d < bestD) {
      bestD = d;
      best = p.note.key;
    }
  }
  // Shown was decided with the slack: a shown disc is then held with all
  // of it on the screen (a disc just past the edge, or pushed there), so
  // it is always one the visitor can tap.
  const r = NOTE_DISC_RADIUS_PX;
  const holdOnScreen = (): void => {
    for (const p of placed) {
      if (!p.on) continue;
      p.x = clamp(p.x, r, Math.max(r, w - r));
      p.y = clamp(p.y, r, Math.max(r, h - r));
    }
  };
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
    holdOnScreen();
  }
  // Also with fewer than two discs, where no round pushes anything.
  holdOnScreen();
  return placed.map((p) => ({
    key: p.note.key,
    on: p.on,
    x: p.x,
    y: p.y,
    surfaceX: p.note.surface.x,
    surfaceY: p.note.surface.y,
    opacity: noteOpacity(p.note.facing, p.note.occluded === true),
    label:
      p.note.key === openKey ||
      (openKey === null &&
        p.note.key === best &&
        p.note.distanceM < NOTE_LABEL_RANGE_M),
  }));
}

/** Whether note `key` of `handle` at `surface` is hidden from `eye`. */
type CoverTest = (
  key: string,
  handle: ModelViewHandle,
  eye: THREE.Vector3,
  surface: THREE.Vector3,
) => boolean;

/** The cover of `handle`'s note at `surface`, tested now; never hidden
 *  for a model too big to cast against (`coverTargetOf`). */
const coverNow: CoverTest = (_key, handle, eye, surface) => {
  const target = coverTargetOf(handle.model);
  return (
    target !== null &&
    noteHidden(
      target,
      eye,
      surface,
      NOTE_OCCLUSION_SLACK_SHARE * handle.drawnSizeM(),
    )
  );
};

/** The notes of `handles` as `camera` sees them on a `width` x `height`
 *  screen; `cover` says which the model hides (by default a ray test per
 *  note, now), asked only for a note whose disc can be shown (in front of
 *  the camera and on the screen). */
export function notesOnScreen(
  handles: readonly ModelViewHandle[],
  camera: THREE.Camera,
  screen: { readonly width: number; readonly height: number },
  cover: CoverTest = coverNow,
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
      const key = noteKey(handle.blockId, index);
      const behind = surface.z > 1 || marker.z > 1;
      const shown = !behind && onScreen(marker, screen.width, screen.height);
      out.push({
        key,
        occluded: shown && cover(key, handle, eye, points.surface),
        surface,
        marker,
        behind,
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
  /** One frame, `dtS` seconds after the last: the discs of `handles`'
   *  notes, `openKey` the note whose card is open; no camera hides them
   *  all. */
  sync(
    handles: readonly ModelViewHandle[],
    camera: THREE.Camera | null,
    openKey: string | null,
    dtS: number,
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
  // Each note's last cover and when it was tested (on `clockS`): a note
  // is due once `NOTE_OCCLUSION_INTERVAL_S` has passed, and a frame
  // tests at most `NOTE_COVER_TESTS_PER_FRAME` due notes. A due note
  // left over is remembered (`next`, the longest-waiting) and goes
  // first in the next frame, so no note is starved by its order.
  const covers = new Map<string, { hidden: boolean; testedAtS: number }>();
  let clockS = 0;
  let budget = 0;
  let turn: string | null = null;
  let next: string | null = null;
  let nextAgeS = -1;
  const coverThrottled: CoverTest = (key, handle, eye, surface) => {
    let c = covers.get(key);
    if (c === undefined) {
      c = { hidden: false, testedAtS: -Infinity };
      covers.set(key, c);
    }
    const ageS = clockS - c.testedAtS;
    if (ageS < NOTE_OCCLUSION_INTERVAL_S) return c.hidden;
    if (budget > 0 && (turn === null || turn === key)) {
      budget -= 1;
      turn = null;
      c.testedAtS = clockS;
      c.hidden = coverNow(key, handle, eye, surface);
      return c.hidden;
    }
    if (ageS > nextAgeS) {
      next = key;
      nextAgeS = ageS;
    }
    return c.hidden;
  };

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
    covers.delete(key);
  };

  return {
    sync(handles, camera, openKey, dtS) {
      const ease =
        Number.isFinite(dtS) && dtS > 0
          ? 1 - Math.exp(-dtS * NOTE_FADE_RATE)
          : 0;
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
      clockS += Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
      budget = NOTE_COVER_TESTS_PER_FRAME;
      turn = next;
      next = null;
      nextAgeS = -1;
      const placements =
        camera === null || width === 0 || height === 0
          ? []
          : layoutNoteMarkers(
              notesOnScreen(handles, camera, { width, height }, coverThrottled),
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
        el.opacity += (p.opacity - el.opacity) * ease;
        el.button.hidden = false;
        el.leader.style.display = "";
        // The stylesheet centres the 28 px button on its origin (its
        // negative margins); a further -50% put the disc 14 px up and left
        // of its point, off its leader's end.
        el.button.style.transform = `translate(${p.x}px, ${p.y}px)`;
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
