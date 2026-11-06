/**
 * Tests for xr-camera-texture module
 *
 * Why these tests matter:
 * Camera texture acquisition is the foundation of the image capture pipeline.
 * This module wraps Three.js's renderer.xr.getCameraTexture() API and pairs
 * the texture with native camera dimensions (width/height) needed for
 * dynamic render target sizing.
 *
 * Historical context: Previously used low-level XRWebGLBinding.getCameraImage()
 * with manual __webglTexture injection. Replaced with Three.js's built-in
 * getCameraTexture() which internally does the same thing but uses the proper
 * ExternalTexture type that Three.js's WebGL backend natively supports.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  acquireCameraTexture,
  type XRCameraLike,
} from './xr-camera-texture.js';

// --- Minimal mocks for Three.js renderer ---

function createMockExternalTexture() {
  return {
    isExternalTexture: true,
    isTexture: true,
    sourceTexture: { __isWebGLTexture: true },
  };
}

function createMockXRCamera(width = 1920, height = 1080): XRCameraLike {
  return { width, height };
}

function createMockRenderer(
  cameraTexture: unknown = createMockExternalTexture()
) {
  return {
    xr: {
      getCameraTexture: vi.fn().mockReturnValue(cameraTexture),
    },
  };
}

describe('xr-camera-texture', () => {
  describe('acquireCameraTexture', () => {
    let mockRenderer: ReturnType<typeof createMockRenderer>;
    let mockXRCamera: XRCameraLike;

    beforeEach(() => {
      mockRenderer = createMockRenderer();
      mockXRCamera = createMockXRCamera();
    });

    /**
     * Why this test matters:
     * The primary path: renderer.xr.getCameraTexture() returns an ExternalTexture,
     * which should be paired with the native camera dimensions for downstream use
     * in the blit capture pipeline.
     */
    it('returns CameraTextureResult with texture and dimensions on success', () => {
      const result = acquireCameraTexture(mockRenderer, mockXRCamera);

      expect(result).not.toBeNull();
      expect(result!.texture).toBeDefined();
      expect(
        (result!.texture as unknown as Record<string, unknown>)
          .isExternalTexture
      ).toBe(true);
      expect(result!.width).toBe(1920);
      expect(result!.height).toBe(1080);
    });

    /**
     * Why this test matters:
     * The function must call renderer.xr.getCameraTexture() with the xrCamera
     * object, not some other API. This verifies the correct Three.js API is used.
     */
    it('calls renderer.xr.getCameraTexture with the xrCamera', () => {
      acquireCameraTexture(mockRenderer, mockXRCamera);

      expect(mockRenderer.xr.getCameraTexture).toHaveBeenCalledWith(
        mockXRCamera
      );
    });

    /**
     * Why this test matters:
     * XRCamera.width and height provide the native camera resolution.
     * These dimensions must be forwarded so the blit render target can
     * match the camera resolution for full-quality captures.
     */
    it('returns camera dimensions from xrCamera', () => {
      const customCamera = createMockXRCamera(1280, 720);

      const result = acquireCameraTexture(mockRenderer, customCamera);

      expect(result).not.toBeNull();
      expect(result!.width).toBe(1280);
      expect(result!.height).toBe(720);
    });

    /**
     * Why this test matters:
     * If getCameraTexture returns undefined (e.g., Three.js hasn't populated
     * its internal cameraAccessTextures map yet), we must return null gracefully.
     */
    it('returns null when getCameraTexture returns undefined', () => {
      mockRenderer.xr.getCameraTexture.mockReturnValue(undefined);

      const result = acquireCameraTexture(mockRenderer, mockXRCamera);

      expect(result).toBeNull();
    });

    /**
     * Why this test matters:
     * If xrCamera is null (camera-access not granted), the function should
     * return null without calling getCameraTexture.
     */
    it('returns null when xrCamera is null', () => {
      const result = acquireCameraTexture(mockRenderer, null);

      expect(result).toBeNull();
      expect(mockRenderer.xr.getCameraTexture).not.toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * If getCameraTexture throws (browser bug, timing issue), the function
     * must catch and return null to avoid crashing the render loop.
     */
    it('returns null when getCameraTexture throws', () => {
      mockRenderer.xr.getCameraTexture.mockImplementation(() => {
        throw new Error('WebXR internal error');
      });

      const result = acquireCameraTexture(mockRenderer, mockXRCamera);

      expect(result).toBeNull();
    });

    /**
     * Why this test matters:
     * Three.js's getCameraTexture() returns the same ExternalTexture instance
     * per camera (cached in cameraAccessTextures map). The function should
     * return whatever Three.js provides without modification.
     */
    it('returns the same texture object that getCameraTexture provides', () => {
      const externalTexture = createMockExternalTexture();
      mockRenderer = createMockRenderer(externalTexture);

      const result = acquireCameraTexture(mockRenderer, mockXRCamera);

      expect(result).not.toBeNull();
      expect(result!.texture).toBe(externalTexture);
    });
  });
});
