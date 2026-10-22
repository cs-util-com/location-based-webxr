/**
 * The visitor's sheet on the page (visitor walk W4 build plan 2026-10-21-1105,
 * M2, §1.5, §1.6, §1.8): writes `walk-sheet-model.ts`'s model into the
 * sheet's elements inside `#ar-root` and the away block on the start page,
 * and turns the grab's and the peek's taps and drags into the store's
 * `sheetSet`. A thin writer: every text and state comes from the model;
 * it writes a node only when what it shows changed (the sheet is redrawn
 * on every guide call, a camera frame among them).
 *
 * @see walk-sheet.ts.md
 */

import type { SkipAction } from "./station-guide.js";
import type { StoryProgress } from "./scene-view.js";
import type { WalkSheet } from "./visitor-walk-slice.js";
import type {
  AwayModel,
  WalkRow,
  WalkSegments,
  WalkSheetModel,
} from "./walk-sheet-model.js";

/**
 * How far a drag on the grab or the peek opens or closes the list (W4:
 * 24 px). Shipped 24 px; the range 16-40 px is a phone test (plan §5):
 * shorter and a tap that slips opens it, longer and the gesture feels
 * stuck.
 */
export const WALK_SHEET_DRAG_PX = 24;

/** The sheet after a vertical drag of `dy` px (negative: up): up opens the
 *  list, down closes it, a shorter one is a tap (null). */
export function sheetAfterDrag(
  dy: number,
  thresholdPx = WALK_SHEET_DRAG_PX,
): WalkSheet | null {
  if (!Number.isFinite(dy) || Math.abs(dy) <= thresholdPx) return null;
  return dy < 0 ? "list" : "peek";
}

/** The quick action's look (W4): an ask, a suggestion or an undo. */
export function quickKind(
  quick: SkipAction | null,
): "ask" | "suggested" | "undo" | null {
  switch (quick?.kind) {
    case "ask-skip":
      return "ask";
    case "skip":
      return "suggested";
    case "undo":
      return "undo";
    default:
      return null;
  }
}

type El = HTMLElement;

export interface WalkSheetDom {
  readonly doc: Document;
  readonly root: El;
  readonly grab: El;
  readonly peek: El;
  readonly segments: El;
  readonly eyebrow: El;
  readonly title: El;
  readonly distance: El;
  readonly tail: El;
  /** `#station-skip`: the guide writes its label, this its look. */
  readonly quick: El;
  readonly story: El;
  readonly dots: El;
  /** The story card's end control: the guide writes its label. */
  readonly storyEnd: El;
  readonly keepListening: El;
  readonly list: El;
  readonly listTitle: El;
  readonly chip: El;
  readonly close: El;
  readonly done: El;
  readonly doneTitle: El;
  readonly doneText: El;
  readonly progress: El;
  readonly rows: El;
  readonly foot: El;
  readonly exit: El;
  readonly away: {
    readonly root: El;
    readonly text: El;
    readonly segments: El;
    readonly rows: El;
  };
}

export interface WalkSheetView {
  /** Draw the sheet; null hides it (the guide does not run). */
  render(
    model: WalkSheetModel | null,
    extra: {
      readonly sheet: WalkSheet;
      readonly quick: SkipAction | null;
      readonly position: string;
      readonly story: {
        readonly stationId: string;
        readonly progress: StoryProgress | null;
      } | null;
    },
  ): void;
  /** Draw the away block; null hides it. */
  renderAway(model: AwayModel | null): void;
}

