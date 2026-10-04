# Globe assets

The globe's runtime imagery, served at `/globe-assets/` by the design
system's routes and copied whole into the look-dev deploy (`copyAll`).

- M0 (this commit): empty. The globe is drawn untextured, and nothing is
  fetched from here yet.
- M1 (globe plan 2026-09-26-0539 §7.4): the imagery pyramid and the global
  maps, fetched by a script that records each file's source and licence.
  Owner decision DEC-PRG-12: about 2 MB of NASA imagery is committed here.
