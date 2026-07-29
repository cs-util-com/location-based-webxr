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
   * xyz per vertex, metres. **+x is ENU east, +y is UP, −z is ENU NORTH.**
   *
   * A **right-handed** frame, matching three.js and WebXR local-up spaces
   * exactly: drop the buffers into a scene aligned to true north and they are
   * already correct. No transform, no group scale, nothing to remember.
   *
   * It emitted ENU north at **+z** until 2026-07-29, which is left-handed and
   * rendered a north-aligned scene MIRRORED north/south. That bug was
   * particularly nasty and worth remembering: buildings stay correct relative
   * to each other, so the result looks like a plausible city and reads as a
   * compass or heading bug somewhere else entirely. Every test in the suite
   * passed throughout, because they all compared a mesh against ITSELF —
   * winding against its own normals, normals against its own volume — and all
   * of those hold equally well in a mirrored world.
   * `mesh-orientation.test.ts` now pins the frame against the real world.
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
 *
 * **THE ENU→RENDER REFLECTION LIVES HERE, AND ONLY HERE.** Callers hand in ENU
 * coordinates — `(east, up, north)` — and the builder emits the right-handed
 * render frame `(east, up, −north)`. That is a reflection, `diag(1, 1, -1)`,
 * and it is applied in one place on purpose:
 *
 * - A reflection does not commute with the cross product the way a rotation
 *   does. For `det(M) = -1`, `cross(Mu, Mv) = -M(u × v)`. So mirroring the
 *   positions and normals ALONE would leave every triangle wound against its
 *   own normal — lit correctly and culled backwards, the hardest class of
 *   geometry bug to see, because the screenshot a developer reaches for as
 *   proof is exactly the artefact that hides it.
 * - `triangle()` therefore reverses, cancelling that sign. The pair is what
 *   makes the transform correct, and neither half is meaningful alone.
 *
 * Doing it centrally rather than at each of the eleven emission sites is
 * deliberate and was measured against the alternative: the emitters do NOT
 * express their orientation uniformly. Some compensate by index order
 * (`extrude.ts` walls), others by choosing the corner order of `p, q, r, s`
 * (`roof.ts` slopes, which then emit natural `(i0, i1, i2)`). "Delete the
 * reversals" is therefore not a mechanical edit, while one reflection at the
 * boundary is provably complete — no emitter can be missed because no emitter
 * is involved.
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
    // ENU north arrives as +z and is stored as -z: emitters work in the ENU
    // frame, the buffers are in the RIGHT-HANDED render frame. See the class
    // docstring for why the reflection also forces the winding reversal below.
    this.px.push(x, y, -z);
    this.nx.push(nxv, nyv, -nzv);
    return index;
  }

  triangle(a: number, b: number, c: number): void {
    // Reversed because `vertex` reflects. For a reflection M with det(M) = -1,
    // cross(Mu, Mv) = -M(u x v) — so mirroring alone would leave every triangle
    // wound against its own normal, lit correctly and culled backwards.
    this.idx.push(a, c, b);
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
