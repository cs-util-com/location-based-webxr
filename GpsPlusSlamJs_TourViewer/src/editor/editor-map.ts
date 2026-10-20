/**
 * The desktop editor's full-window map (M6 E1): its own Leaflet map with
 * the framework's OSM tiles (the summary's shell refuses an empty tour,
 * pads for no rail and hides its map; M6 E1 plan review #4), a marker per
 * code, pin and photo, selection and hover, and the pixel position a card
 * is anchored to. Markers are built from elements, never HTML strings: a
 * label comes from a zip anyone can write (plan review #2). The debug
 * layer's camera captures (`debug-capture-layer.ts`) sit in a pane of
 * their own below the tour's markers: never interactive, never
 * focusable, no tooltip.
 *
 * @see editor-map.ts.md
 */

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { addOsmTileLayer } from "gps-plus-slam-app-framework/visualization/osm-tile-layer";
import type { DebugCapture } from "../debug-captures.js";
import { revokeDebugThumbnail } from "./debug-capture-layer.js";
import type { EditorItem, EditorModel } from "./editor-model.js";

/** Codes stay above notes where they overlap (the owner's default for
 *  marker stacking); the selected marker above both. */
const CODE_Z = 500;
/** A station beside its code is drawn over the code's edge. */
const STATION_ON_CODE_Z = 600;
const SELECTED_Z = 1000;

/** The debug captures' pane: below Leaflet's marker pane (600), above
 *  its overlays (400), and never under the pointer. */
const DEBUG_PANE = "debugCaptures";
const DEBUG_PANE_Z = "550";

/** Where a whole tour is framed when it has nothing with a position:
 *  the map still shows, at a world view. */
const EMPTY_VIEW: L.LatLngTuple = [20, 0];

export interface EditorMapHandlers {
  readonly onSelect: (id: string) => void;
  readonly onHover: (id: string, on: boolean) => void;
  /** A click on the map itself, not on a marker. */
  readonly onBackground: () => void;
  /** The view moved or zoomed: a card follows its marker. */
  readonly onView: () => void;
}

export interface EditorMap {
  show(model: EditorModel, padding: { left: number; top: number }): void;
  /** Redraw the markers after an edit: the view and the selection stay. */
  update(model: EditorModel): void;
  /** Let the marker be dragged (Move, M6 E2a); `onDrop` gets where it
   *  was left. Null ends dragging. */
  drag(id: string, onDrop: ((lat: number, lng: number) => void) | null): void;
  select(id: string | null): void;
  hover(id: string, on: boolean): void;
  /** The marker's ground point in window pixels, or null without one. */
  anchorOf(id: string): { x: number; y: number } | null;
  /** Bring a marker into the view minus `padding` (`revealPadding`). */
  reveal(
    id: string,
    padding: { topLeft: [number, number]; bottomRight: [number, number] },
  ): void;
  /** The debug layer (`debug-capture-layer.ts`): a marker per capture,
   *  without a picture yet, replacing any drawn before. */
  debugDraw(captures: readonly DebugCapture[]): void;
  /** A capture's thumbnail into its marker. */
  debugThumb(image: string, picture: HTMLElement): void;
  /** Show or hide the debug markers. */
  debugVisible(on: boolean): void;
  /** Remove every debug marker. */
  debugClear(): void;
  destroy(): void;
}

function markerElement(item: EditorItem): HTMLElement {
  if (item.kind === "code" || item.kind === "station") {
    const code = document.createElement("div");
    code.className = item.kind === "code" ? "mk-code" : "mk-station";
    code.textContent = String(item.number ?? "");
    return code;
  }
  const note = document.createElement("div");
  note.className = item.kind === "photo" ? "mk-note mk-photo" : "mk-note";
  const tail = document.createElement("div");
  tail.className = "mk-tail";
  const bubble = document.createElement("div");
  bubble.className = "mk-bubble";
  const glyph = document.createElement("span");
  glyph.className = "mk-glyph";
  bubble.append(glyph);
  note.append(tail, bubble);
  return note;
}

