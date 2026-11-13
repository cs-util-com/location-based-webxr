# edit-kinds.ts

## Purpose

The editor's list of kinds: `KIND_EDIT`, one row per kind of the tour
format (`gps-plus-slam-app-framework/ar/tour-kinds` `TOUR_KINDS`), saying
everything the creator pages and the desktop editor know of a kind. A kind
the format gains is then one row here, and a missing row is a compile
error at this list, not a silent fallback somewhere in a page. Pure data
plus a few derived words; no DOM.

It lives in `src/kinds/`, not in `src/editor/`, because the creator pages
at the top of `src/` (the object list, the placement words) read it too, and top-level modules may not import the editor. For the same
reason a row's `look` is a plain word and not the editor kit's `ShellIcon`
type: modules outside the editor may not import the kit. The editor's own
modules that draw a look as an icon (`tree-add-menu.ts`,
`add-palette-model.ts`, `shell-inspector.ts`, `shell-tree.ts`) pass it
where a `ShellIcon` is expected, so a look that is no icon fails to compile
there.

## Public API

- `KIND_EDIT` - `{ [K in TourBlockKind]: KindEditRow }`, in the format's
  order; that order is the order of every derived menu. A row
  (`KindEditRow`):
  - `label` - the one word every creator page uses for the kind ("Pin",
    "Long text", "Photo", "Video", "Audio", "3D model", "Character"): what
    a block with no text of its own is called, the inspector's kind line,
    the lists' and the rail's second line. Why "Pin" and "Photo", not the
    format's words: see `object-describe.ts.md`.
  - `article` - `"a"` or `"an"` ("an audio").
  - `thing` - what a sentence calls one with no text of its own, lower
    case ("The reading stand left its station's circle").
  - `look` - the shell icon, the style class and the tree row's kind, one
    per kind.
  - `searchWords` - the words the tree's search finds the kind by besides
    its name (the 2D rail's search reads the pin's and the photo's).
  - `fields` - its fields in the inspector's order (`FieldSpec`:
    `name`, `label`, `prose`, `number?` - a number's bounds, unit and
    need, the bounds the format's (`tour-kinds.ts` `TOUR_AUDIO_*`) -
    and `views?` - the views that read it, none: every view), besides a
    short text's caption, which the head types (`editor/block-fields.ts`).
    Audio lists a narration circle's radius (`spot`) and a zone's reach,
    calm and volume (`zone`).
  - `add` - its line in the tree's add menu (`KindAdd`: `label`, `hint`,
    `words`, `addable`, and for a kind made from a file `file`: the
    asset kind its file must be, and `storyOnly`: why it is added to a
    story only - a video, which no free host draws); a row without one is
    not offered at all, and one with `addable: false` is listed, says why,
    and adds nothing. The character has no add line: the add menu's own
    Character entry (`editor/editor-shell/tree-add-menu.ts`) makes him in
    the character maker first.
- `KindLook`, `AddKind` (and the unexported `KindAdd`, a row's add line) - types derived from the rows: the
  looks and the kinds with `add.addable: true` (short and long text,
  picture, video, audio, model).
- `FileAddKind`, `TextAddKind` - the addable kinds made from a file
  (`add.file`: picture, video, audio, model) and the rest (short and long
  text, made from words alone: `editor/new-pin.ts`).
- `isFileAddKind(kind)` - type guard on `add.file`.
- `storyOnlyReason(kind)`, `isStoryOnly(kind)` - the `add.storyOnly`
  words, or undefined; the station's menu shows them on the kind, off,
  and the palette (which adds at stations) leaves the kind out.
- Whether a block stands in the world, turns and has size dots is not a
  kind's: it is its VIEW's, in `placement/placement-rows.ts` (a kind may
  stand in the world in one view and be a card in another), held to the
  editor's drawing by `placement/placement.contract.test.ts`.
- `kindNoun(kind)` - the label inside a sentence, its first letter
  lower-cased ("photo", "long text", "3D model").
- `kindWithArticle(kind)` - "a pin", "an audio".
- `ADD_CHOICES` - the add menu's lines, the rows with an `add` in the
  list's order, each with its `kind` and `look`.
- `isAddable(choice)` - type guard narrowing a choice to an `AddKind`.

## Who reads it

- Words: `object-describe.ts` `objectTitle`, `object-list.ts`,
  `creator-placement.ts`, `object-editing.ts`, `move-question.ts` (an item with no text of its own),
  `editor/editor-card.ts`, `editor/editor-model.ts`, `editor/edit-main.ts`
  (its add, delete and split toasts), `editor/editor-session.ts`
  (`objectName`), `editor/editor-shell/inspector-model.ts`,
  `editor/editor-shell/shell-inspector.ts` (the head icon and Delete).
- Looks and search: `editor/editor-shell/tree-model.ts` (`blockRow`, the
  filters).
- The object list's and the inspector's words (`object-list.ts`,
  `inspector-model.ts`).
- Fields: `editor/block-fields.ts`.
- Adding: `editor/editor-shell/tree-add-menu.ts`, `add-palette-model.ts`,
  `editor/new-pin.ts` (`KIND_ADD`, one row per `AddKind`, so an addable
  row without its start fails to compile), `editor-shell.ts`.

## Invariants & assumptions

- Keyed by `TourBlockKind` through `satisfies`: a kind the format gains
  and this list lacks fails `tsc` here. Proven by adding a scratch kind
  `"scratch"` to the framework's `TourBlockOfKind` and `TOUR_KINDS`,
  rebuilding the framework and running the Tour Viewer's `tsc` (line
  numbers of that run, before formatting):

  ```text
  src/kinds/edit-kinds.ts(156,12): error TS1360: Type '{ readonly shortText: ...;
    ... 5 more ...; readonly character: { ...; }; }' does not satisfy the expected
    type '{ ...; readonly character: KindEditRow; readonly scratch: KindEditRow; }'.
  src/item-card.ts(304,13): error TS1360: Type 'TourScratchBlock' does not satisfy
    the expected type 'never'.
  ```

  The first line is the list itself: the row it lacks. The second is the
  visitor's card, whose own exhaustive switch asks for the kind too. Every
  reader of the list then fails where it looks the new kind up (TS7053,
  "expression of type ... | \"scratch\" can't be used to index type"):
  `block-fields.ts` (67, 120), `inspector-model.ts` (265, 610, 680),
  `shell-inspector.ts` (1449), `tree-model.ts` (62, 102, 325),
  `object-describe.ts` (30) and the list's own derived types and helpers
  (`edit-kinds.ts` 161-205). No page compiled with the kind unnamed. The
  scratch row was removed afterwards.

