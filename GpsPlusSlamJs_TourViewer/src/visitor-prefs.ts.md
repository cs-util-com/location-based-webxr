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
  a long text's world views `reading` and `lectern`; `reading` is its
  floor. The screen set (`silent`, `captions`) joins with those views.
- `bodyHasPictures(body)` - whether a long text's body holds a picture
  block, at any depth (in a list, in a quote); an inline picture is not
  one.
- `viewNeedsFail(block, view)` - the reason `view` cannot show `block`
  whole, or null. A lectern shows no pictures ("shows no pictures").
- `preferredView(stored, kind, placement)` - the stored choice, or null
  for anything unreadable.
- `withPreferredView(stored, kind, placement, view | null)` - a NEW value
  with that choice set (null clears it); every other key is kept.
- `shownView({ audience, block, stored })` - the view shown:
  1. a creator sees their own choice;
  2. a view in no set is the creator's (the preference is kept, not
     applied);
  3. else the preferred member, if its needs hold;
  4. else the creator's view, if its needs hold;
  5. else the set's floor.
- `loadVisitorPrefs(storage)` - the parsed value, or null; never throws.
- `saveVisitorPrefs(storage, value)` - true when written; false when the
  storage is missing or throws (the choice then lasts the visit).

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

## Examples

```ts
const stored = withPreferredView(null, "longText", "world", "lectern");
shownView({ audience: "visitor", block, stored }); // "lectern" unless the body has pictures
saveVisitorPrefs(localStorage, stored); // false in a browser that refuses
```

## Tests

- `visitor-prefs.test.ts` - the sets, the needs, the defensive reads, the
  five rules, storage that throws or holds garbage.
- `visitor-prefs.property.test.ts` - the needs hold and the placement
  stays for any stored value; a read never rewrites it; a chosen member
  shows whenever its needs hold.