function iconFor(item: EditorItem): L.DivIcon {
  return item.kind === "code" || item.kind === "station"
    ? L.divIcon({
        className: "mk-wrap",
        html: markerElement(item),
        iconSize: [30, 30],
        // A station at its code's point sits beside the code, to the upper
        // right, overlapping its edge (PR #609 review): both stay clickable.
        iconAnchor: item.onCode === true ? [-9, 33] : [15, 15],
      })
    : L.divIcon({
        className: "mk-wrap",
        html: markerElement(item),
        iconSize: [34, 42],
        iconAnchor: [17, 41],
      });
}

export function createEditorMap(
  container: HTMLElement,
  handlers: EditorMapHandlers,
): EditorMap {
  const map = L.map(container, { zoomControl: false }).setView(EMPTY_VIEW, 2);
  L.control.zoom({ position: "topright" }).addTo(map);
  addOsmTileLayer(map);
  map.on("click", () => {
    handlers.onBackground();
  });
  map.on("move zoom", () => {
    handlers.onView();
  });
  const markers = new Map<string, { marker: L.Marker; item: EditorItem }>();
  let selected: string | null = null;
  const debugPane = map.createPane(DEBUG_PANE);
  debugPane.style.zIndex = DEBUG_PANE_Z;
  debugPane.style.pointerEvents = "none";
  const debugGroup = L.layerGroup();
  const debugMarkers = new Map<string, HTMLElement>();
  let debugShown = true;

  /** Every debug marker goes, and its thumbnail's blob URL with it. */
  function dropDebugMarkers(): void {
    for (const dot of debugMarkers.values()) {
      for (const child of dot.children) revokeDebugThumbnail(child);
    }
    debugGroup.clearLayers();
    debugMarkers.clear();
  }

  function baseZ(item: EditorItem): number {
    if (item.onCode === true) return STATION_ON_CODE_Z;
    return item.kind === "code" ? CODE_Z : 0;
  }

  /** The padding of a tour framed at the world view because nothing of it
   *  has a position (a recording without codes or stations): its debug
   *  captures, once drawn, are framed instead - once. Null otherwise. */
  let framedEmpty: { left: number; top: number } | null = null;

  function fit(
    points: readonly { lat: number; lng: number }[],
    padding: { left: number; top: number },
  ): void {
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
      paddingTopLeft: [padding.left + 30, padding.top + 30],
      paddingBottomRight: [60, 40],
      maxZoom: 19,
    });
  }

  function frame(
    model: EditorModel,
    padding: { left: number; top: number },
  ): void {
    if (model.fitPoints.length === 0) {
      framedEmpty = padding;
      map.setView(EMPTY_VIEW, 2);
      return;
    }
    framedEmpty = null;
    fit(model.fitPoints, padding);
  }

  function addMarker(item: EditorItem, at: { lat: number; lng: number }): void {
    const marker = L.marker([at.lat, at.lng], {
      icon: iconFor(item),
      keyboard: false,
      zIndexOffset: baseZ(item),
    });
    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      handlers.onSelect(item.id);
    });
    marker.on("mouseover", () => {
      handlers.onHover(item.id, true);
    });
    marker.on("mouseout", () => {
      handlers.onHover(item.id, false);
    });
    marker.on("drag", () => {
      handlers.onView();
    });
    marker.addTo(map);
    markers.set(item.id, { marker, item });
  }

  function draw(model: EditorModel): void {
    for (const { marker } of markers.values()) marker.remove();
    markers.clear();
    for (const item of model.items) {
      if (item.at !== null) addMarker(item, item.at);
    }
  }

  function markSelected(id: string | null): void {
    if (selected !== null) {
      const before = markers.get(selected);
      before?.marker.getElement()?.classList.remove("sel");
      before?.marker.setZIndexOffset(baseZ(before.item));
    }
    selected = id;
    const now = id === null ? undefined : markers.get(id);
    now?.marker.getElement()?.classList.add("sel");
    now?.marker.setZIndexOffset(SELECTED_Z);
  }

  return {
    show(model, padding) {
      selected = null;
      draw(model);
      frame(model, padding);
    },
    update(model) {
      // In place (E2a review #3, #4): a marker whose item is still there
      // stays - under the pointer, and draggable mid-Move - and only moves
      // when its position changed (never under a drag); the rest go or
      // are added.
      const keep = selected;
      const next = new Map(
        model.items.flatMap((item) =>
          item.at === null ? [] : [[item.id, { item, at: item.at }] as const],
        ),
      );
      for (const [id, entry] of markers) {
        const now = next.get(id);
        if (now === undefined || now.item.kind !== entry.item.kind) {
          entry.marker.remove();
          markers.delete(id);
          if (selected === id) selected = null;
          continue;
        }
        const was = entry.marker.getLatLng();
        const dragging = entry.marker.dragging?.enabled() ?? false;
        if (!dragging && (was.lat !== now.at.lat || was.lng !== now.at.lng)) {
          entry.marker.setLatLng([now.at.lat, now.at.lng]);
        }
        markers.set(id, { marker: entry.marker, item: now.item });
      }
      for (const [id, now] of next) {
        if (!markers.has(id)) addMarker(now.item, now.at);
      }
      markSelected(keep !== null && markers.has(keep) ? keep : null);
    },
    drag(id, onDrop) {
      const entry = markers.get(id);
      if (entry === undefined) return;
      const { marker } = entry;
      marker.off("dragend");
      if (onDrop === null) {
        marker.dragging?.disable();
        return;
      }
      marker.dragging?.enable();
      marker.on("dragend", () => {
        const at = marker.getLatLng();
        onDrop(at.lat, at.lng);
      });
    },
    select(id) {
      markSelected(id);
    },
    hover(id, on) {
      markers.get(id)?.marker.getElement()?.classList.toggle("hover", on);
    },
    anchorOf(id) {
      const entry = markers.get(id);
      if (entry === undefined) return null;
      const point = map.latLngToContainerPoint(entry.marker.getLatLng());
      const box = container.getBoundingClientRect();
      return { x: point.x + box.left, y: point.y + box.top };
    },
    reveal(id, padding) {
      const entry = markers.get(id);
      if (entry === undefined) return;
      map.panInside(entry.marker.getLatLng(), {
        paddingTopLeft: padding.topLeft,
        paddingBottomRight: padding.bottomRight,
      });
    },
    debugDraw(captures) {
      dropDebugMarkers();
      for (const c of captures) {
        const dot = document.createElement("div");
        dot.className = "mk-debug";
        debugGroup.addLayer(
          L.marker([c.geo.lat, c.geo.lon], {
            // A zero box at the point; the element centres itself on it
            // (its size is the thumbnail's, unknown until decoded).
            icon: L.divIcon({
              className: "mk-debug-wrap",
              html: dot,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
            interactive: false,
            keyboard: false,
            pane: DEBUG_PANE,
          }),
        );
        debugMarkers.set(c.image, dot);
      }
      if (debugShown) debugGroup.addTo(map);
      // A tour with nothing to frame showed the world: the captures are
      // then all there is to look at (debug-captures M1). Once per open, so a
      // view the creator moved is never taken from them.
      if (framedEmpty !== null && captures.length > 0) {
        const padding = framedEmpty;
        framedEmpty = null;
        fit(
          captures.map((c) => ({ lat: c.geo.lat, lng: c.geo.lon })),
          padding,
        );
      }
    },
    debugThumb(image, picture) {
      const dot = debugMarkers.get(image);
      // No marker to take it (the layer was cleared): its URL goes now.
      if (dot === undefined) {
        revokeDebugThumbnail(picture);
        return;
      }
      for (const child of dot.children) revokeDebugThumbnail(child);
      dot.classList.add("has-thumb");
      dot.replaceChildren(picture);
    },
    debugVisible(on) {
      debugShown = on;
      if (on) debugGroup.addTo(map);
      else debugGroup.remove();
    },
    debugClear() {
      dropDebugMarkers();
      debugGroup.remove();
    },
    destroy() {
      map.remove();
    },
  };
}
