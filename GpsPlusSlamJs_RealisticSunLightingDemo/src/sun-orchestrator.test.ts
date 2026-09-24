import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createSunOrchestrator } from './sun-orchestrator.js';

describe('sun-orchestrator', () => {
  it('creates the solar orchestrator and attaches ambient light to the scene', () => {
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    scene.add(arWorldGroup);

    const orchestrator = createSunOrchestrator({ scene, arWorldGroup });

    expect(orchestrator.adapter).toBeDefined();
    expect(orchestrator.shadowRig).toBeDefined();
    expect(orchestrator.sunDisc).toBeDefined();
    expect(orchestrator.ambientLight).toBeInstanceOf(THREE.AmbientLight);
    expect(scene.children).toContain(orchestrator.ambientLight);

    orchestrator.dispose();
  });

  it('updates ambient light and shadow rig on incoming sun state sample', () => {
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    scene.add(arWorldGroup);

    const orchestrator = createSunOrchestrator({ scene, arWorldGroup });

    // Set fixed location and time to trigger a deterministic sun state
    orchestrator.adapter.setLocationSource({
      mode: 'fixed',
      latitudeDeg: 52.52,
      longitudeDeg: 13.405,
    });
    orchestrator.adapter.setTimeSource({
      mode: 'fixed',
      instant: new Date('2026-06-21T12:00:00Z'), // Midday summer
    });

    const state = orchestrator.adapter.getState();
    expect(state.status).toBe('ready');
    if (state.status === 'ready') {
      // In summer noon, ambient light intensity should be daytime level
      expect(orchestrator.ambientLight.intensity).toBeGreaterThan(0.2);
    }

    orchestrator.dispose();
  });

  it('updateFrame delegates to sunDisc only (shadow rig updated in subscription)', () => {
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    scene.add(arWorldGroup);

    const orchestrator = createSunOrchestrator({ scene, arWorldGroup });
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);

    orchestrator.adapter.setLocationSource({
      mode: 'fixed',
      latitudeDeg: 52.52,
      longitudeDeg: 13.405,
    });
    orchestrator.adapter.setTimeSource({
      mode: 'fixed',
      instant: new Date('2026-06-21T12:00:00Z'),
    });

    const updateSunDiscSpy = vi.spyOn(orchestrator.sunDisc, 'update');

    const contentBounds = {
      center: { x: 0, y: 0.5, z: 0 },
      radius: 1.0,
    };

    orchestrator.updateFrame(camera, contentBounds);

    expect(updateSunDiscSpy).toHaveBeenCalled();

    orchestrator.dispose();
  });

  it('cleans up resources and unmounts ambient light upon dispose', () => {
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    scene.add(arWorldGroup);

    const orchestrator = createSunOrchestrator({ scene, arWorldGroup });
    expect(scene.children).toContain(orchestrator.ambientLight);

    orchestrator.dispose();
    expect(scene.children).not.toContain(orchestrator.ambientLight);
  });
});
