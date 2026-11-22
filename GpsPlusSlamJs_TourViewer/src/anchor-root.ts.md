# `anchor-root.ts`

## Purpose

Stands station-tied scene content as a root of a framework deferred anchor
(`gps-plus-slam-app-framework/ar/deferred-anchors`, see its sidecar): the
content goes into a pose-free wrapper group, and the anchor owns the
wrapper's whole local matrix. While the wrapper's key is in view an
alignment change waits; out of view (or at a code lock, a tracking frame
switch, a young alignment) the key lands on its NUE pose.

Callers:

- `scene-stage.ts`: a story figure's holder, in a wrapper of its
  station's key (`stationAnchorKey`, the key `station-content.ts` uses),
  so figure and station content share one matrix and commit in one pass.
- `walk-focus-cues.ts`: the beacon and the ring, in one wrapper of their
  focus station's key (`stationAnchorKey`), re-stood on a focus change.

## Public API

- `anchorRoot(parent, key, root, onCommit?): AnchoredRoot | null`
  - `parent`: the anchor parent (the AR world group with its alignment
    binding). `key`: the anchor key. `root`: an identity wrapper with its
    content already inside, so the anchor's first bounds include it.
    `onCommit`: runs in the pass that places the key (the framework's
    `add` option), so camera-relative work follows in that frame.
  - Returns null, after a `warn` log, when the framework refuses (no
    binding for `parent` yet, a root nested in another anchor, a set torn
    down); the wrapper is detached and the caller stands its content on
    the scene root instead.
- `AnchoredRoot`
  - `parent`, `root`: what it stands under, and the wrapper.
  - `boundsChanged()`: after a part was added, removed or swapped under the
    wrapper (moving or turning a part needs no call: the anchor reads
    matrices live).
  - `release()`: leaves the anchor (the key goes with its last root, so a
    re-entry is a first placement or joins the key's current matrix) and
    the parent. The content stays in the wrapper.

## Invariants

- The wrapper carries no pose of its own: every pose goes on its children.
  The children's NUE poses stay valid inside it, since a committed key's
  local matrix is T^-1 under a parent carrying T.
- No dispatch, no store: a scene-graph matter only.

## Example

```ts
const wrapper = new Group();
wrapper.add(holder); // holder.position = the station's NUE pose
const anchored = anchorRoot(worldGroup, stationAnchorKey(id), wrapper);
if (anchored === null) scene.add(holder);
// later
anchored?.release();
```

## Tests

- `station-anchor.integration.test.ts`: the figure and the beacon through
  `wireSceneMarks` under a real bound world group (shared key, union,
  figure alone, code lock, presence re-entry, beacon defer and commit,
  focus change, null cue).
- `scene-stage.test.ts`, `walk-focus-cues.test.ts`: the fallback to the
  scene root for a parent without an alignment binding.
