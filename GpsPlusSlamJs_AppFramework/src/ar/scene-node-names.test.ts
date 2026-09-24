/**
 * Scene Node Name Constants Tests
 *
 * Why this test matters: R4 — scene-node names were scattered as raw
 * string literals across 10+ production and test files. These constants
 * provide compile-time safety; a typo becomes a build error instead of
 * a silent null from getObjectByName().
 */

import { describe, it, expect } from 'vitest';
import { SCENE_NODE } from './scene-node-names';

describe('SCENE_NODE', () => {
  it('has stable string values (change here requires scene-graph migration)', () => {
    expect(SCENE_NODE.BASIS_CHANGE).toBe('webxr-to-nue');
    expect(SCENE_NODE.CAMERA_FOLLOWER).toBe('camera-follower');
    expect(SCENE_NODE.AMBIENT_LIGHT).toBe('ar-ambient-light');
    expect(SCENE_NODE.SUN_LIGHT).toBe('ar-sun-light');
  });
});
