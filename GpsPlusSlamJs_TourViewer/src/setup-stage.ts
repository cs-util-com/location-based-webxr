/**
 * The setup page's station row and map (polish round M2b, the owner's
 * chosen L5 look): the badge and "Step n of 6", a dot per step, Back and
 * Next under the card, the six stations on the map and the route drawn up
 * to the open one. What to show comes from `setup-stations.ts`; every move
 * goes through `wizard.openStep`, which stays the one owner of which step
 * is open (and keeps step 5 open during an AR session).
 *
 * The DOM surface is structural, like the wizard's, so the unit tests run
 * in node; the map is optional and drawn only where the browser can
 * measure its route.
 *
 * @see setup-stage.ts.md
 */

import { stationView, STATION_ROUTE_FRACTIONS } from "./setup-stations.js";
import { WIZARD_STEPS, type WizardStep } from "./wizard.js";

/** Each step's name on its dot and its map station (provisional copy). */
const STATION_NAMES: Readonly<Record<WizardStep, string>> = {
  host: "Storage",
  link: "Link",
  print: "Print",
  hang: "Hang",
  measure: "Create",
  done: "Done",
};

/** Where each station's label sits beside its dot on the map (from L5). */
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

interface DotNode extends Listening {
  type: string;
  className: string;
  textContent: string | null;
  readonly dataset: Record<string, string | undefined>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

interface SummaryNode extends Listening {
  focus(options?: FocusOptions): void;
}

export interface SetupStageDom<T> {
  steps: Record<WizardStep, StepNode>;
  /** Each step's `<summary>`: a tap on the open step's heading must not
   *  collapse it (the card would be empty), and "Make your tour" puts the
   *  keyboard on it. */
  summaries: Partial<Record<WizardStep, SummaryNode>>;
  badge: { textContent: string | null };
  of: { textContent: string | null };
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
   *  past "Hang". It follows the open step, not progress - opening step 1
   *  again takes it down (see the sidecar). */
  start?: SVGGElement;
  /** The end flag: up at the completion step. */
  endFlag?: SVGGElement;
}

export interface SetupStage {
  /** Redraw from the steps' open state (also called on every toggle). */
  render(): void;
}

export function wireSetupStage<T extends DotNode>(deps: {
  dom: SetupStageDom<T>;
  openStep: (step: WizardStep) => void;
  /** `document.createElement`, injectable for the tests. */
  createElement: (tag: "button") => T;
  map?: SetupMapDom;
  /** Whether the reader asked for reduced motion: the scroll is then
   *  instant. Read on each tap. */
  reducedMotion?: () => boolean;
}): SetupStage {
  const { dom, openStep } = deps;

  const dots = WIZARD_STEPS.map((step, i) => {
    const dot = deps.createElement("button");
    dot.type = "button";
    dot.dataset.step = step;
    dot.setAttribute("data-testid", `station-${step}`);
    dot.setAttribute(
      "aria-label",
      `Step ${String(i + 1)}: ${STATION_NAMES[step]}`,
    );
    dot.addEventListener("click", () => {
      openStep(step);
    });
    return dot;
  });
  dom.dots.replaceChildren(...dots);

  const stations = deps.map === undefined ? null : drawStations(deps.map);

  function openNow(): WizardStep | null {
    return WIZARD_STEPS.find((step) => dom.steps[step].open) ?? null;
  }

  function render(): void {
    const view = stationView(openNow());
    dom.badge.textContent = String(view.number);
    dom.of.textContent = `Step ${String(view.number)} of ${String(view.total)}`;
    WIZARD_STEPS.forEach((_, i) => {
      const dot = dots[i];
      const state = view.states[i] ?? "todo";
      if (dot === undefined) return;
      dot.dataset.state = state;
      if (state === "current") dot.setAttribute("aria-current", "step");
      else dot.removeAttribute("aria-current");
      stations?.[i]?.setAttribute("data-state", state);
    });
    dom.nav.hidden = !view.showNav;
    dom.back.hidden = view.back === null;
    dom.next.hidden = view.next === null;
    if (deps.map !== undefined) {
      revealRoute(deps.map, view.routeFraction);
      const hang = WIZARD_STEPS.indexOf("hang");
      deps.map.start?.setAttribute(
        "data-hung",
        String(view.states[hang] === "done"),
      );
      deps.map.endFlag?.setAttribute("data-on", String(!view.showNav));
    }
  }

  dom.back.addEventListener("click", () => {
    const { back } = stationView(openNow());
    if (back !== null) openStep(back);
  });
  dom.next.addEventListener("click", () => {
    const { next } = stationView(openNow());
    if (next !== null) openStep(next);
  });
  for (const step of WIZARD_STEPS) {
    dom.steps[step].addEventListener("toggle", render);
    dom.summaries[step]?.addEventListener("click", (event) => {
      event.preventDefault();
    });
  }
  // "Make your tour": the setup into view, and the keyboard onto the open
  // step's heading (the stage has no heading of its own; the open step's
  // is what the reader acts on next).
  for (const begin of dom.begins) {
    begin.addEventListener("click", () => {
      const instant = deps.reducedMotion?.() === true;
      dom.stage.scrollIntoView({
        block: "start",
        behavior: instant ? "instant" : "smooth",
      });
      dom.summaries[openNow() ?? "host"]?.focus({ preventScroll: true });
    });
  }

  /** The six stations along the route, each opening its step. */
  function drawStations(map: SetupMapDom): SVGGElement[] {
    const length = map.route.getTotalLength();
    const end = map.route.getPointAtLength(length);
    map.endFlag?.setAttribute(
      "transform",
      `translate(${String(end.x)} ${String(end.y)})`,
    );
    const ns = "http://www.w3.org/2000/svg";
    const doc = map.stations.ownerDocument;
    return WIZARD_STEPS.map((step, i) => {
      const at = map.route.getPointAtLength(
        (STATION_ROUTE_FRACTIONS[i] ?? 0) * length,
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
      const offset = LABEL_OFFSETS[i];
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
