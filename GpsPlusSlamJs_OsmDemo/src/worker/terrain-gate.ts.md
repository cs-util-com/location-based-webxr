# `src/worker/terrain-gate.ts`

## Purpose

Holds a mesh build until the DEM grid for **its own position** has landed, so
the terrain load and the scoring refresh can run concurrently (W3, finding
R3-3) without the buildings ending up on the previous position's relief.

## Public API

- `createTerrainGate(options?): TerrainGate`
  - `settle(centre)` — releases everything waiting for that centre and remembers
    it. **Call it in a `finally`.**
  - `waitFor(centre, signal?): Promise<void>` — resolves when that centre has
    settled, when `signal` aborts, or when the timeout elapses. **Never
    rejects.**
  - `options`: `timeoutMs` (default `TERRAIN_WAIT_TIMEOUT_MS`, 15 s) plus
    `setTimer` / `clearTimer`, injected so tests spend no real time. The default
    timeout is 15 s and is deliberately NOT exported — nothing outside should
    branch on it, and a caller that needs a different bound passes `timeoutMs`.
- `needsTerrainFor(held, position): boolean` — whether a build at `position`
  must wait, given the centre the worker's current field belongs to.

## Invariants & assumptions

- ⚠️ **The DATUM is part of a field's identity, not just its position**
  (2026-08-14). A field is defined by where it was sampled AND by what its
  heights are measured from: `terrain-field.ts` uses the window-centre height
  for the desktop view (heights come out as relief around zero) and `−N` for AR
  (heights come out ellipsoidal, ~99 m at Cologne, which is where the fusion
  puts the camera). Two fields at one position with different datums are ~99 m
  apart and are **not** interchangeable, so `GateCentre.undulationM` is in both
  `keyOf` and `needsTerrainFor`.
  - **What it cost while it was missing.** AR entry and AR exit both change the
    datum _without moving the user_, so a position-only comparison answered "no
    new terrain needed" on exactly the two transitions where the held field is
    ~99 m out — and the mesh was built on it. The owner reported flying ~50 m
    above the buildings on first AR entry and landing within ~4 m on the second;
    the second being right is the tell, because by then the AR field was already
    held.
  - **The key had to change with the predicate**, not after it: otherwise an
    AR-entry wait would be released by the desktop field that settled just
    before it — the same mismatch one layer down.
  - `demo-worker.ts` predicted this class of failure ("if the anchor ever gains
    a second mover … this has to key on the frame origin as well … and it is
    silent"). It named the wrong mover: the datum got there before the origin,
    which is **still unkeyed** and remains an open hole.
- **The join is keyed on the POSITION, never on message order (DEC-R3-20).** The
  first design relied on `postMessage` being ordered and the worker's listener
  running each handler synchronously, so that posting `terrain` before `update`
  would guarantee the load was registered first. Both premises are true and the
  conclusion is false: `loadTerrain` is `latestOnly`-wrapped, so while a load is
  in flight a new position only **queues** and posts a microtask later. With the
  terrain cycle busy and the refresh cycle idle — a slow DEM tile behind a fully
  cached refresh — the `update` is posted first. Keying on the centre makes the
  order irrelevant.
- **`waitFor` succeeds for a centre nobody has requested yet.** That is the
  point: the waiter names what it needs and the load can arrive afterwards.
- **The wait is bounded twice**, by the caller's `AbortSignal` and by a timeout,
  because "wait for a message that may never be posted" is what this shape
  risks. Reaching the timeout means a load was dropped in a way nothing
  modelled; the mesh is then built on whatever field is held — degraded, never
  hung.
- **One settled centre is remembered, not a set.** The only question ever asked
  is about the current position, and a growing map of every centre visited would
  be a leak whose entries are never read.
- **Exact coordinate equality, deliberately.** Both sides derive the numbers from
  the same store position, so they are the same doubles. A tolerance would be a
  way to silently accept the previous position's field on a short step — the
  precise failure being guarded.
- **`settle` is called even when the load FAILED or was aborted.** The question
  is "is the terrain resolved for this position?", not "is there relief?" — so a
  DEM outage releases waiters. Otherwise a failed tile becomes a stalled mesh.

## Examples

```ts
const gate = createTerrainGate();

// In the terrain handler. `undulationM` is the geoid undulation for AR and
// `undefined` for the desktop view — settling without it would release an
// AR-entry wait with a window-centre field, ~99 m out.
try {
  return await loadTerrain(field, centre, extentM, spacingM, signal);
} finally {
  gate.settle({ ...centre, undulationM: geoidUndulationM });
}

// In the update handler, immediately before building the mesh. The build states
// the datum it REQUIRES; the held field carries the datum it HAS.
const wanted = { ...position, undulationM: geoidUndulationM };
if (needsTerrainFor(heldCentre, wanted)) {
  await gate.waitFor(wanted, signal);
}
```

## Tests

`terrain-gate.test.ts`. The decisive one is _"waits for a centre that has NOT
been requested yet"_ — it is the case that broke the ordering design and the
reason this module exists in this shape. The rest pin the four ways the wait can
end (settled, different centre, abort, timeout) and that the abort listener is
removed so a session of thousands of builds cannot leak.

**Corrected 2026-08-19.** This section used to claim the tests pin "that a
re-load is waited for again rather than answered from the previous one". They
do not, and the gate does not behave that way: a re-load at the **same** centre
is answered from the previous settle, because nothing ever clears `settledKey`
and the gate is never told that a load has started.

Two behaviours, two tests, and **no new test was needed for the second** —
which the first version of this note got wrong as well. _"returns immediately
when that centre has already settled"_ already pinned the same-centre
pass-through; a test added alongside it turned out to be the same three lines
under a name it could not honour (there is no load-start API to exercise), and
review removed it. The surviving test's name and comment now carry the
limitation, and the module header explains why it is a design boundary rather
than a defect, plus what a caller must do about it: put the distinguishing fact
in `keyOf`, as `undulationM` already does.

`needsTerrainFor`'s own tests cover the regression the join can cause: a category
change and every widening ring must **not** wait, or the demo stalls on the full
timeout at every category switch.

No test needs a `Worker`: the gate is plain data and promises, which is the whole
reason the decision was extracted out of `demo-worker.ts` rather than written
inline there.
