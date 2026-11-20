/**
 * The setup page's question, checklist and map (polish round M2b, the
 * chosen L5 look; since the setup became a question and a path
 * per answer, `setup-path.ts`): step 1 is one question whose four answers
 * only route; step 2 is the chosen path as a short checklist, the current
 * item active, with Back and Next under the card and the path's stations
 * on the map, the route drawn up to the open one. What to show comes from
 * `setup-stations.ts`; every move goes through `wizard.openStep`, which
 * stays the one owner of which step is open (and keeps the create step
 * open during an AR session).
 *
 * The DOM surface is structural, like the wizard's, so the unit tests run
 * in node; the map is optional and drawn only where the browser can
 * measure its route.
 *
 * @see setup-stage.ts.md
 */

import { SETUP_ANSWERS, SETUP_PATHS, type SetupAnswer } from "./setup-path.js";
import {
  stationSlot,
  stationView,
  STATION_ROUTE_FRACTIONS,
} from "./setup-stations.js";
import { WIZARD_STEPS, type WizardStep } from "./wizard.js";

/** Each step's name on its checklist item and its map station. */
const STATION_NAMES: Readonly<Record<WizardStep, string>> = {
  host: "Storage",
  file: "Open the file",
  starter: "Save the zip",
  link: "Link",
  print: "Print",
  hang: "Hang",
  measure: "Create",
  done: "Done",
};

/** Where a station's label sits beside its dot on the map, per route slot
 *  (from L5). */
const LABEL_OFFSETS: readonly {
  dx: number;
  dy: number;
  anchor: string;
}[] = [
  { dx: 0, dy: 21, anchor: "middle" },
  { dx: 0, dy: -14, anchor: "middle" },
  { dx: -14, dy: 3, anchor: "end" },
  { dx: -14, dy: 3, anchor: "end" },
  { dx: 0, dy: 21, anchor: "middle" },
  { dx: 13, dy: 3, anchor: "start" },
];

type Hidden = HTMLElement["hidden"];

interface Listening {
  addEventListener(
    type: string,
    fn: (event: { preventDefault(): void }) => void,
  ): void;
}

interface StepNode extends Listening {
  open: boolean;
}

