# tour-host.ts

## Purpose

Where the tour lives (polish round M2, the owner's A6/A7): the host a
creator picks in step 1 (Google Drive, Dropbox, OneDrive, GitHub, their own
server), that host's own upload-and-link steps, and the stored choice the
later steps read (the replace steps after Finish, whether the starter zip is
offered). Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
(§2a M2).

## Public API

- `TOUR_HOSTS` - `{ id, label }` in display order; `type TourHost` is the id.
- `isTourHost(value)` - a type guard for stored or external values.
- `hostOfLink(link)` - the cloud host a link points to (Drive, Dropbox,
  OneDrive, GitHub, by hostname - share pages and their raw forms), or
  null for any other link. Step 2 judges a missing file by it (M0c
  review): a stored tile outlives the tour it was picked for.
- `hostStepParts(host)` - the same steps as runs of text, the host's name
  in the step that sends the creator there as `{ text, href }` to the
  host's site (r820 feedback R2): drive.google.com, dropbox.com/home,
  onedrive.live.com, github.com; an own server has none. The words are
  exactly `hostSteps`' (tested).
- `hostSteps(host)` - the host's numbered steps, the last one pointing at the
  link step. The own server's names the two headers a browser needs
  (`Access-Control-Allow-Origin: *`, `Accept-Ranges: bytes`; the site's
  `/api` proxy fronts Google Drive only) and that its link can be pasted
  before the file exists.
- `hostReplaceText(host)` - step 6's sentence on putting the saved zip in
  place of the hosted one under the same link (Dropbox and OneDrive: same
  folder, same name, overwriting - Dropbox ends a shared link when the file
  is deleted first (its forum, 2026-10-11); GitHub: the same path; own
  server: the same place and
  name). Null for Google Drive, whose numbered steps come from the link
  itself (`driveReplaceSteps`, which knows the file's name).
- `hostReplaceOnComputer(host, fileName)` - the same on a computer, for
  the desktop editor's Done (tour editor plan 2026-10-17-1816, W2): names
  the saved file, and Drive included (the Drive website's upload with
  "Replace existing file"). Both read one sentence per host, so the
  phone's and the computer's words cannot drift apart. With a third
  argument, `hostedName` (the name of the file at the tour's link), that
  differs from the saved file's, it starts "Rename <saved> to <hosted>,
  the name of the file at your tour's link, and upload it under that name
  over that file": a host keeps the link only for a file of the same name.
  Null there means the link names no file (a Drive link by its id), and
  the words ask for that name without giving it.
- `needsStarterZip(host)` - every cloud host needs a file before it gives a
  link; an own server does not.
- `readTourHost(store)` / `writeTourHost(store, host | null)` - the choice (null clears it) under
  `tour-viewer.wizard.host`.

## Invariants & assumptions

- The copy is provisional and kept in this module on purpose: the owner's
  verdict on the design prototypes (M1) may restyle it, and one place to
  change it is the point.
- Defensive: a missing store, one that throws (site data blocked) or an
  unknown stored value reads as no choice; a throwing write is ignored (the
  choice then lasts the page).

## Tests

`tour-host.test.ts` - the host list and order, the steps of each, the own
server's headers, the replace text per host (one host each, none for
Drive), the computer's replace text (every host, Drive included, naming
the file; the phone's words pinned unchanged), the starter-zip rule, the stored round trip, unknown
values and throwing stores.
