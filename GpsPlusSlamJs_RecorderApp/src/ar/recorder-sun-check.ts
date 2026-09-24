/**
 * The recorder's glue for the AR sun check (sun-overlay plan
 * 2026-09-24-0100-ar-sun-overlay-heading-check-plan.md, M3): builds the
 * `SunCheckUi` over the framework controller with the recorder's store
 * handle, and ties it to the AR session's life.
 */

import type * as THREE from 'three';

import { alignmentYawDeg } from 'gps-plus-slam-app-framework/ar/sun-check-geometry';
import {
  startSunCheck,
  type SunCheck,
  type SunCheckDeps,
} from 'gps-plus-slam-app-framework/ar/sun-check';
import {
  selectAlignmentMatrix,
  selectZeroReference,
} from 'gps-plus-slam-app-framework/state/app-selectors';

import type { RecorderStore } from '../state/recorder-store';
import type { StoreRef } from '../state/store-ref';
import type { ArSessionScope } from '../utils/ar-session-scope';
import {
  createSunCheckUi,
  SUN_SAFETY_NOTE,
  type SunCheckUi,
  type SunCheckUiDeps,
} from './sun-check-ui';
import { createSunSightingRecorder } from './sun-sighting-note';

export interface RecorderSunCheckDeps {
  /** Follows every store swap; read at call time, never captured. */
  readonly storeRef: StoreRef<RecorderStore>;
  /** The `#app` dom-overlay root. */
  readonly appContainer: HTMLElement;
  /** The live session's GPS-world scene root and alignment group. */
  readonly getScene: () => THREE.Object3D | null;
  readonly getArWorldGroup: () => THREE.Object3D | null;
  readonly isStopInProgress: () => boolean;
  readonly isReplaying: () => boolean;
  readonly showToast: SunCheckUiDeps['showToast'];
  readonly confirm: (options: {
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
  /** The framework controller (injected for tests). */
  readonly start?: (deps: SunCheckDeps) => SunCheck;
  /** The check turned itself off (see `SunCheckUiDeps.onEnabledChange`). */
  readonly onEnabledChange?: (enabled: boolean) => void;
}

/** The controller's deps, read from the CURRENT store at every call. */
export function sunCheckStoreReaders(
  storeRef: StoreRef<RecorderStore>
): Pick<SunCheckDeps, 'getZeroReference' | 'getTargetYawDeg'> {
  return {
    getZeroReference: () => {
      const zero = selectZeroReference(storeRef.get().getState());
      // The library's LatLong spells longitude `lon`; the check says `lng`.
      return zero ? { lat: zero.lat, lng: zero.lon } : null;
    },
    getTargetYawDeg: () => {
      const matrix = selectAlignmentMatrix(storeRef.get().getState());
      // `alignmentYawDeg` throws on a degenerate matrix; the controller
      // guards its app callbacks and reads that as "no target".
      return matrix ? alignmentYawDeg(matrix) : null;
    },
  };
}

export function createRecorderSunCheck(deps: RecorderSunCheckDeps): SunCheckUi {
  const start = deps.start ?? startSunCheck;
  return createSunCheckUi({
    root: deps.appContainer,
    startCheck: () => {
      const scene = deps.getScene();
      const arWorldGroup = deps.getArWorldGroup();
      if (!scene || !arWorldGroup) throw new Error('no AR scene');
      return start({
        scene,
        arWorldGroup,
        ...sunCheckStoreReaders(deps.storeRef),
        nowEpochMs: () => Date.now(),
      });
    },
    confirmSafety: () =>
      deps.confirm({
        message: SUN_SAFETY_NOTE,
        confirmLabel: 'I understand',
        cancelLabel: 'Cancel',
      }),
    showToast: deps.showToast,
    recorderAtPress: createSunSightingRecorder({
      getStore: () => deps.storeRef.get(),
      isStopInProgress: deps.isStopInProgress,
      isReplaying: deps.isReplaying,
    }),
    ...(deps.onEnabledChange ? { onEnabledChange: deps.onEnabledChange } : {}),
  });
}

/**
 * Attaches the UI to a live AR session: detached again when the session ends
 * (the framework's session disposers) or when the scope unwinds (re-entry,
 * a failed Enter-AR), whichever comes first.
 */
export function attachSunCheckToSession(
  ui: SunCheckUi,
  scope: ArSessionScope,
  registerSessionDisposer: (dispose: () => void) => () => void
): void {
  ui.attach();
  const unregister = registerSessionDisposer(() => ui.detach());
  scope.add('Sun check', () => {
    unregister();
    ui.detach();
  });
}