interface ItemNode extends Listening {
  type: string;
  className: string;
  textContent: string | null;
  readonly dataset: Record<string, string | undefined>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

interface Focusable extends Listening {
  focus(options?: FocusOptions): void;
}

export interface SetupStageDom<T> {
  steps: Record<WizardStep, StepNode>;
  /** Each step's `<summary>`: a tap on the open step's heading must not
   *  collapse it (the card would be empty), and "Make your tour" puts the
   *  keyboard on it. */
  summaries: Partial<Record<WizardStep, Focusable>>;
  /** Step 1: the question, and its four answer buttons (`data-answer`). */
  question: { hidden: Hidden };
  answers: readonly (Focusable & {
    readonly dataset: Record<string, string | undefined>;
  })[];
  /** "Change the answer": back to the question. */
  change: { hidden: Hidden } & Listening;
  /** The card: `data-path` names the answer ("none" for the question), so
   *  its CSS can show what belongs to one path only. */
  card: { setAttribute(name: string, value: string): void };
  badge: { textContent: string | null };
  of: { textContent: string | null };
  /** The checklist the path's items are rendered into. */
  dots: { replaceChildren(...nodes: T[]): void };
  nav: { hidden: Hidden };
  back: { hidden: Hidden } & Listening;
  next: { hidden: Hidden } & Listening;
  /** The landing's "Make your tour" buttons. */
  begins: readonly Listening[];
  stage: { scrollIntoView(options?: ScrollIntoViewOptions): void };
}

/** The map's live parts, where a browser can measure the route. */
export interface SetupMapDom {
  route: SVGGeometryElement;
  reveal: SVGPathElement;
  stations: SVGGElement;
  /** The poster at the route's start: shown hung while the open step is
   *  past "Hang". It follows the open step, not progress - opening an
   *  earlier step again takes it down (see the sidecar). */
  start?: SVGGElement;
  /** The end flag: up at the completion step. */
  endFlag?: SVGGElement;
}

export interface SetupStage {
  /** Redraw from the answer and the steps' open state (also called on
   *  every toggle). */
  render(): void;
}

export function wireSetupStage<T extends ItemNode>(deps: {
  dom: SetupStageDom<T>;
  openStep: (step: WizardStep) => void;
  /** The chosen answer (the page's store); null while the question shows. */
  answer: () => SetupAnswer | null;
  /** An answer tapped, or "Change the answer" (null): the caller stores
   *  it, opens the path's first step and calls `render`. */
  onAnswer: (answer: SetupAnswer | null) => void;
  /** `document.createElement`, injectable for the tests. */
  createElement: (tag: "button") => T;
  map?: SetupMapDom;
  /** Whether the reader asked for reduced motion: the scroll is then
   *  instant. Read on each tap. */
  reducedMotion?: () => boolean;
}): SetupStage {
  const { dom, openStep } = deps;

  /** The answer the checklist and the map stations were last built for
   *  (undefined: not built yet). */
  let builtFor: SetupAnswer | null | undefined;
  let items: T[] = [];
  let stations: SVGGElement[] = [];

  function pathOf(answer: SetupAnswer | null): readonly WizardStep[] {
    return answer === null ? [] : SETUP_PATHS[answer];
  }

  function build(answer: SetupAnswer | null): void {
    const path = pathOf(answer);
    items = path.map((step, i) => {
      const item = deps.createElement("button");
      item.type = "button";
      item.className = "setup-item";
      item.dataset.step = step;
      item.textContent = STATION_NAMES[step];
      item.setAttribute("data-testid", `station-${step}`);
      item.setAttribute(
        "aria-label",
        `${String(i + 1)} of ${String(path.length)}: ${STATION_NAMES[step]}`,
      );
      item.addEventListener("click", () => {
        openStep(step);
      });
      return item;
    });
    dom.dots.replaceChildren(...items);
    stations = deps.map === undefined ? [] : drawStations(deps.map, path);
    builtFor = answer;
  }

  function openNow(): WizardStep | null {
    return WIZARD_STEPS.find((step) => dom.steps[step].open) ?? null;
  }

  function render(): void {
    const answer = deps.answer();
    if (answer !== builtFor) build(answer);
    const asking = answer === null;
    dom.question.hidden = !asking;
    dom.change.hidden = asking;
    dom.card.setAttribute("data-path", answer ?? "none");
    dom.badge.textContent = asking ? "1" : "2";
    dom.of.textContent = asking ? "Step 1 of 2" : "Step 2 of 2";
    if (asking) {
      dom.nav.hidden = true;
      if (deps.map !== undefined) {
        revealRoute(deps.map, 0);
        deps.map.start?.setAttribute("data-hung", "false");
        deps.map.endFlag?.setAttribute("data-on", "false");
      }
      return;
    }
    const path = pathOf(answer);
    const view = stationView(path, openNow());
    path.forEach((_, i) => {
      const state = view.states[i] ?? "todo";
      const item = items[i];
      if (item !== undefined) {
        item.dataset.state = state;
        if (state === "current") item.setAttribute("aria-current", "step");
        else item.removeAttribute("aria-current");
      }
      stations[i]?.setAttribute("data-state", state);
    });
    dom.nav.hidden = !view.showNav;
    dom.back.hidden = view.back === null;
    dom.next.hidden = view.next === null;
    if (deps.map !== undefined) {
      revealRoute(deps.map, view.routeFraction);
      const hang = path.indexOf("hang");
      deps.map.start?.setAttribute(
        "data-hung",
        String(hang >= 0 && view.states[hang] === "done"),
      );
      deps.map.endFlag?.setAttribute("data-on", String(!view.showNav));
    }
  }

  dom.back.addEventListener("click", () => {
    const { back } = stationView(pathOf(deps.answer()), openNow());
    if (back !== null) openStep(back);
  });
  dom.next.addEventListener("click", () => {
    const { next } = stationView(pathOf(deps.answer()), openNow());
    if (next !== null) openStep(next);
  });
  for (const node of dom.answers) {
    const answer = SETUP_ANSWERS.find((a) => a === node.dataset.answer);
    if (answer === undefined) continue;
    node.addEventListener("click", () => {
      deps.onAnswer(answer);
    });
  }
  dom.change.addEventListener("click", () => {
    deps.onAnswer(null);
  });
  for (const step of WIZARD_STEPS) {
    dom.steps[step].addEventListener("toggle", render);
    dom.summaries[step]?.addEventListener("click", (event) => {
      event.preventDefault();
    });
  }
  // "Make your tour": the setup into view, and the keyboard onto what the
  // reader acts on next - the question's first answer, or the open step's
  // heading (the stage has no heading of its own).
  for (const begin of dom.begins) {
    begin.addEventListener("click", () => {
      const instant = deps.reducedMotion?.() === true;
      dom.stage.scrollIntoView({
        block: "start",
        behavior: instant ? "instant" : "smooth",
      });
      const target =
        deps.answer() === null
          ? dom.answers[0]
          : dom.summaries[openNow() ?? "host"];
      target?.focus({ preventScroll: true });
    });
  }

  /** The path's stations along the route, each opening its step. */
  function drawStations(
    map: SetupMapDom,
    path: readonly WizardStep[],
  ): SVGGElement[] {
    const length = map.route.getTotalLength();
    const end = map.route.getPointAtLength(length);
    map.endFlag?.setAttribute(
      "transform",
      `translate(${String(end.x)} ${String(end.y)})`,
    );
    map.stations.replaceChildren();
    const ns = "http://www.w3.org/2000/svg";
    const doc = map.stations.ownerDocument;
    return path.map((step, i) => {
      const slot = stationSlot(path.length, i);
      const at = map.route.getPointAtLength(
        (STATION_ROUTE_FRACTIONS[slot] ?? 0) * length,
      );
      const g = doc.createElementNS(ns, "g");
      g.setAttribute("class", "setup-station");
      g.setAttribute("transform", `translate(${String(at.x)} ${String(at.y)})`);
      g.setAttribute("data-testid", `map-station-${step}`);
      const dot = doc.createElementNS(ns, "circle");
      dot.setAttribute("r", "7");
      const number = doc.createElementNS(ns, "text");
      number.setAttribute("class", "setup-station-num");
      number.textContent = String(i + 1);
      const offset = LABEL_OFFSETS[slot];
      const label = doc.createElementNS(ns, "text");
      label.setAttribute("class", "setup-station-label");
      label.setAttribute("x", String(offset?.dx ?? 0));
      label.setAttribute("y", String(offset?.dy ?? 0));
      label.setAttribute("text-anchor", offset?.anchor ?? "middle");
      label.textContent = STATION_NAMES[step];
      g.append(dot, number, label);
      g.addEventListener("click", () => {
        openStep(step);
      });
      map.stations.append(g);
      return g;
    });
  }

  render();
  return { render };
}

/** Draw the route up to `fraction` of its length (the mask's stroke). */
function revealRoute(map: SetupMapDom, fraction: number): void {
  const length = map.route.getTotalLength();
  map.reveal.style.strokeDasharray = `${String(length)} ${String(length)}`;
  map.reveal.style.strokeDashoffset = String(length * (1 - fraction));
}
