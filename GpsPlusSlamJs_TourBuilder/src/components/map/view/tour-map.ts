/**
 * `createTourMap` — plain 2D Leaflet map (no Three.js/CSS3D), component 7
 * (TASK.md §2.3 "2D map overview").
 *
 * Deliberately NOT a wrapper around the framework's `LeafletMapOverlay`: that
 * class embeds its Leaflet map into a THREE.Scene via a CSS3DObject for
 * in-AR-scene display, which contradicts this component's own spec line
 * ("a toggleable HTML/2D map") and its "standalone map page" demo. Documented
 * deviation — see plans/2026-07-31-map-plan.md.
 *
 * What IS reused, at the correct seam: `buildMapData`/`drawMapData` (the same
 * pure builder + drawing routine both existing recorder maps already share)
 * for the user-position dot, and the public method shapes of
 * `LeafletMapOverlay` (`setGpsPosition`, `render`, `toggle`/`show`/`hide`/
 * `isVisible`) so a future composition step could wrap this component in a
 * `CSS3DObject` the same way, without changing this file's interface.
 *
 * @see plans/2026-07-31-map-plan.md
 * @see plans/Shared-Contract.md D5
 */

import L from "leaflet";
import type { MapData } from "gps-plus-slam-app-framework/visualization/map-data";
import { drawMapData } from "gps-plus-slam-app-framework/visualization/map-overlay-draw";

import type {
  WaypointMarkerStatus,
  WaypointMarkerViewModel,
} from "../core/map-marker-state.js";

const DEFAULT_TILE_SERVER_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ZOOM = 17;
const MAX_ZOOM = 19;

/** Size (px) of an unvisited/visited waypoint marker dot. */
const MARKER_SIZE_PX = 20;
/** Size (px) of the "next" highlight — slightly larger to stand out. */
const NEXT_MARKER_SIZE_PX = 24;
/** Size (px) of the actual tap/drag target around a waypoint marker — a
 *  bare 20-24px dot is precise to the point of unusable on a phone
 *  (exactly the problem fixed for the waypoint list's own drag handle;
 *  same fix here, since this is the OTHER way to reposition a waypoint).
 *  The visible dot stays its normal size, centered inside this. */
const MARKER_TOUCH_TARGET_PX = 44;

const STATUS_COLOR: Record<WaypointMarkerStatus, string> = {
  unvisited: "#9ca3af", // neutral grey
  next: "#f5b400", // gold/amber highlight (visual hint only, not a gate)
  visited: "#22c55e", // green
};

/** Size (px) of the click-to-place preview pin. */
const PENDING_PIN_SIZE_PX = 30;
/** Committed waypoints are flat circles; the pending pin is a teardrop that
 *  points at its exact spot (map-pin convention) — reads as "about to be
 *  placed", not yet a real waypoint. */
const PENDING_PIN_HTML = `<svg width="${PENDING_PIN_SIZE_PX}" height="${PENDING_PIN_SIZE_PX}" viewBox="0 0 24 32" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))"><path d="M12 30.5S2.5 19.8 2.5 12a9.5 9.5 0 1 1 19 0c0 7.8-9.5 18.5-9.5 18.5Z" fill="#9ec1ff" stroke="#10131a" stroke-width="1.5"/><circle cx="12" cy="12" r="4" fill="#10131a"/></svg>`;

export interface TourMapOptions {
  readonly tileServerUrl?: string;
  readonly onTileError?: (error: unknown) => void;
  /**
   * Set false for a map that's along for the ride rather than something to
   * explore (e.g. the small live-position preview while authoring): with
   * dragging/zoom left on, a swipe that starts anywhere over the map pans
   * the map instead of scrolling the page — Leaflet grabs single-touch
   * gestures for its own panning, so the surrounding page's scroll never
   * sees them, which reads as the page being stuck. Defaults to true
   * (unchanged behaviour for maps the visitor is meant to pan/zoom).
   */
  readonly interactive?: boolean;
  /**
   * When set, every waypoint marker becomes drag-to-reposition and this
   * fires once per drag gesture, with the marker's own id and its dropped
   * lat/lon — the second way to place a waypoint (the first: walk to the
   * spot and drop it there). Omit to keep markers fixed (e.g. Viewing
   * mode, where a visitor never moves a waypoint).
   */
  readonly onWaypointDragEnd?: (id: string, lat: number, lon: number) => void;
  /**
   * When set, clicking anywhere on the map (not on an existing marker —
   * Leaflet markers stop their own click from bubbling to the map) drops a
   * preview pin there with a "Drop Waypoint" popup button; confirming it
   * calls this with the clicked lat/lon. The third way to place a
   * waypoint, alongside walking there and dragging an existing marker.
   * Clicking elsewhere (or confirming) clears the pin.
   */
  readonly onDropWaypointHere?: (lat: number, lon: number) => void;
  /**
   * Pixels of the map's OWN bottom edge that something else (the mobile
   * bottom sheet, in authoring) currently covers — everything this
   * component centers (a GPS fix, the pending-pin popup, the initial
   * waypoint fitBounds) then centers within the space actually visible
   * above that, not the full container. A live getter, not a static
   * number, since a bottom sheet's height changes as its content does
   * (and doesn't apply at all outside its own breakpoint) — read fresh
   * on every call rather than cached. Omit (or return 0) where nothing
   * covers the map.
   */
  readonly getObscuredBottomPx?: () => number;
}

