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

/**
 * One vector turned about X, then Y, then Z — all right-handed.
 *
 * A FREE FUNCTION rather than three branches inside `place`, which the
 * complexity rule flagged the moment Z was added for D's leaning headstones.
 * Each axis is a no-op at zero, so an unrotated transform costs three
 * comparisons and nothing else — which matters because every non-POI mesh in
 * the package passes through the same call.
 */
function rotated(
  v: readonly [number, number, number],
  rx: number,
  ry: number,
  rz: number,
): [number, number, number] {
  let [x, y, z] = v;
  if (rx !== 0) {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (ry !== 0) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (rz !== 0) {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}

/**
 * Smallest capacity a growing buffer is given, in elements.
 *
 * 96 floats is 32 vertices — one `box`, which is the smallest thing any emitter
 * here builds. Small enough that the thousands of transient POI meshes do not
 * over-allocate, large enough that none of them grows at all.
 */
const INITIAL_CAPACITY = 96;

/**
 * `array` with room for `extra` more elements past `len`, doubling as needed.
 *
 * Returns the SAME array when it already fits, so the common path is one length
 * comparison. Capacity doubles rather than growing to fit, which is what makes
 * `n` appends cost `O(n)` amortised instead of `O(n²)`; a single append larger
 * than the current capacity (a whole mesh arriving through `append`) doubles
 * until it fits rather than allocating exactly, so a run of large appends does
 * not reallocate on every one.
 *
 * @see grownU32 for the index-buffer twin — two functions rather than one
 * generic over the constructor, because the generic version needs a cast at
 * every call site to keep the element type, which costs more clarity than the
 * duplication does.
 */
function grownF32(
  array: Float32Array,
  len: number,
  extra: number,
): Float32Array {
  const needed = len + extra;
  if (needed <= array.length) return array;
  let capacity = array.length === 0 ? INITIAL_CAPACITY : array.length;
  while (capacity < needed) capacity *= 2;
  const grown = new Float32Array(capacity);
  grown.set(array.subarray(0, len));
  return grown;
}

/** {@link grownF32} for the `Uint32Array` index buffer. */
function grownU32(array: Uint32Array, len: number, extra: number): Uint32Array {
  const needed = len + extra;
  if (needed <= array.length) return array;
  let capacity = array.length === 0 ? INITIAL_CAPACITY : array.length;
  while (capacity < needed) capacity *= 2;
  const grown = new Uint32Array(capacity);
  grown.set(array.subarray(0, len));
  return grown;
}

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
 *
 * **THE ACCUMULATORS ARE GROWABLE TYPED ARRAYS, AND THAT IS A MEASURED CHOICE.**
 * They were `number[]` with one `push` per element until 2026-08-22, so every
 * float made the trip float32 → boxed double → float32 and merging one chunk's
 * buildings ran ~5.6 million `push` calls. A `--cpu-prof` of the demo's whole
 * `buildMesh` ranked this class first at **20.6 % of sampled CPU** — `build`
 * 11.3 %, `append` 6.5 %, `vertex` 2.9 % — ahead of the ear-clipping quadratic
 * at 8.9 %, plus a share of the 7.7 % spent in GC. Writing into pre-sized
 * buffers and letting `append` do whole-array `set()` copies took `mergeMeshes`
 * down **66 %** and the demo's whole mesh build down **24 %**, with
 * byte-identical output. See `mesh-data.ts.md` for the full numbers and
 * `mesh-data.bench.ts` for the instrument.
 */
export class MeshBuilder {
  /**
   * Positions and normals, in lockstep, with `pxLen` floats written.
   *
   * **TYPED AND GROWN BY DOUBLING, not `number[]` with `push`** — see
   * {@link grownF32} and the class docstring's cost note. The two share one
   * length because every write path appends to both.
   */
  private px: Float32Array = new Float32Array(0);
  private nx: Float32Array = new Float32Array(0);
  private pxLen = 0;
  private idx: Uint32Array = new Uint32Array(0);
  private idxLen = 0;
  /**
   * Per-vertex RGB, created LAZILY on the first paint.
   *
   * `undefined` until something is actually painted, so an unpainted mesh
   * allocates nothing — see `MeshData.colours` for why that matters on the
   * chunk-meshing path.
   *
   * **Its own length**, rather than deriving from `pxLen`, because `append`
   * deliberately writes the colours BEFORE the positions — the two are briefly
   * out of step and that ordering is what keeps the backfill correct.
   */
  private cx: Float32Array | undefined;
  private cxLen = 0;
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
  private ensureColours(): void {
    if (this.cx !== undefined) return;
    // One RGB triple per vertex written so far, i.e. exactly as many floats as
    // `positions` has.
    const colours = new Float32Array(Math.max(INITIAL_CAPACITY, this.pxLen));
    // WHITE, NOT THE CURRENT COLOUR. Vertices written before the first paint
    // were meant to be the model's own colour, and white is the identity
    // under `vertexColors`. Backfilling with the new colour instead would
    // retro-paint faces the author had already finished.
    colours.fill(1, 0, this.pxLen);
    this.cx = colours;
    this.cxLen = this.pxLen;
  }

  /**
   * How a part is placed: rotated about its own origin, then offset.
   *
   * ROTATE-THEN-TRANSLATE, in that order, matching the `Matrix4` the house-style
   * prototype composes. The other order swings a part around the MODEL origin
   * instead of its own, which puts a tilted board a metre from where its source
   * has it — geometry that looks deliberate and is simply misplaced.
   */
  private transforms: {
    rotateX?: number;
    rotateY?: number;
    rotateZ?: number;
    x?: number;
    y?: number;
    z?: number;
  }[] = [];

  /**
   * Places every following `vertex` under a rotation and offset (§4, DEC-R6-26).
   *
   * WHY THE BUILDER AND NOT EACH PRIMITIVE. The house style places parts with a
   * full transform and 13 of its 52 builders use one; putting it here gives
   * every primitive rotation at once, with no signature changes and no second
   * copy of the arithmetic. It is also the same shape as the source, which is
   * what keeps the remaining ports mechanical.
   *
   * **Costs nothing when unused, and that is tested rather than assumed.** With
   * an empty stack `vertex` takes the identical path it always did, so
   * buildings, roads, plates and slabs are bit-for-bit unchanged.
   */
  pushTransform(transform: {
    rotateX?: number;
    rotateY?: number;
    rotateZ?: number;
    x?: number;
    y?: number;
    z?: number;
  }): void {
    this.transforms.push(transform);
  }

  /** Ends the innermost `pushTransform`. */
  popTransform(): void {
    this.transforms.pop();
  }

  /** Applies the active transform to a direction or a point, in ENU. */
  private place(
    x: number,
    y: number,
    z: number,
    isPoint: boolean,
  ): [number, number, number] {
    let v: [number, number, number] = [x, y, z];
    // Innermost last, so an outer transform composes over an inner one the way
    // a nested matrix stack does.
    for (let i = this.transforms.length - 1; i >= 0; i--) {
      const t = this.transforms[i] as (typeof this.transforms)[number];
      v = rotated(v, t.rotateX ?? 0, t.rotateY ?? 0, t.rotateZ ?? 0);
      // A NORMAL IS A DIRECTION, so it rotates but never translates. Offsetting
      // it would leave a unit vector pointing at wherever the part happens to
      // sit, which shades every tilted part as though lit from the origin.
      if (isPoint) {
        v = [v[0] + (t.x ?? 0), v[1] + (t.y ?? 0), v[2] + (t.z ?? 0)];
      }
    }
    return v;
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nxv: number,
    nyv: number,
    nzv: number,
  ): number {
    const index = this.pxLen / 3;
    // THE IDENTITY PATH IS THE ORIGINAL PATH, byte for byte. Every non-POI mesh
    // in the package builds with an empty stack, and routing those through the
    // rotation arithmetic would drift each coordinate by a rounding error that
    // no test names and every pixel assertion eventually feels.
    if (this.transforms.length > 0) {
      [x, y, z] = this.place(x, y, z, true);
      [nxv, nyv, nzv] = this.place(nxv, nyv, nzv, false);
    }
    // ENU north arrives as +z and is stored as -z: emitters work in the ENU
    // frame, the buffers are in the RIGHT-HANDED render frame. See the class
    // docstring for why the reflection also forces the winding reversal below.
    const at = this.pxLen;
    // MEASURED AND NOT TAKEN: hoisting the capacity test inline here, and
    // calling `grownF32` only on a miss, is worth −0.2 % on `buildBuildings`.
    // A 2026-08-22 profile made it look like a 21 % lever (`grownF32` 15.2 %
    // of that builder, `grownU32` 5.5 %); it is not, and the sampler's
    // attribution to a tiny always-taken call is what to distrust. See
    // `mesh-data.ts.md`.
    this.px = grownF32(this.px, at, 3);
    this.nx = grownF32(this.nx, at, 3);
    this.px[at] = x;
    this.px[at + 1] = y;
    this.px[at + 2] = -z;
    this.nx[at] = nxv;
    this.nx[at + 1] = nyv;
    this.nx[at + 2] = -nzv;
    this.pxLen = at + 3;
    if (this.cx !== undefined) {
      const [r, g, b] = this.current ?? [1, 1, 1];
      const colours = grownF32(this.cx, this.cxLen, 3);
      colours[this.cxLen] = r;
      colours[this.cxLen + 1] = g;
      colours[this.cxLen + 2] = b;
      this.cx = colours;
      this.cxLen += 3;
    }
    return index;
  }

  triangle(a: number, b: number, c: number): void {
    // Reversed because `vertex` reflects. For a reflection M with det(M) = -1,
    // cross(Mu, Mv) = -M(u x v) — so mirroring alone would leave every triangle
    // wound against its own normal, lit correctly and culled backwards.
    const at = this.idxLen;
    this.idx = grownU32(this.idx, at, 3);
    this.idx[at] = a;
    this.idx[at + 1] = c;
    this.idx[at + 2] = b;
    this.idxLen = at + 3;
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
    // POSITIONS AND NORMALS ARE ONE BUFFER PAIR HERE, so a mesh whose normals
    // do not match its positions would silently misalign every vertex after the
    // join. The old element-wise loop turned that into `NaN` normals instead —
    // equally wrong and harder to trace — so it is rejected at the boundary.
    if (mesh.normals.length !== mesh.positions.length) {
      throw new Error(
        `MeshBuilder.append: normals (${mesh.normals.length}) must match positions (${mesh.positions.length})`,
      );
    }
    const offset = this.pxLen / 3;
    const vertexCount = mesh.positions.length / 3;
    // COLOURS FIRST, BEFORE THE POSITIONS ARE WRITTEN. `ensureColours` backfills
    // from the CURRENT vertex count, so running it afterwards would count the
    // incoming vertices as needing white and then append their real colours on
    // top — leaving the array longer than the positions by exactly the appended
    // mesh. Caught by the alignment test, which is why it exists.
    if (mesh.colours !== undefined) {
      // The SAME cursor invariant as the normals guard above: `cxLen` and
      // `pxLen` are independent write cursors, so a colours array that is not
      // exactly positions-length desynchronises them permanently — every later
      // vertex writes its RGB at the wrong offset, and three.js reads the
      // mismatched buffer as a short/long attribute rather than an error.
      if (mesh.colours.length !== mesh.positions.length) {
        throw new Error(
          `MeshBuilder.append: colours (${mesh.colours.length}) must match positions (${mesh.positions.length})`,
        );
      }
      this.ensureColours();
      const colours = grownF32(
        this.cx as Float32Array,
        this.cxLen,
        mesh.colours.length,
      );
      colours.set(mesh.colours, this.cxLen);
      this.cx = colours;
      this.cxLen += mesh.colours.length;
    } else if (this.cx !== undefined) {
      // Already painted, and the incoming mesh is not — white keeps the arrays
      // the same length, and renders it as the model's own colour.
      const needed = vertexCount * 3;
      const colours = grownF32(this.cx, this.cxLen, needed);
      colours.fill(1, this.cxLen, this.cxLen + needed);
      this.cx = colours;
      this.cxLen += needed;
    }
    // WHOLE-ARRAY COPIES. Both sides are already `Float32Array`, so this is a
    // memcpy rather than the element-by-element round trip through boxed
    // doubles that made `append` 6.5 % of the demo's whole mesh build.
    this.px = grownF32(this.px, this.pxLen, mesh.positions.length);
    this.px.set(mesh.positions, this.pxLen);
    this.nx = grownF32(this.nx, this.pxLen, mesh.normals.length);
    this.nx.set(mesh.normals, this.pxLen);
    this.pxLen += mesh.positions.length;
    // The indices are the one buffer that cannot be copied wholesale: each is
    // re-based onto this builder's vertex numbering.
    this.idx = grownU32(this.idx, this.idxLen, mesh.indices.length);
    for (let i = 0; i < mesh.indices.length; i++) {
      this.idx[this.idxLen + i] = (mesh.indices[i] as number) + offset;
    }
    this.idxLen += mesh.indices.length;
  }

  build(forcedEars = 0): MeshData {
    // `slice` on a typed array copies exactly the written prefix, so the
    // returned buffers are the mesh's true size and none of the spare capacity
    // is transferred to a worker or retained by the scene.
    return {
      positions: this.px.slice(0, this.pxLen),
      normals: this.nx.slice(0, this.pxLen),
      indices: this.idx.slice(0, this.idxLen),
      triangleCount: this.idxLen / 3,
      forcedEars,
      ...(this.cx === undefined
        ? {}
        : { colours: this.cx.slice(0, this.cxLen) }),
    };
  }
}
