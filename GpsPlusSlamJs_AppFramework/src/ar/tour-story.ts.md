# tour-story.ts

**Purpose:** a station's CHILDREN in `tour.json` version 5 - what a visitor
meets at a station and what they are asked. A station holds ONE ordered
list of children: a free block (`tour-blocks.ts`, standing in the world)
or a FOLDER. Every container is a folder (`kind: 'folder'`); a folder
with `role: 'story'` is a STORY, which holds its own ordered list of
blocks, choices and quizzes; a folder without a role is a PLAIN FOLDER,
which groups free blocks and plain folders under an optional `pose` (a
frame, and an optional `scale` that makes the group larger). A block lives in one place, so being in a story is what
shows it.
The manifest reads every station's children here (`tour-stations.ts`).

## Public API

- `parseTourStationChildren(value, at, options): TourStationChildrenRead`
  - `{ children, ids }`: the children as read, and every child id the file
    names in the station, the ones a lenient read left out included, in file
    order. `options` are `TourChildrenReadOptions` (the block reader's
    options, `onDropped` taking a `TourChildDrop`). Throws through `fail`
    naming the first violation by its index in the file
    (`stations[0].children[2].children[1].options[0].goto`).
- Types: `TourStationChild` (`TourBlock | TourStory | TourFolder`),
  `TourStory` (`{ id, kind: 'folder', role: 'story', title, children }`),
  `TourFolder` (`{ id, kind: 'folder', title?, pose?, scale?, children }`, its
  children `TourFolderChild`: free blocks and plain folders),
  `TourContainer` (`TourStory | TourFolder`), `TourStoryChild`
  (`TourStoryBlock | TourChoice | TourQuizEntry`), `TourStoryBlock` (a
  block with `advance`), `TourChoice` (`{ id, kind: 'choice', prompt,
options }`), `TourQuizEntry` (`TourQuiz` with `id` and `kind: 'quiz'`),
  `TourChildDrop` (a `TourBlockDrop`, `{ kind: 'child', child, reason }`,
  `{ kind: 'option', child, option, reason }` for a way on a kept choice
  lost with the child it named, `{ kind: 'folderScale', folder, reason }`
  for a plain folder's scale out of its bounds read as 1, or `{ kind: 'folderTitle', folder,
reason }` for its title over its cap left out), `TourChildrenPlace` (`{ index, path,
story? }`: `path` the containers holding the child, outermost first,
  empty at the station's top; `story` the innermost one when it is a
  story),
  `TourChoiceOption` (`{ id, label, goto?, end? }`), `TourQuiz` (`{ question,
points, answer }`), `TourQuizAnswer`, `TourQuizOption`, `TourStepAdvance`
  (`{ mode: 'tap' }`, `{ mode: 'auto', afterS }` or `{ mode: 'lineEnd' }`).
- `TOUR_CHILD_KINDS` - `folder`, `choice`, `quiz`: disjoint from the block
  kinds, so `kind` alone tells a block from a container.
- `TOUR_FOLDER_ROLES` - `story`, the one role a folder may carry.
- `TOUR_STORY_TITLE_RULE` - required, 1-80 code points (`tourTextCount`).
- The three-way split, the one way to ask: `isStory`, `isTourFolder`
  (a plain folder) and `isTourBlockChild`; every station child is exactly
  one of them. Also `isTourStoryBlock`.
- Over a children list: `tourChildrenStories` (the top level only: a
  story never stands in a folder), `tourStoryChildrenBlocks`,
  `tourChildrenBlocks` (every block once, in document order, inside
  stories and plain folders at any depth), `tourChildrenPlace(children,
id)` (null when no child has it).
- Over a station (anything with `children`, `TourStationHolder`):
  `tourStories`, `tourStoryBlocks(story)`, `tourStationStoryBlocks`,
  `tourStationBlocks` (every block, free and in a story),
  `tourStationChildIds` (every id: stories, folders, what they hold, free
  blocks),
  `tourChildPlace(stations, id)` (`TourChildPlace`: the station and where
  in it). The free blocks are `tourFreeBlocks` (`tour-station-pose.ts`),
  which flattens plain folders.
- `checkTourChildIdsUnique(stations, fail)` - child ids are unique across
  the tour: one read per station, checked on its `ids`, so an id a lenient
  read left out still counts.

## The rules

- The order of the file is kept: stories and free blocks in any order
  (nothing assumes free blocks first).
- Nesting: a story stands only at a station's top level; plain folders
  nest in each other at any depth and hold free blocks (in a world view,
  as at the top) and plain folders; nothing but blocks, choices and
  quizzes stands in a story. A story takes no `pose` or `scale`. A plain
  folder may be empty and may carry a `title` (`TOUR_FOLDER_TITLE_RULE`,
  the story title's rule: an editor's tree names a group by it): one that
  is no text or blank fails at every minor, one over its cap fails strict
  and is left out lenient, reported as a `folderTitle` drop. Its `pose` is read as a block's
  (`parseTourLocalPose`). Its `scale` is absent (1) or a number from
  `TOUR_FOLDER_MIN_SCALE` (0.1) to `TOUR_FOLDER_MAX_SCALE` (10), both
  exported: it makes the whole group larger, its children's offsets
  (`tour-folder-pose.ts`) and how large a renderer draws them alike. Any
  other value fails strict; lenient reads the folder without it,
  reported as a `folderScale` drop.
- A child's offset with its folders' poses composed in
  (`composeTourFolderPath`) stays within `TOUR_ITEM_MAX_OFFSET_M` along
  each axis, as a single pose's must: a folder far out holding a block far
  out would otherwise read, and then fail every save once the editor
  flattens it. The innermost folder holding such a block fails strict and
  is left out, reported as a `child` drop, under lenient.
- A free block must stand in a world view; its `advance`, like a choice's
  or a quiz's, is ignored. A story block takes any view of its kind (an
  unknown one reads as `card`) and an `advance`.
- `advance`: `{ mode: 'tap' }` (also when absent, and written out on a
  read so a renderer never guesses), `{ mode: 'auto', afterS > 0 }` or
  `{ mode: 'lineEnd' }` (when the character's line ends: its voice, else a
  reading time).
- `choice`: a non-empty prompt and at least two options with unique ids;
  an option's `goto` names a child of the same story (a skipped one
  included), or is absent: the story continues at the next child. An
  option with `end: true` ends the story instead; it never carries a
  `goto`. Anything else fails, named by the choice's index in the file.
- `quiz`: `question`, `points` (an integer >= 0) and `answer`. There is no
  `route`: answers do not branch the walk. A `route` field is an unknown
  field and ignored.
  - Answers: `single { options, correct }`, `multiple { options,
correct[] }` (at least 2 options, unique ids, correct among them),
    `text`/`code { salt, sha256[] }` (salted SHA-256 hex of the accepted
    answers after normalisation - a deterrent only), `number { value,
tolerance >= 0, unit? }`.
- Blocks, stories, choices and quizzes share one id namespace per station
  (a skipped child's id counted) and across the tour; option ids are
  unique per choice.
- A story's title is required: absent, not a string or blank fails at
  every minor; over 80 fails strict, and a lenient read leaves the story
  out, reported (its children are read first, so their structural faults
  still fail).
- A station-level choice or quiz, a story inside a story or a plain
  folder, a plain folder inside a story, a folder of an unknown role, or
  any unknown kind fails strict and is left out, reported, under lenient;
  so is a quiz of an unknown answer type. A story's `pose` or `scale`
  fails strict and is ignored, as an unknown field, under lenient. (A story inside a story is not read, so its
  own children's ids are not counted.) Options naming a left-out child are
  pruned, each reported,
  and a choice left with fewer than two goes, reported, repeatedly.
- Structural faults fail even a lenient read: an id, a duplicate, a
  `goto` naming nothing, an option's `end` other than `true` or beside a
  `goto`, a story without a title or `children`, a missing list.

## Invariants & assumptions

- After a read, every `goto` names a child of its own story, every choice
  has at least two options, and every free block is in a world view.
- **The in-memory child is the file's child.** Nothing maps one on the way
  in or out, so the manifest's writer writes what it read.
- **LENIENT for a NEWER MINOR:** see the rules above; an unknown advance
  mode is a tap. Strict at this reader's own minor: every one of these
  fails.

## Examples

```ts
const { children } = parseTourStationChildren(station, 'stations[0]', {
  assets,
  fail,
});
const stories = tourChildrenStories(children);
const free = tourFreeBlocks({ children }); // tour-station-pose.ts
```

## Tests

- `tour-story.test.ts`: order kept with stories first or last; free and
  story blocks' views; advance defaults and ignoring; gotos back, forward
  and refused (another story, a free block, the story, nothing); every
  duplicate pairing, within and across stations; the 80-code-point title on
  both sides (80 with a combining mark and a surrogate pair reads, 81
  fails); unknown kinds at both levels; lenient pruning, stranded choices
  and reports; structural faults under lenient; the list functions.
- `tour-folders.test.ts`: a read per shape (story, plain folder with and
  without pose and scale, empty, nested), a folder's title (read, refused
  blank or not text, over its cap refused strict and dropped lenient), scales within the bounds read
  and those out of them refused strict and read as 1 lenient (reported), the composed-offset bound swept
  at its edge (in, on and just past it), turned by a folder's rotation,
  nested, and dropped lenient, every illegal nesting refused strict and left out lenient,
  ids shared across folders, the exclusive three-way split, the walkers,
  places with paths, and the writer writing a story in the folder shape.
- `tour-folders.property.test.ts`: generated stations with nested plain
  folders (up to 1, 3 and 8) read exactly and round-trip, and every walker
  returns exactly the ids the generator recorded placing: those that
  descend into folders, and those that must not (stories, story blocks).
- `tour-story.property.test.ts`: generated children lists (three sizes)
  read exactly and round-trip; every block listed once in document order
  and every child found where it is; a shared id refused strict and
  lenient; the cross-station check throws exactly when two lists share an
  id; newer-minor values injected anywhere never fail a lenient read and
  leave every goto resolving, every choice with two ways on, every free
  block in the world, every title within the cap and every left-out child
  reported, while a strict read fails; chained stranded choices of depth
  1-6 all go; an over-cap text fails a required field and is dropped,
  reported, from an optional one.
- `tour-stations.test.ts` - every quiz answer type and the advance rule,
  through a whole station.
