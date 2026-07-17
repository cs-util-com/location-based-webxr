/**
 * Wayfinding HUD demo entry point — DOM glue only.
 *
 * Dual-mode (PhysicsDemo pattern): on a WebXR-capable device "Start AR" runs
 * the live tap-to-place session (ar-mode.ts, device-verified); everywhere
 * else the desktop walk simulator auto-starts (desktop-sim.ts) and drives
 * the REAL framework HUD — which is what the Playwright e2e exercises.
 *
 * Logic lives in the tested modules (mode-detection, hud-config, hud-status,
 * walk-controls, sim-waypoints, desktop-sim, ar-mode); this file only looks
 * up elements and forwards events. Covered by the Playwright smoke test.
 */

import { startArMode } from "./ar-mode";
import { startDesktopSim } from "./desktop-sim";
import {
  AR_HUD_CONFIG,
  SIM_HUD_CONFIG,
  sanitizeHudDemoConfig,
  type HudDemoConfig,
} from "./hud-config";
import { applyModeEntry, detectArSupport } from "./mode-detection";

function requireEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element #${id}`);
  }
  return el as T;
}

function main(): void {
  const app = requireEl("app");
  const modeScreen = requireEl("mode-screen");
  const startArButton = requireEl<HTMLButtonElement>("start-ar-button");
  const simNote = requireEl("sim-note");
  const capabilityMessage = requireEl("capability-message");
  const hudPanel = requireEl("hud-panel");
  const hudStatus = requireEl<HTMLPreElement>("hud-status");
  const arHint = requireEl("ar-hint");
  const sliders = {
    distanceMin: requireEl<HTMLInputElement>("distance-min"),
    distanceMax: requireEl<HTMLInputElement>("distance-max"),
    indicatorScale: requireEl<HTMLInputElement>("indicator-scale"),
  };
  const outputs = {
    distanceMin: requireEl<HTMLOutputElement>("distance-min-value"),
    distanceMax: requireEl<HTMLOutputElement>("distance-max-value"),
    indicatorScale: requireEl<HTMLOutputElement>("indicator-scale-value"),
  };

  // --- HUD config panel ----------------------------------------------------
  // The active mode's fallback (sim vs AR distances) also anchors the
  // sanitiser when a slider produces garbage.
  let configFallback: HudDemoConfig = SIM_HUD_CONFIG;
  let activeMode: { refreshHud(): void } | null = null;

  const refreshOutputs = (): void => {
    outputs.distanceMin.value = `${sliders.distanceMin.value} m`;
    outputs.distanceMax.value = `${sliders.distanceMax.value} m`;
    outputs.indicatorScale.value = `${sliders.indicatorScale.value}×`;
  };

  const readConfig = (): HudDemoConfig =>
    sanitizeHudDemoConfig(
      {
        distanceMin: Number.parseFloat(sliders.distanceMin.value),
        distanceMax: Number.parseFloat(sliders.distanceMax.value),
        indicatorScale: Number.parseFloat(sliders.indicatorScale.value),
      },
      configFallback,
    );

  const writeSliders = (config: HudDemoConfig): void => {
    sliders.distanceMin.value = String(config.distanceMin);
    sliders.distanceMax.value = String(config.distanceMax);
    sliders.indicatorScale.value = String(config.indicatorScale);
    refreshOutputs();
  };

  for (const slider of Object.values(sliders)) {
    slider.addEventListener("input", () => {
      refreshOutputs();
      activeMode?.refreshHud();
    });
  }

  // Status line: identical text skips the DOM write (called every frame).
  let lastStatus = "";
  const onStatus = (text: string): void => {
    if (text === lastStatus) return;
    lastStatus = text;
    hudStatus.textContent = text;
  };

  // --- mode wiring ---------------------------------------------------------
  void detectArSupport().then((supported) => {
    applyModeEntry(supported, { startArButton, simNote });

    if (!supported) {
      // Desktop: the walk simulator auto-starts behind the mode screen; the
      // screen dismisses on the first interaction so the intro stays readable.
      configFallback = SIM_HUD_CONFIG;
      writeSliders(SIM_HUD_CONFIG);
      hudPanel.hidden = false;
      const sim = startDesktopSim({
        container: app,
        getConfig: readConfig,
        onStatus,
      });
      activeMode = sim;
      const dismissModeScreen = (): void => {
        modeScreen.hidden = true;
      };
      window.addEventListener("keydown", dismissModeScreen, { once: true });
      app.addEventListener("pointerdown", dismissModeScreen, { once: true });
      return;
    }

    startArButton.addEventListener("click", () => {
      startArButton.disabled = true;
      capabilityMessage.hidden = false;
      capabilityMessage.textContent = "Starting AR…";
      configFallback = AR_HUD_CONFIG;
      writeSliders(AR_HUD_CONFIG);
      void startArMode({
        container: app,
        getConfig: readConfig,
        onStatus,
        onError: (message) => {
          startArButton.disabled = false;
          capabilityMessage.hidden = false;
          capabilityMessage.textContent = `⚠ ${message}`;
        },
        onStarted: () => {
          modeScreen.hidden = true;
          capabilityMessage.hidden = true;
          hudPanel.hidden = false;
          arHint.hidden = false;
        },
        onEnded: () => {
          // System back gesture etc. — return to the mode screen for a rerun.
          activeMode = null;
          hudPanel.hidden = true;
          arHint.hidden = true;
          modeScreen.hidden = false;
          startArButton.disabled = false;
          capabilityMessage.hidden = true;
        },
      }).then((mode) => {
        activeMode = mode;
      });
    });
  });
}

main();