export interface TourMapInstance {
  /** Center the map on a GPS fix. Same name/shape as `LeafletMapOverlay`. */
  setGpsPosition(lat: number, lon: number): void;
  /** Draw the user-position dot via the shared `buildMapData`/`drawMapData` path. */
  render(data: MapData): void;
  /** Replace the waypoint marker layer wholesale (contract: realistic tour sizes only). */
  setWaypoints(markers: readonly WaypointMarkerViewModel[]): void;
  toggle(): void;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  /** Re-measure the container (Leaflet mis-sizes tiles if hidden at creation/toggle). */
  resize(): void;
  /** The underlying Leaflet map, or `null` after `destroy()`. */
  getLeafletMap(): L.Map | null;
  destroy(): void;
}

/**
 * The geographic point that, once centered by Leaflet in the usual way
 * (which centers within the FULL container), would instead render at the
 * center of the space still visible above `obscuredBottomPx` of covered
 * bottom edge. Pure pixel math, not a Leaflet-native "padding" concept —
 * `setView`/`panTo` center a single point with no padding option of their
 * own (unlike `fitBounds`, which gets the real thing below).
 *
 * The shift is always exactly half the obscured height, regardless of the
 * container's own size: centering within a shorter visible strip only
 * ever needs pushing the true center down by half of what got shorter.
 */
function offsetTargetForObscuredBottom(
  map: L.Map,
  target: L.LatLngExpression,
  zoom: number,
  obscuredBottomPx: number,
): L.LatLngExpression {
  // Untouched, not even round-tripped through L.latLng(), when there's
  // nothing to correct for — the common case (desktop, or mobile before
  // the panel exists yet) should look exactly like it did before this
  // existed, callers included: `target` keeps whatever shape it arrived
  // in (a plain [lat, lon] tuple, here) rather than always coming back as
  // a `LatLng` instance.
  if (obscuredBottomPx <= 0) return target;
  const point = map
    .project(L.latLng(target), zoom)
    .add([0, obscuredBottomPx / 2]);
  return map.unproject(point, zoom);
}

function buildWaypointIconHtml(
  status: WaypointMarkerStatus,
  order: number,
): string {
  const color = STATUS_COLOR[status];
  const size = status === "next" ? NEXT_MARKER_SIZE_PX : MARKER_SIZE_PX;
  // A visited waypoint reads as "done" (checkmark); an upcoming one carries
  // its position in the author's own list — this is the numbering the
  // waypoint panel already shows ("Waypoint 1", "Waypoint 2", …), not a
  // proximity/activation order (plan D3: that's distance-based, never
  // list-order-based).
  const label = status === "visited" ? "✓" : order <= 99 ? String(order) : "";
  const fontSize = order >= 10 ? 9 : 11;
  const glyph = label
    ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:white;font-size:${fontSize}px;font-weight:600;line-height:1;">${label}</div>`
    : "";
  const dot = `<div style="position:relative;background:${color};width:${size}px;height:${size}px;border-radius:50%;border:3px solid white;box-shadow:0 0 4px rgba(0,0,0,0.7);">${glyph}</div>`;
  // The dot is the whole visible marker, but `iconSize` below is what
  // Leaflet actually binds tap/drag listeners to — centering the dot in a
  // larger invisible box is what makes the REAL interactive target bigger
  // without also drawing a bigger, more cluttered dot on the map.
  return `<div style="width:${MARKER_TOUCH_TARGET_PX}px;height:${MARKER_TOUCH_TARGET_PX}px;display:flex;align-items:center;justify-content:center;">${dot}</div>`;
}

