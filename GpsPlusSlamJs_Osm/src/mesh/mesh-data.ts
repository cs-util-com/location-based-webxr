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
  /**
   * Per-vertex RGB in 0..1, or **`undefined` when nothing was painted** (§4).
   *
   * OPTIONAL RATHER THAN ALWAYS PRESENT, and that is a cost decision rather
   * than a style one. Buildings, roads, plates and region slabs all build
   * through `MeshBuilder` on the chunk-meshing hot path and none of them paint
   * per face — they are coloured per feature by a separate array the consumer
   * builds. Emitting an array here for them would be one more buffer the size
   * of `positions`, allocated and transferred per chunk, that nothing reads.
   *
   * **The values MULTIPLY the material colour**, which is what three's
   * `vertexColors` does. So white is the identity: an unpainted vertex in a
   * partly-painted mesh renders as the model's own `colour`, unchanged. That is
   * why partial painting is safe and why `paint` can be introduced one face at
   * a time rather than all-or-nothing per model.
   */
  readonly colours?: Float32Array;
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
  /**
   * Per-vertex RGB, created LAZILY on the first paint.
   *
   * `undefined` until something is actually painted, so an unpainted mesh
   * allocates nothing — see `MeshData.colours` for why that matters on the
   * chunk-meshing path.
   */
  private cx: number[] | undefined;
  /** The colour `vertex` applies, or `undefined` while nothing is painted. */
  private current: readonly [number, number, number] | undefined;

  /**
   * Sets the colour every following `vertex` is painted with (§4).
   *
   * STATEFUL RATHER THAN A SEVENTH ARGUMENT to `vertex`, because the emitters
   * paint per FACE: `box` writes four vertices per face through one helper, and
   * threading a colour through every primitive's signature would touch code
   * that has no interest in colour at all. One `paint` before a face is the
   * whole call site.
   *
   * Backfills every vertex written so far with white, so a mesh painted from
   * its third face still has an array aligned to its first.
   */
  paint(packedRgb: number): void {
    this.current = [
      ((packedRgb >> 16) & 0xff) / 255,
      ((packedRgb >> 8) & 0xff) / 255,
      (packedRgb & 0xff) / 255,
    ];
    this.ensureColours();
  }

  /** Creates the colour array if needed, backfilling existing vertices white. */
  private ensureColours(): number[] {
    if (this.cx === undefined) {
      this.cx = [];
      // WHITE, NOT THE CURRENT COLOUR. Vertices written before the first paint
      // were meant to be the model's own colour, and white is the identity
      // under `vertexColors`. Backfilling with the new colour instead would
      // retro-paint faces the author had already finished.
      for (let i = 0; i < this.px.length / 3; i++) this.cx.push(1, 1, 1);
    }
    return this.cx;
  }

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
    if (this.cx !== undefined) {
      const [r, g, b] = this.current ?? [1, 1, 1];
      this.cx.push(r, g, b);
    }
    return index;
  }

  triangle(a: number, b: number, c: number): void {
    // Reversed because `vertex` reflects. For a reflection M with det(M) = -1,
    // cross(Mu, Mv) = -M(u x v) — so mirroring alone would leave every triangle
    // wound against its own normal, lit correctly and culled backwards.
    this.idx.push(a, c, b);
  }

  /**
   * Appends another mesh, re-basing its indices.
   *
   * **COLOURS ARE A THIRD PARALLEL ARRAY AND THIS IS WHERE THEY DESYNCHRONISE.**
   * Either side may be painted or not, so both directions need handling: a
   * painted mesh joining an unpainted one has to backfill the target's existing
   * vertices, and an unpainted mesh joining a painted one has to contribute
   * white for its own. Getting either wrong shifts every colour after the join
   * by the other mesh's vertex count — which paints the wrong faces rather than
   * throwing, and reads as a modelling mistake.
   */
  append(mesh: MeshData): void {
    const offset = this.px.length / 3;
    const vertexCount = mesh.positions.length / 3;
    // COLOURS FIRST, BEFORE THE POSITIONS ARE PUSHED. `ensureColours` backfills
    // from the CURRENT vertex count, so running it after the loop would count
    // the incoming vertices as needing white and then append their real colours
    // on top — leaving the array longer than the positions by exactly the
    // appended mesh. Caught by the alignment test, which is why it exists.
    if (mesh.colours !== undefined) {
      const colours = this.ensureColours();
      for (const value of mesh.colours) colours.push(value);
    } else if (this.cx !== undefined) {
      // Already painted, and the incoming mesh is not — white keeps the arrays
      // the same length, and renders it as the model's own colour.
      for (let i = 0; i < vertexCount; i++) this.cx.push(1, 1, 1);
    }
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
      ...(this.cx === undefined ? {} : { colours: new Float32Array(this.cx) }),
    };
  }
}
