import {
  createRealSunDataAdapter,
  type RealSunDataState,
} from "gps-plus-slam-app-framework/geo";
import {
  startGpsWatch,
  stopGpsWatch,
  type GpsPosition,
} from "gps-plus-slam-app-framework/sensors/gps";
import {
  parseAbsoluteTime,
  sliderToInstant,
  splitUtcInstant,
} from "./time-controls";
import "./style.css";

function element<T extends HTMLElement>(id: string): T {
  const found = document.querySelector<T>(`#${id}`);
  if (!found) throw new Error(`Missing element #${id}`);
  return found;
}

const locationSource = element<HTMLSelectElement>("location-source");
const timeSource = element<HTMLSelectElement>("time-source");
const latitude = element<HTMLInputElement>("latitude");
const longitude = element<HTMLInputElement>("longitude");
const instant = element<HTMLInputElement>("instant");
const day = element<HTMLInputElement>("utc-day");
const slider = element<HTMLInputElement>("time-slider");
const timeError = element<HTMLParagraphElement>("time-error");
const gpsStatus = element<HTMLParagraphElement>("gps-status");
const stopButton = element<HTMLButtonElement>("stop-gps");
const adapter = createRealSunDataAdapter();
let latestGps: GpsPosition | null = null;
let watching = false;
let watchGeneration = 0;
let disposed = false;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

const text = (id: string, value: string): void => {
  element(id).textContent = value;
};
const coordinateText = (lat: number, lon: number): string => `${lat}°, ${lon}°`;
const iso = (ms: number): string =>
  Number.isFinite(new Date(ms).getTime())
    ? new Date(ms).toISOString()
    : "Invalid time";

