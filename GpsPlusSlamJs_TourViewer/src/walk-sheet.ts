/**
 * The visitor's sheet on the page (visitor walk W4 build plan 2026-10-21-1105,
 * M2, §1.5, §1.6, §1.8): writes `walk-sheet-model.ts`'s model into the
 * sheet's elements inside `#ar-root` and the away block on the start page,
 * and turns the grab's and the peek's taps and drags into the store's
 * `sheetSet`. A thin writer: every text and state comes from the model;
 * it writes a node only when what it shows changed (the sheet is redrawn
 * on every guide call, a camera frame among them). M3's direction arrows
 * turn in place: an arrow's angle changes with every camera frame, so it
 * is kept out of the rows' redraw key and written only when it changed.
 * M4 gives each row its controls (W4 §1.6): "Guide me here" on its title,
 * its action (Skip, Bring back, the undo with its bar) and the Skip's
 * confirm; a tap goes to the guide as `rowTapped`, and a redraw hands
 * the focus to the control that took the tapped one's place.
 *
 * @see walk-sheet.ts.md
 */

import type { SkipAction, WalkRowTap } from "./station-guide.js";
import type { StoryProgress } from "./scene-view.js";
import { SKIP_UNDO_MS, type WalkSheet } from "./visitor-walk-slice.js";
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

/**
 * Hide `el` (or show it); when it hides while it holds the focus (itself
 * or a child), the focus moves to `fallback`, what takes its place: a
 * focused element that hides drops the focus to the page's body, and a
 * keyboard or switch user starts over from the top (W4 M2 review).
 */
export function hideKeepingFocus(
  el: { hidden: HTMLElement["hidden"]; contains(other: never): boolean },
  hidden: boolean,
  fallback: { focus(): void },
  active: unknown,
): void {
  if (el.hidden === hidden) return;
  const held = hidden && active !== null && el.contains(active as never);
  el.hidden = hidden;
  if (held) fallback.focus();
}

/**
 * A focus loss to nowhere because the control that held it hid (itself or
 * a parent) or left the page: the browser blurs a focused control the
 * moment it is hidden, so a hide made elsewhere (the guide hides the
 * story's end control before the sheet hides its card) is only seen here,
 * at its `focusout`. A move to another control (`related` set) or a
 * window blur over a control still shown is no such loss.
 */
export function focusLostToHiding(
  target: {
    readonly isConnected: boolean;
    closest(selector: string): unknown;
  } | null,
  related: unknown,
): boolean {
  if (target === null || related !== null) return false;
  return !target.isConnected || target.closest("[hidden]") !== null;
}

/**
 * The rows' redraw key: everything a row shows but what changes as the
 * visitor walks - its arrow's angle and its undo's time left (every
 * frame), its sub line and the title button's accessible name (the metres
 * and the direction word). The arrow turns in place, the undo's bar runs
 * on its own animation and the sub line and the name are written in
 * place, so a redraw (the row's buttons rebuilt, the bar restarted, a tap
 * in flight and the focus lost) happens only when the row's title, state
 * or controls changed.
 */
export function rowsDrawKey(rows: readonly WalkRow[]): string {
  return JSON.stringify(
    rows.map(
      ({ arrowDeg: _a, sub: _s, mainLabel: _m, undoLeftMs, ...row }) => ({
        ...row,
        undo: undoLeftMs !== null,
      }),
    ),
  );
}

/** What a row control does, from its `data-tap` ("undo" is a bring
 *  back inside the window); null for anything else. */
export function rowTapOf(tap: string | undefined): WalkRowTap | null {
  switch (tap) {
    case "skip":
    case "confirm":
    case "cancel":
    case "bring":
    case "choose":
      return tap;
    case "undo":
      return "bring";
    default:
      return null;
  }
}

/**
 * Where the focus goes after a row control was tapped and the rows were
 * redrawn (its `data-tap`s, first found first): a Skip's place is taken
 * by its confirm, a confirm's by the undo, Cancel and a bring back by the
 * Skip again; otherwise the same control. A row without any of them hands
 * the focus to the list's close button (the caller).
 */