function setText(el: El, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setHidden(el: El, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

function setData(el: El, key: string, value: string | null): void {
  if (value === null) {
    if (key in el.dataset) delete el.dataset[key];
  } else if (el.dataset[key] !== value) {
    el.dataset[key] = value;
  }
}

export function wireWalkSheet(deps: {
  readonly dom: WalkSheetDom;
  /** The visitor opened or closed the list (the store's `sheetSet`). */
  setSheet(sheet: WalkSheet): void;
  /** The sheet as the store holds it now. */
  sheet(): WalkSheet;
  /** "Keep listening" (the guide's `cancelAsk`). */
  keepListening(): void;
  /** The completion card's "Exit AR": the session's own way out. */
  exit(): void;
}): WalkSheetView {
  const { dom } = deps;
  /** What each list was last drawn from: a redraw only on a change. */
  const drawn = new Map<El, string>();

  function toggle(): void {
    deps.setSheet(deps.sheet() === "list" ? "peek" : "list");
  }

  // Taps (and the keyboard) through click; drags through pointer events.
  // A drag that changed the sheet swallows the click that may follow it.
  let dragFrom: number | null = null;
  let dragged = false;
  for (const el of [dom.grab, dom.peek]) {
    el.addEventListener("pointerdown", (event) => {
      // The quick action is a button of its own (W4).
      if (
        event.target instanceof Element &&
        event.target.closest("button") !== null &&
        event.target.closest("button") !== dom.grab
      ) {
        return;
      }
      dragFrom = event.clientY;
      dragged = false;
    });
    el.addEventListener("pointermove", (event) => {
      if (dragFrom === null) return;
      const next = sheetAfterDrag(event.clientY - dragFrom);
      if (next === null) return;
      dragFrom = null;
      dragged = true;
      if (next !== deps.sheet()) deps.setSheet(next);
    });
    el.addEventListener("pointerup", () => {
      dragFrom = null;
    });
    // The browser took the gesture over (a scroll, a native drag).
    el.addEventListener("pointercancel", () => {
      dragFrom = null;
    });
    el.addEventListener("click", (event) => {
      if (
        el === dom.peek &&
        event.target instanceof Element &&
        event.target.closest("button") !== null
      ) {
        return;
      }
      if (dragged) {
        dragged = false;
        return;
      }
      toggle();
    });
  }
  dom.close.addEventListener("click", () => {
    deps.setSheet("peek");
  });
  dom.keepListening.addEventListener("click", () => {
    deps.keepListening();
  });
  dom.exit.addEventListener("click", () => {
    deps.exit();
  });

  function drawSegments(el: El, segments: WalkSegments): void {
    const key = JSON.stringify(segments);
    if (drawn.get(el) === key) return;
    drawn.set(el, key);
    setData(el, "kind", segments.kind);
    const parts: { state: string; grow: number }[] =
      segments.kind === "each"
        ? segments.states.map((state) => ({ state, grow: 1 }))
        : [
            { state: "found", grow: segments.found },
            { state: "skipped", grow: segments.skipped },
            { state: "left", grow: segments.toFind },
          ].filter((p) => p.grow > 0);
    el.replaceChildren(
      ...parts.map(({ state, grow }) => {
        const i = dom.doc.createElement("i");
        i.dataset["s"] = state;
        if (segments.kind === "bar") i.style.flexGrow = String(grow);
        return i;
      }),
    );
  }

  function drawRows(rows: readonly WalkRow[]): void {
    const key = JSON.stringify(rows);
    if (drawn.get(dom.rows) === key) return;
    drawn.set(dom.rows, key);
    dom.rows.replaceChildren(
      ...rows.map((row) => {
        const li = dom.doc.createElement("li");
        li.className = "walk-row";
        li.dataset["state"] = row.state;
        li.dataset["id"] = row.id;
        li.dataset["testid"] = "walk-row";
        const glyph = dom.doc.createElement("span");
        glyph.className = "walk-glyph";
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = String(row.number);
        const main = dom.doc.createElement("div");
        main.className = "walk-row-main";
        const title = dom.doc.createElement("b");
        title.textContent = row.title;
        const sub = dom.doc.createElement("small");
        sub.dataset["testid"] = "walk-row-sub";
        sub.textContent = row.sub;
        main.append(title, sub);
        li.append(glyph, main);
        return li;
      }),
    );
  }

  function drawDots(
    story: {
      readonly stationId: string;
      readonly progress: StoryProgress | null;
    } | null,
  ): void {
    const p = story?.progress ?? null;
    const key =
      p === null || story === null
        ? ""
        : `${story.stationId}|${String(p.index)}|${String(p.count)}|${String(p.autoMs)}`;
    if (drawn.get(dom.dots) === key) return;
    drawn.set(dom.dots, key);
    if (p === null) {
      dom.dots.replaceChildren();
      return;
    }
    dom.dots.replaceChildren(
      ...Array.from({ length: p.count }, (_, i) => {
        const dot = dom.doc.createElement("i");
        dot.dataset["s"] = i < p.index ? "on" : i === p.index ? "now" : "off";
        if (i === p.index && p.autoMs !== null) {
          dot.dataset["timed"] = "true";
          dot.style.setProperty("--walk-dot-ms", `${String(p.autoMs)}ms`);
        }
        return dot;
      }),
    );
  }

  return {
    render(model, extra) {
      setHidden(dom.root, model === null);
      if (model === null) return;
      const list = extra.sheet === "list";
      setData(dom.root, "sheet", extra.sheet);
      setData(dom.root, "complete", String(model.list.completion !== null));
      dom.grab.setAttribute("aria-expanded", String(list));
      if (dom.grab.getAttribute("aria-label") !== model.grabLabel) {
        dom.grab.setAttribute("aria-label", model.grabLabel);
      }
      // The peek, or the story card in its place.
      setHidden(dom.peek, model.storyCard !== null);
      setHidden(dom.story, model.storyCard === null);
      setData(dom.peek, "kind", model.peek.kind);
      setData(dom.peek, "position", extra.position);
      drawSegments(dom.segments, model.segments);
      setText(dom.eyebrow, model.peek.eyebrow);
      setText(dom.title, model.peek.title);
      setText(dom.distance, model.peek.distance ?? "");
      setHidden(dom.distance, model.peek.distance === null);
      setText(dom.tail, model.peek.tail);
      setData(dom.quick, "kind", quickKind(extra.quick));
      // The story card: its dots, and "Keep listening" beside the confirm.
      drawDots(extra.story);
      const confirming = extra.quick?.kind === "end";
      setData(dom.storyEnd, "kind", confirming ? "end" : "ask");
      setHidden(dom.keepListening, !confirming);
      // The list.
      setHidden(dom.list, !list);
      setText(dom.listTitle, model.list.title);
      setText(dom.chip, model.list.chip);
      const done = model.list.completion;
      setHidden(dom.done, done === null);
      setHidden(dom.foot, done === null);
      setText(dom.doneTitle, done?.title ?? "");
      setText(dom.doneText, done?.text ?? "");
      setHidden(dom.progress, done !== null);
      const progressKey = JSON.stringify(model.list.progress);
      if (drawn.get(dom.progress) !== progressKey) {
        drawn.set(dom.progress, progressKey);
        const lead = dom.doc.createElement("b");
        lead.textContent = model.list.progress.lead;
        dom.progress.replaceChildren(
          lead,
          ...model.list.progress.rest.map((part) => ` - ${part}`),
        );
      }
      drawRows(model.list.rows);
    },
    renderAway(model) {
      setHidden(dom.away.root, model === null);
      if (model === null) return;
      setText(dom.away.text, model.text);
      drawSegments(dom.away.segments, model.segments);
      const key = JSON.stringify(model.rows);
      if (drawn.get(dom.away.rows) === key) return;
      drawn.set(dom.away.rows, key);
      dom.away.rows.replaceChildren(
        ...model.rows.map((row) => {
          const li = dom.doc.createElement("li");
          li.dataset["testid"] = "walk-away-row";
          const title = dom.doc.createElement("b");
          title.textContent = row.title;
          const status = dom.doc.createElement("span");
          status.textContent = row.status;
          li.append(title, status);
          return li;
        }),
      );
    },
  };
}
