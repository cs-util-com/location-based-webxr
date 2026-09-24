/**
 * Scene-graph node name constants.
 *
 * Used in .name assignments and getObjectByName() lookups.
 * Centralised here (R4) so a rename is a single-point change
 * with compile-time safety instead of grep-and-replace.
 */

export const SCENE_NODE = {
  /** Basis-change node (WebXR → NUE coordinate system) */
  BASIS_CHANGE: 'webxr-to-nue',
  /** Camera follower node (GPS-world-aligned, tracks camera position) */
  CAMERA_FOLLOWER: 'camera-follower',
  /** The AR scene's ambient light (`createSceneHierarchy`). */
  AMBIENT_LIGHT: 'ar-ambient-light',
  /**
   * The AR scene's directional shading light, fixed at (0, 10, 5); the sun
   * shadow prototype drives it as the sun and restores it (plan 2026-09-23-2343).
   */
  SUN_LIGHT: 'ar-sun-light',
} as const;
