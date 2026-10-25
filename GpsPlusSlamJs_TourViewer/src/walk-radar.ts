/**
 * The visitor's radar on the page: draws `walk-radar-model.ts`'s model on
 * a canvas inside `#ar-root` (a round button whose tap steps the range:
 * automatic, 30, 100, 300 m, automatic again), writes the precision chip
 * under it (shown only while the position is weak, unknown, pending or
 * lost, and for `WALK_RADAR_PEEK_MS` after a tap, with the range label),
 * and keeps what only a view keeps - the range step, the range shown last
 * (the adaptive range's hysteresis), the burst ring of a station just
 * found, the redraw clock and the ms each draw took. The list opens from
 * the sheet only.
 *
 * **Never per frame through the store.** The radar's geometry changes with
 * every camera frame; it lives here (a canvas, a closure), and the store
 * holds only the events behind it (the precision kind, the tracking loss,
 * the walk's statuses). Redrawn at most `WALK_RADAR_HZ` times a second: a
 * request inside the interval leaves one trailing draw, so the last state
 * is always drawn.
 *
 * @see walk-radar.ts.md
 */

import type { TourOrder } from "gps-plus-slam-app-framework/ar/tour-stations";

import {
  createRollingWindow,
  type RollingSummary,
  type RollingWindow,
} from "./rolling-window.js";
import type { WalkChipKind } from "./visitor-guide-slice.js";
import {
  walkPrecisionChip,
  walkPrecisionChipShown,
  walkRadarAdaptiveRangeM,
  walkRadarFovDeg,
  walkRadarModel,
  walkRadarNextRangeM,
  walkRadarRangeLabel,
  WALK_RADAR_RANGE_M,
  type WalkRadarBlip,
  type WalkRadarGeometry,
  type WalkRadarModel,
  type WalkRadarStation,
} from "./walk-radar-model.js";

/**
 * The most redraws a second (the prototype drew every frame; 15 shipped).
 * The phone's frame time with the radar on decides whether more is
 * affordable (the 50 ms frame budget: no frame over 50 ms; the `?debug=1` readout).
 */
export const WALK_RADAR_HZ = 15;

/** How long the range label and the chip show after a tap on the radar,
 *  ms: long enough to read "Range: 100 m" and the chip's few words. */
export const WALK_RADAR_PEEK_MS = 2000;

/** The burst ring at a station just found (the prototype: 1.6 s). */
export const WALK_BURST_MS = 1600;

/** The prototype's colours: the same values as `index.html`'s `--walk-*` tokens
 *  (`walk-radar.test.ts` holds the two together). A canvas needs them as
 *  strings and as RGB for its gradients. */
export const WALK_RADAR_COLOURS = {
  accent: "#fb923c",
  found: "#2dd4bf",
  foundInk: "#04201c",
  skip: "#9aa4ae",
  left: "#f3f5f7",
  gps: "#93c5fd",
  weak: "#fbbf24",
} as const;

/** A `#rrggbb` colour's channels as "r,g,b", for the canvas's `rgba()`
 *  tints. */
function rgbOf(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}

const GPS_RGB = rgbOf(WALK_RADAR_COLOURS.gps);
const WEAK_RGB = rgbOf(WALK_RADAR_COLOURS.weak);
const ACCENT_RGB = rgbOf(WALK_RADAR_COLOURS.accent);
const FOUND_RGB = rgbOf(WALK_RADAR_COLOURS.found);
/** The frozen radar's greys. */
const FROZEN_FOUND = "#b9c1c9";
const FROZEN_OTHER = "#8b949d";

/** The canvas calls the radar makes (a test can record them). */
export interface RadarCanvas {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  globalAlpha: number;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
}

export interface WalkRadarDrawOptions {
  readonly nowMs: number;
  /** The CSS size, px, and the device pixel ratio the canvas uses. */
  readonly sizePx: number;
  readonly dpr: number;
  readonly reduceMotion: boolean;
  /** A station just found: 0..1 of its burst, else undefined. */
  burstOf(id: string): number | undefined;
}

