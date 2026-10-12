/**
 * The atmosphere's GPU half: three look-up-table passes, the environment bake,
 * and the readbacks. Deliberately THIN: every decision (when to render what,
 * which scale, what to dispose when) lives in `sky-atmosphere.ts`, which talks
 * to this through the {@link AtmosphereDevice} interface, so that bookkeeping
 * is testable without a GPU (lessons-learned: keep decision logic out of
 * device layers).
 *
 * WHAT CAN ONLY BE CHECKED IN A BROWSER lives here: shader compilation, render
 * targets, readbacks. The look-dev page's smoke test exercises all of it,
 * including a parity readback of LUT texels against the CPU model.
 *
 * @see atmosphere-luts.ts.md
 */

import * as THREE from 'three';

import {
  ATMOSPHERE_LUT_VERTEX_GLSL,
  MULTI_SCATTERING_LUT_FRAGMENT_GLSL,
  SKY_VIEW_LUT_FRAGMENT_GLSL,
  TRANSMITTANCE_LUT_FRAGMENT_GLSL,
} from './atmosphere-glsl.js';
import {
  MULTI_SCATTERING_LUT_SIZE,
  SKY_VIEW_LUT_SIZE,
  TRANSMITTANCE_LUT_SIZE,
} from './atmosphere-lut-mapping.js';

/** The three LUTs, in dependency order. */
export type LutName = 'transmittance' | 'multiScattering' | 'skyView';

/** The uniforms every atmosphere program shares, as ONE set of objects. */
export interface AtmosphereUniforms {
  [name: string]: THREE.IUniform;
  atmMieExtinction: THREE.IUniform<number>;
  atmTransmittanceLut: THREE.IUniform<THREE.Texture>;
  atmMultiScatteringLut: THREE.IUniform<THREE.Texture>;
  atmSkyViewLut: THREE.IUniform<THREE.Texture>;
  atmSunDirection: THREE.IUniform<THREE.Vector3>;
  atmSunCosZenith: THREE.IUniform<number>;
  atmObserverRadius: THREE.IUniform<number>;
  atmRadianceToScene: THREE.IUniform<number>;
}

/**
 * An asynchronous read of the sky-view LUT in flight (the staged rebuild):
 * the GPU copies into a buffer behind a fence, and the CPU takes it on a
 * later frame without waiting.
 */
export interface SkyViewRead {
  /** Whether the copy has finished; never blocks. */
  ready(): boolean;
  /** The LUT as `readSkyView` returns it (null: the read failed). Once. */
  take(): Float32Array | null;
  /** Releases the buffer and the fence without reading. */
  cancel(): void;
}

/** What `SkyAtmosphere` needs from the GPU. */
export interface AtmosphereDevice {
  /** Whether float colour buffers can be rendered to. False → no sky. */
  readonly supported: boolean;
  readonly transmittance: THREE.Texture;
  readonly multiScattering: THREE.Texture;
  readonly skyView: THREE.Texture;
  /** Render one LUT with the shared uniforms. */
  render(lut: LutName, uniforms: AtmosphereUniforms): void;
  /** Render `scene` (the sun-less sky) into a cube and PMREM it. */
  bakeEnvironment(scene: THREE.Scene): {
    texture: THREE.Texture;
    dispose(): void;
  };
  /**
   * Like `bakeEnvironment`, into the device's ONE reused target (the staged
   * rebuild: no allocation per bake). The returned `dispose` does nothing;
   * the device's own `dispose` frees the target. Optional: without it the
   * staged rebuild bakes a new target each time.
   */
  bakeEnvironmentReused?(scene: THREE.Scene): {
    texture: THREE.Texture;
    dispose(): void;
  };
  /** The whole sky-view LUT as RGBA floats, row-major from v = 0 (zenith). */
  readSkyView(): Float32Array | null;
  /**
   * Starts an asynchronous read of the sky-view LUT (null: the device cannot,
   * and the staged rebuild reads synchronously instead). Optional, for the
   * same reason.
   */
  beginSkyViewRead?(): SkyViewRead | null;
  /** One LUT texel, RGB, decoded to floats. For the parity check. */
  readTexel(lut: LutName, x: number, y: number): [number, number, number];
  /** Subscribe to WebGL context restores; returns the unsubscribe. */
  onContextRestored(listener: () => void): () => void;
  dispose(): void;
}

