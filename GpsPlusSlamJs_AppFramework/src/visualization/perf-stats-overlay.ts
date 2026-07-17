/**
 * Stats.js performance overlay — an FPS / frame-ms / MB panel row that any
 * consumer can mount over its scene (desktop) or WebXR dom-overlay (AR).
 *
 * Shared framework home for what was two near-identical app copies (the
 * recorder's optional debug toggle and the physics demo's always-on harness).
 * Whether the overlay is shown at all — always, or behind a toggle — is the
 * caller's decision; this module only owns the panel mechanics.
 *
 * mrdoob's Stats.js (bundled with three as `three/addons/libs/stats.module.js`,
 * no extra dependency) shows ONE panel at a time and cycles on tap — unusable
 * at a glance mid-session, so this wrapper mounts one Stats instance per panel
 * and lays them out in a flex row. The MB panel needs the Chrome-only
 * `performance.memory`; it is omitted where unsupported.
 *
 * Read-only instrument: `pointer-events: none` so it never swallows a pointer
 * meant for the scene or the HUD it shares the AR dom-overlay layer with.
 * Callers own the per-frame cadence — call `update()` once per rendered frame
 * (the rAF loop or the XR frame callback) — and must `dispose()` on session
 * teardown so panels never stack across Enter-AR cycles.
 *
 * Both the Stats constructor AND the container factory are injectable: the real
 * Stats builds a `<canvas>` 2D context and `document.createElement` needs a DOM,
 * neither of which a node test environment provides — tests inject plain fakes,
 * so this module is testable without jsdom.
 */

import Stats from 'three/addons/libs/stats.module.js';

/** The subset of the Stats.js API this overlay drives (test-fakeable). */
export interface PerfStatsInstance {
  readonly dom: HTMLElement;
  showPanel(id: number): void;
  update(): void;
}

export interface PerfStatsOverlayOptions {
  /** Injected Stats constructor for tests. Default: real `three/addons` Stats. */
  readonly statsFactory?: () => PerfStatsInstance;
  /**
   * Whether the MB panel's `performance.memory` source exists. Default: probed
   * from the live `performance` object (Chrome-only API).
   */
  readonly memorySupported?: boolean;
  /**
   * Container factory. Default: `document.createElement('div')`. Inject in node
   * unit tests (or any host without a DOM) so no jsdom is required.
   */
  readonly createContainer?: () => HTMLElement;
}

export interface PerfStatsOverlayHandle {
  /** The mounted container element (removed again by `dispose`). */
  readonly dom: HTMLElement;
  /** Number of panels mounted (3, or 2 without `performance.memory`). */
  readonly panelCount: number;
  /** Advance all panels one frame. No-op after `dispose`. */
  update(): void;
  /** Remove the overlay from the DOM. Idempotent. */
  dispose(): void;
}

/** Panel ids in Stats.js: 0 = FPS, 1 = frame ms, 2 = MB (Chrome only). */
const ALL_PANELS = [0, 1, 2] as const;

/** Container class — a stable hook for devtools; no CSS keys off it (styles
 * are inline below), so it carries no layout meaning. */
const CONTAINER_CLASS = 'perf-stats-overlay';

function defaultMemorySupported(): boolean {
  return (
    typeof performance !== 'undefined' &&
    'memory' in (performance as unknown as Record<string, unknown>)
  );
}

/**
 * Mount the perf panels into `parent` and return the drive handle.
 *
 * @param parent - host element; in live AR this must be (inside) the WebXR
 *   dom-overlay root, or the panels cannot composite over the camera view.
 * @throws TypeError when `parent` is not a DOM element (fail fast — a silent
 *   no-op overlay would hide the framerate it exists to show).
 */
export function createPerfStatsOverlay(
  parent: HTMLElement,
  options: PerfStatsOverlayOptions = {}
): PerfStatsOverlayHandle {
  if (!parent || typeof parent.appendChild !== 'function') {
    throw new TypeError('createPerfStatsOverlay: parent must be a DOM element');
  }
  const statsFactory = options.statsFactory ?? (() => new Stats());
  const memorySupported = options.memorySupported ?? defaultMemorySupported();
  const createContainer =
    options.createContainer ?? (() => document.createElement('div'));
  const panels = memorySupported ? ALL_PANELS : ALL_PANELS.slice(0, 2);

  const container = createContainer();
  container.className = CONTAINER_CLASS;
  // Top-right corner; read-only instrument (never intercept pointers). Fixed so
  // it stays put over both a desktop scene and the AR dom-overlay layer.
  container.style.cssText =
    'position:fixed;top:0;right:0;z-index:90;display:flex;pointer-events:none;';

  const instances: PerfStatsInstance[] = [];
  for (const id of panels) {
    const stats = statsFactory();
    stats.showPanel(id);
    // Stats.js pins itself `position:fixed` at the viewport corner; neutralize
    // so the flex row lays the panels out side-by-side.
    stats.dom.style.position = 'relative';
    container.appendChild(stats.dom);
    instances.push(stats);
  }
  parent.appendChild(container);

  let disposed = false;
  return {
    dom: container,
    panelCount: instances.length,
    update(): void {
      if (disposed) return;
      for (const stats of instances) {
        // Isolate per-panel failures: update() runs inside the render/XR frame
        // loop and must never take it down with it.
        try {
          stats.update();
        } catch {
          // Swallow — a broken panel simply stops advancing.
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      container.remove();
    },
  };
}
