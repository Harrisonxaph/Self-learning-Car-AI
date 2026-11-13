// Deterministic importer for the Silverstone circuit (P4-06 step 2a, docs/plans/p4-06-plan.md). It reads the COMMITTED, unmodified source file
// (src/data/tracks/sources/Silverstone.csv), checks it against the SHA-256 recorded beside it, converts it with the pure converter
// (src/tracks/convertRacetrack.ts), runs the P4-01 validator on the result (a conversion that does not validate is a failure) and writes
// src/data/tracks/silverstone.json. The committed track file is the converter's output byte for byte, and a test regenerates it.
//
//   node scripts/importSilverstone.mjs            write src/data/tracks/silverstone.json
//   node scripts/importSilverstone.mjs --check    write nothing; exit 1 if the committed file differs from the conversion
//
// It makes no network request and registers nothing: the track is not in the split manifest (step 2b), not selectable (step 3) and not used by any
// code yet. Licence: the source is the TUM racetrack-database (LGPL-3.0) whose centre lines come from OpenStreetMap (ODbL 1.0); see
// src/data/tracks/NOTICE.md.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// IMPORT_SILVERSTONE_DIR points the importer at another folder holding sources/ and the output (the tests use a scratch copy).
const TRACKS = process.env.IMPORT_SILVERSTONE_DIR ? resolve(process.env.IMPORT_SILVERSTONE_DIR) : join(ROOT, 'src/data/tracks');
const DIRECTION_NOTE =
  'Silverstone is raced clockwise. The engine credits one driving direction (counter-clockwise on the screen), so this is the circuit\'s true layout driven the opposite way round: the points are listed in reverse and the picture is not mirrored.';

export async function convert() {
  const meta = JSON.parse(readFileSync(join(TRACKS, 'sources/Silverstone.source.json'), 'utf8'));
  const csv = readFileSync(join(TRACKS, 'sources/Silverstone.csv'), 'utf8');
  const sha256 = createHash('sha256').update(csv, 'utf8').digest('hex');
  if (sha256 !== meta.sha256) throw new Error(`Silverstone.csv has SHA-256 ${sha256}, but ${join(TRACKS, 'sources/Silverstone.source.json')} records ${meta.sha256}; the source file must stay unmodified.`);
  const { module: converter } = await runnerImport(resolve(ROOT, 'src/tracks/convertRacetrack.ts'));
  const { module: validation } = await runnerImport(resolve(ROOT, 'src/sim/trackValidation.ts'));
  const conversion = converter.convertRacetrack(csv, {
    id: 'silverstone',
    version: `${meta.commit.slice(0, 7)}-${meta.sha256.slice(0, 12)}`,
    name: 'Silverstone',
    source: { name: meta.name, url: meta.url, commit: meta.commit, sha256: meta.sha256, licence: meta.licence, attribution: meta.attribution },
    directionNote: DIRECTION_NOTE,
  });
  const text = converter.serialiseRacetrack(conversion.document);
  const result = validation.validateTrack(JSON.parse(text));
  if (!result.ok) throw new Error(`Silverstone does not validate: ${result.errors.map((e) => e.message).join(' ')}`);
  return { text, conversion, warnings: result.warnings };
}

async function main() {
  const check = process.argv.includes('--check');
  const { text, conversion, warnings } = await convert();
  const file = join(TRACKS, 'silverstone.json');
  if (check) {
    let current = null;
    try {
      current = readFileSync(file, 'utf8');
    } catch {
      // missing counts as different
    }
    if (current !== text) {
      console.error('silverstone.json: the committed file differs from the conversion of the committed source.');
      return 1;
    }
    return 0;
  }
  writeFileSync(file, text);
  console.log(`silverstone: ${Math.round(conversion.lengthMetres)} m centre line, ${conversion.rows} rows, ${conversion.document.gates.length} gates; warnings: ${warnings.length}.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 2;
    },
  );
}
