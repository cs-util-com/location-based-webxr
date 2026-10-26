/**
 * The hero film's eight parts (beats), in the prototype's order: one function per
 * part giving the whole picture at the part's own moment `t`. `S` is the
 * model (the route drawn so far, the pins, the code, the person, the
 * wedge of view, the camera's view); `U` is the drawn phone (on or off,
 * which eye, what its screen shows) and the old photo.
 *
 * Pure: the same (part, t) always gives the same picture, so the film can
 * pause, jump and redraw anywhere. Ported from the landing prototype; its
 * per-part comments are kept.
 *
 * @see film-story.ts.md
 */
import type { BeatSpec } from "./film-timeline.js";
import { backOut, bump, easeOut, seg, smoothEase } from "./film-math.js";
import {
  LEAD_IN,
  LOOK,
  ROUTE,
  ROUTE_LEN,
  SPOT,
  START,
  STATIONS,
  S_FIG,
  type EyeName,
  type XYZ,
  type XZ,
} from "./film-park.js";

export type ViewName = "over" | "mill" | "poster";
export type Pill = "visit" | "make" | "saved" | "scan";

export interface Figure {
  readonly who: "maker" | "visitor";
  readonly x: number;
  readonly z: number;
  /** How far it has appeared, [0, 1]. */
  readonly k: number;
  readonly yaw: number;
  /** Where its phone looks (x, z), or null while walking. */
  readonly look: XZ | null;
  /** 1 while walking (it bobs), else 0. */
  readonly bob: 0 | 1;
}

/** The model at one moment. */
export interface SceneState {
  route: number;
  pins: number[];
  pulse: number[];
  poster: number;
  fig: Figure | null;
  wedge: number;
  view: ViewName;
}

/** The drawn phone and the old photo at one moment. */
export interface PhoneState {
  on: boolean;
  eye: EyeName;
  cover: number;
  pill: Pill;
  chip: number;
  retic: number;
  glide: number;
  press: number;
  ripple: number;
  pinF: number;
  posterF: number;
  place: number;
  tools: number;
  toolPic: boolean;
  card: number;
  typed: number;
  body: number;
  dashed: boolean;
  ghost: number;
  pic: number;
  next: number;
  share: number;
  print: number;
  halo: number;
  callout: number;
  scan: number;
  polaroid: number;
}

export interface FilmFrame {
  readonly s: SceneState;
  readonly u: PhoneState;
}

const N_PINS = STATIONS.length;

export function blankScene(): SceneState {
  return {
    route: 0,
    pins: new Array<number>(N_PINS).fill(0),
    pulse: new Array<number>(N_PINS).fill(0),
    poster: 0,
    fig: null,
    wedge: 0,
    view: "over",
  };
}

export function blankPhone(): PhoneState {
  return {
    on: false,
    eye: "mill",
    cover: 1,
    pill: "visit",
    chip: 0,
    retic: 0,
    glide: 0,
    press: 0,
    ripple: 0,
    pinF: 0,
    posterF: 0,
    place: 0,
    tools: 0,
    toolPic: false,
    card: 0,
    typed: 99,
    body: 1,
    dashed: false,
    ghost: 0,
    pic: 0,
    next: 0,
    share: 0,
    print: 0,
    halo: 0,
    callout: 0,
    scan: 0,
    polaroid: 0,
  };
}

function full(s: SceneState): void {
  s.route = ROUTE_LEN;
  s.pins = new Array<number>(N_PINS).fill(1);
  s.poster = 1;
}

function person(
  s: SceneState,
  who: Figure["who"],
  spot: XZ,
  k: number,
  look: XYZ,
): void {
  s.fig = {
    who,
    x: spot[0],
    z: spot[1],
    k,
    yaw: Math.atan2(look[0] - spot[0], look[2] - spot[1]),
    look: [look[0], look[2]],
    bob: 0,
  };
}

function walking(
  s: SceneState,
  who: Figure["who"],
  p: { x: number; z: number; tx: number; tz: number },
  bob: 0 | 1,
): void {
  s.fig = {
    who,
    x: p.x,
    z: p.z,
    k: 1,
    yaw: Math.atan2(p.tx, p.tz),
    look: null,
    bob,
  };
}

/**
 * The moment the first part's drawn line reaches each stop (the draw is
 * eased with a smoothstep; inverted by bisection).
 */
const RISE = STATIONS.map((st) => {
  const f = st.s / ROUTE_LEN;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (smoothEase(m) < f) lo = m;
    else hi = m;
  }
  return 0.5 + 3.0 * hi;
});

/** The station title the maker types in part 4. */
export const TYPED_TITLE = "The old mill";

interface Beat extends BeatSpec<ViewName> {
  apply(t: number, s: SceneState, u: PhoneState): void;
  /** The bar's name for the part ("Part 3 of 8: ..."). */
  readonly title: string;
  /** The one-line caption under the scene. */
  readonly caption: string;
}

