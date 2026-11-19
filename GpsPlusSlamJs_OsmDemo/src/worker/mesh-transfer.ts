/**
 * The transfer list of a worker reply (`demo-worker.ts` posts with it):
 * which buffers move to the page instead of being copied. A module of its
 * own so the list is testable without starting a worker.
 *
 * @see mesh-transfer.ts.md
 */

import type { UpdateResult, WorkerCallKind } from "./protocol.js";

/**
 * Buffers to hand over rather than copy, per request kind.
 *
 * WHY PER KIND AND NOT A BLANKET SWEEP. Transferring **detaches** a buffer on this
 * side, so it may only be done for data the worker does not keep:
 *
 * - **update**: the mesh comes from `chunkMeshes`, freshly allocated per call and
 *   never retained here, so handing it over is free. This is the payload that
 *   matters: the building geometry is the largest thing that crosses.
 * - **terrain**: the field's `heights` MUST NOT be transferred. That same object
 *   stays in module state for the next mesh build, and detaching it would leave the
 *   worker holding a zero-length array. Buildings would silently drop to flat ground
 *   on the following refresh, which reads as a terrain bug rather than as a
 *   memory-ownership one.
 * - **init / explain**: small plain objects with nothing worth transferring.
 *
 * Until this existed the package's `Float32Array` output was only transfer**able**,
 * while four docstrings claimed the transfer itself as the payoff of the worker
 * split: the docs asserted a property the code lacked.
 */
export function transferablesOf(
  kind: WorkerCallKind,
  value: unknown,
): Transferable[] {
  if (kind !== "update") return [];
  const update = (value as UpdateResult | undefined)?.mesh;
  // A REGIONS-ONLY REPLY TRANSFERS NOTHING. It has no `buildings` or
  // `plates` to hand over, and the slab buffers are not in this list either -
  // which is worth knowing rather than assuming: the win of such a reply is the BUILD
  // being skipped, not a transfer being saved.
  if (update === undefined || update.kind !== "full") return [];
  const mesh = update.mesh;
  // PER CHUNK. The layers are lists now, so the transfer list is a
  // flatMap rather than six fields - and it must stay complete: a buffer left
  // out is silently COPIED instead of moved, which is invisible except as the
  // thing this list exists to avoid.
  return [...mesh.buildings, ...mesh.plates, ...mesh.roads]
    .flatMap((chunk) => [
      chunk.mesh.positions.buffer,
      chunk.mesh.normals.buffer,
      chunk.mesh.indices.buffer,
      // `colors` IS DELIBERATELY ABSENT, and the omission is not the oversight
      // it looks like. Adding it on 2026-08-16 turned the demo's e2e suite red
      // - so something downstream re-reads that buffer after the post, and
      // transferring it detaches the worker's copy. Reverted rather than chased,
      // and filed; the comment above is about buffers that are safe to move.
      //
      // The two shell attributes ARE transferred: they are new, and nothing but
      // the AR material reads them. The optional entries rely on the
      // `instanceof` filter below to drop `undefined`.
      chunk.height01?.buffer,
      chunk.featureRand?.buffer,
      // THE LOOK COLOURS of a time-of-day build (`look-choice.ts`): one code
      // buffer per look, fresh per build and kept by nothing in the worker,
      // so moved like the geometry; copying four of them would be the
      // time-of-day build's whole extra cost on this boundary.
      ...(chunk.lookColours ?? []).map((codes) => codes.buffer),
    ])
    .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}
