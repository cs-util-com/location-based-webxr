/**
 * XR Camera Texture Acquisition Module
 *
 * Acquires camera frames from WebXR using Three.js's built-in
 * renderer.xr.getCameraTexture() API and pairs the texture with
 * native camera dimensions needed for dynamic render target sizing.
 *
 * How it works internally (Three.js v0.182.0+):
 * - Three.js's WebXRManager creates an XRWebGLBinding lazily via getBinding()
 * - Each XR frame, it calls glBinding.getCameraImage(camera) for each view
 * - Results are wrapped in ExternalTexture (sourceTexture = native WebGLTexture)
 * - getCameraTexture(xrCamera) returns the cached ExternalTexture
 * - Three.js's WebGLTextures handles ExternalTexture natively:
 *     textureProperties.__webglTexture = texture.sourceTexture
 *   so ShaderMaterial uniforms that receive the texture work correctly.
 *
 * Previously this module duplicated the low-level pipeline manually
 * (XRWebGLBinding.getCameraImage + __webglTexture injection hack).
 * Replaced with the Three.js API since it handles the same logic
 * internally and uses the proper ExternalTexture type.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-26-bug-camera-frames-black-2.md (reference tutorial)
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-26-user-feedback.md Issue 5 Phase 2
 */

import type * as THREE from 'three';
import { createLogger } from '../utils/logger';

const log = createLogger('XRCameraTexture');

/**
 * Result from acquireCameraTexture containing the Three.js texture
 * (ExternalTexture returned by Three.js) plus the native camera dimensions.
 */
export interface CameraTextureResult {
  /** Three.js ExternalTexture from renderer.xr.getCameraTexture() */
  texture: THREE.Texture;
  /** Native camera frame width in pixels */
  width: number;
  /** Native camera frame height in pixels */
  height: number;
}

/**
 * Minimal interface for XRCamera — only the properties we use.
 */
export interface XRCameraLike {
  width: number;
  height: number;
}

/**
 * Minimal interface for the parts of THREE.WebGLRenderer we need.
 * Avoids importing the full renderer type in tests.
 */
export interface RendererLike {
  xr: {
    getCameraTexture(xrCamera: unknown): THREE.Texture | undefined;
  };
}

/**
 * Acquire the camera texture for the current XR frame using Three.js's
 * built-in getCameraTexture() API, paired with native camera dimensions.
 *
 * Three.js internally:
 * 1. Creates XRWebGLBinding (lazy, one per session)
 * 2. Calls glBinding.getCameraImage(camera) each frame
 * 3. Wraps in ExternalTexture (sourceTexture = native WebGLTexture)
 * 4. Caches per xrCamera in cameraAccessTextures map
 *
 * This function adds the native camera dimensions (width/height) needed
 * for dynamic render target sizing in the blit capture pipeline.
 *
 * Must be called within the XR animation frame callback.
 *
 * @param renderer - The Three.js WebGLRenderer
 * @param xrCamera - The XRCamera from XRView.camera, or null if unavailable
 * @returns CameraTextureResult, or null if acquisition fails
 */
export function acquireCameraTexture(
  renderer: RendererLike,
  xrCamera: XRCameraLike | null
): CameraTextureResult | null {
  if (!xrCamera) {
    return null;
  }

  try {
    const texture = renderer.xr.getCameraTexture(xrCamera);
    if (!texture) {
      return null;
    }

    return {
      texture,
      width: xrCamera.width,
      height: xrCamera.height,
    };
  } catch (error) {
    log.error('Failed to acquire camera texture:', error);
    return null;
  }
}
