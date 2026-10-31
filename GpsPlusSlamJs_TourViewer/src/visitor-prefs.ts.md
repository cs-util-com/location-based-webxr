# visitor-prefs.ts

## Purpose

The visitor's view preference (station blocks design §4), as pure
functions: which interchangeable set a block's view is in, whether a view
can show a block whole, the five rules that pick the view shown, and the
defensive read and write of the one storage key.

## Public API

- `VISITOR_PREFS_KEY` - `tour-viewer.visitor.prefs.v1`, one key per
  device.
- `viewSetOf(kind, view)` - the `ViewSet` (`kind`, `placement` world or
  screen, `members`, `floor`) a view belongs to, or null. Today one set:
  a long text's world views `reading`, `lectern` and `captions`;
  `reading` is its floor. `captions` is a visitor's view only (a creator
  places a reading sign or a lectern; the strip is how a visitor follows
  the same text by its voice), and its world part is the reading sign.
  `silent` is not a member yet.
- `bodyHasPictures(body)` - whether a long text's body holds a picture
  block, at any depth (in a list, in a quote); an inline picture is not
  one. Each body is parsed once: the answers are kept by body (up to 16,
  emptied whole when full), since the switch asks every camera frame and
  a 32 000-character body took about 2 ms to parse on desktop Node.
- `viewNeedsFail(block, view, verdict?)` - the reason `view` cannot show
  `block` whole, or null. A lectern shows no pictures ("shows no
  pictures"); captions need a read-along that holds ("needs a timing":
  no `narration.timing`, or a `stale` verdict). Captions do not fail on
  pictures: "Full text" opens the sheet, which shows them.
- `preferredView(stored, kind, placement)` - the stored choice, or null
  for anything unreadable.
- `withPreferredView(stored, kind, placement, view | null)` - a NEW value
  with that choice set (null clears it); every other key is kept.
- `shownView({ audience, block, stored, verdict? })` - the view shown
  (`verdict` is the text's read-along verdict, `narration-timing.ts`):
  1. a creator sees their own choice;
  2. a view in no set is the creator's (the preference is kept, not
     applied);
  3. else the preferred member, if its needs hold;
  4. else the creator's view, if its needs hold;
  5. else the set's floor.
- `shownMember({ creator, preferred, floor, fails })` - rules 3-5 within
  one set, `fails(view)` saying whether a member's needs fail; what
  `shownView` uses, and what pins rule 4 on a set of three.
- `loadVisitorPrefs(storage)` - the parsed value, or null; never throws.
- `saveVisitorPrefs(storage, value)` - true when written; false when the
  storage is missing or throws (the choice then lasts the visit).
- `storeVisitorChoice(storage, inStore, kind, placement, view | null)` -
  a choice merged into a FRESH read of the device (the page's start-up
  read would delete keys another tab wrote since), or into `inStore` when
  the device gives nothing, then saved: `{ value, kept }`, `value` for the
  page's store.

## Invariants & assumptions

- A preference never moves a block between the world and the screen: the
  view shown is always in the creator's view's set.
- The view shown always has its needs met (the floor's always are).
- Reading never rewrites the stored value; unknown keys (another app
  version's) survive a write.
- Every read is defensive: any JSON shape, a non-string view, a view not
  in the set, all read as "no choice".
- A consequence of rules 4 and 5: a creator's lectern over a body with
  pictures shows as a reading sign to a visitor even without a choice,
  since a lectern cannot show the pictures.
- Captions whose timing turns out stale fall back by rules 4 and 5, so to
  the creator's view (which may be a lectern), not always to reading as
  the prototype does; an unread or pending timing still counts as
  holding, so the strip's first frame does not flicker to another view.

## Examples

```ts
const stored = withPreferredView(null, "longText", "world", "lectern");
shownView({ audience: "visitor", block, stored }); // "lectern" unless the body has pictures
saveVisitorPrefs(localStorage, stored); // false in a browser that refuses
```

## Tests

- `visitor-prefs.test.ts` - the sets, the needs, the defensive reads, the
  five rules, storage that throws or holds garbage; rule 4 on a
  three-member set made for the test (the creator's view, not the floor);
  a choice merged into a fresh read keeps another tab's key, and builds on
  the store's value when the device cannot be read.
- `visitor-prefs.memo.test.ts` - each body parsed once, two bodies in
  turn included (the parser spied on).
- `visitor-prefs.property.test.ts` - the needs hold and the placement
  stays for any stored value; a read never rewrites it; a chosen member
  shows whenever its needs hold.
