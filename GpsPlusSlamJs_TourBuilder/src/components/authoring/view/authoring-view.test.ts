/**
 * `mountAuthoringView` DOM wiring tests. jsdom — the session and the store
 * subscription are both injected, so no real GPS/Redux is involved.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mountAuthoringView,
  type AuthoringViewDeps,
} from "./authoring-view.js";
import type { AuthoringSliceState } from "../../../store/authoring-slice.js";
import type { AssetSlot } from "../core/asset-attachment.js";

function draft(
  overrides: Partial<AuthoringSliceState> = {},
): AuthoringSliceState {
  return {
    name: "",
    description: "",
    assets: [],
    waypoints: [],
    breadcrumb: [],
    ...overrides,
  };
}

/** A minimal hand-rolled store: plain state + listeners, no Redux dependency. */
function fakeStore(initial: AuthoringSliceState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const actions: unknown[] = [];
  return {
    getState: () => ({ authoring: state }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (action: { type: string; payload: unknown }) => {
      actions.push(action);
    },
    setState: (next: AuthoringSliceState) => {
      state = next;
      for (const l of listeners) l();
    },
    actions,
  };
}

function harness(
  initial: AuthoringSliceState = draft(),
  overrides: {
    packAndDownload?: AuthoringViewDeps["packAndDownload"];
    dropWaypoint?: () => string | null;
  } = {},
) {
  const root = document.createElement("div");
  document.body.append(root);
  const store = fakeStore(initial);
  const session = {
    dropWaypoint: overrides.dropWaypoint ?? vi.fn(() => "wp-1"),
    attachAsset: vi.fn(),
    exportTour: vi.fn(() => ({ tour: { id: "t" }, assetFiles: new Map() })),
    destroy: vi.fn(),
  };
  const onExport = vi.fn();
  const packAndDownload =
    overrides.packAndDownload ?? vi.fn().mockResolvedValue(undefined);
  const deps: AuthoringViewDeps = {
    session: session as unknown as AuthoringViewDeps["session"],
    subscribe: store.subscribe,
    getState: store.getState,
    dispatch: store.dispatch,
    packAndDownload,
    onExport,
  };
  const view = mountAuthoringView(root, deps);
  return { root, store, session, onExport, packAndDownload, view };
}

function byTestId(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`missing [data-testid=${id}]`);
  return el as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mountAuthoringView", () => {
  it("renders one row per waypoint in state", () => {
    const { root } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
          {
            id: "wp-2",
            position: { lat: 3, lon: 4 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    expect(root.querySelectorAll('[data-testid^="waypoint-"]')).toHaveLength(2);
  });

  it("re-renders when the store notifies a state change", () => {
    const { root, store } = harness();
    expect(root.querySelectorAll('[data-testid^="waypoint-"]')).toHaveLength(0);

    store.setState(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );

    expect(root.querySelectorAll('[data-testid^="waypoint-"]')).toHaveLength(1);
  });

  it("a store notification from an unrelated section (e.g. the tour name field's blur-triggered change) never touches the Waypoints section's DOM, so a click in flight on Drop Waypoint isn't swallowed", () => {
    const { root, store } = harness();
    const dropButtonBefore = byTestId(root, "drop-waypoint");

    // Simulates the tour-name input's blur firing `change` — which
    // dispatches — mid-mousedown on "Drop Waypoint": the resulting render
    // only rebuilds the Tour Details section (name/description changed);
    // the Waypoints section — and the button's node identity the browser's
    // pending click is matched against — must be completely untouched, at
    // any point after the dispatch, not just within the same task.
    //
    // Spreading the previous state (rather than building a fresh `draft()`)
    // mirrors what the real Immer-backed reducer does: untouched slices
    // (`waypoints`, `assets`) keep their exact array reference.
    store.setState({
      ...store.getState().authoring,
      name: "typed while focused elsewhere",
    });

    expect(byTestId(root, "drop-waypoint")).toBe(dropButtonBefore);
  });

  it("Drop Waypoint button calls session.dropWaypoint()", () => {
    const { root, session } = harness();
    byTestId(root, "drop-waypoint").click();
    expect(session.dropWaypoint).toHaveBeenCalledTimes(1);
  });

  it("editing a waypoint's prefetch radius dispatches updateWaypoint", () => {
    const { root, store } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    const input = byTestId(root, "prefetch-radius-wp-1") as HTMLInputElement;
    input.value = "30";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(store.actions).toContainEqual({
      type: "authoring/updateWaypoint",
      payload: { id: "wp-1", changes: { prefetchRadius: 30 } },
    });
  });

  it("editing a waypoint's active radius dispatches updateWaypoint", () => {
    const { root, store } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    const input = byTestId(root, "active-radius-wp-1") as HTMLInputElement;
    input.value = "12";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(store.actions).toContainEqual({
      type: "authoring/updateWaypoint",
      payload: { id: "wp-1", changes: { activeRadius: 12 } },
    });
  });

  it("the remove button dispatches removeWaypoint(id)", () => {
    const { root, store } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    byTestId(root, "remove-waypoint-wp-1").click();

    expect(store.actions).toContainEqual({
      type: "authoring/removeWaypoint",
      payload: "wp-1",
    });
  });

  it("picking a file for a slot calls session.attachAsset(waypointId, slot, file)", () => {
    const { root, session } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    const input = byTestId(root, "asset-model-wp-1") as HTMLInputElement;
    const file = new File(["x"], "knight.glb");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const slot: AssetSlot = "model";
    expect(session.attachAsset).toHaveBeenCalledWith("wp-1", slot, file);
  });

  it("model input only accepts GLTF/GLB, per the contract", () => {
    const { root } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    expect(byTestId(root, "asset-model-wp-1").getAttribute("accept")).toBe(
      ".glb,.gltf",
    );
  });

  it("rejects a file with the wrong extension for the slot, shows an inline error, and does not call attachAsset", () => {
    const { root, session } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    const input = byTestId(root, "asset-model-wp-1") as HTMLInputElement;
    const file = new File(["x"], "story.mp3");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(session.attachAsset).not.toHaveBeenCalled();
    expect(byTestId(root, "visual-error-wp-1").textContent).toContain(
      "story.mp3",
    );
    expect(input.value).toBe("");
  });

  it("clears a prior visual-tile error once a valid file is picked", () => {
    const { root, session } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    const modelInput = byTestId(root, "asset-model-wp-1") as HTMLInputElement;
    Object.defineProperty(modelInput, "files", {
      value: [new File(["x"], "story.mp3")],
      configurable: true,
    });
    modelInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(byTestId(root, "visual-error-wp-1").textContent).not.toBe("");

    Object.defineProperty(modelInput, "files", {
      value: [new File(["x"], "knight.glb")],
      configurable: true,
    });
    modelInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(session.attachAsset).toHaveBeenCalledTimes(1);
    expect(byTestId(root, "visual-error-wp-1").textContent).toBe("");
  });

  it("rejects a wrong-type audio file and shows its own inline error", () => {
    const { root, session } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    const input = byTestId(root, "asset-audio-wp-1") as HTMLInputElement;
    const file = new File(["x"], "facade.png");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(session.attachAsset).not.toHaveBeenCalled();
    expect(byTestId(root, "audio-error-wp-1").textContent).toContain(
      "facade.png",
    );
  });

  it("editing a waypoint's transcript dispatches updateWaypoint with a merged content patch", () => {
    const { root, store } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: { model: "asset-1" },
          },
        ],
      }),
    );
    const textarea = byTestId(root, "transcript-wp-1") as HTMLTextAreaElement;
    textarea.value = "A knight once stood here.";
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    expect(store.actions).toContainEqual({
      type: "authoring/updateWaypoint",
      payload: {
        id: "wp-1",
        changes: { content: { transcript: "A knight once stood here." } },
      },
    });
  });

  it("pre-fills the transcript textarea from existing waypoint content", () => {
    const { root } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: { transcript: "Already written." },
          },
        ],
      }),
    );
    const textarea = byTestId(root, "transcript-wp-1") as HTMLTextAreaElement;

    expect(textarea.value).toBe("Already written.");
  });

  it("Tour Details starts expanded and closes/opens on its header click, without losing the name field's value", () => {
    const { root } = harness(draft({ name: "Castle Walk" }));
    const detailsSection = () =>
      byTestId(root, "tour-details-toggle").closest(".authoring-section")!;
    expect(detailsSection().classList.contains("open")).toBe(true);

    byTestId(root, "tour-details-toggle").click();
    expect(detailsSection().classList.contains("open")).toBe(false);

    byTestId(root, "tour-details-toggle").click();
    expect(detailsSection().classList.contains("open")).toBe(true);
    expect((byTestId(root, "tour-name") as HTMLInputElement).value).toBe(
      "Castle Walk",
    );
  });

  it("name/description inputs dispatch setTourMeta", () => {
    const { root, store } = harness();
    const nameInput = byTestId(root, "tour-name") as HTMLInputElement;
    nameInput.value = "Castle Walk";
    nameInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(store.actions).toContainEqual({
      type: "authoring/setTourMeta",
      payload: { name: "Castle Walk", description: "" },
    });
  });

  it("Export button packs+downloads before calling onExport, and shows a plain confirmation", async () => {
    const { root, session, packAndDownload, onExport } = harness();
    byTestId(root, "export").click();

    expect(session.exportTour).toHaveBeenCalledTimes(1);
    expect(packAndDownload).toHaveBeenCalledWith({ id: "t" }, new Map());

    await vi.waitFor(() =>
      expect(onExport).toHaveBeenCalledWith({
        tour: { id: "t" },
        assetFiles: new Map(),
      }),
    );
    expect(byTestId(root, "export-status").textContent).toBe(
      "Download started.",
    );
  });

  it("shows the error inline and re-enables Export if packAndDownload rejects, without calling onExport", async () => {
    const { root, onExport } = harness(draft(), {
      packAndDownload: vi.fn().mockRejectedValue(new Error("no network")),
    });
    const exportButton = byTestId(root, "export") as HTMLButtonElement;
    exportButton.click();

    expect(exportButton.disabled).toBe(true);
    await vi.waitFor(() =>
      expect(byTestId(root, "export-status").textContent).toBe("no network"),
    );
    expect(exportButton.disabled).toBe(false);
    expect(onExport).not.toHaveBeenCalled();
  });

  it("waypoints render collapsed by default and expand on header click; opening one collapses the other", () => {
    const { root } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
          {
            id: "wp-2",
            position: { lat: 3, lon: 4 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );

    expect(byTestId(root, "waypoint-wp-1").classList.contains("open")).toBe(
      false,
    );
    expect(byTestId(root, "waypoint-wp-2").classList.contains("open")).toBe(
      false,
    );

    byTestId(root, "wp-toggle-wp-1").click();
    expect(byTestId(root, "waypoint-wp-1").classList.contains("open")).toBe(
      true,
    );

    byTestId(root, "wp-toggle-wp-2").click();
    expect(byTestId(root, "waypoint-wp-1").classList.contains("open")).toBe(
      false,
    );
    expect(byTestId(root, "waypoint-wp-2").classList.contains("open")).toBe(
      true,
    );
  });

  it("dragging a card past its siblings' midpoints reorders the DOM live, then dispatches one moveWaypoint matching the drop position", () => {
    const { root, store } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 1 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
          {
            id: "wp-2",
            position: { lat: 2, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
          {
            id: "wp-3",
            position: { lat: 3, lon: 3 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );

    const list = root.querySelector(".waypoint-list")!;
    // Every card (including the placeholder, once it exists) reports its
    // top as 50px times its LIVE index in `list.children` — a stand-in for
    // real flow layout that stays correct as the drag reorders the DOM,
    // unlike a fixed-at-setup closure value.
    function wireStackedRect(el: HTMLElement): void {
      el.getBoundingClientRect = () =>
        ({
          top: Array.from(list.children).indexOf(el) * 50,
          height: 50,
          left: 0,
          width: 300,
        }) as DOMRect;
    }
    for (const card of Array.from(list.children) as HTMLElement[]) {
      wireStackedRect(card);
    }

    const handle = byTestId(root, "wp-drag-handle-wp-1");
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientY: 25 }),
    );
    const draggedCard = byTestId(root, "waypoint-wp-1");
    expect(draggedCard.classList.contains("dragging")).toBe(true);
    expect(draggedCard.style.position).toBe("fixed");
    const placeholder = list.querySelector(".wp-drag-placeholder");
    expect(placeholder).not.toBeNull();
    wireStackedRect(placeholder as HTMLElement); // it now holds wp-1's old slot

    const wp2Card = byTestId(root, "waypoint-wp-2");

    // Past wp-2's midpoint (75) and wp-3's (125): the placeholder lands
    // last, and wp-2 — displaced up one slot — picks up a FLIP transform
    // for the browser to animate away next frame.
    document.dispatchEvent(new PointerEvent("pointermove", { clientY: 130 }));
    expect(
      Array.from(list.children).map((c) =>
        c === placeholder
          ? "placeholder"
          : (c as HTMLElement).dataset["testid"],
      ),
    ).toEqual([
      "waypoint-wp-2",
      "waypoint-wp-3",
      "waypoint-wp-1",
      "placeholder",
    ]);
    expect(wp2Card.style.transform).not.toBe("");

    document.dispatchEvent(new PointerEvent("pointerup"));

    expect(store.actions).toContainEqual({
      type: "authoring/moveWaypoint",
      payload: { id: "wp-1", toIndex: 2 },
    });
    expect(
      Array.from(list.children).map(
        (c) => (c as HTMLElement).dataset["testid"],
      ),
    ).toEqual(["waypoint-wp-2", "waypoint-wp-3", "waypoint-wp-1"]);
    expect(draggedCard.classList.contains("dragging")).toBe(false);
    expect(draggedCard.style.position).toBe("");
    expect(list.querySelector(".wp-drag-placeholder")).toBeNull();
  });

  it("a quick tap anywhere on a card's header still just toggles it open (no aiming at the grip required, but a tap isn't a drag)", () => {
    const { root } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 1 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    const header = byTestId(root, "wp-toggle-wp-1");

    header.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    // Real event order for a tap: pointerdown, pointerup, then the
    // browser's own synthesized click. Firing pointerup also clears the
    // pending hold-to-drag timer — a real tap must not leave it armed to
    // fire later against whatever the next test happens to render.
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    header.dispatchEvent(new Event("click", { bubbles: true }));

    expect(byTestId(root, "waypoint-wp-1").classList.contains("open")).toBe(
      true,
    );
    expect(byTestId(root, "waypoint-wp-1").classList.contains("dragging")).toBe(
      false,
    );
  });

  it("pressing and holding anywhere on a card's header (not just the grip) also starts a drag", () => {
    vi.useFakeTimers();
    try {
      const { root } = harness(
        draft({
          waypoints: [
            {
              id: "wp-1",
              position: { lat: 1, lon: 1 },
              prefetchRadius: 25,
              activeRadius: 10,
              content: {},
            },
            {
              id: "wp-2",
              position: { lat: 2, lon: 2 },
              prefetchRadius: 25,
              activeRadius: 10,
              content: {},
            },
          ],
        }),
      );
      const header = byTestId(root, "wp-toggle-wp-1");

      header.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        }),
      );
      // Held past HOLD_TO_DRAG_MS without moving: commits to a drag.
      vi.advanceTimersByTime(250);

      const card = byTestId(root, "waypoint-wp-1");
      expect(card.classList.contains("dragging")).toBe(true);

      // The hold-to-drag's own pointerup (not the manufactured `click`
      // used in the tap test above) must NOT also toggle the card open —
      // that's exactly what `dragJustHappened` exists to prevent.
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
      header.dispatchEvent(new Event("click", { bubbles: true }));
      expect(byTestId(root, "waypoint-wp-1").classList.contains("open")).toBe(
        false,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("dropping a new waypoint expands it and collapses whatever was open", () => {
    const { root, store } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
      { dropWaypoint: () => "wp-2" },
    );
    byTestId(root, "wp-toggle-wp-1").click();
    expect(byTestId(root, "waypoint-wp-1").classList.contains("open")).toBe(
      true,
    );

    // dropWaypoint() (mocked above to return "wp-2") is what actually adds
    // the waypoint via the real session in production; the fake store here
    // needs its own matching setState so the render the click triggers has
    // something to find at "waypoint-wp-2".
    store.setState(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
          {
            id: "wp-2",
            position: { lat: 5, lon: 6 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );
    byTestId(root, "drop-waypoint").click();

    expect(byTestId(root, "waypoint-wp-1").classList.contains("open")).toBe(
      false,
    );
    expect(byTestId(root, "waypoint-wp-2").classList.contains("open")).toBe(
      true,
    );
  });

  it("view.focusWaypoint(id) expands that card and collapses the others (waypoints created outside the card, e.g. from the map)", () => {
    const wp = (id: string) => ({
      id,
      position: { lat: 1, lon: 2 },
      prefetchRadius: 25,
      activeRadius: 10,
      content: {},
    });
    const { root, view } = harness(
      draft({ waypoints: [wp("wp-1"), wp("wp-2")] }),
    );
    byTestId(root, "wp-toggle-wp-1").click();

    view.focusWaypoint("wp-2");

    expect(byTestId(root, "waypoint-wp-1").classList.contains("open")).toBe(
      false,
    );
    expect(byTestId(root, "waypoint-wp-2").classList.contains("open")).toBe(
      true,
    );
  });

  it("clicking a visual tile's clear button dispatches removeAsset for that asset", () => {
    const { root, store } = harness(
      draft({
        assets: [
          { id: "asset-1", type: "model", filename: "assets/asset-1.glb" },
        ],
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: { model: "asset-1" },
          },
        ],
      }),
    );
    byTestId(root, "clear-model-wp-1").click();

    expect(store.actions).toContainEqual({
      type: "authoring/removeAsset",
      payload: "asset-1",
    });
  });

  it("collapsed summary shows an icon per attached content type, and 'empty' text when nothing is attached", () => {
    const { root } = harness(
      draft({
        assets: [
          { id: "asset-1", type: "model", filename: "assets/asset-1.glb" },
          { id: "asset-2", type: "audio", filename: "assets/asset-2.mp3" },
        ],
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: { model: "asset-1", audio: "asset-2", transcript: "  " },
          },
          {
            id: "wp-2",
            position: { lat: 3, lon: 4 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );

    const wp1Summary = byTestId(root, "waypoint-wp-1").querySelector(
      ".wp-summary",
    )!;
    expect(wp1Summary.querySelectorAll("svg")).toHaveLength(2); // model + audio, whitespace-only transcript doesn't count
    expect(
      byTestId(root, "waypoint-wp-2").querySelector(".wp-summary-empty")
        ?.textContent,
    ).toBe("empty");
  });

  it("shows an empty-state message when there are no waypoints, and hides it once one exists", () => {
    const { root, store } = harness();
    expect(byTestId(root, "waypoints-empty")).toBeTruthy();

    store.setState(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );

    expect(root.querySelector('[data-testid="waypoints-empty"]')).toBeNull();
  });

  it("shows the attached asset's filename from state, and it survives an unrelated re-render (U5)", () => {
    const withAttachment = draft({
      assets: [
        { id: "asset-1", type: "model", filename: "assets/asset-1.glb" },
      ],
      waypoints: [
        {
          id: "wp-1",
          position: { lat: 1, lon: 2 },
          prefetchRadius: 25,
          activeRadius: 10,
          content: { model: "asset-1" },
        },
      ],
    });
    const { root, store } = harness(withAttachment);

    expect(byTestId(root, "asset-status-model-wp-1").textContent).toContain(
      "assets/asset-1.glb",
    );

    // An unrelated state change (e.g. dropping a second waypoint) rebuilds
    // the DOM from scratch — the attached filename must still read from
    // `waypoint.content`, not a native <input> label that would reset.
    store.setState({
      ...withAttachment,
      waypoints: [
        ...withAttachment.waypoints,
        {
          id: "wp-2",
          position: { lat: 5, lon: 6 },
          prefetchRadius: 25,
          activeRadius: 10,
          content: {},
        },
      ],
    });

    expect(byTestId(root, "asset-status-model-wp-1").textContent).toContain(
      "assets/asset-1.glb",
    );
  });

  it("shows '(none)' for an asset slot with nothing attached", () => {
    const { root } = harness(
      draft({
        waypoints: [
          {
            id: "wp-1",
            position: { lat: 1, lon: 2 },
            prefetchRadius: 25,
            activeRadius: 10,
            content: {},
          },
        ],
      }),
    );

    expect(byTestId(root, "asset-status-model-wp-1").textContent).toContain(
      "(none)",
    );
  });

  it("destroy() unsubscribes from the store and clears the DOM", () => {
    const { root, store, view } = harness();
    view.destroy();

    expect(root.innerHTML).toBe("");
    store.setState(draft({ name: "should not re-render" }));
    expect(root.innerHTML).toBe("");
  });
});
