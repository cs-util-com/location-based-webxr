/**
 * The drawn phone's screen: what each of its parts looks like for one
 * phone state (`phoneStyles`, pure), where the parts that sit on the
 * scene are placed (`anchorPlacement`, pure), and a thin view that writes
 * both into the film's markup, touching only what changed. Ported from
 * the prototype's `uiApply` and `placeAnchors`.
 *
 * @see film-phone.ts.md
 */
import type { FilmDom } from "./film-dom.js";
import type { FilmLayout } from "./film-layout.js";
import type { EyeName } from "./film-park.js";
import { TYPED_TITLE, type Pill, type PhoneState } from "./film-story.js";

type P2 = readonly [number, number];

/** Where the scene's spots sit on the phone's screen, screen px. */
export interface ScreenAnchors {
  /** The first station's pin head (where the card sits). */
  readonly pin?: P2;
  /** The code's board: x0, y0, x1, y1. */
  readonly board?: readonly [number, number, number, number];
  /** The ground under the pin. */
  readonly ground: P2;
  /** The "Next" label. */
  readonly next: P2;
}

/** Where things sit on the drawn screens, as fractions of the screen (3D projects its own). */
const FLOOR_ANCHORS: Readonly<
  Record<
    EyeName,
    {
      pin?: P2;
      board?: readonly [number, number, number, number];
      ground: P2;
      next: P2;
    }
  >
> = {
  mill: { pin: [0.47, 0.47], ground: [0.47, 0.705], next: [0.5, 0.88] },
  poster: {
    board: [0.33, 0.4, 0.67, 0.71],
    ground: [0.5, 0.8],
    next: [0.5, 0.88],
  },
  scan: {
    board: [0.27, 0.34, 0.73, 0.77],
    ground: [0.5, 0.85],
    next: [0.5, 0.88],
  },
};

