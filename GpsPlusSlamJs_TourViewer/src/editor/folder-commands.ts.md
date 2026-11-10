# folder-commands.ts

## Purpose

The editor's plain-folder commands as the station tree gives them: Group
(the picked items in a new folder), Ungroup, an item moved into a folder
or out of its folders, and a folder renamed. Each is one undo step of the
tour document and none moves an item in the world.

## Public API

- `PlainFolderPlace` - `{ stationId, folder, itemIds }`: a plain folder,
  its station and the ids of the items it holds at any depth.
- `plainFolderOf(state, folderId)` - the folder's place, or null (no tour
  open, or no station holds it).
- `folderName(folder)` - its title, else "Folder".
- `nextFolderTitle(state, stationId)` - "Folder N", the first number no
  folder of the station is called by.
- `pickedGroupRefusal(state, picked)` - why the tree's picked rows (item
  ids and `folder:<id>`) cannot be grouped (`oneLevel` for a folder among
  them, else `groupRefusal`), or null.
- `NOTHING_TO_GROUP`, `FOLDER_NAME_TOO_LONG` (names the format's cap,
  80 characters), `FOLDER_DELETE_NOT_YET`, `FOLDER_DUPLICATE_NOT_YET`
  (Del and Ctrl+D on a plain folder, `editor3d-input.ts`) - the lines
  said where no folder rule refused.
- `createFolderCommands(deps)` -> `{ group, ungroup, moveInto, rename,
reorder }`:
  - `deps`: `getState` (the tour document), `dispatch`, `before` (called
    before each edit: the page ends a pending Undo offer), `changed`
    (after an edit the tour took: the page refreshes and autosaves), `say`
    (a passing line), `mint` (a new folder's id, default `newObjectId`);
  - `group(picked)` - the new folder's id, or null when refused (nothing
    picked says `NOTHING_TO_GROUP`);
  - `ungroup(folderId)` - the ids of the items it held, or null (a
    folder gone from the tour says `gone`);
  - `moveInto(itemId, folderId | null)` - whether the item moved (null:
    out of its folders); refused with the store's own reason
    (`folderDropRefusal`, then `objectsFolderRefusal`: `notHere`,
    `tooFar`); into the folder it is in already, quietly nothing;
  - `rename(folderId, title)` - whether the name changed;
  - `reorder(folderId, index)` - a folder at its station's top put at
    `index` among the station's top-level folders (the tree's drag of a
    folder row): whether it moved; its own place quietly nothing, a
    folder gone says `gone`.

## Invariants & assumptions

- The rules are the tour document's (`groupRefusal`, `folderDropRefusal`);
  the commands only check first so the refusal can be said in words
  (`folderRefusalLine`: "Not possible here: ...").
- Whether the tour took an action is told by identity: a refused folder
  action returns the same state object.
- Every outcome is said, so a change in a folded station is never silent:
  "Grouped N items into a folder - type its name", "Ungrouped - N items
  stay where they are", `"X" now in "F" - kept its place in the scene`,
  `"X" left the folder - kept its place in the scene`. A blank rename, a
  move out of an item in no folder, a move into the folder an item is in
  and a folder dropped on its own place are quiet no-ops. A folder's
  reorder is not said: it happens in the tree in view.

## Examples

```ts
const folders = createFolderCommands({
  getState: () => store.getState().tourDocument,
  dispatch: store.dispatch,
  before: endUndo,
  changed: () => {
    refresh();
    tourChanged();
  },
  say: toast,
});
const id = folders.group(["p", "q"]); // "Folder 2" when "Folder 1" exists
```

## Tests

`folder-commands.test.ts`: grouping as one step and its name, the
refusals (a foldered item, a folder, two stations, an unknown id), none
picked, ungroup counts and a gone folder, moves in and out, another
station's folder, the 10 km bound, a move into the folder an item is in,
rename and its cap, the reorder as one step.
