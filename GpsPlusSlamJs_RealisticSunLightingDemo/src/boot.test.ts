import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';
import { createSimpleGeometry } from './object-spawner.js';
import { decideTapPlacement } from './placement.js';
import { createSunOrchestrator } from './sun-orchestrator.js';
import { createStatusPanelViewModel } from './status-panel.js';

describe('boot: headless smoke test', () => {
  it('boots store, spawner, placement, orchestrator and view-model without throwing', () => {
    const store = createSlamAppStore({ storageBackend: new NullStorageBackend() });
    expect(store.getState()).toBeDefined();
    expect(store.getState().recording).toBeDefined();

    const simpleGeometry = createSimpleGeometry();
    expect(simpleGeometry.mesh).toBeInstanceOf(THREE.Group);

    const decision = decideTapPlacement({ hasGpsFix: true, reticleVisible: true });
    expect(decision.kind).toBe('place');

    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    scene.add(arWorldGroup);

    const orchestrator = createSunOrchestrator({ scene, arWorldGroup });
    expect(orchestrator.adapter).toBeDefined();

    const vm = createStatusPanelViewModel(orchestrator.adapter);
    expect(vm.isLiveTime()).toBe(true);

    orchestrator.dispose();
  });
});
