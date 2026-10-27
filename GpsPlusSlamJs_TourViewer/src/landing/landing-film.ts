/**
 * The landing page's hero film, mounted into a box the page gives it: a
 * model park that shows what a tour is and how one is made, in eight
 * parts that play once, with a segmented bar to pause, play and jump to a
 * part, and a caption under the picture.
 *
 * It plays by itself once enough of it is in view, pauses when it leaves
 * the view or on a tap, and asks for animation frames only while it
 * plays. With reduced motion it opens on its last picture with every
 * caption as a list and plays only when asked. Without WebGL, or after a
 * real context loss, it draws the same park flat. When AR starts it stops
 * and frees its renderer; the next time it is in view (or played) it
 * builds a new one.
 *
 * `mountLandingFilm` is the page's interface. `createLandingFilm` is the
 * same with its pace and renderer tunable and its browser parts as seams,
 * for tests and measurements.
 *
 * @see landing-film.ts.md
 */
import "./landing-film.css";

import { createFrameTimes } from "gps-plus-slam-app-framework/utils/frame-times";
import { debugUiEnabledFromSearch } from "gps-plus-slam-app-framework/utils/debug-flag";

import { barModel } from "./film-bar.js";
import { createFilmBarView } from "./film-bar-view.js";
import { createRunCounts, debugQuality, filmReadout } from "./film-debug.js";
import { buildFilmDom, type FilmDom } from "./film-dom.js";
import { drawFloor, floorSignature } from "./film-floor.js";
import { createGpuLifecycle, type FallbackReason } from "./film-gpu.js";
import { filmLayout, type FilmLayout } from "./film-layout.js";
import { createPhoneView, floorAnchors } from "./film-phone.js";
import { createFilmPlayer, type PlayerSnapshot } from "./film-player.js";
import type { LandingFilmOptions, LandingPart } from "./landing-mount.js";
import {
  createFilmScene,
  FULL_QUALITY,
  type FilmScene,
  type SceneParts,
  type SceneQuality,
} from "./film-scene.js";
import {
  BEAT_CAPTIONS,
  BEAT_TITLES,
  FILM_BEATS,
  frameAt,
  type ViewName,
} from "./film-story.js";
import {
  createTimeline,
  type Segment,
  type TimelinePace,
} from "./film-timeline.js";

/** The film's pace and gating (each swept; see landing-film.ts.md). */
export interface FilmTuning extends TimelinePace {
  readonly startShare: number;
  readonly leaveShare: number;
  readonly quality: SceneQuality;
}

export const DEFAULT_TUNING: FilmTuning = {
  // 0.75 of the prototype's acting speed (swept 1, 0.75, 0.5): slower, so each
  // step can be followed; 70 s in all (0.5 makes it 98 s, 1 makes it 56 s).
  speed: 0.75,
  // a reading hold after each part (swept 0, 1.5, 3 s): every caption then
  // shows at least 2.1 s longer than it takes to read at 200 words a minute;
  // without it the shortest part is cut before its caption is read.
  holdS: 1.5,
  // one camera move, and the pause before a part whose view stays (the prototype's)
  camS: 1.1,
  settleS: 0.22,
  // starts with half of it in view (swept 0.25, 0.5): at 0.25 it starts
  // while most of it is still below the fold and the first part is missed
  startShare: 0.5,
  // leaves the view (and pauses) below a tenth: hysteresis, so a film at
  // the edge of the view does not flicker between playing and paused
  leaveShare: 0.1,
  // Full quality, NOT shown to meet the phone budget (no frame over 50 ms):
  // at 390x844 with the CPU slowed 4x, 18 and 24 frames over 50 ms in 30 s,
  // and every knob (shadows, pixel ratio 1.5, eye pass, all off) within the
  // noise of repeats (14 to 77). A slowed CPU cannot judge knobs that cut
  // GPU work; a phone's `?debug=1` readout with fewer slow frames under
  // `film-shadows=0` or `film-dpr=1.5` over a whole run would change this.
  quality: FULL_QUALITY,
};

