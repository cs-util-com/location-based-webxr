/**
 * Draws the film's bar model (`film-bar.ts`): a group of segment buttons,
 * one per part ("Part 3 of 8: ...", the current one `aria-current`), and
 * the play/pause button. A segment's width is its part's share of the
 * film. Writes only what changed.
 *
 * @see film-bar-view.ts.md
 */
import type { BarModel, SegmentLook } from "./film-bar.js";

export interface FilmBarViewOptions {
  readonly titles: readonly string[];
  /** Each part's length on the timeline (segment width weights), > 0. */
  readonly weights: readonly number[];
  onJump(beat: number): void;
  onToggle(): void;
}

export interface FilmBarView {
  readonly element: HTMLElement;
  update(model: BarModel): void;
}

const LOOK_CLASS: Readonly<Record<SegmentLook, string>> = {
  seen: "lf-seg-seen",
  current: "lf-seg-current",
  upcoming: "lf-seg-upcoming",
};

const ICON: Readonly<Record<BarModel["button"]["kind"], string>> = {
  pause:
    '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="3" height="11" rx="1"/><rect x="8.5" y="1.5" width="3" height="11" rx="1"/></svg>',
  play: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.8v10.4L12 7z"/></svg>',
  again:
    '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.2a4.8 4.8 0 1 0 4.6 6.2l-1.7-.5A3 3 0 1 1 7 4V6l3.2-2.9L7 .2z"/></svg>',
};

/** One segment button and what it shows now. */
interface SegView {
  readonly b: HTMLButtonElement;
  readonly fill: HTMLElement;
  look: SegmentLook;
  fillV: string;
  label: string;
  current: boolean;
}

export function createFilmBarView(
  doc: Document,
  o: FilmBarViewOptions,
): FilmBarView {
  if (o.weights.length !== o.titles.length || o.titles.length === 0) {
    throw new RangeError(
      `film bar view: one weight per part, got ${String(o.weights.length)} for ${String(o.titles.length)}`,
    );
  }
  const element = doc.createElement("div");
  element.className = "lf-controls";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "The film's parts");

  const play = doc.createElement("button");
  play.type = "button";
  play.className = "lf-play";
  const playIcon = doc.createElement("span");
  playIcon.setAttribute("aria-hidden", "true");
  playIcon.style.display = "contents";
  const playText = doc.createElement("span");
  playText.className = "lf-play-text";
  playText.setAttribute("aria-hidden", "true");
  play.append(playIcon, playText);
  play.addEventListener("click", () => o.onToggle());

  const list = doc.createElement("ol");
  list.className = "lf-segs";
  const segs = o.titles.map((_, i): SegView => {
    const li = doc.createElement("li");
    const w = o.weights[i]!;
    li.style.flexGrow = String(Number.isFinite(w) && w > 0 ? w : 1);
    li.style.flexBasis = "0";
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "lf-seg lf-seg-upcoming";
    const track = doc.createElement("span");
    track.className = "lf-seg-track";
    const fill = doc.createElement("span");
    fill.className = "lf-seg-fill";
    track.append(fill);
    b.append(track);
    b.addEventListener("click", () => o.onJump(i));
    li.append(b);
    list.append(li);
    return {
      b,
      fill,
      look: "upcoming",
      fillV: "",
      label: "",
      current: false,
    };
  });
  element.append(play, list);

  let kind = "";
  let playLabel = "";
  return {
    element,
    update(m) {
      m.segments.forEach((s, i) => {
        const seg = segs[i];
        if (seg === undefined) return;
        if (s.look !== seg.look) {
          seg.b.classList.remove(LOOK_CLASS[seg.look]);
          seg.b.classList.add(LOOK_CLASS[s.look]);
          seg.look = s.look;
        }
        const fillV = s.fill.toFixed(4);
        if (fillV !== seg.fillV) {
          seg.fill.style.setProperty("--lf-fill", fillV);
          seg.fillV = fillV;
        }
        if (s.label !== seg.label) {
          seg.b.setAttribute("aria-label", s.label);
          seg.label = s.label;
        }
        if (s.current !== seg.current) {
          if (s.current) seg.b.setAttribute("aria-current", "step");
          else seg.b.removeAttribute("aria-current");
          seg.current = s.current;
        }
      });
      if (m.button.kind !== kind) {
        kind = m.button.kind;
        play.setAttribute("data-kind", kind);
        playIcon.innerHTML = ICON[m.button.kind];
      }
      if (m.button.label !== playLabel) {
        playLabel = m.button.label;
        play.setAttribute("aria-label", playLabel);
        playText.textContent = playLabel;
      }
    },
  };
}
