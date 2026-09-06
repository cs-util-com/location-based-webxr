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
import { guardSliderAgainstScroll } from "gps-plus-slam-app-framework/utils/slider-scroll-guard";

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
  const arInstructions = requireEl("ar-instructions");
  const arHintFlash = requireEl("ar-hint-flash");
  const sliders = {
    distanceMin: requireEl<HTMLInputElement>("distance-min"),
    distanceMax: requireEl<HTMLInputElement>("distance-max"),
    indicatorScale: requireEl<HTMLInputElement>("indicator-scale"),
  };
  const imageIndicators = requireEl<HTMLInputElement>("image-indicators");
  const entranceAnimation = requireEl<HTMLInputElement>("entrance-animation");
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
        imageIndicators: imageIndicators.checked,
        entrance: entranceAnimation.checked,
      },
      configFallback,
    );

  const writeSliders = (config: HudDemoConfig): void => {
    sliders.distanceMin.value = String(config.distanceMin);
    sliders.distanceMax.value = String(config.distanceMax);
    sliders.indicatorScale.value = String(config.indicatorScale);
    imageIndicators.checked = config.imageIndicators;
    entranceAnimation.checked = config.entrance;
    syncEntranceSwitch();
    refreshOutputs();
  };

  for (const slider of Object.values(sliders)) {
    // Guard BEFORE the listener: the HUD control row is swiped past on a phone,
    // and a native range input would otherwise edit itself as the finger
    // travels (2026-07-27 recorder field feedback, same bug class). At-target
    // listeners fire in registration order, which is what lets the guard shield
    // this one.
    guardSliderAgainstScroll(slider);
    // `input` keeps the number under the thumb live; the HUD is re-created on
    // `change` (the drag's release), not per pixel of the drag — with the
    // entrance on, each re-creation allocated four 256² canvases and their
    // textures and restarted every entrance, dozens of times per drag
    // (2026-09-06 follow-up). Playwright's `fill()` fires both events.
    slider.addEventListener("input", () => {
      refreshOutputs();
    });
    slider.addEventListener("change", () => {
      activeMode?.refreshHud();
    });
  }
  // The entrance is inert without image indicators (the procedural ring has
  // no build-up), so its switch is disabled until they are on — a live switch
  // that rebuilds the HUD for no visible effect misleads (M4 milestone review).
  const syncEntranceSwitch = (): void => {
    entranceAnimation.disabled = !imageIndicators.checked;
  };
  imageIndicators.addEventListener("change", () => {
    syncEntranceSwitch();
    activeMode?.refreshHud();
  });
  entranceAnimation.addEventListener("change", () => {
    activeMode?.refreshHud();
  });

  // Status line: identical text skips the DOM write (called every frame).
  let lastStatus = "";
  const onStatus = (text: string): void => {
    if (text === lastStatus) return;
    lastStatus = text;
    hudStatus.textContent = text;
  };

  // Transient hint flash (e.g. a tap with no surface). Cancels a pending
  // revert so rapid re-taps restart the 2.5 s window instead of cutting it.
  let hintFlashTimer: number | null = null;
  const flashHint = (message: string): void => {
    if (hintFlashTimer !== null) window.clearTimeout(hintFlashTimer);
    arHintFlash.textContent = message;
    arHintFlash.hidden = false;
    hintFlashTimer = window.setTimeout(() => {
      arHintFlash.hidden = true;
      hintFlashTimer = null;
    }, 2500);
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
        onHint: flashHint,
        onError: (message) => {
          startArButton.disabled = false;
          capabilityMessage.hidden = false;
          capabilityMessage.textContent = `⚠ ${message}`;
        },
        onStarted: () => {
          modeScreen.hidden = true;
          capabilityMessage.hidden = true;
          hudPanel.hidden = false;
          arInstructions.hidden = false;
        },
        onEnded: () => {
          // System back gesture etc. — return to the mode screen for a rerun.
          activeMode = null;
          hudPanel.hidden = true;
          arInstructions.hidden = true;
          arHintFlash.hidden = true;
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
