/**
 * `mountAuthoringView` — the DOM wiring for component 10. Renders tour
 * meta inputs, the waypoint list as collapsible cards (radius inputs with
 * hint tooltips, a Model/Picture tile pair, an audio tile, a transcript
 * textarea), a Drop Waypoint button, and an Export button that packs,
 * downloads, and only then hands off to the injected `onExport`. Reacts to
 * store changes via an injected `subscribe`/`getState` pair rather than
 * owning state itself — the `authoring` slice (already built by component 3)
 * is the single source of truth for everything except which waypoint card is
 * expanded, which is local UI state (see the `expandedId` closure variable
 * below) so it survives unrelated re-renders without ever touching Redux.
 *
 * @see plans/2026-08-07-authoring-plan.md
 * @see plans/2026-08-07-authoring-demo-ux-plan.md (card layout, U5/U6)
 * @see plans/2026-09-02-authoring-composition-ui-refresh-design.md
 */

import {
  setTourMeta,
  updateWaypoint,
  removeWaypoint,
  moveWaypoint,
  removeAsset,
  type AuthoringSliceState,
} from "../../../store/authoring-slice.js";
import type { AuthoringStateShape } from "../../../store/selectors.js";
import {
  ALLOWED_EXTENSIONS,
  isAllowedAssetFile,
  type AssetSlot,
} from "../core/asset-attachment.js";
import type { AssetId, Tour } from "../../../store/types.js";
import { ICONS } from "../../shared/icons.js";
import { buildLabeledField } from "../../shared/labeled-field.js";

type AuthoringViewAction =
  | ReturnType<typeof setTourMeta>
  | ReturnType<typeof updateWaypoint>
  | ReturnType<typeof removeWaypoint>
  | ReturnType<typeof moveWaypoint>
  | ReturnType<typeof removeAsset>;

interface AuthoringViewSession {
  dropWaypoint(): string | null;
  attachAsset(waypointId: string, slot: AssetSlot, file: File): void;
  exportTour(): { tour: Tour; assetFiles: ReadonlyMap<AssetId, File> };
}

export interface AuthoringViewDeps {
  readonly session: AuthoringViewSession;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => AuthoringStateShape;
  readonly dispatch: (action: AuthoringViewAction) => void;
  /** Packs the tour and starts the download. Rejecting leaves the author on
   *  this screen with the error shown inline — nothing is torn down. */
  readonly packAndDownload: (
    tour: Tour,
    assetFiles: ReadonlyMap<AssetId, File>,
  ) => Promise<void>;
  /** Fires once `packAndDownload` has resolved successfully. */
  readonly onExport: (result: {
    tour: Tour;
    assetFiles: ReadonlyMap<AssetId, File>;
  }) => void;
}

export interface AuthoringView {
  /** Expands the given waypoint's card (collapsing the others) and scrolls
   *  it into view. For waypoints created outside the card's own Drop
   *  button — e.g. from the map popup — which the view can't otherwise
   *  tell apart from any other store change. */
  readonly focusWaypoint: (id: string) => void;
  readonly destroy: () => void;
}

const PREFETCH_HINT =
  "Distance at which this waypoint's media starts downloading, so it's ready before the visitor arrives.";
const ACTIVE_HINT =
  "Distance at which this waypoint's content actually plays. Must be smaller than the prefetch distance.";

const ACCEPT: Record<AssetSlot, string> = {
  model: ALLOWED_EXTENSIONS.model.join(","),
  sprite: ALLOWED_EXTENSIONS.sprite.join(","),
  audio: ALLOWED_EXTENSIONS.audio.join(","),
};

const SLOT_NOUN: Record<AssetSlot, string> = {
  model: "model",
  sprite: "picture",
  audio: "audio",
};

function formatAllowedExtensions(slot: AssetSlot): string {
  const exts = ALLOWED_EXTENSIONS[slot];
  return exts.length === 1
    ? exts[0]!
    : `${exts.slice(0, -1).join(", ")} or ${exts.at(-1)}`;
}

function rejectionMessage(slot: AssetSlot, file: File): string {
  return `${file.name} isn't a supported ${SLOT_NOUN[slot]} file. Use ${formatAllowedExtensions(slot)}.`;
}