/** The browser parts, as seams. */
export interface FilmEnv {
  readonly webgl: () => boolean;
  readonly createScene: (
    doc: Document,
    parts: SceneParts,
    quality: SceneQuality,
    opts: {
      reducedMotion: boolean;
      devicePixelRatio: number;
      smallScreen: boolean;
    },
    onContextLost: () => void,
  ) => FilmScene;
  readonly observeView: (
    el: Element,
    onShare: (share: number) => void,
  ) => () => void;
  readonly observeSize: (el: Element, onSize: () => void) => () => void;
  readonly viewport: () => { w: number; h: number; dpr: number };
  readonly now: () => number;
  /** The stage's size, CSS px. */
  readonly size: (el: HTMLElement) => { w: number; h: number };
  /** `?debug=1`: the frame readout over the picture. */
  readonly debug: boolean;
  /** The scene's quality from the tuning's (`?debug=1` with the address's knobs; film-debug.ts). */
  readonly quality: (base: SceneQuality) => SceneQuality;
}

/** What a harness can see and do; the page uses only `destroy`. */
export interface LandingFilmHandle extends LandingPart {
  snapshot(): PlayerSnapshot;
  jumpTo(beat: number): void;
  toggle(): void;
  renderer(): "3d" | "floor";
  readonly totalS: number;
  readonly segments: readonly Segment[];
}

const THRESHOLDS = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1];

