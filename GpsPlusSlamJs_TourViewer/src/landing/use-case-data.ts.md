# use-case-data.ts

## Purpose

The twenty examples of the landing page's use-case section: who makes a
tour like this, what a visitor sees there, and the picture of that moment
as a phone screen held sideways. Every maker and place is made up.

## Public API

- `interface UseCase { id, title, sentence, alt, scene, overlay(t) }`
  - `id` - kebab-case, used for `data-testid="use-case-<id>"`;
  - `sentence` - one sentence: the maker, and what the visitor sees;
  - `alt` - the picture for a screen reader, always saying what is seen
    "through the phone";
  - `scene` - the real place, drawn with `REAL` colours only (identical in
    both looks);
  - `overlay(t)` - what the tour adds, drawn in the look `t`.
- `USE_CASES` - in page order. The first four are required by name: the
  castle whose fallen tower stands again (the visitor's view only, nothing
  about how the tower was made), the birthday treasure hunt, the paintings
  in empty shop windows and the indoor exhibition (shown plainly). The
  first six show before "More ideas".

## Invariants & assumptions

- Honest claims: a visitor sees words, photos, drawings and a standing
  model at a spot; no entry promises sound, video or moving content.
- No proper nouns: a capital letter only where a text or a sentence part
  starts, and a deny list of the real names one reaches for first.
- A scene never carries `<text>`, filters or ids; overlays carry no ids.

## The curation

Sixteen distinct examples came from the earlier landing drafts; four new
ones were added: the names on the horizon (a hiking club's lookout), the
birds of the marsh (nature volunteers at the hides), where the water
reached (a flood line on the houses) and a ghost walk at dusk (a youth
club). Considered and left out: a welcome for holiday guests (the same
wayfinding picture as the school walk), a market walk (a stall's story is
weak as a picture and close to the farm), what an excavation found (close
to the castle and the railway).

## Tests

`use-case-data.test.ts`: the count (4 to 20), the four required first,
unique ids and titles, the shape of every text, the deny list and the
capital rule over every readable text including the pictures' own, the
castle and honest-claims rules, the indoor example, the muted scenes
(chroma at most 48), the route colours in every route-light overlay, no
ids, coordinates on the screen.
