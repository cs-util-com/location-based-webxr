/**
 * The mesh buffer type and its builder.
 *
 * WHY ITS OWN MODULE. `extrude.ts` needs the roof, and `roof.ts` needs the
 * buffer type and the builder — a dependency cycle the repo's `check:cycles`
 * gate caught immediately. Splitting the shared vocabulary out is the fix, and
 * it is the right shape anyway: this file says what a mesh IS, and the two
 * above say how particular meshes are made.
 *
 * @see mesh-data.ts.md
 */

/** A renderable mesh, in the local ENU frame, metres. */
export interface MeshData {
  /**
   * xyz per vertex, metres. **+x is ENU east, +y is UP, +z is ENU NORTH.**
   *
   * Note the last one, because it is the half that is easy to miss: mapping ENU
   * north onto **+z** makes this frame LEFT-handed. three.js and WebXR local-up
   * spaces put north at **−z**, so dropping these buffers into a scene that has
   * been aligned to true north renders the block MIRRORED north/south. It still
   * looks like a plausible city — buildings sit correctly relative to each
   * other — so it reads as a compass or heading bug rather than a frame one.
   *
   * A consumer aligning to true north must negate z (or scale the group by
   * `(1, 1, -1)`). `extrude.ts` compensates for the handedness flip by reversing
   * every winding, which fixes back-face culling only — not the frame.
   *
   * NOT captured by the demo: `building-view.ts` parks a free camera with no
   * north reference, so a mirrored scene is indistinguishable from a correct
   * one there. See `mesh-data.ts.md` for the open question about emitting `-z`
   * instead.
   */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** Triangles emitted. Cheap for a consumer to budget against. */
  readonly triangleCount: number;
  /**
   * Degenerate ears the triangulator was forced to cut.
   *
   * Non-zero means the footprint was malformed. Surfaced so a consumer can
   * count how much of the real planet is broken rather than silently rendering
   * slivers.
   */
  readonly forcedEars: number;
}

/**
 * Accumulates vertices and triangles, then freezes into typed arrays.
 *
 * No vertex sharing: each wall quad gets its own four vertices so the normals
 * are flat rather than smeared across a corner. Buildings are all hard edges,
 * so shared vertices would mean either wrong shading or a split pass to undo it.
 */
export class MeshBuilder {
  private readonly px: number[] = [];
  private readonly nx: number[] = [];
  private readonly idx: number[] = [];

  vertex(
    x: number,
    y: number,
    z: number,
    nxv: number,
    nyv: number,
    nzv: number,
  ): number {
    const index = this.px.length / 3;
    this.px.push(x, y, z);
    this.nx.push(nxv, nyv, nzv);
    return index;
  }

  triangle(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Appends another mesh, re-basing its indices. */
  append(mesh: MeshData): void {
    const offset = this.px.length / 3;
    for (let i = 0; i < mesh.positions.length; i++) {
      this.px.push(mesh.positions[i] as number);
      this.nx.push(mesh.normals[i] as number);
    }
    for (const index of mesh.indices) this.idx.push(index + offset);
  }

  build(forcedEars = 0): MeshData {
    return {
      positions: new Float32Array(this.px),
      normals: new Float32Array(this.nx),
      indices: new Uint32Array(this.idx),
      triangleCount: this.idx.length / 3,
      forcedEars,
    };
  }
}
