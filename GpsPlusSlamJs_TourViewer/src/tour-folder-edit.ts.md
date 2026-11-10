# tour-folder-edit.ts

## Purpose

The plain-folder tree of a station's frame as the editor changes it: a
folder added, changed or taken out, a folder's title checked, and the
line a page shows for a refused folder edit. The tour document's folder
actions (`tour-document.ts`: `folderGrouped`, `folderUngrouped`,
`objectsFoldered`, `folderMoved`, `folderRenamed`, `folderDeleted`) go
through it.

A frame's folders hold no blocks (`tour-content.ts` `frameChildren`):
the items are the document's objects, each naming the folders it stands
in (`TourObject.folder`), so everything here works on the folder tree
alone.

## Public API

- `FolderRefusal` - why a folder edit is not possible where it was asked:
  - `storyIntoFolder` - a story stays at its station's top;
  - `folderIntoStory` - a story holds blocks only;
  - `folderIntoItself` - a folder into itself or a folder inside it;
  - `oneLevel` - the editor groups one level deep (no folder inside a
    folder, no group of items already in one);
  - `notHere` - items of several stations, or something that is no item.
- `FOLDER_NOT_POSSIBLE` ("Not possible here") and
  `folderRefusalLine(reason)` - that line and the reason, for a page.
- `folderTitle(title): string | null` - the trimmed title, or null for
  one the format refuses (blank, or over `TOUR_FOLDER_TITLE_RULE`'s 80
  code points).
- `withFolder(children, id, change)` - the tree with the folder `id`, at
  any depth, changed; the same array for an unknown id.
- `withFolderAdded(children, folder, into?)` - the tree with `folder` at
  the end of the folder `into`, or of the top; the same array for an
  unknown `into`.
- `withoutFolder(children, id, lift)` - the tree without the folder
  `id`. With `lift` its own folders take its place, each at its pose
  composed with the removed folder's (`composeTourFolderPose`), so they
  stay where they stood; a removed folder with no pose lifts them as
  they are. Without `lift` they go with it. The same array for an
  unknown id.

## Invariants & assumptions

- Pure: no input is changed, and an edit that changes nothing returns
  the very array it was given, which the reducers use to tell "no
  change".
- A folder's scale is never set (it stays 1).
- Folder ids are unique across the tour, so an id names one folder.

## Example

```ts
const lifted = withoutFolder(frame.children, "outer", true);
const named = folderTitle(input) ?? undefined; // null: refuse
```

## Tests

- `tour-folder-edit.test.ts` - lifting composes the poses (and keeps a
  pose-less folder's children as they are), dropping, changing and
  adding at depth, the title rule in code points, every refusal line.
- `tour-document-folder-actions.test.ts` - the actions built on it: one
  undo step each, world poses kept (swept over folder yaw and offset),
  refusals, the draft reload and the visitor's view.