export function focusAfterTap(tap: string): readonly string[] {
  switch (tap) {
    case "skip":
      return ["confirm", "undo", "skip"];
    case "confirm":
      return ["undo", "bring", "skip"];
    case "cancel":
      return ["skip"];
    case "bring":
    case "undo":
      return ["skip", "bring"];
    default:
      return [tap];
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
  /** The peek's distance: its arrow and its text inside. */
  readonly distance: El;
  readonly distanceText: El;
  readonly distanceArrow: SVGElement;
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
  /** The list's hint while no station is guessed (R-2). */
  readonly hint: El;
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
      /** The story card's end control's action (R-5). */
      readonly end: SkipAction | null;
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

const SVG_NS = "http://www.w3.org/2000/svg";

/** W4's direction arrow, pointing up (straight ahead) until turned. */
function createArrow(doc: Document): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "walk-arrow");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M8 2l5 11-5-3-5 3z");
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

/**
 * Turn an arrow to `deg` (whole degrees, positive to the right); null
 * hides it (the CSS hides an arrow without `data-deg`). Written only on a
 * change: the angle moves with every camera frame. `data-deg` holds the
 * angle asked; the transform turns the short way from the angle shown
 * (`data-turn`), so the eased turn never spins the long way round when
 * the station crosses straight behind (170 to -170 turns to 190).
 */
export function setArrow(
  el: Pick<SVGElement, "dataset" | "style">,
  deg: number | null,
): void {
  const value = deg === null ? null : String(deg);
  if ((el.dataset["deg"] ?? null) === value) return;
  if (deg === null) {
    delete el.dataset["deg"];
    delete el.dataset["turn"];
    el.style.transform = "";
    return;
  }
  const shown = Number(el.dataset["turn"]);
  const turn =
    el.dataset["turn"] === undefined || !Number.isFinite(shown)
      ? deg
      : shown + ((((deg - shown) % 360) + 540) % 360) - 180;
  el.dataset["deg"] = String(deg);
  el.dataset["turn"] = String(turn);
  el.style.transform = `rotate(${String(turn)}deg)`;
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
  /** A tap on a row's control (the guide's `rowTapped`). */
  rowTapped(stationId: string, tap: WalkRowTap): void;
  /** The completion card's "Exit AR": the session's own way out. */
  exit(): void;
}): WalkSheetView {
  const { dom } = deps;
  /** What each list was last drawn from: a redraw only on a change. */
  const drawn = new Map<El, string>();
  /** What each row writes in place, as last built, in the rows' order:
   *  its arrow, its sub line's text and its title button (its name). */
  let rowParts: { arrow: SVGElement; subText: El; main: El }[] = [];
  /** The row control last tapped: the redraw it causes hands the focus
   *  on (`focusAfterTap`). */
  let focusTap: { id: string; tap: string } | null = null;

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
  // A control in the story card that hid with the focus (its end, the
  // card itself) hands it to the grab; "Keep listening" hands it to the
  // end control instead (`hideKeepingFocus` in `render`).
  dom.story.addEventListener("focusout", (event) => {
    if (event.target === dom.keepListening) return;
    const target = event.target instanceof Element ? event.target : null;
    if (focusLostToHiding(target, event.relatedTarget)) dom.grab.focus();
  });
  dom.keepListening.addEventListener("click", () => {
    deps.keepListening();
  });
  // A row's controls, by delegation: the rows are rebuilt on a change.
  dom.rows.addEventListener("click", (event) => {
    const control =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("button[data-tap]")
        : null;
    const id = control?.closest<HTMLElement>(".walk-row")?.dataset["id"];
    const tap = rowTapOf(control?.dataset["tap"]);
    if (control === null || id === undefined || tap === null) return;
    if (control instanceof HTMLButtonElement && control.disabled) return;
    focusTap = { id, tap: control.dataset["tap"] ?? "" };
    deps.rowTapped(id, tap);
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
    // The arrows, the sub lines and the names are written in place
    // (below); everything else redraws the rows.
    const key = rowsDrawKey(rows);
    if (drawn.get(dom.rows) !== key) {
      drawn.set(dom.rows, key);
      rowParts = [];
      const active = dom.doc.activeElement;
      const held =
        focusTap !== null && active !== null && dom.rows.contains(active);
      rebuildRows(rows);
      if (held) refocus(focusTap!);
    }
    focusTap = null;
    rows.forEach((row, i) => {
      const parts = rowParts[i];
      if (parts === undefined) return;
      setArrow(parts.arrow, row.arrowDeg);
      setText(parts.subText, row.sub);
      if (parts.main.getAttribute("aria-label") !== row.mainLabel) {
        parts.main.setAttribute("aria-label", row.mainLabel);
      }
    });
  }

  /** After a tapped control's row was redrawn: the focus to what took
   *  its place, else to the list's close button. */
  function refocus(from: { id: string; tap: string }): void {
    const row = [...dom.rows.children].find(
      (li) => li instanceof HTMLElement && li.dataset["id"] === from.id,
    );
    for (const tap of focusAfterTap(from.tap)) {
      const control = row?.querySelector<HTMLElement>(
        `button[data-tap="${tap}"]:not(:disabled)`,
      );
      if (control != null) {
        control.focus();
        return;
      }
    }
    dom.close.focus();
  }

  function button(className: string, tap: string, text: string): El {
    const el = dom.doc.createElement("button");
    el.type = "button";
    el.className = className;
    el.dataset["tap"] = tap;
    el.textContent = text;
    return el;
  }

  function rebuildRows(rows: readonly WalkRow[]): void {
    dom.rows.replaceChildren(
      ...rows.map((row) => {
        const li = dom.doc.createElement("li");
        li.className = "walk-row";
        li.dataset["state"] = row.state;
        li.dataset["id"] = row.id;
        li.dataset["testid"] = "walk-row";
        if (row.chosen) li.dataset["chosen"] = "true";
        const glyph = dom.doc.createElement("span");
        glyph.className = "walk-glyph";
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = String(row.number);
        // The title is "Guide me here" where a target can be chosen (R-4).
        const main = button("walk-row-main", "choose", "");
        main.dataset["testid"] = "walk-row-main";
        if (row.choosable)
          main.setAttribute("aria-pressed", String(row.chosen));
        else (main as HTMLButtonElement).disabled = true;
        const title = dom.doc.createElement("b");
        title.textContent = row.title;
        const sub = dom.doc.createElement("small");
        sub.dataset["testid"] = "walk-row-sub";
        const arrow = createArrow(dom.doc);
        // Its text and the title's name are written by `drawRows`.
        const subText = dom.doc.createElement("span");
        rowParts.push({ arrow, subText, main });
        sub.append(arrow, subText);
        main.append(title, sub);
        li.append(glyph, main);
        if (row.action !== null) {
          const act = button("walk-row-act", row.action.kind, row.action.label);
          act.dataset["k"] = row.action.kind;
          act.dataset["testid"] = "walk-row-act";
          act.setAttribute("aria-label", row.action.ariaLabel);
          li.append(act);
        }
        if (row.confirm !== null) {
          const confirm = dom.doc.createElement("div");
          confirm.className = "walk-confirm";
          const yes = button(
            "btn btn--prose walk-btn walk-btn-warn",
            "confirm",
            row.confirm,
          );
          yes.dataset["testid"] = "walk-row-confirm";
          const no = button("btn btn--prose walk-btn", "cancel", "Cancel");
          no.dataset["testid"] = "walk-row-cancel";
          no.setAttribute("aria-label", `Cancel - keep ${row.title}`);
          confirm.append(yes, no);
          li.append(confirm);
        }
        if (row.undoLeftMs !== null) {
          // The undo's time left, run down by its own animation from the
          // share left when the row was drawn.
          const bar = dom.doc.createElement("div");
          bar.className = "walk-undobar";
          bar.dataset["testid"] = "walk-undobar";
          bar.setAttribute("aria-hidden", "true");
          const left = Math.max(0, Math.min(row.undoLeftMs, SKIP_UNDO_MS));
          const fill = dom.doc.createElement("i");
          fill.style.setProperty(
            "--walk-undo-from",
            (left / SKIP_UNDO_MS).toFixed(3),
          );
          fill.style.setProperty(
            "--walk-undo-ms",
            `${String(Math.round(left))}ms`,
          );
          bar.append(fill);
          li.append(bar);
        }
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
      // The peek, or the story card in its place; a closing card hands
      // its focus to the grab.
      setHidden(dom.peek, model.storyCard !== null);
      hideKeepingFocus(
        dom.story,
        model.storyCard === null,
        dom.grab,
        dom.doc.activeElement,
      );
      setData(dom.peek, "kind", model.peek.kind);
      setData(dom.peek, "position", extra.position);
      drawSegments(dom.segments, model.segments);
      setText(dom.eyebrow, model.peek.eyebrow);
      setText(dom.title, model.peek.title);
      setText(dom.distanceText, model.peek.distance ?? "");
      setArrow(dom.distanceArrow, model.peek.arrowDeg);
      setHidden(dom.distance, model.peek.distance === null);
      setText(dom.tail, model.peek.tail);
      setData(dom.quick, "kind", quickKind(extra.quick));
      // The story card: its dots, and "Keep listening" beside the confirm.
      drawDots(extra.story);
      const confirming = extra.end?.kind === "end";
      setData(dom.storyEnd, "kind", confirming ? "end" : "ask");
      // "Keep listening" hides once tapped: the end control takes its
      // focus.
      hideKeepingFocus(
        dom.keepListening,
        !confirming,
        dom.storyEnd,
        dom.doc.activeElement,
      );
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
      setText(dom.hint, model.list.hint ?? "");
      setHidden(dom.hint, model.list.hint === null);
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
      // The quick action hides while the list is open (W4; the CSS): a
      // focus it held when it opened the list goes to the armed row's
      // confirm; in the chooser (the hint asks which station) to the
      // first row's Skip, the question's first answer; else to the list's
      // close button.
      const fromQuick = list && dom.doc.activeElement === dom.quick;
      drawRows(model.list.rows);
      const hinted = model.list.hint !== null && dom.hint.id !== "";
      // While the hint shows, each Skip is described by it: a screen
      // reader hears the question with the control that answers it.
      for (const skip of dom.rows.querySelectorAll<HTMLElement>(
        'button[data-tap="skip"]',
      )) {
        if (hinted) skip.setAttribute("aria-describedby", dom.hint.id);
        else skip.removeAttribute("aria-describedby");
      }
      if (fromQuick) {
        const confirm = dom.rows.querySelector<HTMLElement>(
          'button[data-tap="confirm"]',
        );
        const firstSkip = hinted
          ? dom.rows.querySelector<HTMLElement>('button[data-tap="skip"]')
          : null;
        (confirm ?? firstSkip ?? dom.close).focus();
      }
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