function syncRefreshTimer(): void {
  const needsTimer = !disposed && adapter.getInputs().time.mode === "real";
  if (needsTimer && refreshTimer === undefined) {
    refreshTimer = setInterval(() => adapter.refresh(), 30_000);
  } else if (!needsTimer && refreshTimer !== undefined) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

function render(state: RealSunDataState): void {
  const selected = adapter.getInputs();
  const sample = state.status === "ready" ? state.sample : null;
  text(
    "sources",
    `${selected.location.mode === "live" ? "Live GPS" : "Fixed location"} + ${selected.time.mode === "real" ? "real time" : "fixed time"}`,
  );
  const location =
    sample ??
    (selected.location.mode === "fixed"
      ? selected.location
      : latestGps && {
          latitudeDeg: latestGps.lat,
          longitudeDeg: latestGps.lon,
        });
  text(
    "selected-location",
    location
      ? coordinateText(location.latitudeDeg, location.longitudeDeg)
      : "Waiting for GPS — select fixed location to continue",
  );
  text(
    "selected-time",
    iso(
      sample?.sunTimeMs ??
        (selected.time.mode === "fixed"
          ? selected.time.instant.getTime()
          : Date.now()),
    ),
  );
  const fixMs =
    sample?.locationTimestampMs ??
    (selected.location.mode === "live" ? latestGps?.timestamp : undefined);
  text(
    "fix-time",
    fixMs === undefined || fixMs === null
      ? "None — manual location or no GPS fix"
      : iso(fixMs),
  );
  element("status").dataset.status = state.status;
  const messages = {
    "waiting-for-location":
      "Waiting for GPS. You can use fixed location without permission.",
    ready: "Ready — result uses the selected inputs above.",
    "invalid-input":
      state.status === "invalid-input" && state.reason === "location"
        ? "Invalid location. Enter latitude −90…90 and longitude −180…180, or retry GPS."
        : "Invalid time. Enter a valid absolute instant or select real time.",
    disposed: "Session ended.",
  };
  text("status", messages[state.status]);
  element("result").hidden = !sample;
  element("no-result").hidden = !!sample;
  text("raw-state", JSON.stringify(state, null, 2));
  if (sample) {
    const sun = sample.sun;
    const angle = (radians: number): string =>
      `${radians.toFixed(6)} rad (${((radians * 180) / Math.PI).toFixed(2)}°)`;
    text("azimuth", angle(sun.azimuthRad));
    text("altitude", angle(sun.altitudeRad));
    text("above-horizon", sun.isAboveHorizon ? "Yes" : "No");
    text("north", sun.directionNue.x.toFixed(6));
    text("up", sun.directionNue.y.toFixed(6));
    text("east", sun.directionNue.z.toFixed(6));
  }
  syncRefreshTimer();
}

function showTimeError(message = ""): void {
  timeError.textContent = message;
  timeError.hidden = !message;
  instant.setAttribute("aria-invalid", String(!!message));
}

function updateSliderLabel(): void {
  const minute = slider.valueAsNumber;
  text(
    "slider-time",
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")} UTC`,
  );
}

function syncTimeControls(date: Date): void {
  const parts = splitUtcInstant(date);
  day.value = parts.day;
  slider.value = String(parts.minute);
  updateSliderLabel();
}

function applyLocation(): void {
  adapter.setLocationSource(
    locationSource.value === "live"
      ? { mode: "live" }
      : {
          mode: "fixed",
          latitudeDeg: latitude.valueAsNumber,
          longitudeDeg: longitude.valueAsNumber,
        },
  );
}

function applyTime(): void {
  if (timeSource.value === "real") {
    showTimeError();
    adapter.setTimeSource({ mode: "real" });
    return;
  }
  const parsed = parseAbsoluteTime(instant.value);
  showTimeError(
    parsed
      ? ""
      : "Use a valid ISO date/time with Z or ±HH:MM. There is no fallback to real time.",
  );
  if (parsed) syncTimeControls(parsed);
  adapter.setTimeSource({ mode: "fixed", instant: parsed ?? new Date(NaN) });
}

function applySlider(): void {
  timeSource.value = "fixed";
  updateSliderLabel();
  const parsed = sliderToInstant(day.value, slider.valueAsNumber);
  showTimeError(parsed ? "" : "Select a valid UTC day for the slider.");
  instant.value = parsed?.toISOString() ?? "";
  adapter.setTimeSource({ mode: "fixed", instant: parsed ?? new Date(NaN) });
}

locationSource.addEventListener("change", applyLocation);
for (const control of [latitude, longitude])
  control.addEventListener("input", () => {
    locationSource.value = "fixed";
    applyLocation();
  });
timeSource.addEventListener("change", applyTime);
instant.addEventListener("input", () => {
  timeSource.value = "fixed";
  applyTime();
});
day.addEventListener("change", applySlider);
slider.addEventListener("input", applySlider);
element("refresh").addEventListener("click", () => adapter.refresh());
element("apply-pair").addEventListener("click", () => {
  latitude.value = "52.52";
  longitude.value = "13.405";
  instant.value = "2026-06-21T12:00:00.000Z";
  locationSource.value = "fixed";
  timeSource.value = "fixed";
  showTimeError();
  const date = new Date(instant.value);
  syncTimeControls(date);
  // Deliberately one atomic publication; no intermediate mixed location/time.
  adapter.setInputs({
    location: { mode: "fixed", latitudeDeg: 52.52, longitudeDeg: 13.405 },
    time: { mode: "fixed", instant: date },
  });
});

function stopWatching(): void {
  watchGeneration++;
  if (watching) stopGpsWatch();
  watching = false;
  stopButton.disabled = true;
}

function clearGps(): void {
  latestGps = null;
  adapter.clearLiveLocation();
}

function requestGps(): void {
  if (disposed) return;
  stopWatching();
  clearGps();
  if (!window.isSecureContext || !navigator.geolocation) {
    gpsStatus.textContent =
      "GPS unavailable here. Use HTTPS or localhost, or select fixed location.";
    return;
  }
  gpsStatus.textContent =
    "Requesting GPS permission / waiting for a location… Fixed location is available now.";
  watching = true;
  stopButton.disabled = false;
  const generation = watchGeneration;
  try {
    startGpsWatch(
      (position) => {
        if (!watching || disposed || generation !== watchGeneration) return;
        latestGps = position;
        gpsStatus.textContent = `GPS received: ${coordinateText(position.lat, position.lon)} · accuracy ${position.accuracy} m`;
        adapter.setGpsPosition(position);
      },
      (error) => {
        if (!watching || disposed || generation !== watchGeneration) return;
        const reasons: Record<number, string> = {
          1: "Permission denied",
          2: "Position unavailable",
          3: "GPS timed out",
        };
        gpsStatus.textContent = `${reasons[error.code] ?? "GPS error"}. Retry or select fixed location. Cached fix cleared.`;
        clearGps();
        if (error.code === 1) stopWatching();
      },
    );
  } catch (error) {
    stopWatching();
    gpsStatus.textContent = `Unable to start GPS: ${error instanceof Error ? error.message : String(error)}. Use fixed location.`;
  }
}

element("start-gps").addEventListener("click", requestGps);
stopButton.addEventListener("click", () => {
  stopWatching();
  clearGps();
  gpsStatus.textContent =
    "GPS stopped and cached fix cleared. Fixed location is still available.";
});
const unsubscribe = adapter.subscribe(render);
const onVisible = (): void => {
  if (!disposed && !document.hidden && adapter.getInputs().time.mode === "real")
    adapter.refresh();
};
document.addEventListener("visibilitychange", onVisible);
function cleanup(): void {
  if (disposed) return;
  disposed = true;
  stopWatching();
  clearInterval(refreshTimer);
  unsubscribe();
  adapter.dispose();
  document.removeEventListener("visibilitychange", onVisible);
}
window.addEventListener("pagehide", cleanup);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
import.meta.hot?.dispose(cleanup);
render(adapter.getState());
requestGps();