/** Draw the model (the prototype's `drawRadar`, from the model's numbers). */
export function drawWalkRadar(
  g: RadarCanvas,
  m: WalkRadarModel,
  o: WalkRadarDrawOptions,
): void {
  const w = o.sizePx;
  const c = m.centre;
  const R = m.rimR;
  const circle = (x: number, y: number, r: number): void => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
  };
  g.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  g.clearRect(0, 0, w, w);
  g.globalAlpha = 1;
  g.setLineDash([]);
  circle(c, c, R + 3);
  g.fillStyle = "rgba(10,14,19,.68)";
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = "rgba(255,255,255,.28)";
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(255,255,255,.12)";
  for (const ring of m.rings) {
    circle(c, c, ring.r);
    g.stroke();
  }
  // The outer ring's label, placed as the prototype places "100 m".
  const labelled = m.rings.find((r) => r.label !== null);
  if (labelled?.label != null) {
    g.fillStyle = "rgba(255,255,255,.5)";
    g.font = `600 ${String(Math.max(9, w * 0.075))}px system-ui,sans-serif`;
    g.textAlign = "left";
    g.fillText(
      labelled.label,
      c + labelled.r * 0.72 + 1,
      c + labelled.r * 0.72 + 2,
    );
  }
  if (m.north !== null) {
    // A provisional heading's north is dimmer: it can be far off.
    g.fillStyle = m.provisional
      ? "rgba(255,255,255,.38)"
      : "rgba(255,255,255,.7)";
    g.font = `700 ${String(Math.max(9, w * 0.072))}px system-ui,sans-serif`;
    g.textAlign = "center";
    g.fillText(
      "N",
      c + Math.sin(m.north) * (R - 7),
      c - Math.cos(m.north) * (R - 7) + 3.5,
    );
  }
  if (m.visitor.kind === "pending") {
    const p = o.reduceMotion ? 0.25 : (o.nowMs % 1600) / 1600;
    for (const k of [0, 0.5]) {
      const q = (p + k) % 1;
      circle(c, c, 6 + q * (R - 8));
      g.strokeStyle = `rgba(${GPS_RGB},${String(0.7 * (1 - q))})`;
      g.lineWidth = 2;
      g.stroke();
    }
    circle(c, c, 4);
    g.fillStyle = "#fff";
    g.fill();
    return;
  }
  const frozen = m.mode === "frozen";
  if (m.cone !== null) {
    const grd = g.createRadialGradient(c, c, 0, c, c, R);
    grd.addColorStop(0, "rgba(255,255,255,.26)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, R, -Math.PI / 2 - m.cone, -Math.PI / 2 + m.cone);
    g.closePath();
    g.fillStyle = grd;
    g.fill();
  }
  if (m.visitor.kind === "blur") {
    const rgb = m.visitor.tone === "weak" ? WEAK_RGB : GPS_RGB;
    const rr = m.visitor.r;
    const grd = g.createRadialGradient(c, c, 0, c, c, rr * 1.15);
    grd.addColorStop(0, `rgba(${rgb},.55)`);
    grd.addColorStop(0.75, `rgba(${rgb},.28)`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    circle(c, c, rr * 1.15);
    g.fillStyle = grd;
    g.fill();
    g.setLineDash([3, 3]);
    circle(c, c, rr);
    g.strokeStyle = `rgba(${rgb},.85)`;
    g.lineWidth = 1.2;
    g.stroke();
    g.setLineDash([]);
  }
  // Without a heading: how far, not which way.
  for (const ring of m.distanceRings) {
    g.globalAlpha = ring.focus ? 0.95 : 0.5;
    g.setLineDash([4, 4]);
    circle(c, c, ring.r);
    g.strokeStyle = frozen
      ? FROZEN_OTHER
      : ring.focus
        ? WALK_RADAR_COLOURS.accent
        : WALK_RADAR_COLOURS.left;
    g.lineWidth = ring.focus ? 2.2 : 1.2;
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }
  for (const b of m.blips) drawBlip(g, b, frozen, o);
  if (m.rimArc !== null) {
    g.beginPath();
    g.arc(
      c,
      c,
      R + 1,
      m.rimArc - Math.PI / 2 - 0.22,
      m.rimArc - Math.PI / 2 + 0.22,
    );
    g.strokeStyle = WALK_RADAR_COLOURS.accent;
    g.lineWidth = 3.5;
    g.stroke();
  }
  // You.
  if (m.visitor.kind === "unknown") {
    circle(c, c, 9);
    g.fillStyle = "#4b535c";
    g.fill();
    g.fillStyle = "#e5e9ee";
    g.font = "800 12px system-ui,sans-serif";
    g.textAlign = "center";
    g.fillText("?", c, c + 4.2);
  } else if (m.visitor.kind === "pin") {
    circle(c, c, 7.5);
    g.strokeStyle = WALK_RADAR_COLOURS.found;
    g.lineWidth = 2.2;
    g.stroke();
    circle(c, c, 4);
    g.fillStyle = "#fff";
    g.fill();
  } else {
    // A GPS position wobbles a little - more when too weak.
    const weak = m.visitor.tone === "weak";
    const j = o.reduceMotion ? 0 : weak ? 2.2 : 0.9;
    circle(c + Math.sin(o.nowMs / 530) * j, c + Math.cos(o.nowMs / 710) * j, 4);
    g.fillStyle = weak ? "rgba(255,255,255,.75)" : "#fff";
    g.fill();
  }
}

function drawBlip(
  g: RadarCanvas,
  b: WalkRadarBlip,
  frozen: boolean,
  o: WalkRadarDrawOptions,
): void {
  const { x, y, r } = b;
  const circle = (rad: number): void => {
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
  };
  const colour = frozen
    ? b.look === "found"
      ? FROZEN_FOUND
      : FROZEN_OTHER
    : b.look === "focus"
      ? WALK_RADAR_COLOURS.accent
      : b.look === "found"
        ? WALK_RADAR_COLOURS.found
        : b.look === "skipped"
          ? WALK_RADAR_COLOURS.skip
          : b.look === "later"
            ? "rgba(255,255,255,.45)"
            : WALK_RADAR_COLOURS.left;
  g.globalAlpha = b.alpha;
  if (b.look === "focus" && !o.reduceMotion) {
    const q = (o.nowMs % 1400) / 1400;
    circle(r + q * 9);
    g.strokeStyle = `rgba(${ACCENT_RGB},${String(0.6 * (1 - q))})`;
    g.lineWidth = 2;
    g.stroke();
  }
  const burst = o.burstOf(b.id);
  if (burst !== undefined) {
    circle(r + burst * 22);
    g.strokeStyle = `rgba(${FOUND_RGB},${String(1 - burst)})`;
    g.lineWidth = 3;
    g.stroke();
  }
  circle(r);
  if (b.look === "skipped") {
    g.setLineDash([2.5, 2]);
    g.strokeStyle = colour;
    g.lineWidth = 1.6;
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(x - 3.5, y + 3.5);
    g.lineTo(x + 3.5, y - 3.5);
    g.stroke();
  } else if (b.look === "left") {
    g.fillStyle = "rgba(10,14,19,.85)";
    g.fill();
    g.strokeStyle = colour;
    g.lineWidth = frozen ? 1.6 : 2;
    g.stroke();
  } else {
    g.fillStyle = colour;
    g.fill();
  }
  if (b.look === "found") {
    g.beginPath();
    g.moveTo(x - 3, y);
    g.lineTo(x - 0.8, y + 2.3);
    g.lineTo(x + 3.2, y - 2.4);
    g.strokeStyle = WALK_RADAR_COLOURS.foundInk;
    g.lineWidth = 1.8;
    g.stroke();
  } else if (b.look === "focus" || b.look === "left") {
    const big = b.look === "focus";
    g.fillStyle = big ? "#1f1105" : colour;
    g.font = `800 ${big ? "10" : "8.5"}px system-ui,sans-serif`;
    g.textAlign = "center";
    g.fillText(String(b.number), x, y + (big ? 3.6 : 3));
  }
  g.globalAlpha = 1;
}

/**
 * At most one draw per `intervalMs`: a request inside the interval leaves
 * one trailing draw at its end, so the latest state is always drawn.
 */
export function createRedrawThrottle(deps: {
  readonly intervalMs: number;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  draw(): void;
}): { request(): void; cancel(): void } {
  let last = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  function run(): void {
    timer = null;
    last = deps.now();
    deps.draw();
  }
  return {
    request() {
      const wait = last + deps.intervalMs - deps.now();
      if (wait <= 0) {
        if (timer !== null) {
          deps.clearTimer(timer);
          timer = null;
        }
        run();
      } else if (timer === null) {
        timer = deps.setTimer(run, wait);
      }
    },
    cancel() {
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
    },
  };
}

/**
 * The burst ring's clock: a station that turns found (or its story
 * starts) bursts for `WALK_BURST_MS`. Only a change seen between two
 * renders bursts - the first render of a walk (a page reload, the next AR
 * entry) does not replay old finds.
 */
export function createRadarBursts(): {
  note(stations: readonly WalkRadarStation[], nowMs: number): void;
  progress(id: string, nowMs: number): number | undefined;
  reset(): void;
} {
  let states: Map<string, WalkRadarStation["state"]> | null = null;
  const started = new Map<string, number>();
  const unfound = (s: string | undefined) => s === "next" || s === "left";
  return {
    note(stations, nowMs) {
      const next = new Map(stations.map((s) => [s.id, s.state]));
      if (states !== null) {
        for (const [id, state] of next) {
          const before = states.get(id);
          if (unfound(before) && (state === "here" || state === "found")) {
            started.set(id, nowMs);
          }
        }
      }
      states = next;
    },
    progress(id, nowMs) {
      const at = started.get(id);
      if (at === undefined) return undefined;
      const q = (nowMs - at) / WALK_BURST_MS;
      if (q >= 1 || q < 0) {
        started.delete(id);
        return undefined;
      }
      return q;
    },
    reset() {
      states = null;
      started.clear();
    },
  };
}

/**
 * The readout's frame-time source: each frame
 * loop tick's `dt` (seconds) goes into `window` as ms at `now()`. A dt
 * that is no positive finite number (the loop's first frame) is no frame
 * time. Returns the loop's unregister.
 */
export function sampleFrameTimes(
  register: (fn: (dt: number) => void) => () => void,
  now: () => number,
  window: Pick<RollingWindow, "push">,
): () => void {
  return register((dt) => {
    if (Number.isFinite(dt) && dt > 0) window.push(now(), dt * 1000);
  });
}

/**
 * The `?debug=1` readout's two lines: the ms
 * each radar draw took (two decimals: a draw is well under a millisecond
 * on a desktop) and the frame time, each as a mean and the worst over the
 * last 2 s; "-" before anything was measured.
 */
export function walkRadarDebugLines(
  draw: RollingSummary | null,
  frame: RollingSummary | null,
): string[] {
  const line = (s: RollingSummary | null, digits: number): string =>
    s === null
      ? "-"
      : `${s.mean.toFixed(digits)} ms mean, ${s.worst.toFixed(digits)} ms worst (${String(s.count)} in 2 s)`;
  return [`radar draw: ${line(draw, 2)}`, `frame: ${line(frame, 1)}`];
}

/** One render's inputs (the guide's view and the store's events). */
export interface WalkRadarFrame {
  readonly stations: readonly WalkRadarStation[];
  readonly order: TourOrder;
  readonly kind: WalkChipKind;
  readonly accuracyM: number | null;
  readonly live: WalkRadarGeometry | null;
  readonly snapshot: WalkRadarGeometry | null;
}

/** The elements the radar writes (structural, so a test needs no DOM). */
export interface WalkRadarDom {
  /** The radar and the chip's column (`#walk-radar-wrap`). */
  readonly wrap: Pick<HTMLElement, "hidden" | "dataset">;
  /** The round button (`#walk-radar`): a tap steps the range. */
  readonly button: Pick<HTMLElement, "addEventListener">;
  readonly canvas: {
    readonly clientWidth: number;
    width: number;
    height: number;
    getContext(kind: "2d"): RadarCanvas | null;
  };
  /** The chip (`#walk-precision`) and its text; shown only while
   *  `walkPrecisionChipShown`, or after a tap. */
  readonly chip: Pick<HTMLElement, "dataset" | "hidden">;
  readonly chipText: Pick<HTMLElement, "textContent">;
  /** The range label (`#walk-range`), shown only after a tap. */
  readonly rangeLabel: Pick<HTMLElement, "hidden" | "textContent">;
}

export interface WalkRadarView {
  /** Draw this render's radar (throttled); null hides it. */
  render(frame: WalkRadarFrame | null): void;
  /** The ms per draw over the last 2 s (the `?debug=1` readout). */
  drawStats(nowMs: number): RollingSummary | null;
  /** The AR session's end or the open tour's close (both through the
   *  stations' `stop`): the range (automatic again), the bursts and the
   *  draw stats start anew, and a tap's peek ends. */
  reset(): void;
}

function setText(el: Pick<HTMLElement, "textContent">, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function wireWalkRadar(deps: {
  readonly dom: WalkRadarDom;
  /** `performance.now()`: the animation's, the throttle's and the draw
   *  clock. */
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** The XR camera's `P[0]` while a session presents, else null. */
  projection0(): number | null;
  /** The screen's width over its height (the cone's fallback). */
  aspect(): number;
  devicePixelRatio(): number;
  reduceMotion(): boolean;
  /** Call `onChange` whenever the canvas's box is resized (a
   *  `ResizeObserver` on the page, for the page's life). */
  observeSize(onChange: () => void): void;
}): WalkRadarView {
  const { dom } = deps;
  const draws = createRollingWindow();
  const bursts = createRadarBursts();
  let frame: WalkRadarFrame | null = null;
  /** The adaptive range shown last (its hysteresis), kept while a fixed
   *  step is drawn so automatic resumes where it was. */
  let adaptiveM: number | null = null;
  /** The tap's range step: null is automatic. */
  let fixedM: number | null = null;
  /** A tap's peek: the range label and the chip show until its timer. */
  let peekTimer: unknown = null;
  /** The canvas's CSS size as last read: reading it is a layout read, and
   *  a draw follows the sheet's DOM writes of the same render, so it is
   *  read once and again only after a resize (or while it had none). */
  let sizePx: number | null = null;
  deps.observeSize(() => {
    sizePx = null;
  });
  dom.button.addEventListener("click", () => {
    fixedM = walkRadarNextRangeM(fixedM);
    endPeek();
    peekTimer = deps.setTimer(() => {
      peekTimer = null;
      writeWords();
    }, WALK_RADAR_PEEK_MS);
    writeWords();
    throttle.request();
  });

  function endPeek(): void {
    if (peekTimer !== null) deps.clearTimer(peekTimer);
    peekTimer = null;
  }

  /** The range step's word, the range label and whether the chip shows:
   *  by its rule, or during a tap's peek. */
  function writeWords(): void {
    const peeking = peekTimer !== null;
    const range = fixedM === null ? "auto" : String(fixedM);
    if (dom.wrap.dataset["range"] !== range) dom.wrap.dataset["range"] = range;
    setText(
      dom.rangeLabel,
      walkRadarRangeLabel(fixedM, fixedM ?? adaptiveM ?? WALK_RADAR_RANGE_M),
    );
    if (dom.rangeLabel.hidden === peeking) dom.rangeLabel.hidden = !peeking;
    const chipShown =
      peeking || (frame !== null && walkPrecisionChipShown(frame.kind));
    if (dom.chip.hidden === chipShown) dom.chip.hidden = !chipShown;
  }

  function draw(): void {
    const f = frame;
    if (f === null) return;
    const started = deps.now();
    if (sizePx === null || sizePx <= 8) sizePx = dom.canvas.clientWidth;
    if (sizePx <= 8) return;
    const dpr = Math.min(Math.max(deps.devicePixelRatio(), 1), 2);
    const px = Math.round(sizePx * dpr);
    if (dom.canvas.width !== px) {
      dom.canvas.width = px;
      dom.canvas.height = px;
    }
    const g = dom.canvas.getContext("2d");
    if (g === null) return;
    // The range follows the live distances, and holds while frozen. A
    // later station (a tour in order) is still to find: it counts.
    const frozen = f.kind === "none" || f.kind === "lost";
    const geo = frozen ? f.snapshot : f.live;
    const unfound = f.stations
      .filter(
        (s) => s.state === "next" || s.state === "left" || s.state === "later",
      )
      .map((s) => geo?.distances.get(s.id))
      .filter((d): d is number => d !== undefined);
    // The adaptive range keeps following under a fixed step, so the
    // automatic one resumes where it would be.
    adaptiveM = walkRadarAdaptiveRangeM(unfound, adaptiveM);
    if (fixedM === null) writeWords();
    const model = walkRadarModel({
      ...f,
      fovDeg: walkRadarFovDeg(deps.projection0(), deps.aspect()),
      sizePx,
      rangeM: fixedM ?? adaptiveM,
    });
    drawWalkRadar(g, model, {
      nowMs: started,
      sizePx,
      dpr,
      reduceMotion: deps.reduceMotion(),
      burstOf: (id) => bursts.progress(id, started),
    });
    draws.push(started, deps.now() - started);
  }

  const throttle = createRedrawThrottle({
    intervalMs: 1000 / WALK_RADAR_HZ,
    now: () => deps.now(),
    setTimer: (fn, ms) => deps.setTimer(fn, ms),
    clearTimer: (handle) => {
      deps.clearTimer(handle);
    },
    draw,
  });

  return {
    render(next) {
      const shown = next !== null;
      if (dom.wrap.hidden === shown) dom.wrap.hidden = !shown;
      if (next === null) {
        frame = null;
        throttle.cancel();
        return;
      }
      frame = next;
      bursts.note(next.stations, deps.now());
      // The chip: its words and its mark's look; frozen grey for the
      // radar's CSS.
      const text = walkPrecisionChip(next.kind, next.accuracyM);
      setText(dom.chipText, text);
      if (dom.chip.dataset["kind"] !== next.kind) {
        dom.chip.dataset["kind"] = next.kind;
      }
      writeWords();
      const mode =
        next.kind === "none" || next.kind === "lost" ? "frozen" : "live";
      if (dom.wrap.dataset["mode"] !== mode) dom.wrap.dataset["mode"] = mode;
      // The heading's word, for a test and a stylesheet: none, provisional
      // or confirmed (the geometry the radar reads in this mode).
      const geo = mode === "frozen" ? next.snapshot : next.live;
      const heading =
        geo?.headingDeg == null
          ? "none"
          : geo.headingConfirmed === false
            ? "provisional"
            : "confirmed";
      if (dom.wrap.dataset["heading"] !== heading) {
        dom.wrap.dataset["heading"] = heading;
      }
      throttle.request();
    },
    drawStats(nowMs) {
      return draws.summary(nowMs);
    },
    reset() {
      adaptiveM = null;
      fixedM = null;
      endPeek();
      writeWords();
      bursts.reset();
      draws.reset();
    },
  };
}
