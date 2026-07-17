/**
 * Physics demo entry point.
 *
 * This iteration (Part C1 of the 2026-07-15 replay-as-dev-harness): the
 * desktop-replay skeleton. It detects WebXR support (live AR physics lands in a
 * later iteration) and, on the desktop, lets the developer load a recorded walk
 * and replay it via the framework's `startReplaySession` — rendering the live
 * occupancy-mesh reconstruction while offering play/pause + speed controls. The
 * Rapier physics, mesh-view controller and spawn UX build on this skeleton.
 *
 * Logic lives in the tested modules (`mode-detection`, `replay-launch`); this
 * file is the DOM glue, covered by the Playwright smoke test.
 */

import { detectArSupport, applyModeEntry } from "./mode-detection";
import { loadAndStartReplay, type ReplayLaunchSink } from "./replay-launch";
import { initRapier } from "./physics-world";
import { startArMode } from "./ar-mode";
import { createPerfStats } from "./perf-stats";
import { startReplayPhysics } from "./replay-physics";
import type { ReplaySessionController } from "gps-plus-slam-app-framework/state/replay-session";

function requireEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element #${id}`);
  }
  return el as T;
}

function main(): void {
  const app = requireEl("app");
  const overlay = requireEl("overlay");
  const modeScreen = requireEl("mode-screen");
  const capabilityMessage = requireEl("capability-message");
  const fileInput = requireEl<HTMLInputElement>("recording-input");
  const fileRow = requireEl("file-row");
  const startArButton = requireEl<HTMLButtonElement>("start-ar-button");
  const replayPanel = requireEl("replay-panel");
  const replayStatus = requireEl("replay-status");
  const playPauseButton = requireEl<HTMLButtonElement>("play-pause-button");
  const speedInput = requireEl<HTMLInputElement>("replay-speed");
  const speedValue = requireEl("replay-speed-value");
  const meshStyleSelect = requireEl<HTMLSelectElement>("mesh-style");
  const meshShaderSelect = requireEl<HTMLSelectElement>("mesh-shader");
  const statsEl = requireEl("stats");
  const replayControls = requireEl("replay-controls");

  // Always-on FPS / memory panel (user feedback #4): mounted into the dom-overlay
  // layer so it composites over both the desktop scene and the AR camera feed. It
  // is driven per-frame from whichever loop is active (desktop rAF / AR XR frame).
  const perfStats = createPerfStats(overlay);

  // Live AR: on a WebXR-capable device, "Start AR" launches a genuine AR physics
  // session (device-only — verified via `pnpm dev` on a phone). The play/pause +
  // speed row is replay-only, so it is hidden in AR; the mesh + physics controls
  // are shared. Detection is fire-and-forget so the replay listeners below wire
  // synchronously (a blocking await here would leave the file input briefly dead).
  //
  // The mode screen is EITHER-OR: a capable phone shows only "Start AR" (the
  // recording file-row is hidden); the desktop shows only the file-row. The
  // file-row defaults visible in the HTML, so the desktop path already works if
  // detection never resolves.
  void detectArSupport().then((supported) => {
    applyModeEntry(supported, { startArButton, fileRow });
    if (!supported) return;
    startArButton.addEventListener("click", () => {
      startArButton.disabled = true;
      capabilityMessage.hidden = false;
      capabilityMessage.textContent = "Starting AR…";
      void initRapier().then(() =>
        startArMode({
          container: app,
          statsEl,
          meshStyleSelect,
          meshShaderSelect,
          onFrame: () => perfStats.update(),
          onError: (message) => {
            startArButton.disabled = false;
            capabilityMessage.hidden = false;
            capabilityMessage.textContent = `⚠ ${message}`;
          },
          onStarted: () => {
            modeScreen.hidden = true;
            replayPanel.hidden = false;
            replayControls.hidden = true; // play/pause/speed are replay-only
            replayStatus.textContent =
              "AR running — tap a surface to drop a ball.";
          },
        }),
      );
    });
  });

  let controller: ReplaySessionController | null = null;
  let disposeReplayPhysics: (() => void) | null = null;
  let playing = false;

  const setPlaying = (next: boolean): void => {
    playing = next;
    playPauseButton.textContent = next ? "Pause" : "Play";
  };

  // Tear down the previous replay before a new one so a reload can never stack
  // orphaned rAF loops / physics worlds / WebGL contexts (PR #197 review). Both
  // teardowns are idempotent, so this is safe with no active replay.
  const disposePreviousReplay = (): void => {
    disposeReplayPhysics?.();
    disposeReplayPhysics = null;
    controller?.dispose();
    controller = null;
  };

  const sink: ReplayLaunchSink = {
    onLoading() {
      fileInput.disabled = true;
      capabilityMessage.hidden = false;
      capabilityMessage.textContent = "Loading recording…";
    },
    onReady(readyController, actionCount) {
      disposePreviousReplay();
      controller = readyController;
      modeScreen.hidden = true;
      replayPanel.hidden = false;
      replayStatus.textContent = `Replaying ${actionCount} recorded actions — the mesh reconstructs as the walk plays back.`;

      // Physics starts once Rapier's WASM is ready (loaded lazily on first replay).
      void initRapier().then(() => {
        // A reload during the WASM load may have disposed this controller already;
        // only wire physics if it is still the active one.
        if (controller !== readyController) return;
        disposeReplayPhysics = startReplayPhysics(readyController, {
          meshStyleSelect,
          meshShaderSelect,
          statsEl,
          onFrame: () => perfStats.update(),
        });
      });

      setPlaying(true);
      void readyController.play(Number(speedInput.value) || 1);
    },
    onError(message) {
      fileInput.disabled = false;
      capabilityMessage.hidden = false;
      capabilityMessage.textContent = `⚠ ${message}`;
    },
  };

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
      void loadAndStartReplay(file, app, sink);
    }
  });

  playPauseButton.addEventListener("click", () => {
    if (!controller) {
      return;
    }
    if (playing) {
      controller.pause();
      setPlaying(false);
    } else {
      setPlaying(true);
      void controller.resume();
    }
  });

  const applySpeed = (): void => {
    const factor = Number(speedInput.value) || 1;
    speedValue.textContent = `${factor}×`;
    controller?.setSpeed(factor);
  };
  speedInput.addEventListener("input", applySpeed);
}

main();