- No `Record<string, ...>` and no `default:` stands between a kind and
  what it says: every table that maps kinds is a mapped type over
  `TourBlockKind` (or one of the derived kinds), and every switch over a
  kind is exhaustive.
- Each `look` is unique (the tree tells rows apart by it).
- What the editor can do with a kind is unchanged by this list: it only
  says it. Short and long text, picture, video, sound and 3D model are
  addable (the four files through `editor/add-file-item.ts`), a video in a
  story only; a character is listed off.

## The editor half of a row

- A kind's own part of the item inspector (what no field spec says: a
  long text's writer, a model's notes and sections) is its panel, in
  `editor/kind-panels/kind-panels.ts` `KIND_PANELS`, keyed by the same
  kind type. It cannot live here: the creator pages outside the editor
  read this list, and top-level modules may not reach editor DOM code.
- `new-pin.ts` `KIND_ADD` (what an added kind starts as, at a station
  and as a story entry) stays there, one row per `AddKind`, so an
  addable kind without one fails to compile. Folding it here would be a
  runtime import cycle: `edit-kinds.ts` -> `editor/new-pin.ts` ->
  `tour-document.ts` -> `tour-content.ts` -> `edit-kinds.ts`, and it
  would put an editor module and the tour document under every creator
  page that reads this list.

## Not folded, and why

- `view-switch.ts` `KIND_NOUN` and the visitor pages' kind words: the
  visitor side, not the editor's; their own list is the visitor's.
- `shown-blocks.ts` `isWorldBlock`: decides by a block's view, not its
  kind (a character's speaking view stands in the world, its card does
  not), the same question the placement rows answer per view.
- `object-describe.ts` `objectOwnText`: its switch names the kinds with a
  caption or a name and ends in `default: return object.title`. Not
  silent: a new kind without a `title` fails to compile there.
- `editor/editor-card.ts` and `editor-model.ts` work in the 2D rail's
  own kinds (`EditorItemKind`: code, pin, photo, station); they read the
  list for the pin's and the photo's words.
- `CHARACTER_VIEW_CHOICES` and the other view lists: views of one kind,
  not kinds.

## Examples

```ts
KIND_EDIT.longText.label; // "Long text"
kindWithArticle("audio"); // "an audio"
ADD_CHOICES.filter(isAddable).map((c) => c.kind);
// ["shortText", "longText", "picture", "video", "audio", "model"]
storyOnlyReason("video"); // "A video plays in a story: add it to one"
```

## Tests

`edit-kinds.test.ts`: a row for every kind of the format and no other, in
its order; every row's words non-empty; unique looks; every search word
finds its row in the tree, free and inside a story; the add menu lists
and enables (a station's menu without the story-only video, a story's
with it), and the palette offers, exactly the rows that say so; and the
editor's reach pinned (every kind with an add line listed, the character
through the menu's own entry, the four
file kinds). Seen red with a
row removed.

## Choice fields

A `FieldSpec` may carry `choices` (`FieldChoice`: value and label): a field chosen on chips by the kind's panel, never typed. The short text has `role` (`SHORT_TEXT_ROLES`) and, for a sign, `orientation` (`SHORT_TEXT_TURNS`), plus the number field `readAtM` (1-40 m, signs and ground arrows). A ground arrow also has `style` and `floorPlacement` (chips), `bendDeg` (a number, -60 to 60 degrees), `captionOnArrow` (`flag`: a switch, written as true or left out) and `color` / `darkColor` (`colour`: `#rrggbb`, picked in colour wells); `orientation` turns its plate.

## A block's name by its view

`SHORT_TEXT_VIEWS` names a short text's views (Pin, Sign, Edge hint, Ground arrow); `blockLabel(block)` is the kind's label, or for a short text its view's name. The inspector's head reads it, so a sign is headed "Sign in ...".
