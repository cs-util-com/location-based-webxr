// @vitest-environment jsdom
/**
 * Why these tests matter: the bar is the film's only keyboard control.
 * Each segment must be a real button named "Part n of 8: ..." with
 * exactly one `aria-current`, a jump must reach the page's handler, the
 * play/pause button must say what it will do, and the looks (seen,
 * current, upcoming, paused, finished) must reach the classes the
 * stylesheet keys on: the model being right is not enough if the DOM
 * keeps a stale class.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { barModel } from "./film-bar.js";
import { createFilmBarView } from "./film-bar-view.js";
import type { PlayerSnapshot } from "./film-player.js";
import { createTimeline } from "./film-timeline.js";

const TL = createTimeline(
  [
    { durS: 2, views: [{ atS: 0, view: "a" }] },
    { durS: 4, views: [{ atS: 0, view: "a" }] },
    { durS: 2, views: [{ atS: 0, view: "a" }] },
  ],
  { speed: 1, holdS: 0, camS: 1, settleS: 0 },
);
const TITLES = ["One", "Two", "Three"];
const CAPTIONS = ["First.", "Second.", "Third."];

const snap = (
  t: number,
  status: PlayerSnapshot["status"] = "playing",
  opening = false,
): PlayerSnapshot => ({
  status,
  pausedBy: status === "paused" ? "user" : null,
  t,
  position: TL.positionAt(t),
  opening,
  moving: status === "playing",
});

function setup() {
  const onJump = vi.fn();
  const onToggle = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);
  const view = createFilmBarView(document, {
    titles: TITLES,
    weights: TL.segments.map((s) => s.endS - s.startS),
    onJump,
    onToggle,
  });
  root.append(view.element);
  return { view, onJump, onToggle, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("film bar view", () => {
  it("draws one named button per part and a play button", () => {
    const { view } = setup();
    view.update(barModel(snap(3), TITLES, CAPTIONS));
    const segs = [
      ...view.element.querySelectorAll<HTMLButtonElement>("button.lf-seg"),
    ];
    expect(segs.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Part 1 of 3: One",
      "Part 2 of 3: Two",
      "Part 3 of 3: Three",
    ]);
    expect(segs.every((b) => b.type === "button")).toBe(true);
    expect(segs.map((b) => b.getAttribute("aria-current"))).toEqual([
      null,
      "step",
      null,
    ]);
    expect(
      view.element.querySelector(".lf-play")?.getAttribute("aria-label"),
    ).toBe("Pause the film");
  });

  it("sizes each segment by its share of the film", () => {
    const { view } = setup();
    const items = [
      ...view.element.querySelectorAll<HTMLElement>(".lf-segs li"),
    ];
    expect(items.map((li) => li.style.flexGrow)).toEqual(
      TL.segments.map((s) => String(s.endS - s.startS)),
    );
  });

  it("puts the looks on the classes the stylesheet reads, and the fill on the current one", () => {
    const { view } = setup();
    view.update(barModel(snap(3), TITLES, CAPTIONS));
    const looks = () =>
      [...view.element.querySelectorAll("button.lf-seg")].map((b) =>
        ["lf-seg-seen", "lf-seg-current", "lf-seg-upcoming"].find((c) =>
          b.classList.contains(c),
        ),
      );
    expect(looks()).toEqual([
      "lf-seg-seen",
      "lf-seg-current",
      "lf-seg-upcoming",
    ]);
    const fill = view.element.querySelectorAll<HTMLElement>(".lf-seg-fill")[1]!;
    expect(Number(fill.style.getPropertyValue("--lf-fill"))).toBeCloseTo(
      0.25,
      3,
    );
    view.update(barModel(snap(TL.totalS, "finished"), TITLES, CAPTIONS));
    expect(looks()).toEqual(["lf-seg-seen", "lf-seg-seen", "lf-seg-seen"]);
    expect([...view.element.querySelectorAll("[aria-current]")]).toHaveLength(
      0,
    );
  });

  it("keeps the current part current while paused and says Play", () => {
    const { view } = setup();
    view.update(barModel(snap(3, "paused"), TITLES, CAPTIONS));
    expect(
      view.element
        .querySelectorAll("button.lf-seg")[1]
        ?.classList.contains("lf-seg-current"),
    ).toBe(true);
    const play = view.element.querySelector(".lf-play")!;
    expect(play.getAttribute("aria-label")).toBe("Play the film");
    expect(play.getAttribute("data-kind")).toBe("play");
  });

  it("shows Play again as visible text once finished", () => {
    const { view } = setup();
    view.update(barModel(snap(TL.totalS, "finished"), TITLES, CAPTIONS));
    const play = view.element.querySelector(".lf-play")!;
    expect(play.getAttribute("aria-label")).toBe("Play again");
    expect(play.querySelector(".lf-play-text")?.textContent).toBe("Play again");
  });

  it("hands a segment click to the jump, and the play button to the toggle", () => {
    const { view, onJump, onToggle } = setup();
    view.element
      .querySelectorAll<HTMLButtonElement>("button.lf-seg")[2]!
      .click();
    expect(onJump).toHaveBeenCalledWith(2);
    view.element.querySelector<HTMLButtonElement>(".lf-play")!.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("names the group for a screen reader", () => {
    const { view } = setup();
    expect(view.element.getAttribute("role")).toBe("group");
    expect(view.element.getAttribute("aria-label")).toBe("The film's parts");
  });

  it("refuses weights that do not match the titles", () => {
    expect(() =>
      createFilmBarView(document, {
        titles: TITLES,
        weights: [1],
        onJump: () => undefined,
        onToggle: () => undefined,
      }),
    ).toThrow(RangeError);
  });
});