/**
 * Show (and re-measure) or hide a map — the pairing every HUD Map toggle
 * needs: Leaflet mis-sizes tiles unless `resize()` follows an unhide.
 * No-op for a map that does not exist yet.
 */
export function applyMapVisibility(
  map: Pick<TourMapInstance, "show" | "hide" | "resize"> | null | undefined,
  visible: boolean,
): void {
  if (!map) return;
  if (visible) {
    map.show();
    map.resize();
  } else {
    map.hide();
  }
}

export function createTourMap(
  container: HTMLElement | null,
  options: TourMapOptions = {},
): TourMapInstance | null {
  if (!container) {
    return null;
  }

  const tileServerUrl = options.tileServerUrl ?? DEFAULT_TILE_SERVER_URL;
  const interactive = options.interactive ?? true;

  let leafletMap: L.Map | null = L.map(container, {
    zoomControl: interactive,
    attributionControl: false,
    center: [0, 0],
    zoom: DEFAULT_ZOOM,
    ...(interactive
      ? {}
      : {
          dragging: false,
          touchZoom: false,
          doubleClickZoom: false,
          scrollWheelZoom: false,
          boxZoom: false,
          keyboard: false,
          tap: false,
        }),
  });
  const tileLayer = L.tileLayer(tileServerUrl, { maxZoom: MAX_ZOOM });
  tileLayer.on("tileerror", (e: L.TileErrorEvent) => {
    options.onTileError?.(e.error);
  });
  tileLayer.addTo(leafletMap);

  // Leaflet's default zoom control sits top-left, the same corner the GPS
  // badge already occupies (authoring's full-bleed map) — move it out of
  // the way rather than stacking on top of it.
  if (interactive) {
    leafletMap.zoomControl?.setPosition("bottomright");
  }

  let pendingPinMarker: L.Marker | null = null;

  function clearPendingPin(): void {
    pendingPinMarker?.remove();
    pendingPinMarker = null;
  }

  const onDropWaypointHere = options.onDropWaypointHere;
  if (onDropWaypointHere) {
    leafletMap.on("click", (e: L.LeafletMouseEvent) => {
      clearPendingPin();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary map-pending-pin-button";
      button.textContent = "+ Drop Waypoint";
      button.addEventListener("click", () => {
        onDropWaypointHere(e.latlng.lat, e.latlng.lng);
        clearPendingPin();
      });
      const card = document.createElement("div");
      card.className = "map-pending-pin-card";
      const title = document.createElement("p");
      title.className = "map-pending-pin-title";
      title.textContent = "New waypoint";
      const coords = document.createElement("p");
      coords.className = "map-pending-pin-coords";
      coords.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
      card.append(title, coords, button);
      pendingPinMarker = L.marker(e.latlng, {
        icon: L.divIcon({
          className: "",
          html: PENDING_PIN_HTML,
          iconSize: [PENDING_PIN_SIZE_PX, PENDING_PIN_SIZE_PX],
          iconAnchor: [PENDING_PIN_SIZE_PX / 2, PENDING_PIN_SIZE_PX],
        }),
      })
        .addTo(leafletMap!)
        .bindPopup(card, {
          closeButton: true,
          minWidth: 180,
          offset: [0, -PENDING_PIN_SIZE_PX],
          // Leaflet already auto-pans the map to keep a just-opened popup
          // on screen — tell it the bottom sheet's live height counts as
          // "off screen" too, so a tap near the bottom doesn't open a
          // popup that ends up hidden underneath it.
          autoPanPaddingBottomRight: [
            20,
            20 + (options.getObscuredBottomPx?.() ?? 0),
          ],
        })
        .openPopup();
      // Closing the popup (the ✕, Escape, or clicking elsewhere on the map
      // — clicking elsewhere also re-fires this same "click" handler, which
      // already calls clearPendingPin() itself, so this is only redundant
      // there, not wrong) always means "never mind".
      pendingPinMarker.on("popupclose", clearPendingPin);
    });
  }

  let trajectoryLayers: L.Layer[] = [];
  let waypointMarkers: L.Marker[] = [];
  let visible = false;
  let hasCenteredOnce = false;
  /** The most recent fix, so `show()` can re-centre after an unhide even if
   *  every `setGpsPosition`/`panTo` in between ran against a hidden (0×0)
   *  container and left Leaflet's view in an undefined state. */
  let lastPosition: L.LatLngTuple | null = null;

  // Toggleable, starts hidden (matches recorder's "map opens via a button").
  container.style.display = "none";

  function resize(): void {
    leafletMap?.invalidateSize();
  }

  return {
    setGpsPosition(lat: number, lon: number): void {
      lastPosition = [lat, lon];
      if (!leafletMap) return;
      const obscured = options.getObscuredBottomPx?.() ?? 0;
      // Only the first fix sets the initial view (incl. zoom). Later calls
      // pan without touching zoom, so a user's manual zoom during playback
      // isn't fought on every position update.
      if (!hasCenteredOnce) {
        const center = offsetTargetForObscuredBottom(
          leafletMap,
          [lat, lon],
          DEFAULT_ZOOM,
          obscured,
        );
        leafletMap.setView(center, DEFAULT_ZOOM);
        hasCenteredOnce = true;
      } else {
        const center = offsetTargetForObscuredBottom(
          leafletMap,
          [lat, lon],
          leafletMap.getZoom(),
          obscured,
        );
        leafletMap.panTo(center);
      }
    },

    render(data: MapData): void {
      if (!leafletMap) return;
      for (const layer of trajectoryLayers) layer.remove();
      trajectoryLayers = drawMapData(leafletMap, data, {
        showUserPosition: true,
      }).layers;
    },

    setWaypoints(markers: readonly WaypointMarkerViewModel[]): void {
      if (!leafletMap) return;
      // Before any GPS fix exists (e.g. the entry screen, ahead of AR), the
      // map would otherwise sit on the [0, 0] fallback center — null island,
      // not the tour. Center on the waypoints themselves the first time any
      // arrive; a later real GPS fix still just pans (untouched zoom).
      if (!hasCenteredOnce && markers.length > 0) {
        const bounds = L.latLngBounds(
          markers.map((m) => [m.position.lat, m.position.lon]),
        );
        const obscured = options.getObscuredBottomPx?.() ?? 0;
        leafletMap.fitBounds(bounds, {
          maxZoom: DEFAULT_ZOOM,
          padding: [40, 40],
          // `fitBounds` already understands "padding" as space to leave
          // clear — unlike the pixel-math `setGpsPosition` needs, this is
          // Leaflet's own native mechanism, just fed the bottom sheet's
          // live height as extra bottom-edge padding.
          paddingBottomRight: [40, 40 + obscured],
        });
        hasCenteredOnce = true;
      }
      for (const marker of waypointMarkers) marker.remove();
      const onDragEnd = options.onWaypointDragEnd;
      waypointMarkers = markers.map((m) => {
        const marker = L.marker([m.position.lat, m.position.lon], {
          icon: L.divIcon({
            className: "",
            html: buildWaypointIconHtml(m.status, m.order),
            iconSize: [MARKER_TOUCH_TARGET_PX, MARKER_TOUCH_TARGET_PX],
            iconAnchor: [
              MARKER_TOUCH_TARGET_PX / 2,
              MARKER_TOUCH_TARGET_PX / 2,
            ],
          }),
          draggable: onDragEnd !== undefined,
        }).bindPopup(m.id);
        if (onDragEnd) {
          marker.on("dragend", () => {
            const { lat, lng } = marker.getLatLng();
            onDragEnd(m.id, lat, lng);
          });
        }
        return marker.addTo(leafletMap!);
      });
    },

    toggle(): void {
      if (visible) {
        this.hide();
      } else {
        this.show();
      }
    },

    show(): void {
      if (visible) return;
      container.style.display = "";
      visible = true;
      requestAnimationFrame(() => {
        resize();
        // A fix reported while hidden (e.g. the preview's first position,
        // which fires synchronously before the session shell shows the map)
        // was applied against a 0×0 container — invalidateSize alone can't
        // recover from that, so force the last known fix back to centre now
        // that the real size is known.
        if (lastPosition && leafletMap) {
          const zoom = leafletMap.getZoom();
          const obscured = options.getObscuredBottomPx?.() ?? 0;
          leafletMap.setView(
            offsetTargetForObscuredBottom(
              leafletMap,
              lastPosition,
              zoom,
              obscured,
            ),
            zoom,
          );
        }
      });
    },

    hide(): void {
      if (!visible) return;
      container.style.display = "none";
      visible = false;
    },

    isVisible(): boolean {
      return visible;
    },

    resize,

    getLeafletMap(): L.Map | null {
      return leafletMap;
    },

    destroy(): void {
      if (!leafletMap) return;
      clearPendingPin();
      for (const layer of trajectoryLayers) layer.remove();
      for (const marker of waypointMarkers) marker.remove();
      trajectoryLayers = [];
      waypointMarkers = [];
      leafletMap.remove();
      leafletMap = null;
      visible = false;
    },
  };
}
