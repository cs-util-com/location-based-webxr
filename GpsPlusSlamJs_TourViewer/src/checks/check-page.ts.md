# check-page.ts

**Purpose:** the registry and the start of the one check page
(`check.html`, described in `check.html.md`): `?view=<name>` picks one
prototype-parity view, and only that view's module is loaded.

## Public API

- `CHECK_VIEWS` - the views by name (`lectern`, `long-text`, `then-now`,
  `travelling-box`, `model-views`, `character-views`), each a page title
  and a `start(hosts)` that loads the view's module by a literal dynamic
  import and starts it.
- `CheckViewName` - the union of those names.
- `CheckHosts` - `{ root, cardHost }`: the full-page root every view draws
  in, and the visitor page's screen host (only `then-now` uses it).
- `checkViewOf(search)` - the name `view=` gives in a URL's `search`, or
  null for none, an empty one or one the registry does not own (a key
  only an object's prototype has, such as `toString`, is not a view).
- `startCheckPage(doc, search, hosts)` - with a known view: sets
  `body[data-view]` (the page's CSS keys each backdrop on it) and the
  title, starts the view and resolves to its name; rejects when the view's
  module fails to load or start, so the failure is a page error rather
  than a blank page. Without one: titles the page "Check pages", lists the
  views as `?view=` links in `root` and resolves to null.

## Invariants

- Every other query key belongs to the view: the registry reads `view`
  only, so a view's own keys must never be named `view` (the reading
  sheet's look is `look=captions` for that reason).
- The imports are literal, so Vite splits one chunk per view and the e2e
  plan's import scan (`tests/repo-config/tour-viewer-e2e-plan.test.js`)
  follows them from the page to each view's module.
- `startCheckPage` installs the framework's page-wide slider guard
  (`guardSlidersIn(doc)`) first, for the index and every view, as every
  page with a slider does: a vertical swipe that starts on a range input
  (the then-now view's Swipe line, say) scrolls the page instead of moving
  it.
- The modules are entries of nothing but this registry; knip reaches them
  through it (`knip.json` lists `src/checks/check-page.ts`).

## Example

```html
<script type="module">
  import { startCheckPage } from "./src/checks/check-page.ts";
  void startCheckPage(document, location.search, {
    root: document.getElementById("ar-root"),
    cardHost: document.getElementById("narration-card-root"),
  });
</script>
```

## Tests

- `src/checks/check-page.test.ts` - the names, the parse (with two
  property tests over arbitrary queries), the index, a failing start and
  the page-wide slider guard (for the index, before any view starts, and
  for the then-now view).
- Each view's own spec opens it through this page (listed in
  `check.html.md`).
