/**
 * The desktop editor's full-window map (M6 E1): its own Leaflet map with
 * the framework's OSM tiles (the summary's shell refuses an empty tour,
 * pads for no rail and hides its map; M6 E1 plan review #4), a marker per
 * code, pin and photo, selection and hover, and the pixel position a card
 * is anchored to. Markers are built from elements, never HTML strings: a
 * label comes from a zip anyone can write (plan review #2).
 *
 * @see editor-map.ts.md
 */

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { addOsmTileLayer } from "gps-plus-slam-app-framework/visualization/osm-tile-layer";
import type { EditorItem, EditorModel } from "./editor-model.js";

/** Codes stay above notes where they overlap (the owner's default for
 *  marker stacking); the selected marker above both. */
const CODE_Z = 500;
const SELECTED_Z = 1000;

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
        iconAnchor: [15, 15],
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

  function baseZ(item: EditorItem): number {
    return item.kind === "code" ? CODE_Z : 0;
  }

  function frame(
    model: EditorModel,
    padding: { left: number; top: number },
  ): void {
    if (model.fitPoints.length === 0) {
      map.setView(EMPTY_VIEW, 2);
      return;
    }
    map.fitBounds(L.latLngBounds(model.fitPoints.map((p) => [p.lat, p.lng])), {
      paddingTopLeft: [padding.left + 30, padding.top + 30],
      paddingBottomRight: [60, 40],
      maxZoom: 19,
    });
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
    destroy() {
      map.remove();
    },
  };
}