/** The drawn screens' anchors for `eye` on a screen `sw` x `sh` px. */
export function floorAnchors(
  eye: EyeName,
  sw: number,
  sh: number,
): ScreenAnchors {
  const f = FLOOR_ANCHORS[eye];
  return {
    ...(f.pin ? { pin: [f.pin[0] * sw, f.pin[1] * sh] as const } : {}),
    ...(f.board
      ? {
          board: [
            f.board[0] * sw,
            f.board[1] * sh,
            f.board[2] * sw,
            f.board[3] * sh,
          ] as const,
        }
      : {}),
    ground: [f.ground[0] * sw, f.ground[1] * sh],
    next: [f.next[0] * sw, f.next[1] * sh],
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type AnchorKey =
  "card" | "pic" | "ret" | "pinf" | "next" | "halo" | "posterf" | "call";

/** Each anchored part's place, and the sizes that follow the board. */
export interface AnchorPlacement {
  readonly at: Readonly<Partial<Record<AnchorKey, P2>>>;
  /** The drawn pin's top margin: from the ground up to the pin head. */
  readonly pinMarginTop: number;
  readonly board: {
    readonly halo: { readonly w: number; readonly h: number };
    readonly scan: { readonly w: number; readonly h: number };
    readonly poster: { readonly w: number; readonly h: number };
  } | null;
}

export function anchorPlacement(
  A: ScreenAnchors,
  sw: number,
  sh: number,
): AnchorPlacement {
  const pin = A.pin ?? [sw / 2, sh * 0.4];
  const cardY = Math.max(pin[1], sh * 0.42);
  const at: Partial<Record<AnchorKey, P2>> = {
    card: [clamp(pin[0], sw * 0.44, sw * 0.56), cardY],
    // the old photo hangs just left of the pin's pole, below the card
    pic: [clamp(pin[0] - sw * 0.46, sw * 0.04, sw * 0.6), cardY + sh * 0.03],
    ret: A.ground,
    pinf: A.ground,
    next: A.next,
  };
  let board: AnchorPlacement["board"] = null;
  if (A.board) {
    const [x0, y0, x1, y1] = A.board;
    const bw = x1 - x0;
    const bh = y1 - y0;
    at.halo = [x0 - 5, y0 - 5];
    at.posterf = [x0, y0];
    at.call = [(x0 + x1) / 2, y0 - 6];
    board = {
      halo: { w: bw + 10, h: bh + 10 },
      scan: { w: bw + 16, h: bh + 16 },
      poster: { w: bw, h: (bh * 70) / 46 },
    };
  }
  return { at, pinMarginTop: -(A.ground[1] - pin[1]) - 4, board };
}

type PartKey =
  | "cover"
  | "chip"
  | "place"
  | "tools"
  | "share"
  | "placeBtn"
  | "printBtn"
  | "retic"
  | "ripple"
  | "pinF"
  | "posterF"
  | "halo"
  | "scan"
  | "card"
  | "body"
  | "ghost"
  | "pic"
  | "next"
  | "callout"
  | "polaroid";

export type PartStyles = Readonly<
  Record<PartKey, Readonly<Record<string, string>>>
>;

const f3 = (v: number) => v.toFixed(3);

function sheet(v: number): Record<string, string> {
  return {
    opacity: f3(v),
    transform: `translateY(${((1 - v) * 0.8).toFixed(2)}em)`,
    visibility: v > 0.001 ? "visible" : "hidden",
  };
}

/** Each part's inline style for phone state `u` (the prototype's `uiApply`, as data). */
export function phoneStyles(u: PhoneState): PartStyles {
  return {
    cover: { opacity: u.on ? f3(u.cover) : "1" },
    chip: {
      opacity: f3(u.chip),
      transform: `translateX(-50%) translateY(${((1 - u.chip) * -0.4).toFixed(2)}em)`,
    },
    place: sheet(u.place),
    tools: sheet(u.tools),
    share: sheet(u.share),
    placeBtn: {
      transform: `scale(${f3(1 - 0.06 * u.press)})`,
      background: u.press > 0.3 ? "var(--lf-route-dark)" : "",
    },
    printBtn: {
      transform: `scale(${f3(1 - 0.06 * u.print)})`,
      background: u.print > 0.3 ? "var(--lf-route-dark)" : "",
    },
    retic: {
      opacity: f3(u.retic),
      transform: `translate(${(u.glide * 34).toFixed(1)}px,${(u.glide * 46).toFixed(1)}px)`,
    },
    ripple: {
      opacity: f3(u.ripple > 0 && u.ripple < 1 ? 0.9 * (1 - u.ripple) : 0),
      transform: `scale(${f3(0.7 + 1.4 * u.ripple)})`,
    },
    pinF: {
      opacity: u.pinF > 0.01 ? "1" : "0",
      transform: `scaleY(${f3(Math.max(0.001, u.pinF))})`,
    },
    posterF: {
      opacity: u.posterF > 0.01 ? "1" : "0",
      transform: `translateY(${((1 - Math.min(1, u.posterF)) * -14).toFixed(1)}px) scale(${f3(Math.max(0.001, u.posterF))})`,
    },
    halo: { opacity: f3(u.halo) },
    scan: {
      opacity: f3(u.scan > 0 ? Math.min(1, u.scan * 3) : 0),
      transform: `scale(${f3(1.35 - 0.35 * u.scan)})`,
    },
    card: {
      opacity: f3(u.card),
      transform: `translateX(-50%) translateY(${((1 - u.card) * 0.8).toFixed(2)}em) scale(${f3(0.94 + 0.06 * u.card)})`,
    },
    body: { opacity: f3(u.body) },
    ghost: { opacity: f3(u.ghost) },
    pic: {
      opacity: f3(u.pic),
      transform: `scale(${f3(0.82 + 0.18 * u.pic)}) rotate(${(-3 + u.pic).toFixed(2)}deg)`,
    },
    next: { opacity: f3(u.next) },
    callout: {
      opacity: f3(u.callout),
      transform: `translateX(-50%) translateY(${((1 - u.callout) * 0.8).toFixed(2)}em)`,
    },
    polaroid: { opacity: f3(u.polaroid) },
  };
}

/** The top bar's pill, by kind (constant markup). */
export const PILLS: Readonly<Record<Pill, string>> = {
  visit:
    'Mill Park<span class="lf-dots"><i class="lf-on"></i><i></i><i></i><i></i><i></i></span>',
  make: '<span class="lf-tg">Making</span>Station 1',
  saved: '<span class="lf-tg lf-ok">Saved</span>5 stations',
  scan: "Scan the code",
};

/** How many letters of the card's title are typed, and whether the caret shows. */
export function typedTitle(u: PhoneState): { text: string; caret: boolean } {
  const n = Math.max(0, Math.min(TYPED_TITLE.length, Math.round(u.typed)));
  return {
    text: TYPED_TITLE.slice(0, n),
    caret: u.dashed && n < TYPED_TITLE.length && u.card > 0.5,
  };
}

/** The text size inside the phone: 6.6 % of its screen, 13 to 17 px (the prototype's clamp). */
export function screenFontPx(sw: number): number {
  return Math.max(13, Math.min(17, sw * 0.066));
}

/** Below this screen width the card body, the share sheet's second line and the dots drop. */
export const NARROW_SCREEN_PX = 158;

export interface PhoneView {
  /** Writes phone state `u` (the eye's stills, every part's style, the pill, the typed title). */
  apply(u: PhoneState): void;
  /** Sizes the phone, the screen and the old photo to the layout. */
  layout(ly: FilmLayout): void;
  /** Places the anchored parts. */
  place(A: ScreenAnchors, ly: FilmLayout): void;
  /** The eye last applied. */
  eye(): EyeName;
}

export function createPhoneView(dom: FilmDom): PhoneView {
  const E = dom.parts;
  const els: Readonly<Record<PartKey, HTMLElement>> = {
    cover: E.cover,
    chip: E.chip,
    place: E.place,
    tools: E.tools,
    share: E.share,
    placeBtn: E.placeBtn,
    printBtn: E.printBtn,
    retic: E.retic,
    ripple: E.ripple,
    pinF: E.pinF,
    posterF: E.posterF,
    halo: E.halo,
    scan: E.scan,
    card: E.card,
    body: E.body,
    ghost: E.ghost,
    pic: E.pic,
    next: E.next,
    callout: E.callout,
    polaroid: dom.polaroid,
  };
  const memo = new Map<HTMLElement, Record<string, string>>();
  const css = (el: HTMLElement, prop: string, v: string) => {
    const k = memo.get(el) ?? {};
    if (k[prop] === v) return;
    k[prop] = v;
    memo.set(el, k);
    el.style.setProperty(prop, v);
  };
  const move = (el: HTMLElement, p: P2) =>
    css(
      el,
      "transform",
      `translate(${p[0].toFixed(1)}px,${p[1].toFixed(1)}px)`,
    );
  let curEye: EyeName | "" = "";
  let curPill: Pill | "" = "";
  let on: boolean | null = null;
  let typed = "";
  return {
    eye: () => (curEye === "" ? "mill" : curEye),
    apply(u) {
      if (u.on !== on) {
        on = u.on;
        dom.phone.classList.toggle("lf-on", u.on);
      }
      if (u.eye !== curEye) {
        curEye = u.eye;
        const still = u.eye === "mill" ? "mill" : "poster";
        for (const s of E.stills)
          s.style.display = s.dataset.still === still ? "" : "none";
      }
      if (u.pill !== curPill) {
        curPill = u.pill;
        E.pill.innerHTML = PILLS[u.pill];
      }
      const styles = phoneStyles(u);
      for (const key of Object.keys(styles) as PartKey[]) {
        const el = els[key];
        for (const [prop, v] of Object.entries(styles[key])) css(el, prop, v);
      }
      E.card.classList.toggle("lf-dashed", u.dashed);
      E.toolText.classList.toggle("lf-sel", !u.toolPic);
      E.toolPic.classList.toggle("lf-sel", u.toolPic);
      const t = typedTitle(u);
      if (t.text !== typed) {
        typed = t.text;
        E.typed.textContent = t.text;
      }
      E.caret.classList.toggle("lf-on", t.caret);
    },
    layout(ly) {
      const p = ly.phone;
      css(
        dom.phone,
        "transform",
        `translate(${String(p.x)}px,${String(p.y)}px)`,
      );
      css(dom.phone, "width", `${String(p.w)}px`);
      css(dom.phone, "height", `${String(p.h)}px`);
      css(dom.screen, "--lf-sw", `${String(ly.screen.w)}px`);
      css(dom.screen, "--lf-fs", `${screenFontPx(ly.screen.w).toFixed(2)}px`);
      dom.screen.classList.toggle("lf-narrow", ly.screen.w < NARROW_SCREEN_PX);
      const pol = ly.polaroid;
      css(dom.polaroid, "width", `${pol.w.toFixed(1)}px`);
      css(
        dom.polaroid,
        "transform",
        `translate(${String(pol.x)}px,${String(pol.y)}px) rotate(-4deg)`,
      );
    },
    place(A, ly) {
      const pl = anchorPlacement(A, ly.screen.w, ly.screen.h);
      for (const [key, p] of Object.entries(pl.at) as [AnchorKey, P2][])
        move(E.anchors[key], p);
      css(E.pinF, "margin-top", `${pl.pinMarginTop.toFixed(1)}px`);
      if (pl.board) {
        css(E.halo, "width", `${pl.board.halo.w.toFixed(1)}px`);
        css(E.halo, "height", `${pl.board.halo.h.toFixed(1)}px`);
        css(E.scan, "width", `${pl.board.scan.w.toFixed(1)}px`);
        css(E.scan, "height", `${pl.board.scan.h.toFixed(1)}px`);
        css(E.scan, "left", "-3px");
        css(E.scan, "top", "-3px");
        css(E.posterF, "width", `${pl.board.poster.w.toFixed(1)}px`);
        css(E.posterF, "height", `${pl.board.poster.h.toFixed(1)}px`);
      }
    },
  };
}
