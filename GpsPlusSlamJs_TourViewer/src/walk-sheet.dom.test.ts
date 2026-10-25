// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";

import type { GuideView } from "./station-guide";
import { startWalk, walkRoute } from "./station-run";
import { wireWalkSheet, type WalkSheetDom } from "./walk-sheet";
import { walkSheetModel } from "./walk-sheet-model";

/**
 * Why these tests matter: the sheet's model says what the list shows, but
 * what the visitor sees is what the view writes into the page's own
 * markup. The order chip shows only for "Any order"; for a fixed or a
 * branching order the view must hide the element itself - a model that
 * says null over a view that keeps the last text (or the markup's
 * default) would still show "In order". Driven on the real `index.html`.
 */

function station(id: string, title: string): TourStation {
  return {
    id,
    title,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    activateRadiusM: 30,
    foundRadiusM: 10,
    hint: "arrow",
    steps: [],
    items: [],
  };
}

const TOUR = [station("gate", "The gate"), station("well", "The well")];

function view(): GuideView {
  return {
    focusId: "gate",
    position: "distance",
    precision: "gps",
    accuracyM: 6,
    bearings: new Map(),
    headingDeg: null,
    radarHeadingDeg: null,
    headingConfirmed: false,
    there: null,
    snapshot: null,
    distances: new Map([
      ["gate", 30],
      ["well", 60],
    ]),
    quick: null,
    end: null,
    chosenId: null,
    canChoose: false,
    rowArmedId: null,
    noGuess: false,
    chooser: false,
    undo: null,
    note: null,
    trackingLost: false,
  };
}

function byId<T extends Element = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`index.html has no #${id}`);
  return el as unknown as T;
}

function sheetDom(): WalkSheetDom {
  return {
    doc: document,
    root: byId("walk-sheet"),
    grab: byId("walk-grab"),
    peek: byId("walk-peek"),
    segments: byId("walk-segments"),
    eyebrow: byId("walk-eyebrow"),
    title: byId("walk-title"),
    distance: byId("walk-distance"),
    distanceText: byId("walk-distance-text"),
    distanceArrow: byId<SVGElement>("walk-distance-arrow"),
    tail: byId("walk-tail"),
    tailArrow: byId<SVGElement>("walk-tail-arrow"),
    quick: byId("station-skip"),
    story: byId("walk-story"),
    dots: byId("walk-dots"),
    storyEnd: byId("walk-story-end"),
    keepListening: byId("walk-keep-listening"),
    list: byId("walk-list"),
    listTitle: byId("walk-list-title"),
    chip: byId("walk-chip"),
    close: byId("walk-close"),
    done: byId("walk-done"),
    doneTitle: byId("walk-done-title"),
    doneText: byId("walk-done-text"),
    progress: byId("walk-progress"),
    hint: byId("walk-hint"),
    rows: byId("walk-rows"),
    away: {
      root: byId("walk-away"),
      text: byId("walk-away-text"),
      segments: byId("walk-away-segments"),
      rows: byId("walk-away-rows"),
    },
  };
}

describe("the walk sheet's view on the page's markup", () => {
  beforeAll(() => {
    // jsdom gives `import.meta.url` a non-file scheme: the package root
    // is the working directory of its test runs.
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    // The markup only: no script of the page runs here.
    document.documentElement.innerHTML = html
      .replace(/^<!doctype html>/i, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "");
  });

  it.each<[TourOrder, string | null, string]>([
    ["any", "Any order", "shown"],
    ["fixed", null, "hidden"],
    ["branch", null, "hidden"],
  ])(
    "with the list open, %s order: the order chip reads %s (%s)",
    (order, chip) => {
      const sheet = wireWalkSheet({
        dom: sheetDom(),
        setSheet: () => undefined,
        sheet: () => "list",
        keepListening: () => undefined,
        rowTapped: () => undefined,
      });
      // The view starts from what an earlier tour left: any order's chip.
      const render = (o: TourOrder) =>
        sheet.render(
          walkSheetModel({
            stations: TOUR,
            order: o,
            tourTitle: "Old town walk",
            progress: startWalk(walkRoute(TOUR), o),
            view: view(),
            story: null,
            sheet: "list",
          }),
          {
            sheet: "list",
            quick: null,
            end: null,
            position: "distance",
            story: null,
          },
        );
      render("any");
      render(order);
      const el = byId("walk-chip");
      // Hidden for fixed and branching order; any order reads its label.
      expect({
        hidden: el.hidden,
        text: chip === null ? null : el.textContent,
      }).toEqual({ hidden: chip === null, text: chip });
      expect(byId("walk-list").hidden).toBe(false);
    },
  );
});
