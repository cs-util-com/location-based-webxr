// @vitest-environment jsdom
/**
 * Why these tests matter: a right click (a long press on a touch screen)
 * on the 3D view's ground offers "New station here" - the one way to put
 * a station exactly where the creator points. The menu must open where
 * the pointer was but inside the view, start a station only at a spot the
 * ground has loaded (a station on no ground would float or sink), and be
 * usable and closable from the keyboard like the bar's menus, its keys
 * never reaching the scene.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSceneMenu } from "./scene-menu.js";

const PLACE = { lat: 48.52, lon: 9.05, alt: 340 };

function setUp() {
  document.body.innerHTML = `
    <div id="view3d">
      <canvas id="scene" tabindex="-1"></canvas>
      <div id="scene-menu" hidden>
        <button type="button" id="scene-new-station">New station here</button>
      </div>
    </div>
    <button id="elsewhere" type="button">Elsewhere</button>`;
  const box = document.getElementById("view3d") as HTMLElement;
  const menu = document.getElementById("scene-menu") as HTMLElement;
  const item = document.getElementById("scene-new-station") as HTMLElement;
  const canvas = document.getElementById("scene") as HTMLElement;
  vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 300,
    right: 400,
    bottom: 300,
  } as DOMRect);
  vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({
    width: 160,
    height: 40,
  } as DOMRect);
  const started = vi.fn();
  const scene = createSceneMenu({
    box,
    menu,
    item,
    returnFocus: canvas,
    newStation: started,
  });
  return { scene, box, menu, item, canvas, started };
}

function key(target: Element, name: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("createSceneMenu", () => {
  it("is a menu of one item, closed at first", () => {
    const { menu, item, scene } = setUp();
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-label")).toBe("The ground here");
    expect(item.getAttribute("role")).toBe("menuitem");
    expect(menu.hidden).toBe(true);
    expect(scene.isOpen()).toBe(false);
  });

  it("opens where the pointer was, with the focus on its item", () => {
    const { scene, menu, item } = setUp();
    scene.openAt({ x: 50, y: 60 }, PLACE);
    expect(menu.hidden).toBe(false);
    expect(menu.style.left).toBe("50px");
    expect(menu.style.top).toBe("60px");
    expect(document.activeElement).toBe(item);
    expect(item.hasAttribute("aria-disabled")).toBe(false);
  });

  it("stays inside the view near its right and bottom edges", () => {
    const { scene, menu } = setUp();
    scene.openAt({ x: 390, y: 290 }, PLACE);
    // 400 - 160 - 8 and 300 - 40 - 8.
    expect(menu.style.left).toBe("232px");
    expect(menu.style.top).toBe("252px");
    scene.openAt({ x: -20, y: -5 }, PLACE);
    expect(menu.style.left).toBe("8px");
    expect(menu.style.top).toBe("8px");
  });

  it("starts a station at the place, once, and closes", () => {
    const { scene, item, started, canvas } = setUp();
    scene.openAt({ x: 50, y: 60 }, PLACE);
    item.click();
    expect(started).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledWith(PLACE);
    expect(scene.isOpen()).toBe(false);
    expect(document.activeElement).toBe(canvas);
  });

  // Why: the sky, or ground still loading, has no height a station could
  // stand at; the item says why rather than vanishing.
  it("offers no station where no ground has loaded: the item says so and does nothing", () => {
    const { scene, item, started } = setUp();
    scene.openAt({ x: 50, y: 60 }, null);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    // Said in visible text, part of the item's name: a tooltip never
    // shows on a touch screen, and a disabled item that does not say why
    // looks broken.
    const why = item.querySelector(".why");
    expect(why?.textContent).toMatch(/no ground/i);
    expect((why as HTMLElement | null)?.hidden).toBe(false);
    expect(item.textContent).toMatch(/New station here.*no ground/is);
    item.click();
    expect(started).not.toHaveBeenCalled();
    expect(scene.isOpen()).toBe(true);
    scene.openAt({ x: 50, y: 60 }, PLACE);
    expect(item.hasAttribute("aria-disabled")).toBe(false);
    expect(item.querySelector<HTMLElement>(".why")?.hidden).toBe(true);
  });

  // Why: the menu offers the ground under the spot it was opened at; a
  // zoom moves that ground away from under it, so the offer would start
  // a station somewhere the creator no longer sees.
  it("a wheel over the view closes it", () => {
    const { scene, box } = setUp();
    scene.openAt({ x: 50, y: 60 }, PLACE);
    box.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(scene.isOpen()).toBe(false);
    scene.openAt({ x: 50, y: 60 }, PLACE);
    // Closed, a wheel does nothing more.
    scene.close();
    box.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(scene.isOpen()).toBe(false);
  });

  it("Escape closes it, the focus back on the view, and goes no further", () => {
    const { scene, item, canvas } = setUp();
    const page = vi.fn();
    document.addEventListener("keydown", page);
    scene.openAt({ x: 50, y: 60 }, PLACE);
    const event = key(item, "Escape");
    expect(scene.isOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(page).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(canvas);
    document.removeEventListener("keydown", page);
  });

  it("Tab closes it and lets the focus move on; a press outside closes it", () => {
    const { scene, item } = setUp();
    scene.openAt({ x: 50, y: 60 }, PLACE);
    key(item, "Tab");
    expect(scene.isOpen()).toBe(false);
    scene.openAt({ x: 50, y: 60 }, PLACE);
    (document.getElementById("elsewhere") as HTMLElement).dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    );
    expect(scene.isOpen()).toBe(false);
  });

  it("a press on the menu itself leaves it open; close() closes it", () => {
    const { scene, menu } = setUp();
    scene.openAt({ x: 50, y: 60 }, PLACE);
    menu.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(scene.isOpen()).toBe(true);
    scene.close();
    expect(scene.isOpen()).toBe(false);
    // Closing a closed menu is nothing.
    scene.close();
    expect(scene.isOpen()).toBe(false);
  });
});