export function mountAuthoringView(
  root: HTMLElement,
  deps: AuthoringViewDeps,
): AuthoringView {
  /** Which waypoint card is expanded (accordion: at most one at a time).
   *  Local UI state, deliberately never dispatched — a store round trip on
   *  every collapse/expand would defeat the whole point of keeping it
   *  independent from unrelated store updates. */
  let expandedId: string | null = null;

  /** Cards whose header `click` (the one that always follows a pointerup,
   *  browser-native) must NOT toggle the accordion because that pointerup
   *  actually ended a press-and-hold drag, not a tap — see `wireDragReorder`. */
  const dragJustHappened = new Set<HTMLElement>();

  function attachedFilename(
    authoring: AuthoringSliceState,
    wp: AuthoringSliceState["waypoints"][number],
    slot: AssetSlot,
  ): string {
    const assetId = wp.content[slot];
    if (!assetId) return "(none)";
    const asset = authoring.assets.find((a) => a.id === assetId);
    return asset?.filename ?? "(none)";
  }

  function buildVisualTile(
    slot: Extract<AssetSlot, "model" | "sprite">,
    authoring: AuthoringSliceState,
    wp: AuthoringSliceState["waypoints"][number],
    errorEl: HTMLElement,
  ): HTMLElement {
    const assetId = wp.content[slot];
    const active = assetId !== undefined;

    const tile = document.createElement("label");
    tile.className = `visual-tile${active ? " visual-tile-active" : ""}`;

    const icon = document.createElement("span");
    icon.className = "visual-tile-icon";
    icon.innerHTML = slot === "model" ? ICONS.cube : ICONS.photo;

    const label = document.createElement("span");
    label.className = "visual-tile-label";
    label.textContent = slot === "model" ? "Model" : "Picture";

    const status = document.createElement("span");
    status.className = "visual-tile-status";
    status.dataset["testid"] = `asset-status-${slot}-${wp.id}`;
    status.textContent = attachedFilename(authoring, wp, slot);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ACCEPT[slot];
    fileInput.className = "visual-tile-input";
    fileInput.dataset["testid"] = `asset-${slot}-${wp.id}`;
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (!isAllowedAssetFile(slot, file)) {
        errorEl.textContent = rejectionMessage(slot, file);
        fileInput.value = "";
        return;
      }
      errorEl.textContent = "";
      deps.session.attachAsset(wp.id, slot, file);
    });

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "visual-tile-clear";
    clear.dataset["testid"] = `clear-${slot}-${wp.id}`;
    clear.innerHTML = ICONS.x;
    clear.addEventListener("click", (event) => {
      event.preventDefault(); // don't let the <label> forward the click into the file input
      if (assetId) deps.dispatch(removeAsset(assetId));
    });

    tile.append(icon, label, status, fileInput, clear);
    return tile;
  }

  function buildAudioTile(
    authoring: AuthoringSliceState,
    wp: AuthoringSliceState["waypoints"][number],
    errorEl: HTMLElement,
  ): HTMLElement {
    const assetId = wp.content.audio;
    const active = assetId !== undefined;

    const tile = document.createElement("label");
    tile.className = `audio-tile${active ? " audio-tile-active" : ""}`;

    const icon = document.createElement("span");
    icon.className = "audio-tile-icon";
    icon.innerHTML = ICONS.audio;

    const label = document.createElement("span");
    label.className = "audio-tile-label";
    label.textContent = "Audio narration";

    const status = document.createElement("span");
    status.className = "audio-tile-status";
    status.dataset["testid"] = "asset-status-audio-" + wp.id;
    status.textContent = attachedFilename(authoring, wp, "audio");

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ACCEPT.audio;
    fileInput.className = "audio-tile-input";
    fileInput.dataset["testid"] = `asset-audio-${wp.id}`;
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (!isAllowedAssetFile("audio", file)) {
        errorEl.textContent = rejectionMessage("audio", file);
        fileInput.value = "";
        return;
      }
      errorEl.textContent = "";
      deps.session.attachAsset(wp.id, "audio", file);
    });

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "audio-tile-clear";
    clear.dataset["testid"] = `clear-audio-${wp.id}`;
    clear.innerHTML = ICONS.x;
    clear.addEventListener("click", (event) => {
      event.preventDefault();
      if (assetId) deps.dispatch(removeAsset(assetId));
    });

    tile.append(icon, label, status, fileInput, clear);
    return tile;
  }

  /** One icon per attached content type, in the collapsed header. Trimmed so
   *  a whitespace-only transcript doesn't count as "written". */
  function buildSummary(
    wp: AuthoringSliceState["waypoints"][number],
  ): HTMLElement {
    const summary = document.createElement("span");
    summary.className = "wp-summary";

    const visualIcon =
      wp.content.model !== undefined
        ? ICONS.cube
        : wp.content.sprite !== undefined
          ? ICONS.photo
          : null;
    const hasAudio = wp.content.audio !== undefined;
    const hasTranscript = (wp.content.transcript ?? "").trim().length > 0;

    if (visualIcon === null && !hasAudio && !hasTranscript) {
      const empty = document.createElement("span");
      empty.className = "wp-summary-empty";
      empty.textContent = "empty";
      summary.append(empty);
      return summary;
    }

    if (visualIcon !== null) {
      const span = document.createElement("span");
      span.innerHTML = visualIcon;
      summary.append(span);
    }
    if (hasAudio) {
      const span = document.createElement("span");
      span.innerHTML = ICONS.audio;
      summary.append(span);
    }
    if (hasTranscript) {
      const span = document.createElement("span");
      span.innerHTML = ICONS.text;
      summary.append(span);
    }
    return summary;
  }

  function renderWaypointCard(
    authoring: AuthoringSliceState,
    wp: AuthoringSliceState["waypoints"][number],
    index: number,
  ): HTMLElement {
    const isOpen = wp.id === expandedId;

    const card = document.createElement("div");
    card.className = `waypoint-card${isOpen ? " open" : ""}`;
    card.dataset["testid"] = `waypoint-${wp.id}`;

    const header = document.createElement("div");
    header.className = "wp-header";
    header.dataset["testid"] = `wp-toggle-${wp.id}`;
    header.addEventListener("click", () => {
      // A press-and-hold-to-drag gesture on this same header (below) also
      // ends in a `click` once the pointer lifts — without this check that
      // click would toggle the accordion right after every drag.
      if (dragJustHappened.has(card)) {
        dragJustHappened.delete(card);
        return;
      }
      expandedId = isOpen ? null : wp.id;
      render();
    });

    // Effortless reordering: press-and-drag the grip to pick the card up
    // and drop it anywhere else in the list (`wireDragReorder`, attached
    // once per render of the whole list, below). A `click` on the handle
    // alone (no drag) would otherwise bubble to the header and toggle the
    // accordion, so that's swallowed here too.
    const dragHandle = document.createElement("span");
    dragHandle.className = "wp-drag-handle";
    dragHandle.dataset["testid"] = `wp-drag-handle-${wp.id}`;
    dragHandle.setAttribute("aria-label", "Reorder waypoint");
    dragHandle.innerHTML = ICONS.grip;
    dragHandle.addEventListener("click", (event) => event.stopPropagation());

    const chevron = document.createElement("span");
    chevron.className = "wp-chevron";
    chevron.innerHTML = ICONS.chevron;

    const title = document.createElement("h3");
    title.textContent = `Waypoint ${index + 1}`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "icon-btn";
    removeButton.dataset["testid"] = `remove-waypoint-${wp.id}`;
    removeButton.setAttribute("aria-label", "Remove waypoint");
    removeButton.innerHTML = ICONS.x;
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation(); // don't also toggle the accordion
      deps.dispatch(removeWaypoint(wp.id));
    });

    header.append(dragHandle, chevron, title, buildSummary(wp), removeButton);
    card.append(header);

    const body = document.createElement("div");
    body.className = "wp-body";
    const bodyIn = document.createElement("div");
    bodyIn.className = "wp-body-in";
    body.append(bodyIn);
    card.append(body);

    const prefetchInput = document.createElement("input");
    prefetchInput.type = "number";
    prefetchInput.dataset["testid"] = `prefetch-radius-${wp.id}`;
    prefetchInput.value = String(wp.prefetchRadius);
    prefetchInput.addEventListener("change", () => {
      deps.dispatch(
        updateWaypoint({
          id: wp.id,
          changes: { prefetchRadius: Number(prefetchInput.value) },
        }),
      );
    });

    const activeInput = document.createElement("input");
    activeInput.type = "number";
    activeInput.dataset["testid"] = `active-radius-${wp.id}`;
    activeInput.value = String(wp.activeRadius);
    activeInput.addEventListener("change", () => {
      deps.dispatch(
        updateWaypoint({
          id: wp.id,
          changes: { activeRadius: Number(activeInput.value) },
        }),
      );
    });

    const radiusRow = document.createElement("div");
    radiusRow.className = "radius-row";
    radiusRow.append(
      buildLabeledField(
        "Prefetch (m)",
        prefetchInput,
        `prefetch-${wp.id}`,
        PREFETCH_HINT,
      ),
      buildLabeledField(
        "Active (m)",
        activeInput,
        `active-${wp.id}`,
        ACTIVE_HINT,
      ),
    );
    bodyIn.append(radiusRow);

    const visualLabel = document.createElement("p");
    visualLabel.className = "section-label";
    visualLabel.textContent = "Visual";
    bodyIn.append(visualLabel);

    const visualError = document.createElement("p");
    visualError.className = "field-error-text";
    visualError.dataset["testid"] = `visual-error-${wp.id}`;

    const tiles = document.createElement("div");
    tiles.className = "visual-tiles";
    tiles.append(
      buildVisualTile("model", authoring, wp, visualError),
      buildVisualTile("sprite", authoring, wp, visualError),
    );
    bodyIn.append(tiles, visualError);

    const hint = document.createElement("p");
    hint.className = "visual-hint";
    hint.textContent =
      "Choose a model or a picture for this waypoint. Attaching one clears the other.";
    bodyIn.append(hint);

    const audioError = document.createElement("p");
    audioError.className = "field-error-text";
    audioError.dataset["testid"] = `audio-error-${wp.id}`;

    const audioLabel = document.createElement("p");
    audioLabel.className = "section-label";
    audioLabel.textContent = "Audio";
    bodyIn.append(
      audioLabel,
      buildAudioTile(authoring, wp, audioError),
      audioError,
    );

    const transcriptInput = document.createElement("textarea");
    transcriptInput.dataset["testid"] = `transcript-${wp.id}`;
    transcriptInput.value = wp.content.transcript ?? "";
    transcriptInput.addEventListener("change", () => {
      deps.dispatch(
        updateWaypoint({
          id: wp.id,
          changes: { content: { transcript: transcriptInput.value } },
        }),
      );
    });
    bodyIn.append(
      buildLabeledField("Transcript", transcriptInput, `transcript-${wp.id}`),
    );

    return card;
  }

  /** How long a displaced card's FLIP settle-into-place animation runs. */
  const REORDER_ANIM_MS = 220;
  /** How long a press on the card body (NOT the grip) must hold before it
   *  commits to a drag rather than a tap-to-expand — long enough that a
   *  normal tap or a scroll-swipe never accidentally grabs the card, short
   *  enough that a real "I want to move this" press still feels immediate. */
  const HOLD_TO_DRAG_MS = 220;
  /** A press on the card body that moves this many px before the hold
   *  delay elapses also commits to a drag right away — no need to sit
   *  still and wait once the intent is already obvious. */
  const HOLD_MOVE_THRESHOLD_PX = 10;

  /**
   * Effortless reordering: the grip handle always drags immediately, but
   * so does a **press-and-hold anywhere else on the card's header** — a
   * quick tap there still opens/closes the card as before, the header's
   * own `click` handler tells the two apart via `dragJustHappened`. Aiming
   * for a specific small handle is real friction (worse on a phone); a
   * press-and-hold on the whole row removes the aiming requirement
   * entirely, which is why the handle is a secondary affordance here, not
   * the only way in.
   *
   * However it starts, dragging works the same way: the card lifts out of
   * the list, following the pointer 1:1 while a dashed placeholder holds
   * its old slot open; every other card slides smoothly (FLIP — measure,
   * mutate, invert the jump into a transform, then animate that transform
   * to zero) out of the way as the placeholder moves past their midpoint.
   * Releasing drops the card into the placeholder's slot and dispatches
   * exactly one `moveWaypoint`, which the next render() from the store
   * then simply confirms. Pointer Events (not HTML5 `draggable`) because
   * this app's primary surface is a phone, and native drag-and-drop has no
   * touch support at all.
   */
  function wireDragReorder(list: HTMLElement): void {
    let dragging: HTMLElement | null = null;
    let placeholder: HTMLElement | null = null;
    let pointerStartY = 0;
    let cardStartTop = 0;

    function others(): HTMLElement[] {
      return Array.from(list.children).filter(
        (el) => el !== dragging && el !== placeholder,
      ) as HTMLElement[];
    }

    /** Runs `mutate` (a DOM reorder of the non-dragged cards), then FLIPs
     *  every card whose position it changed into a smooth slide. */
    function flip(mutate: () => void): void {
      const before = new Map(
        others().map((el) => [el, el.getBoundingClientRect().top]),
      );
      mutate();
      for (const el of others()) {
        const from = before.get(el);
        if (from === undefined) continue;
        const to = el.getBoundingClientRect().top;
        const delta = from - to;
        if (delta === 0) continue;
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          el.style.transition = `transform ${REORDER_ANIM_MS}ms var(--ease-out)`;
          el.style.transform = "";
        });
      }
    }

    function movePlaceholderTo(y: number): void {
      if (!placeholder) return;
      flip(() => {
        for (const card of others()) {
          const rect = card.getBoundingClientRect();
          if (y < rect.top + rect.height / 2) {
            list.insertBefore(placeholder!, card);
            return;
          }
        }
        list.append(placeholder!); // past every sibling's midpoint: goes last
      });
    }

    function onPointerMove(event: PointerEvent): void {
      if (!dragging) return;
      dragging.style.top = `${cardStartTop + (event.clientY - pointerStartY)}px`;
      movePlaceholderTo(event.clientY);
    }

    function endDrag(): void {
      if (!dragging || !placeholder) return;
      const card = dragging;
      const slot = placeholder;
      dragging = null;
      placeholder = null;

      // The placeholder's index among everyone EXCEPT the still-present
      // fixed-position `card` — `card` itself would otherwise double-count
      // (it's still a DOM child, appended after its own placeholder since
      // pointerdown) and throw this off by one.
      const toIndex = Array.from(list.children)
        .filter((el) => el !== card)
        .indexOf(slot);
      slot.replaceWith(card);
      card.classList.remove("dragging");
      card.style.position = "";
      card.style.top = "";
      card.style.left = "";
      card.style.width = "";
      card.style.zIndex = "";

      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);

      const id = card.dataset["testid"]!.replace("waypoint-", "");
      deps.dispatch(moveWaypoint({ id, toIndex }));
    }

    function beginDrag(card: HTMLElement, clientY: number): void {
      const rect = card.getBoundingClientRect();

      const slot = document.createElement("div");
      slot.className = "wp-drag-placeholder";
      slot.style.height = `${rect.height}px`;
      card.replaceWith(slot);
      placeholder = slot;

      dragging = card;
      pointerStartY = clientY;
      cardStartTop = rect.top;
      dragJustHappened.add(card);
      card.classList.add("dragging");
      card.style.position = "fixed";
      card.style.top = `${rect.top}px`;
      card.style.left = `${rect.left}px`;
      card.style.width = `${rect.width}px`;
      card.style.zIndex = "30";
      // The lifted card floats outside `list` in stacking terms (fixed),
      // so it needs somewhere to still live in the DOM while dragging —
      // append it back to `list` after its own placeholder.
      list.append(card);

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);
    }

    for (const card of Array.from(list.children) as HTMLElement[]) {
      const handle = card.querySelector<HTMLElement>(".wp-drag-handle");
      const header = card.querySelector<HTMLElement>(".wp-header");

      // The grip: always starts a drag immediately, no aiming ambiguity —
      // that's the point of a dedicated handle.
      handle?.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        beginDrag(card, event.clientY);
      });

      // The rest of the header: a quick tap still opens/closes the card
      // (native `click`, untouched); holding past HOLD_TO_DRAG_MS — or
      // moving HOLD_MOVE_THRESHOLD_PX before that timer fires — commits to
      // a drag instead. Ignores presses that started on the handle (it
      // already has its own listener above) or the remove button (its own
      // unrelated action).
      header?.addEventListener("pointerdown", (event) => {
        const target = event.target as HTMLElement | null;
        if (target === null) return;
        if (handle?.contains(target)) return;
        if (target.closest(".icon-btn")) return;

        const startX = event.clientX;
        const startY = event.clientY;
        const pointerId = event.pointerId;
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          beginDrag(card, startY);
        }, HOLD_TO_DRAG_MS);

        function onMove(moveEvent: PointerEvent): void {
          if (moveEvent.pointerId !== pointerId || settled) return;
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          if (Math.hypot(dx, dy) < HOLD_MOVE_THRESHOLD_PX) return;
          settled = true;
          cleanup();
          beginDrag(card, moveEvent.clientY);
        }

        function onRelease(releaseEvent: PointerEvent): void {
          if (releaseEvent.pointerId !== pointerId) return;
          settled = true;
          cleanup();
          // Too quick/too still to be a drag — a normal tap. Nothing to
          // do: the browser's own `click` (toggle) follows on its own.
        }

        function cleanup(): void {
          clearTimeout(timer);
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onRelease);
          document.removeEventListener("pointercancel", onRelease);
        }

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onRelease);
        document.addEventListener("pointercancel", onRelease);
      });
    }
  }

  function focusWaypoint(id: string): void {
    expandedId = id;
    render();
    // The new card is appended at the end of the list and auto-expanded,
    // so with any other waypoints already present it renders off-screen
    // below the fold with nothing to bring it into view — the visitor
    // has to already know to scroll down to find what they just created.
    const card = waypointsEl?.querySelector(`[data-testid="waypoint-${id}"]`);
    // jsdom (unit tests) has no scrollIntoView at all, unlike most DOM
    // APIs it at least stubs.
    if (typeof card?.scrollIntoView === "function") {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function renderWaypointsSection(authoring: AuthoringSliceState): HTMLElement {
    const section = document.createElement("section");
    section.className = "authoring-section";

    const heading = document.createElement("div");
    heading.className = "waypoints-heading";
    const h2 = document.createElement("h2");
    h2.textContent = `Waypoints · ${authoring.waypoints.length}`;
    const dropButton = document.createElement("button");
    dropButton.className = "primary";
    dropButton.dataset["testid"] = "drop-waypoint";
    dropButton.textContent = "+ Drop Waypoint";
    dropButton.addEventListener("click", () => {
      const newId = deps.session.dropWaypoint();
      if (newId !== null) focusWaypoint(newId);
    });
    heading.append(h2, dropButton);
    section.append(heading);

    const placementHint = document.createElement("p");
    placementHint.className = "visual-hint";
    placementHint.textContent =
      "Walk to the spot and tap Drop Waypoint, click the map, or drag an existing pin to fine-tune it. Press and hold a card to reorder the list.";
    section.append(placementHint);

    if (authoring.waypoints.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.dataset["testid"] = "waypoints-empty";
      empty.textContent = "No waypoints yet. Drop one to get started.";
      section.append(empty);
    } else {
      const list = document.createElement("div");
      list.className = "waypoint-list";
      authoring.waypoints.forEach((wp, index) => {
        list.append(renderWaypointCard(authoring, wp, index));
      });
      section.append(list);
      wireDragReorder(list);
    }

    return section;
  }

  function renderTourDetailsSection(
    authoring: AuthoringSliceState,
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = `authoring-section${tourDetailsOpen ? " open" : ""}`;

    // Expanded by default so a new author sees the name/description fields
    // straight away; collapsible to give the waypoint list the panel's
    // limited space once they're set. Same disclosure
    // interaction as a waypoint card (chevron rotates, body's max-height
    // opens), just under neutral `details-*` classes since this section
    // isn't waypoint-specific.
    const header = document.createElement("div");
    header.className = "details-header";
    header.dataset["testid"] = "tour-details-toggle";
    header.addEventListener("click", () => {
      tourDetailsOpen = !tourDetailsOpen;
      render();
    });

    const chevron = document.createElement("span");
    chevron.className = "details-chevron";
    chevron.innerHTML = ICONS.chevron;

    const heading = document.createElement("h2");
    heading.textContent = "Tour Details";
    header.append(chevron, heading);
    section.append(header);

    const body = document.createElement("div");
    body.className = "details-body";

    const nameInput = document.createElement("input");
    nameInput.dataset["testid"] = "tour-name";
    nameInput.value = authoring.name;
    nameInput.addEventListener("change", () => {
      deps.dispatch(
        setTourMeta({
          name: nameInput.value,
          description: authoring.description,
        }),
      );
    });
    body.append(buildLabeledField("Name", nameInput, "tour-name"));

    const descriptionInput = document.createElement("input");
    descriptionInput.dataset["testid"] = "tour-description";
    descriptionInput.value = authoring.description;
    descriptionInput.addEventListener("change", () => {
      deps.dispatch(
        setTourMeta({
          name: authoring.name,
          description: descriptionInput.value,
        }),
      );
    });
    body.append(
      buildLabeledField("Description", descriptionInput, "tour-description"),
    );
    section.append(body);

    return section;
  }

  function renderExportAction(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "export-action";

    const exportButton = document.createElement("button");
    // Secondary but full-width: Drop Waypoint is the one primary action on
    // the screen; export is a one-off finishing step that still needs to be
    // easy to hit.
    exportButton.className = "export-button";
    exportButton.dataset["testid"] = "export";
    exportButton.textContent = "Export & Pack";
    wrapper.append(exportButton);

    const status = document.createElement("p");
    status.dataset["testid"] = "export-status";
    wrapper.append(status);

    exportButton.addEventListener("click", () => {
      void (async () => {
        exportButton.disabled = true;
        status.textContent = "";
        status.dataset["state"] = "";
        const result = deps.session.exportTour();
        try {
          await deps.packAndDownload(result.tour, result.assetFiles);
        } catch (error) {
          status.textContent =
            error instanceof Error ? error.message : String(error);
          status.dataset["state"] = "error";
          exportButton.disabled = false;
          return;
        }
        status.textContent = "Download started.";
        status.dataset["state"] = "ok";
        deps.onExport(result);
      })();
    });

    return wrapper;
  }

  // A field's blur-triggered `change` dispatch (e.g. tabbing/clicking out of
  // the transcript textarea into "Drop Waypoint") lands mid-mousedown, before
  // the browser has resolved the in-flight click's mouseup. A real mousedown
  // -to-mouseup gap is tens of milliseconds even for a fast click — far
  // longer than any macrotask deferral — so delaying a full DOM teardown
  // doesn't stop it from landing mid-gesture and destroying the click's
  // target out from under it, silently swallowing that click (AC: reported
  // as "have to click twice"). The actual fix is to not tear down elements
  // the change didn't touch: each section only gets rebuilt when the slice
  // of state it renders from has actually changed (reference inequality —
  // Immer/RTK keep untouched slices referentially stable), so editing the
  // tour name never disturbs the Waypoints section's DOM (or vice versa),
  // regardless of timing.
  let tourDetailsOpen = true;
  let renderedName: string | undefined;
  let renderedDescription: string | undefined;
  let renderedTourDetailsOpen: boolean | undefined;
  let tourDetailsEl: HTMLElement | null = null;

  let renderedWaypoints: AuthoringSliceState["waypoints"] | undefined;
  let renderedAssets: AuthoringSliceState["assets"] | undefined;
  let renderedExpandedId: string | null | undefined;
  let waypointsEl: HTMLElement | null = null;

  let exportSectionEl: HTMLElement | null = null;

  /** Swaps `current` for `next` in place (or appends, on first render) and
   *  returns `next` so callers can update their "last rendered" ref in one line. */
  function replaceSection(
    current: HTMLElement | null,
    next: HTMLElement,
  ): HTMLElement {
    if (current === null) root.append(next);
    else current.replaceWith(next);
    return next;
  }

  function tourDetailsIsStale(authoring: AuthoringSliceState): boolean {
    return (
      tourDetailsEl === null ||
      authoring.name !== renderedName ||
      authoring.description !== renderedDescription ||
      tourDetailsOpen !== renderedTourDetailsOpen
    );
  }

  function waypointsSectionIsStale(authoring: AuthoringSliceState): boolean {
    return (
      waypointsEl === null ||
      authoring.waypoints !== renderedWaypoints ||
      authoring.assets !== renderedAssets ||
      expandedId !== renderedExpandedId
    );
  }

  function render(): void {
    const authoring = deps.getState().authoring;

    if (tourDetailsIsStale(authoring)) {
      tourDetailsEl = replaceSection(
        tourDetailsEl,
        renderTourDetailsSection(authoring),
      );
      renderedName = authoring.name;
      renderedDescription = authoring.description;
      renderedTourDetailsOpen = tourDetailsOpen;
    }

    if (waypointsSectionIsStale(authoring)) {
      waypointsEl = replaceSection(
        waypointsEl,
        renderWaypointsSection(authoring),
      );
      renderedWaypoints = authoring.waypoints;
      renderedAssets = authoring.assets;
      renderedExpandedId = expandedId;
    }

    if (exportSectionEl === null) {
      exportSectionEl = renderExportAction();
      root.append(exportSectionEl);
    }
  }

  const unsubscribe = deps.subscribe(() => {
    render();
  });
  render();

  return {
    focusWaypoint,
    destroy(): void {
      unsubscribe();
      root.innerHTML = "";
    },
  };
}
