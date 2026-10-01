/**
 * The summary after Finish, on the page (authoring plan 2026-09-28-0953 §1
 * item 5, §3.3, milestone M3b): one row per code with its verdict and the
 * numbers behind it, the map, and the way back into AR.
 *
 * THE MAP LOADS ON DEMAND. `loadMap` is a dynamic import of
 * `summary-map-view.ts` - the only module that pulls in Leaflet - so the
 * page a visitor loads never contains it. While it loads the map says so;
 * when it cannot load (offline, a failed chunk) it says that, and the
 * verdicts above it still stand: they need no map (CLAUDE.md, "UI feedback
 * for async actions").
 *
 * "Back to authoring" is "Start AR setup" again (plan §3.3): the button
 * here hands its tap to the page's own AR entry, inside the same user
 * gesture, rather than adding a second way into AR.
 *
 * @see summary-panel.ts.md
 */

import type { SummaryCode, SummaryModel } from "./summary-model.js";

/** What the map module offers (`summary-map-view.ts`). */
export interface SummaryMapModule {
  drawSummaryMap(
    container: HTMLElement,
    model: SummaryModel,
  ): { destroy(): void } | null;
}

export interface SummaryPanelDom {
  /** The whole summary (inside the finish block); hidden until a Finish. */
  root: HTMLElement;
  /** The list of codes. */
  codes: HTMLElement;
  /** The map's container. */
  map: HTMLElement;
  /** The map's loading and failure line. */
  mapStatus: HTMLElement;
  /** "Start AR setup" again. */
  startAr: HTMLButtonElement;
}

export interface SummaryPanel {
  /** Show the summary of `model`, replacing any earlier one. */
  show(model: SummaryModel): void;
  /** Hide it and drop its map (a tour closed). */
  hide(): void;
}

/** The map's words, one per state. */
export const SUMMARY_MAP_TEXT = {
  loading: "Loading the map...",
  failed: "The map could not load (offline?). The verdicts above still hold.",
  empty: "Nothing to show on a map yet.",
} as const;

type SummaryMapState = "loading" | "ready" | "failed" | "empty";

/** One code's row: its name, its verdict, and the numbers folded away. */
function codeRow(doc: Document, code: SummaryCode): HTMLElement {
  const li = doc.createElement("li");
  li.className = "summary-code";
  li.dataset["testid"] = "summary-code";
  li.dataset["verdict"] = code.verdict.kind;
  const title = doc.createElement("span");
  title.className = "summary-code-title";
  title.textContent = code.label;
  const verdict = doc.createElement("span");
  verdict.className = "summary-verdict";
  verdict.dataset["testid"] = "summary-verdict";
  verdict.textContent = code.verdict.text;
  const numbers = doc.createElement("details");
  numbers.className = "summary-numbers";
  numbers.dataset["testid"] = "summary-numbers";
  const summary = doc.createElement("summary");
  summary.textContent = "The numbers";
  numbers.append(summary);
  for (const line of code.details) {
    const p = doc.createElement("p");
    p.className = "summary-line";
    p.textContent = line;
    numbers.append(p);
  }
  li.append(title, verdict, numbers);
  return li;
}

export function createSummaryPanel(deps: {
  dom: SummaryPanelDom;
  doc: Document;
  /** The map module, imported dynamically. */
  loadMap: () => Promise<SummaryMapModule>;
  /** Start AR setup, as the page's own button does. */
  startAr: () => void;
}): SummaryPanel {
  const { dom, doc } = deps;
  let map: { destroy(): void } | null = null;
  /** Bumped by every show and hide: a load that finishes after either
   *  belongs to a summary no longer on screen. */
  let generation = 0;

  function setMapState(state: SummaryMapState): void {
    dom.mapStatus.dataset["state"] = state;
    dom.map.dataset["state"] = state;
    dom.mapStatus.hidden = state === "ready";
    dom.mapStatus.textContent =
      state === "ready" ? "" : SUMMARY_MAP_TEXT[state];
  }

  function dropMap(): void {
    map?.destroy();
    map = null;
  }

  function drawMap(model: SummaryModel, mine: number): void {
    if (model.fitPoints.length === 0) {
      dom.map.hidden = true;
      setMapState("empty");
      return;
    }
    dom.map.hidden = false;
    setMapState("loading");
    deps
      .loadMap()
      .then((module) => {
        if (mine !== generation) return;
        map = module.drawSummaryMap(dom.map, model);
        setMapState(map === null ? "failed" : "ready");
      })
      .catch(() => {
        if (mine !== generation) return;
        setMapState("failed");
      });
  }

  dom.startAr.addEventListener("click", () => {
    deps.startAr();
  });

  return {
    show(model) {
      generation += 1;
      dropMap();
      dom.codes.replaceChildren(...model.codes.map((c) => codeRow(doc, c)));
      dom.root.hidden = false;
      drawMap(model, generation);
    },
    hide() {
      generation += 1;
      dropMap();
      dom.root.hidden = true;
    },
  };
}
