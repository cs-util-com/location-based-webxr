/**
 * QR-tracking demo — application entry point (glue).
 *
 * The "framework wiring — don't touch" layer. It composes the tested seams into
 * the demo flow:
 *
 *   1. Capability-gate: no WebXR → honest message, no crash.
 *   2. On the Start gesture: boot the store (with the `qrDetected` slice), the
 *      AR session, the debug view under `arWorldGroup`, and the demo controller.
 *   3. Per frame, hand the captured RGBA image to the controller; it detects,
 *      measures the size from depth, solves a PnP pose from the corners (once a
 *      size exists), records into `qrDetected`, and glues the axis + cube to the
 *      code. The HUD renders the live size readout.
 *
 * Pure, unit-tested logic lives in the sibling modules (`capability`,
 * `hud-view`, `demo-store`, `demo-controller`); the axis+cube overlay is the
 * shared framework `ar/qr/qr-debug-view` (same view the Recorder renders). This
 * file is verified manually via `pnpm dev` on an AR
 * device (the §5 on-device gate) and through the faked Playwright e2e.
 */

import {
  qrFrameChanged,
  recordQrDetection,
  recordQrSizeEstimate,
  selectQrFusedEntries,
  selectQrSize,
} from "gps-plus-slam-app-framework/state";
import {
  createFusedQrPoseSource,
  estimateQrSizeFromParallax,
} from "gps-plus-slam-app-framework/ar/qr";
import { createMotionTrail } from "./motion-trail.js";
import {
  createMotionTrailView,
  type MotionTrailView,
} from "./motion-trail-view.js";

import { getSeams } from "./seams.js";
import { createQrDemoStore, type QrDemoStore } from "./demo-store.js";
// Shared framework consumer view (deep subpath, NOT the heavy `/ar` barrel —
// same rationale as the recorder's import). The demo previously shipped a
// byte-identical local copy; it now renders the SAME overlay as the Recorder so
// the two can't drift (e.g. the WEBXR_TO_NUE basis handling) over time.
import {
  createQrDebugView,
  type QrDebugView,
} from "gps-plus-slam-app-framework/ar/qr/qr-debug-view";
import {
  createDefaultSolvePose,
  createQrDemoController,
} from "./demo-controller.js";
import { parseQrPerfParams } from "./qrperf/qrperf-params.js";
import { parseIntervalParam } from "./interval-param.js";
import { DEFAULT_QR_CAPTURE_INTERVAL_MS } from "gps-plus-slam-app-framework/ar/qr/qr-capture-cadence";
import { mountQrPerf, type MountedQrPerf } from "./qrperf/mount-qrperf.js";
import type { CaptureTiming } from "gps-plus-slam-app-framework/ar/camera-blit-capture";
import { toHudView, type DemoStatus } from "./hud-view.js";
import { isDemoSupported, capabilityMessage } from "./capability.js";
import {
  createDebugLog,
  formatDetectionLine,
  formatStatusLine,
} from "./debug-log.js";

/**
 * Detection cadence (ms between captures) — ~8 Hz, within the plan §9 5–10 Hz
 * target. NOT per-frame: a phone renders ~30–60 fps and blitting + detecting
 * every frame would waste CPU/GPU/battery. This is the SINGLE cadence knob — it
 * drives the framework `CameraFrameSource` (the one throttle, Option A); the
 * controller then detects every delivered frame (`minIntervalMs: 0`).
 * `?interval=<ms>` overrides it for field measurements (QR near-frontal pose
 * plan, M1); the default and the bounds are the framework's, shared with the
 * Recorder.
 */