function hasWebGL(doc: Document): boolean {
  try {
    const c = doc.createElement("canvas");
    const g = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!g) return false;
    g.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function browserEnv(doc: Document): FilmEnv {
  const win = doc.defaultView;
  const search = win ? win.location.search : "";
  const debug = debugUiEnabledFromSearch(search);
  return {
    webgl: () => hasWebGL(doc),
    createScene: createFilmScene,
    observeView(el, onShare) {
      if (!win || typeof win.IntersectionObserver !== "function") {
        onShare(1);
        return () => undefined;
      }
      const io = new win.IntersectionObserver(
        (es) => {
          const e = es[es.length - 1];
          if (e) onShare(e.isIntersecting ? e.intersectionRatio : 0);
        },
        { threshold: THRESHOLDS },
      );
      io.observe(el);
      return () => io.disconnect();
    },
    observeSize(el, onSize) {
      if (win && typeof win.ResizeObserver === "function") {
        const ro = new win.ResizeObserver(() => onSize());
        ro.observe(el);
        return () => ro.disconnect();
      }
      win?.addEventListener("resize", onSize);
      return () => win?.removeEventListener("resize", onSize);
    },
    viewport: () => ({
      w: win?.innerWidth ?? 1024,
      h: win?.innerHeight ?? 768,
      dpr: win?.devicePixelRatio ?? 1,
    }),
    now: () => (win ? win.performance.now() : Date.now()),
    size: (el) => ({ w: el.clientWidth, h: el.clientHeight }),
    debug,
    quality: (base) => (debug ? debugQuality(search, base) : base),
  };
}

/** Fits the floor's label pills to their text (needs layout; skipped where text cannot be measured). */
function fitFloorLabels(floor: SVGSVGElement): void {
  for (const g of floor.querySelectorAll<SVGGElement>(".lf-lb")) {
    const t = g.querySelector<SVGTextContentElement>(".lf-nm");
    const r = g.querySelector("rect");
    if (!t || !r || typeof t.getComputedTextLength !== "function") continue;
    let len: number;
    try {
      len = t.getComputedTextLength();
    } catch {
      continue;
    }
    if (!len) continue;
    const h = Number(g.dataset.h);
    const f = Number(g.dataset.fs);
    const x = Number(g.dataset.x);
    const isN = g.dataset.n === "1";
    const w = len + (isN ? h + 0.3 * f + 0.7 * f : 1.4 * f);
    const x0 = x - w / 2;
    r.setAttribute("x", x0.toFixed(2));
    r.setAttribute("width", w.toFixed(2));
    if (isN) {
      const c = g.querySelector("circle");
      const num = g.querySelector("text:not(.lf-nm)");
      c?.setAttribute("cx", (x0 + h / 2).toFixed(2));
      num?.setAttribute("x", (x0 + h / 2).toFixed(2));
      t.setAttribute("x", (x0 + h + 0.3 * f).toFixed(2));
    }
  }
}

function setLead(
  dom: FilmDom,
  p: readonly [number, number] | null,
  ly: FilmLayout | null,
): void {
  if (!p || !ly) {
    dom.leadLine.setAttribute("opacity", "0");
    dom.leadDot.setAttribute("opacity", "0");
    return;
  }
  const px = ly.phone.x - 3;
  const py = ly.phone.y + ly.phone.h * 0.46;
  dom.leadLine.setAttribute("x1", p[0].toFixed(1));
  dom.leadLine.setAttribute("y1", p[1].toFixed(1));
  dom.leadLine.setAttribute("x2", px.toFixed(1));
  dom.leadLine.setAttribute("y2", py.toFixed(1));
  dom.leadDot.setAttribute("cx", p[0].toFixed(1));
  dom.leadDot.setAttribute("cy", p[1].toFixed(1));
  dom.leadLine.setAttribute("opacity", ".6");
  dom.leadDot.setAttribute("opacity", ".8");
}

/**
 * The film with its pace, renderer and browser parts given. Throws a
 * TypeError for a host that is not an element (a page bug, not a device).
 */
export function createLandingFilm(
  host: HTMLElement,
  options: LandingFilmOptions,
  tuning: FilmTuning = DEFAULT_TUNING,
  envIn?: Partial<FilmEnv>,
): LandingFilmHandle {
  if (!host || typeof host.append !== "function" || !host.ownerDocument) {
    throw new TypeError("landing film: host must be an element in a document");
  }
  if (typeof options.onArStarting !== "function") {
    throw new TypeError("landing film: onArStarting must be a function");
  }
  const doc = host.ownerDocument;
  const env: FilmEnv = { ...browserEnv(doc), ...envIn };
  const win = doc.defaultView;
  const rf: (cb: FrameRequestCallback) => number =
    options.requestFrame ?? ((cb) => (win ? win.requestAnimationFrame(cb) : 0));
  const cancelled = new Set<number>();

  const timeline = createTimeline<ViewName>(FILM_BEATS, tuning);
  const dom = buildFilmDom(doc);
  const phone = createPhoneView(dom);
  // the frame measurements exist only for the `?debug=1` readout
  const frames = env.debug ? createFrameTimes(600) : null;
  const run = env.debug ? createRunCounts() : null;
  const quality = env.quality(tuning.quality);
  let sceneDpr = 1;
  const gpu = createGpuLifecycle({ webgl: env.webgl() });
  /** The scene being drawn; null while drawing flat or while `owned` compiles. */
  let scene: FilmScene | null = null;
  /** The scene that exists (shown or still compiling): the one to free. */
  let owned: FilmScene | null = null;
  let ly: FilmLayout | null = null;
  let layoutKey = 0;
  let floorSig = "";
  let anchorKey = "";
  let buildMs = 0;
  let lastFrameNow: number | null = null;
  /**
   * After AR took the GPU, only a new entry into view (or a tap) builds
   * a renderer again: a view change while still in view (a layout shift
   * during the session) must not build one behind it.
   */
  let rebuildOnEntry = false;
  let lastEmit = "";
  let listMode = false;
  /** The stage's last good height with the caption list (sizeStageForList). */
  let listStageH: number | null = null;
  let destroyed = false;

  dom.captions.replaceChildren(
    ...BEAT_CAPTIONS.map((c) => {
      const li = doc.createElement("li");
      li.textContent = c;
      return li;
    }),
  );

  const placeAnchors = () => {
    if (!ly) return;
    const eye = phone.eye();
    const key = `${String(layoutKey)}|${eye}|${scene ? "3d" : "floor"}`;
    if (key === anchorKey) return;
    anchorKey = key;
    const sw = ly.screen.w;
    const sh = ly.screen.h;
    phone.place(
      scene ? scene.anchors(eye, sw, sh) : floorAnchors(eye, sw, sh),
      ly,
    );
  };

  const render = (t: number) => {
    if (destroyed) return;
    const pos = timeline.positionAt(t);
    const frame = frameAt(pos.beat, pos.storyT);
    phone.apply(frame.u);
    placeAnchors();
    if (!ly) return;
    if (scene) {
      scene.draw(frame, timeline.cameraAt(t), t);
      return;
    }
    const sig = `${String(layoutKey)}|${floorSignature(frame.s, frame.u.on)}`;
    if (sig === floorSig) return;
    floorSig = sig;
    const d = drawFloor(frame.s, frame.u.on, ly);
    dom.floor.setAttribute("viewBox", d.viewBox);
    dom.floor.setAttribute("preserveAspectRatio", "xMidYMid meet");
    dom.floor.innerHTML = d.markup;
    fitFloorLabels(dom.floor);
    setLead(dom, d.lead, ly);
  };

  const onChange = (snap: PlayerSnapshot) => {
    const m = barModel(snap, BEAT_TITLES, BEAT_CAPTIONS);
    bar.update(m);
    if (dom.caption.textContent !== m.caption)
      dom.caption.textContent = m.caption;
    if (m.captionsAsList !== listMode) {
      listMode = m.captionsAsList;
      showList(listMode);
      sizeStageForList();
      layout();
    }
    dom.root.classList.toggle("lf-paused", m.paused);
    dom.root.classList.toggle("lf-finished", m.finished);
    if (snap.status !== "playing") lastFrameNow = null;
    const key = `${snap.status}|${String(snap.position.beat)}|${String(snap.moving)}|${String(snap.pausedBy)}`;
    if (key !== lastEmit) {
      lastEmit = key;
      host.dataset.filmState = snap.status;
      host.dataset.filmBeat = String(snap.position.beat);
      host.dataset.filmMoving = String(snap.moving);
      // the cards below hold still while this is "true" (landing-cards.ts):
      // while the film moves with its start share in view, not while it
      // plays on mostly scrolled away
      host.dataset.playing = String(snap.moving);
      host.dispatchEvent(
        new (win?.CustomEvent ?? CustomEvent)("landing-film-change", {
          detail: {
            status: snap.status,
            beat: snap.position.beat,
            moving: snap.moving,
            pausedBy: snap.pausedBy,
          },
        }),
      );
    }
    if (run && frames) {
      dom.debug.hidden = false;
      dom.debug.textContent = filmReadout({
        renderer: scene ? "3d" : "floor",
        quality,
        dpr: sceneDpr,
        status: snap.status,
        t: snap.t,
        totalS: timeline.totalS,
        live: frames.summary(),
        run: run.counts(),
        buildMs,
      });
    }
  };

  const player = createFilmPlayer({
    timeline,
    reducedMotion: options.reducedMotion,
    startShare: tuning.startShare,
    leaveShare: tuning.leaveShare,
    requestFrame(cb) {
      const id = rf((now) => {
        if (cancelled.delete(id)) return;
        if (lastFrameNow !== null) {
          frames?.push(now - lastFrameNow);
          run?.push(now - lastFrameNow);
        }
        lastFrameNow = now;
        cb(now);
      });
      return id;
    },
    cancelFrame(id) {
      cancelled.add(id);
      if (!options.requestFrame) win?.cancelAnimationFrame(id);
    },
    render,
    onChange,
  });

  const bar = createFilmBarView(doc, {
    titles: BEAT_TITLES,
    weights: timeline.segments.map((s) => s.endS - s.startS),
    onJump: (beat) => {
      ensureScene();
      player.jumpTo(beat);
    },
    onToggle: () => {
      ensureScene();
      player.toggle();
    },
  });
  dom.stage.after(bar.element);

  const toFloor = () => {
    scene = null;
    owned = null;
    dom.root.classList.remove("lf-3d");
    floorSig = "";
    anchorKey = "";
  };
  const report = (r: FallbackReason | null) => {
    if (r) options.onFallback?.(r);
  };

  /** The page's mark of a live AR session (ar-entry.ts). */
  const arActive = () => doc.body?.dataset["arActive"] === "true";

  function ensureScene(): void {
    if (destroyed || !gpu.wantsScene() || !ly) return;
    if (arActive()) {
      // AR has the GPU: build on the next entry into view (or a tap) after it
      rebuildOnEntry = true;
      return;
    }
    const t0 = env.now();
    try {
      const vp = env.viewport();
      let token = 0;
      const s = env.createScene(
        doc,
        {
          stage: dom.stage,
          after: dom.floor,
          tags: dom.tags,
          leadLine: dom.leadLine,
          leadDot: dom.leadDot,
        },
        quality,
        {
          reducedMotion: options.reducedMotion,
          devicePixelRatio: vp.dpr,
          smallScreen: Math.min(vp.w, vp.h) < 700,
        },
        () => onLost(token),
      );
      token = gpu.created();
      owned = s;
      sceneDpr = Math.min(vp.dpr || 1, quality.pixelRatioCap);
      s.layout(ly);
      // the drawing stays until the shaders are compiled (film-scene.ts prepare)
      const adopt = () => {
        if (destroyed || owned !== s) return;
        scene = s;
        dom.root.classList.add("lf-3d");
        anchorKey = "";
        s.show();
        player.redraw();
      };
      s.prepare().then(adopt, adopt);
    } catch {
      toFloor();
      report(gpu.createFailed());
    }
    buildMs = Math.max(buildMs, env.now() - t0);
    player.redraw();
  }

  function onLost(token: number): void {
    if (destroyed) return;
    const r = gpu.contextLost(token);
    if (!r) return;
    const dead = owned;
    toFloor();
    try {
      dead?.release();
    } catch {
      // the context is gone already; nothing more to free
    }
    report(r);
    player.redraw();
  }

  const stop = () => {
    if (destroyed) return;
    player.release();
    rebuildOnEntry = true;
    if (owned) {
      const s = owned;
      toFloor();
      gpu.released();
      s.release();
    }
    player.redraw();
  };

  /** The caption, or (reduced motion, before the first play) every caption as a list. */
  function showList(on: boolean): void {
    dom.caption.hidden = on;
    dom.captions.hidden = !on;
    dom.root.classList.toggle("lf-list", on);
  }
  /**
   * With the list the film grows below its box instead of shrinking the
   * picture: the stage keeps the height it has with the one-line caption
   * (measured in one synchronous pass, so nothing is painted in between).
   * A measurement under 2 px (taken mid-resize) keeps the last good
   * height rather than leave the stage with none; the next resize
   * measures again.
   */
  function sizeStageForList(): void {
    dom.stage.style.removeProperty("height");
    if (!listMode) return;
    showList(false);
    const { h } = env.size(dom.stage);
    showList(true);
    if (h >= 2) listStageH = h;
    if (listStageH !== null) dom.stage.style.height = `${String(listStageH)}px`;
  }

  function layout(): void {
    if (destroyed) return;
    const { w, h } = env.size(dom.stage);
    if (w < 2 || h < 2) return;
    if (ly && ly.W === w && ly.H === h) return;
    ly = filmLayout(w, h, env.viewport().w);
    layoutKey += 1;
    phone.layout(ly);
    scene?.layout(ly);
    player.redraw();
  }
  const onResize = () => {
    sizeStageForList();
    layout();
  };

  const onStageClick = () => {
    ensureScene();
    player.tap();
  };

  // mount: the host's own content (a placeholder) comes back on destroy
  const before = [...host.childNodes];
  host.replaceChildren(dom.root);
  dom.stage.addEventListener("click", onStageClick);
  const unobserveSize = env.observeSize(host, onResize);
  layout();
  const unobserveView = env.observeView(host, (v) => {
    const share = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    if (share === 0) rebuildOnEntry = false;
    else if (!rebuildOnEntry) ensureScene();
    // during a live AR session the film sees no view: a report there must
    // not start it again, drawing flat behind the session
    player.setViewShare(arActive() ? 0 : share);
  });
  const unregisterAr = options.onArStarting(stop);
  report(gpu.initialFallback);
  player.redraw();

  return {
    totalS: timeline.totalS,
    segments: timeline.segments,
    snapshot: () => player.snapshot(),
    jumpTo: (beat) => {
      ensureScene();
      player.jumpTo(beat);
    },
    toggle: () => {
      ensureScene();
      player.toggle();
    },
    renderer: () => (scene ? "3d" : "floor"),
    destroy() {
      if (destroyed) return;
      player.destroy();
      destroyed = true;
      try {
        unregisterAr();
      } catch {
        // the page's own unregister failing must not keep the film mounted
      }
      unobserveView();
      unobserveSize();
      dom.stage.removeEventListener("click", onStageClick);
      if (owned) {
        const s = owned;
        scene = null;
        owned = null;
        gpu.released();
        s.release();
      }
      host.replaceChildren(...before);
      delete host.dataset.filmState;
      delete host.dataset.filmBeat;
      delete host.dataset.filmMoving;
      delete host.dataset.playing;
    },
  };
}

/** Mounts the hero film into `host` (the page's interface). */
export function mountLandingFilm(
  host: HTMLElement,
  options: LandingFilmOptions,
): LandingPart {
  const film = createLandingFilm(host, options);
  return { destroy: () => film.destroy() };
}
