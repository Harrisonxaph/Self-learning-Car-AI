# Notice for `silverstone.json` and `sources/Silverstone.csv` (P4-06)

The Silverstone circuit data in this folder is derived from the **TUM racetrack-database**
(Technical University of Munich, Institute of Automotive Technology):

- Source file: `tracks/Silverstone.csv`
- Source URL: https://github.com/TUMFTM/racetrack-database/blob/e59595d1f3573b30d1ded6a08984935b957688e0/tracks/Silverstone.csv
- Source commit: `e59595d1f3573b30d1ded6a08984935b957688e0`
- SHA-256 of the file: `27c51454e81780a75c353d3e6c9f73dbbcd1e82139782e95bd722ade19736e39`
- Licence of the racetrack-database: **GNU Lesser General Public License v3.0** (LGPL-3.0)
- The centre lines in the database derive from **OpenStreetMap** data, which is available under the
  **Open Database Licence 1.0** (ODbL): **© OpenStreetMap contributors** (https://www.openstreetmap.org/copyright)

`sources/Silverstone.csv` is the database's file, **unmodified** (the same bytes; the SHA-256 above is checked by the importer
and by a test). `silverstone.json` is **converted** from it by `scripts/importSilverstone.mjs` (the pure converter is
`src/tracks/convertRacetrack.ts`): the centre line is offset by the database's left and right widths into the two boundaries,
gates are placed on every tenth point, a start is placed behind gate 0, and the points are listed in the reverse order (see
below). The track file carries this source information in its own `source` header.

**Direction.** Silverstone is raced clockwise. The simulation credits one driving direction (counter-clockwise on the screen),
so the converted track is the circuit's true layout **driven the opposite way round**; the picture is not mirrored.

This notice records what the roadmap requires (source, commit, licences and attribution). It is not legal advice, and the
owner's sign-off of the licences is recorded in `docs/ROADMAP.md` (changelog, 2026-11-12, and issue #57). Silverstone is a
simplified model of the real circuit: straight segments about 5 m long, no kerbs, run-offs or elevation.