const DETECT_INTERVAL_MS =
  parseIntervalParam(location.search) ?? DEFAULT_QR_CAPTURE_INTERVAL_MS;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} element in index.html`);
  return node as T;
}

const dom = {
  app: el("app"),
  startScreen: el("start-screen"),
  startButton: el<HTMLButtonElement>("start-button"),
  capabilityMessage: el("capability-message"),
  hud: el("hud"),
  hudStatus: el("hud-status"),
  hudSize: el("hud-size"),
  hudSamples: el("hud-samples"),
  hudSpread: el("hud-spread"),
  hudLifecycle: el("hud-lifecycle"),
  hudPose: el("hud-pose"),
  hudMotion: el("hud-motion"),
  debugLog: el("debug-log"),
  qrperfLog: el("qrperf-log"),
  qrperfCopy: el<HTMLButtonElement>("qrperf-copy"),
  error: el("error"),
} as const;

let store: QrDemoStore | null = null;
/**
 * The fused QR pose per payload (M3b b5); one per page, trackers per code.
 * With `?qrperf`, each NEW evaluation's cost is timed (plan §30): the HUD's
 * render evaluates first, so a stopwatch around a later read would time a
 * cache hit.
 */
const fusedPose = createFusedQrPoseSource({
  entriesOf: (text) =>
    store ? selectQrFusedEntries(store.getState(), text) : [],
  onEvaluated: (_result, ms) => perf?.instrument.onFusedCost(ms),
});
/** The `?qrperf` instrument, when the flag is set (null otherwise). */
let perf: MountedQrPerf | null = null;
let view: QrDebugView | null = null;
/**
 * The active code's last ~2 s of positions, drawn in its motion mode's
 * colour (plan §26); cleared on a restart or another code.
 */
const trail = createMotionTrail();
let trailView: MotionTrailView | null = null;
let stopFrames: (() => void) | null = null;
let status: DemoStatus = "idle";
/** The most-recently detected payload — drives which marker the HUD shows. */
let activeText: string | null = null;

/** On-screen detection log (cadence/tuning aid — see debug-log.ts). */
const debugLog = createDebugLog();
/** Clock of the previous lock, for the per-line Δt. */
let lastLockMs: number | null = null;

function renderDebugLog(): void {
  dom.debugLog.textContent = debugLog.lines.join("\n");
  // Keep the newest line in view.
  dom.debugLog.scrollTop = dom.debugLog.scrollHeight;
}

function renderHud(): void {
  const size =
    store && activeText
      ? selectQrSize(store.getState(), activeText)
      : undefined;
  // Re-evaluate (cheap: cached until a new detection or a frame change) so a
  // restart shows at once, not at the next lock.
  if (store && activeText) fusedPose.evaluate(activeText);
  const v = toHudView(
    status,
    size,
    activeText ? fusedPose.last(activeText) : null,
  );
  dom.hudStatus.textContent = v.statusLabel;
  dom.hudSize.textContent = v.sizeLabel;
  dom.hudSamples.textContent = v.sampleLabel;
  dom.hudSpread.textContent = v.spreadLabel;
  dom.hudLifecycle.textContent = v.lifecycleLabel;
  dom.hudPose.textContent = v.poseLabel;
  dom.hudMotion.textContent = v.motionLabel;
  dom.hudMotion.style.color = v.motionColor ?? "";
  trailView?.update(trail.points(), v.motionColor);
}

function failStart(err: unknown): void {
  stopFrames?.();
  stopFrames = null;
  perf?.dispose();
  perf = null;
  view?.dispose();
  view = null;
  trailView?.dispose();
  trailView = null;
  trail.clear();
  dom.startButton.disabled = false;
  dom.startButton.textContent = "Start AR";
  dom.startScreen.hidden = false;
  dom.hud.hidden = true;
  dom.capabilityMessage.hidden = false;
  dom.capabilityMessage.textContent =
    err instanceof Error ? err.message : "Failed to start the AR session.";
  console.error("[qr-tracking-demo] AR boot failed; rolled back.", err);
}

async function startAr(): Promise<void> {
  dom.startButton.disabled = true;
  dom.startButton.textContent = "Starting…";

  const seams = getSeams();
  store = createQrDemoStore();
  store.subscribe(renderHud);

  try {
    await seams.initAR(dom.app, {
      onFrameChanged: () => {
        // The old positions live in the old frame: never draw through it.
        trail.clear();
        store?.dispatch(qrFrameChanged());
      },
    });
  } catch (err) {
    failStart(err);
    return;
  }

  const group = seams.getArWorldGroup();
  if (!group) {
    failStart(new Error("AR scene not ready — cannot place debug objects"));
    return;
  }

  view = createQrDebugView(group);
  trailView = createMotionTrailView(group);
  // `?qrperf` (plan 2026-09-23 M2): opt-in stage timings; null when off, and
  // then every hook below is exactly the un-instrumented pipeline.
  const perfParams = parseQrPerfParams(window.location.search);
  perf = mountQrPerf(
    perfParams,
    { log: dom.qrperfLog, copy: dom.qrperfCopy },
    DETECT_INTERVAL_MS,
  );
  // `baseline=1` reproduces the pre-M3 pipeline in the same build (plan
  // DEC-Q7): a full pixel copy per decode, and a capture every interval.
  const baseDetect = seams.createDetect(
    perfParams.baseline
      ? {
          copyPixels: true,
          onCopyMs: (ms) => perf?.instrument.onPixelCopy(ms),
        }
      : undefined,
  );
  const detect = perf ? perf.instrument.wrapDetect(baseDetect) : baseDetect;
  const controller = createQrDemoController({
    detect,
    ...(perf
      ? { solvePose: perf.instrument.wrapSolve(createDefaultSolvePose()) }
      : {}),
    getDepthContext: () => seams.getDepthContext(),
    recordDetection: (event) => {
      if (event.text !== activeText) trail.clear();
      activeText = event.text;
      trail.add(event.timestamp, event.qrPoseWorld.position);
      store?.dispatch(recordQrDetection(event));
    },
    recordSize: (text, estimate) => {
      store?.dispatch(recordQrSizeEstimate({ text, estimate }));
      // Log every lock with the Δt since the previous one — the cadence signal
      // for tuning the throttle + accumulator thresholds on a real device.
      const nowMs = performance.now();
      debugLog.append(
        formatDetectionLine({
          clockMs: nowMs,
          deltaMs: lastLockMs === null ? null : nowMs - lastLockMs,
          text,
          sizeStatus: estimate.status,
          estimateM: estimate.estimateM,
          sampleCount: estimate.sampleCount,
        }),
      );
      lastLockMs = nowMs;
      renderDebugLog();
    },
    updateScene: (pose, sizeM) => {
      // Always update: the view shows the AXIS from the pose alone (so a locked
      // QR is visibly glued immediately) and reveals the CUBE only once a
      // measured size arrives. Previously this was gated on `sizeM !== null`,
      // which withheld even the axis while the depth size was still converging.
      view?.update(pose, sizeM);
    },
    // The overlay shows the FUSED pose (the joint rotation over the window,
    // QR near-frontal pose plan M3b b5) once its gate opens; the controller
    // falls back to the raw frame pose until then. Reads the slice AFTER
    // recordDetection has fed the current frame in.
    resolveStablePose: (text) => {
      if (!store) return null;
      const pose = fusedPose.resolve(text);
      // Once per lock: the ?qrperf report tallies the fused result.
      const last = fusedPose.last(text);
      if (perf && last) {
        // The size state goes with it: the switch log shows whether a
        // "moving" came while the size was still converging (plan §30).
        const size = selectQrSize(store.getState(), text);
        const depth = size
          ? { status: size.status, estimateM: size.estimateM }
          : undefined;
        perf.instrument.onFused(last, depth);
        // The size section (QR size consensus plan S2, log only): parallax
        // assumes a still code, so a turning one is counted, not measured -
        // the turn signal is the size-free check (plan §8).
        const turning = last.motion?.state.includes("turning") ?? false;
        perf.instrument.onSize({
          parallax: turning
            ? null
            : estimateQrSizeFromParallax(
                selectQrFusedEntries(store.getState(), text),
              ),
          turning,
          ...(depth ? { depth } : {}),
        });
      }
      return pose;
    },
    onStatus: (next) => {
      status = next;
      debugLog.append(formatStatusLine(performance.now(), next));
      renderDebugLog();
      renderHud();
    },
    // Option A — single cadence owner: the framework CameraFrameSource already
    // throttles capture to DETECT_INTERVAL_MS, so the controller detects every
    // delivered frame (its scheduler still coalesces in-flight detects). A
    // second equal throttle here would just drop the occasional boundary frame.
    minIntervalMs: 0,
  });

  // The framework CameraFrameSource owns the cadence (Option A).
  stopFrames = seams.startFrameSource((frame) => controller.offerFrame(frame), {
    intervalMs: DETECT_INTERVAL_MS,
    ...(perf ? { onCaptureTiming: captureTimingHook(perf) } : {}),
    // Skip the GPU readback of frames the busy detector would drop anyway.
    ...(perfParams.baseline ? {} : { wantsFrame: () => !controller.isBusy() }),
  });

  dom.startScreen.hidden = true;
  dom.hud.hidden = false;
  status = "scanning";
  renderHud();
}

/** The `?qrperf` capture-timing hook, bound to its instrument. */
function captureTimingHook(
  mounted: MountedQrPerf,
): (timing: CaptureTiming) => void {
  return (timing) => mounted.instrument.onCaptureTiming(timing);
}

async function main(): Promise<void> {
  // The Chromium WebXR camera-access tab-crash workaround is applied by the
  // framework's initAR (on by default) — no manual call needed here.
  renderHud();

  const support = await getSeams().checkSupport();
  // Depth-less but WebXR-capable browsers still run (manual-size fallback), so
  // only a hard WebXR gap blocks; the message is informational otherwise.
  const message = capabilityMessage(support);
  if (!isDemoSupported(support)) {
    dom.startButton.disabled = true;
    dom.capabilityMessage.hidden = false;
    dom.capabilityMessage.textContent = message ?? "";
    return;
  }
  if (message) {
    dom.capabilityMessage.hidden = false;
    dom.capabilityMessage.textContent = message;
  }

  dom.startButton.addEventListener("click", () => {
    void startAr();
  });
}

window.addEventListener("beforeunload", () => {
  stopFrames?.();
  perf?.dispose();
  view?.dispose();
  trailView?.dispose();
});

void main();