const SIZES: Record<LutName, { width: number; height: number }> = {
  transmittance: TRANSMITTANCE_LUT_SIZE,
  multiScattering: MULTI_SCATTERING_LUT_SIZE,
  skyView: SKY_VIEW_LUT_SIZE,
};

const FRAGMENTS: Record<LutName, string> = {
  transmittance: TRANSMITTANCE_LUT_FRAGMENT_GLSL,
  multiScattering: MULTI_SCATTERING_LUT_FRAGMENT_GLSL,
  skyView: SKY_VIEW_LUT_FRAGMENT_GLSL,
};

/** Environment cube face size. Small: the PMREM blurs it anyway. */
const ENVIRONMENT_CUBE_SIZE = 64;

/** Whether the renderer can render to (and read) half-float colour buffers. */
function supportsFloatTargets(renderer: THREE.WebGLRenderer): boolean {
  const ext = renderer.extensions;
  return (
    ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float')
  );
}

/** The WebGL implementation of {@link AtmosphereDevice}. */
export class WebGlAtmosphereDevice implements AtmosphereDevice {
  readonly supported: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly targets: Record<LutName, THREE.WebGLRenderTarget>;
  private readonly materials: Partial<Record<LutName, THREE.ShaderMaterial>> =
    {};
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    0,
    1
  );
  private readonly cubeTarget: THREE.WebGLCubeRenderTarget;
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  /** The staged rebuild's one environment target (`bakeEnvironmentReused`). */
  private reusedEnvironment: THREE.WebGLRenderTarget | undefined;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.supported = supportsFloatTargets(renderer);
    const make = (lut: LutName) =>
      new THREE.WebGLRenderTarget(SIZES[lut].width, SIZES[lut].height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        generateMipmaps: false,
      });
    this.targets = {
      transmittance: make('transmittance'),
      multiScattering: make('multiScattering'),
      skyView: make('skyView'),
    };
    // One triangle covering the viewport: no diagonal seam, fewer fragments
    // than a two-triangle quad.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
    );
    this.quad = new THREE.Mesh(geometry);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(ENVIRONMENT_CUBE_SIZE, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
    });
    this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.cubeTarget);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  get transmittance(): THREE.Texture {
    return this.targets.transmittance.texture;
  }
  get multiScattering(): THREE.Texture {
    return this.targets.multiScattering.texture;
  }
  get skyView(): THREE.Texture {
    return this.targets.skyView.texture;
  }

  render(lut: LutName, uniforms: AtmosphereUniforms): void {
    let material = this.materials[lut];
    if (material === undefined) {
      material = new THREE.ShaderMaterial({
        vertexShader: ATMOSPHERE_LUT_VERTEX_GLSL,
        fragmentShader: FRAGMENTS[lut],
        uniforms,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.materials[lut] = material;
    }
    this.quad.material = material;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.targets[lut]);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.setRenderTarget(previous);
  }

  bakeEnvironment(scene: THREE.Scene): {
    texture: THREE.Texture;
    dispose(): void;
  } {
    this.cubeCamera.update(this.renderer, scene);
    const target = this.pmrem.fromCubemap(this.cubeTarget.texture);
    return { texture: target.texture, dispose: () => target.dispose() };
  }

  /**
   * The first bake allocates through PMREM (its ping-pong target exists only
   * after an allocating call); every later one renders into that target.
   */
  bakeEnvironmentReused(scene: THREE.Scene): {
    texture: THREE.Texture;
    dispose(): void;
  } {
    this.cubeCamera.update(this.renderer, scene);
    this.reusedEnvironment =
      this.reusedEnvironment === undefined
        ? this.pmrem.fromCubemap(this.cubeTarget.texture)
        : this.pmrem.fromCubemap(
            this.cubeTarget.texture,
            this.reusedEnvironment
          );
    return { texture: this.reusedEnvironment.texture, dispose: () => {} };
  }

  readSkyView(): Float32Array | null {
    const { width, height } = SIZES.skyView;
    return this.readRegion('skyView', 0, 0, width, height);
  }

  /**
   * The sky-view LUT copied into a pixel-pack buffer behind a fence; read on
   * a later frame once the fence is signalled, so the CPU never waits for
   * the GPU. The same read types as `readRegion` (FLOAT when guaranteed,
   * else HALF_FLOAT, `gl.getError()` deciding). Not three's
   * `readRenderTargetPixelsAsync`: it takes three's half-float read path,
   * which `readRegion` explains is avoided.
   */
  beginSkyViewRead(): SkyViewRead | null {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const { width, height } = SIZES.skyView;
    const float = this.renderer.extensions.has('EXT_color_buffer_float');
    const count = width * height * 4;
    const buffer = gl.createBuffer();
    if (buffer === null) return null;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.targets.skyView);
    while (gl.getError() !== gl.NO_ERROR) {
      // drain errors raised by earlier, unrelated calls
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(
      gl.PIXEL_PACK_BUFFER,
      count * (float ? 4 : 2),
      gl.STREAM_READ
    );
    gl.readPixels(
      0,
      0,
      width,
      height,
      gl.RGBA,
      float ? gl.FLOAT : gl.HALF_FLOAT,
      0
    );
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const failed = gl.getError() !== gl.NO_ERROR;
    this.renderer.setRenderTarget(previous);
    const fence = failed
      ? null
      : gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (fence !== null) gl.deleteSync(fence);
      gl.deleteBuffer(buffer);
    };
    return {
      ready: () =>
        released ||
        fence === null ||
        gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED,
      take: () => {
        if (released || fence === null) {
          release();
          return null;
        }
        const raw = float ? new Float32Array(count) : new Uint16Array(count);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, raw);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const ok = gl.getError() === gl.NO_ERROR;
        release();
        if (!ok) return null;
        if (raw instanceof Float32Array) return raw;
        const floats = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          floats[i] = THREE.DataUtils.fromHalfFloat(raw[i]!);
        }
        return floats;
      },
      cancel: release,
    };
  }

  readTexel(lut: LutName, x: number, y: number): [number, number, number] {
    const rgba = this.readRegion(lut, x, y, 1, 1);
    // NaN, not zeros, on failure: the parity check must fail loudly.
    return rgba
      ? [rgba[0]!, rgba[1]!, rgba[2]!]
      : [Number.NaN, Number.NaN, Number.NaN];
  }

  /**
   * A block of a half-float LUT as floats, or null if the driver refused the
   * read. A synchronous GPU readback, acceptable once per sun change.
   *
   * WHY NOT `readRenderTargetPixels`: for a HalfFloat target three asks for
   * `readPixels(RGBA, HALF_FLOAT)`, which WebGL2 only allows when the
   * driver's implementation-defined read type says so. SwiftShader does;
   * a phone GPU may not, and then the read fails with a GL error and no
   * exception, leaving zeros (review finding 5). With
   * `EXT_color_buffer_float`, `readPixels(RGBA, FLOAT)` is GUARANTEED for
   * float colour buffers, so that is used when available; otherwise the
   * half-float read is tried, and either way `gl.getError()` decides.
   */
  private readRegion(
    lut: LutName,
    x: number,
    y: number,
    width: number,
    height: number
  ): Float32Array | null {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.targets[lut]);
    try {
      while (gl.getError() !== gl.NO_ERROR) {
        // drain errors raised by earlier, unrelated calls
      }
      let floats: Float32Array;
      if (this.renderer.extensions.has('EXT_color_buffer_float')) {
        floats = new Float32Array(width * height * 4);
        gl.readPixels(x, y, width, height, gl.RGBA, gl.FLOAT, floats);
      } else {
        const halves = new Uint16Array(width * height * 4);
        gl.readPixels(x, y, width, height, gl.RGBA, gl.HALF_FLOAT, halves);
        floats = new Float32Array(halves.length);
        for (let i = 0; i < halves.length; i++) {
          floats[i] = THREE.DataUtils.fromHalfFloat(halves[i]!);
        }
      }
      return gl.getError() === gl.NO_ERROR ? floats : null;
    } finally {
      this.renderer.setRenderTarget(previous);
    }
  }

  onContextRestored(listener: () => void): () => void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextrestored', listener);
    return () => canvas.removeEventListener('webglcontextrestored', listener);
  }

  dispose(): void {
    for (const target of Object.values(this.targets)) target.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.quad.geometry.dispose();
    this.cubeTarget.dispose();
    this.reusedEnvironment?.dispose();
    this.pmrem.dispose();
  }
}