const BEATS: readonly Beat[] = [
  {
    // 0: the motivation; the finished route draws itself
    durS: 4.3,
    views: [{ atS: 0, view: "over" }],
    title: "A tour",
    caption: "A tour is a walk with stories on real spots.",
    apply(t, s) {
      s.view = "over";
      s.poster = backOut(seg(t, 0.2, 0.7));
      s.route = ROUTE_LEN * smoothEase(seg(t, 0.5, 3.5));
      s.pins = RISE.map((r) => backOut(seg(t, r, r + 0.6)));
    },
  },
  {
    // 1: what a visitor sees at the first station
    durS: 2.7,
    views: [{ atS: 0, view: "mill" }],
    title: "What a visitor sees",
    caption: "A visitor holds up the phone. The story is right there.",
    apply(t, s, u) {
      full(s);
      s.view = "mill";
      person(s, "visitor", SPOT.mill, easeOut(seg(t, 0, 0.3)), LOOK.mill);
      s.wedge = seg(t, 0.65, 1);
      u.on = t >= 0.3;
      u.eye = "mill";
      u.cover = 1 - seg(t, 0.65, 1);
      u.pill = "visit";
      u.pinF = 1;
      u.card = easeOut(seg(t, 1.05, 1.5));
      u.pic = easeOut(seg(t, 1.55, 2.1));
      u.next = seg(t, 2.25, 2.65);
    },
  },
  {
    // 2: a story you know; the park is empty again, the old photo lies
    // where the phone will be
    durS: 2.1,
    views: [{ atS: 0, view: "mill" }],
    title: "A story you know",
    caption: "Making one: start with a story you know.",
    apply(t, s, u) {
      const k = 1 - smoothEase(seg(t, 0.75, 1.3));
      s.view = "mill";
      s.route = ROUTE_LEN * (1 - seg(t, 0.75, 1.25));
      s.pins = new Array<number>(N_PINS).fill(k);
      s.poster = k;
      const sw = seg(t, 0.3, 0.6);
      person(
        s,
        sw < 0.5 ? "visitor" : "maker",
        SPOT.mill,
        sw < 0.5 ? 1 - 2 * sw : easeOut(2 * sw - 1),
        LOOK.mill,
      );
      s.wedge = 1 - seg(t, 0, 0.3);
      u.on = t < 0.3;
      u.eye = "mill";
      u.cover = 0;
      u.pill = "visit";
      u.pinF = 1;
      u.card = 1;
      u.pic = 1;
      u.next = 1;
      u.polaroid = easeOut(seg(t, 1.45, 1.95));
    },
  },
  {
    // 3: walk there and place a station
    durS: 3.9,
    views: [{ atS: 0, view: "mill" }],
    title: "Walk there",
    caption:
      "Walk there with your phone and tap. A station drops onto that spot.",
    apply(t, s, u) {
      const p = backOut(seg(t, 2.45, 3.05));
      s.view = "mill";
      s.pins = [p, 0, 0, 0, 0];
      person(s, "maker", SPOT.mill, 1, LOOK.mill);
      s.wedge = seg(t, 0.7, 1);
      u.polaroid = 1 - seg(t, 0, 0.3);
      u.on = t >= 0.35;
      u.eye = "mill";
      u.cover = 1 - seg(t, 0.7, 1);
      u.pill = "make";
      u.place = 1;
      u.retic = seg(t, 1.1, 1.35) * (1 - seg(t, 2.45, 2.75));
      u.glide = 1 - easeOut(seg(t, 1.1, 2.1));
      u.press = bump(seg(t, 2.15, 2.45));
      u.pinF = p;
      u.ripple = seg(t, 2.7, 3.7);
    },
  },
  {
    // 4: add words and a picture
    durS: 4.1,
    views: [{ atS: 0, view: "mill" }],
    title: "Add words and a picture",
    caption: "Add a few lines and the old photo. They stay on that spot.",
    apply(t, s, u) {
      s.view = "mill";
      s.pins = [1, 0, 0, 0, 0];
      person(s, "maker", SPOT.mill, 1, LOOK.mill);
      s.wedge = 1;
      u.on = true;
      u.eye = "mill";
      u.cover = 0;
      u.pill = "make";
      u.pinF = 1;
      u.place = 1 - seg(t, 0, 0.25);
      u.tools = seg(t, 0.25, 0.5);
      u.card = easeOut(seg(t, 0.45, 0.9));
      u.dashed = true;
      u.typed = Math.round(seg(t, 0.95, 1.85) * TYPED_TITLE.length);
      u.body = seg(t, 1.9, 2.3);
      u.toolPic = t >= 2.4;
      u.ghost = seg(t, 2.5, 2.75) * (1 - seg(t, 3.3, 3.5));
      u.pic = easeOut(seg(t, 3.25, 3.85));
    },
  },
  {
    // 5: and so on along the walk; the person walks on and the route
    // draws behind them
    durS: 7.6,
    views: [{ atS: 0, view: "over" }],
    title: "Along the walk",
    caption: "The same at every spot along the walk.",
    apply(t, s) {
      s.view = "over";
      const w = seg(t, 0.9, 7.4);
      const sw = S_FIG + (ROUTE_LEN - S_FIG) * w;
      s.route = t < 0.9 ? S_FIG * smoothEase(seg(t, 0, 0.6)) : sw;
      s.pins = STATIONS.map((st, i) => {
        if (i === 0) return 1;
        const tr = 0.9 + (6.5 * (st.s - S_FIG)) / (ROUTE_LEN - S_FIG);
        return backOut(seg(t, tr, tr + 0.6));
      });
      walking(s, "maker", ROUTE.at(sw), t < 0.9 || w >= 1 ? 0 : 1);
    },
  },
  {
    // 6: when the tour is ready, the code is printed and hung at the start
    durS: 4.3,
    views: [{ atS: 0, view: "poster" }],
    title: "Hang the code",
    caption:
      "When the tour is ready, print its code and hang it where the walk begins.",
    apply(t, s, u) {
      full(s);
      s.poster = backOut(seg(t, 2.3, 3.1));
      s.view = "poster";
      person(s, "maker", SPOT.poster, easeOut(seg(t, 0, 0.3)), LOOK.poster);
      s.wedge = seg(t, 0.65, 1);
      u.on = t >= 0.3;
      u.eye = "poster";
      u.cover = 1 - seg(t, 0.65, 1);
      u.pill = "saved";
      u.share = easeOut(seg(t, 1.0, 1.4)) * (1 - seg(t, 2.3, 2.6));
      u.print = bump(seg(t, 1.9, 2.2));
      u.posterF = s.poster;
      u.halo = seg(t, 3.1, 3.45);
      u.callout = easeOut(seg(t, 3.4, 3.9));
    },
  },
  {
    // 7: a visitor scans the code, then walks the finished route to its end
    durS: 12.6,
    views: [
      { atS: 0, view: "poster" },
      { atS: 3.3, view: "over" },
    ],
    title: "Visitors scan it",
    caption:
      "Visitors scan it there to open the tour. Your stations appear, one after another.",
    apply(t, s, u) {
      full(s);
      s.view = t < 3.3 ? "poster" : "over";
      if (t < 4.6) {
        person(s, "visitor", SPOT.scan, easeOut(seg(t, 0, 0.3)), LOOK.scan);
      } else {
        const d = seg(t, 4.6, 12.3) * (LEAD_IN + ROUTE_LEN);
        let p: { x: number; z: number; tx: number; tz: number };
        if (d < LEAD_IN) {
          const f = d / LEAD_IN;
          p = {
            x: SPOT.scan[0] + (START.x - SPOT.scan[0]) * f,
            z: SPOT.scan[1] + (START.z - SPOT.scan[1]) * f,
            tx: START.x - SPOT.scan[0],
            tz: START.z - SPOT.scan[1],
          };
        } else p = ROUTE.at(d - LEAD_IN);
        walking(s, "visitor", p, t >= 12.3 ? 0 : 1);
        const sw = d - LEAD_IN;
        s.pulse = STATIONS.map((st) =>
          Math.max(0, 1 - Math.abs(sw - st.s) / 1.4),
        );
      }
      s.wedge = seg(t, 0.65, 1) * (1 - seg(t, 2.9, 3.1));
      u.on = t >= 0.3 && t < 3.0;
      u.eye = "scan";
      u.cover = 1 - seg(t, 0.65, 1);
      u.pill = "scan";
      u.posterF = 1;
      u.scan = easeOut(seg(t, 1.0, 1.7));
      u.chip = seg(t, 1.75, 2.05);
    },
  },
];

/** The parts as the timeline sees them (length and views). */
export const FILM_BEATS: readonly BeatSpec<ViewName>[] = BEATS;

/** The bar's names, one per part. */
export const BEAT_TITLES: readonly string[] = BEATS.map((b) => b.title);

/** The captions, one per part. */
export const BEAT_CAPTIONS: readonly string[] = BEATS.map((b) => b.caption);

/**
 * The whole picture of part `beat` at its own moment `t` (clamped to the
 * part). An unknown part throws: the timeline only ever names real ones.
 */
export function frameAt(beat: number, t: number): FilmFrame {
  const b = BEATS[beat];
  if (b === undefined || !Number.isInteger(beat)) {
    throw new RangeError(`film story: no part ${String(beat)}`);
  }
  const s = blankScene();
  const u = blankPhone();
  b.apply(Math.min(b.durS, Math.max(0, Number.isFinite(t) ? t : 0)), s, u);
  return { s, u };
}
