// P4-06 step 2a: the Silverstone importer. The converter is checked by hand on a small loop, its refusals one by one, the full source file
// converts to the COMMITTED track byte for byte, the track passes the P4-01 validator, its gates and start are as the plan says, and a scripted
// gate-pursuit driver completes a lap through the real checkpoint engine (geometry only: not a trained or tuned model, and not a result). Nothing
// here registers Silverstone, evaluates a model or makes any claim about learning.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SENSOR_CONFIG } from '../../src/sensors/rays';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { validateTrack } from '../../src/sim/trackValidation';
import { resolveEpisodeRules } from '../../src/training/fitness';
import { startEpisodeState, stepEpisode, type EpisodeContext } from '../../src/training/episodeStep';
import type { Racer } from '../../src/sim/checkpoints';
import {
  convertRacetrack,
  MAX_BOUNDARY_POINTS,
  MAX_GATES,
  parseRacetrackCsv,
  RacetrackFormatError,
  serialiseRacetrack,
  type ConvertOptions,
} from '../../src/tracks/convertRacetrack';

const ROOT = join(__dirname, '../..');
const TRACKS = join(ROOT, 'src/data/tracks');
const csvText = readFileSync(join(TRACKS, 'sources/Silverstone.csv'), 'utf8');
const meta = JSON.parse(readFileSync(join(TRACKS, 'sources/Silverstone.source.json'), 'utf8')) as Record<string, string>;
const committed = readFileSync(join(TRACKS, 'silverstone.json'), 'utf8');
const source = { name: 'Test source', url: 'https://example.test/x.csv', commit: 'abc1234', sha256: '0'.repeat(64), licence: 'test licence', attribution: 'test attribution' };
const options = (extra: Partial<ConvertOptions> = {}): ConvertOptions => ({ id: 't', version: '1', name: 'T', source, ...extra });
const SILVERSTONE = (): ConvertOptions => ({
  id: 'silverstone',
  version: `${meta.commit!.slice(0, 7)}-${meta.sha256!.slice(0, 12)}`,
  name: 'Silverstone',
  source: { name: meta.name!, url: meta.url!, commit: meta.commit!, sha256: meta.sha256!, licence: meta.licence!, attribution: meta.attribution! },
  directionNote: JSON.parse(committed).source.directionNote,
});

// A 10 m square in the database's frame (y up), listed CLOCKWISE (as the real circuits are), eight rows, widths right 2 and left 2.
const LOOP = ['# x_m,y_m,w_tr_right_m,w_tr_left_m', '0,0,2,2', '0,10,2,2', '0,20,2,2', '10,20,2,2', '20,20,2,2', '20,10,2,2', '20,0,2,2', '10,0,2,2'].join('\n');

describe('the strict parser', () => {
  it('reads rows of four finite numbers after a "#" header, with or without a final newline and with CRLF', () => {
    const rows = parseRacetrackCsv(LOOP);
    expect(rows).toHaveLength(8);
    expect(rows[1]).toEqual({ x: 0, y: 10, right: 2, left: 2 });
    expect(parseRacetrackCsv(`${LOOP}\n`)).toEqual(rows);
    expect(parseRacetrackCsv(LOOP.replace(/\n/g, '\r\n'))).toEqual(rows);
  });
  it.each([
    ['an empty file', '', /empty/],
    ['only whitespace', '  \n ', /empty/],
    ['a missing header comment', '0,0,2,2\n1,0,2,2\n2,0,2,2', /Line 1 must be the "#" header/],
    ['a row with too few numbers', `${LOOP}\n1,2,3`, /Line 10 has 3 values/],
    ['a row with too many numbers', `${LOOP}\n1,2,3,4,5`, /Line 10 has 5 values/],
    ['a value that is not a number', `${LOOP}\n1,x,3,4`, /Line 10 holds a value that is not a finite number/],
    ['an infinite value', `${LOOP}\n1,Infinity,3,4`, /Line 10 holds a value that is not a finite number/],
    ['an empty value', `${LOOP}\n1,,3,4`, /Line 10 holds a value that is not a finite number/],
    ['a zero width', `${LOOP}\n1,2,0,4`, /Line 10 has a width that is not greater than 0/],
    ['a negative width', `${LOOP}\n1,2,3,-1`, /Line 10 has a width that is not greater than 0/],
    ['a blank line in the middle', ['# h', '0,0,1,1', '', '1,0,1,1', '2,0,1,1'].join('\n'), /Line 3 is empty/],
    ['fewer than three rows', '# h\n0,0,1,1\n1,0,1,1', /2 rows; a loop needs at least 3/],
  ])('refuses %s with a message naming the line', (_name, text, message) => {
    expect(() => parseRacetrackCsv(text)).toThrow(RacetrackFormatError);
    expect(() => parseRacetrackCsv(text)).toThrow(message);
  });
  it('refuses a file with more rows than a boundary may hold, and a non-string', () => {
    const rows = ['# h', ...Array.from({ length: MAX_BOUNDARY_POINTS + 1 }, (_, i) => `${i},0,1,1`)].join('\n');
    expect(() => parseRacetrackCsv(rows)).toThrow(/at most 2000 points/);
    expect(() => parseRacetrackCsv(42 as unknown as string)).toThrow(RacetrackFormatError);
  });
  it('refuses options that cannot give a track, and coinciding points', () => {
    expect(() => convertRacetrack(LOOP, options({ gateEveryRows: 0 }))).toThrow(/gateEveryRows/);
    expect(() => convertRacetrack(LOOP, options({ gateEveryRows: 2.5 }))).toThrow(/gateEveryRows/);
    expect(() => convertRacetrack(LOOP, options({ startBehindMetres: 0 }))).toThrow(/startBehindMetres/);
    expect(() => convertRacetrack(LOOP, options({ startBehindMetres: NaN }))).toThrow(/startBehindMetres/);
    expect(() => convertRacetrack(LOOP, options({ gateEveryRows: 8 }))).toThrow(/at least 3/); // 8 rows, a gate every 8: one gate
    const many = ['# h', ...Array.from({ length: 1500 }, (_, i) => `${Math.cos(i)},${Math.sin(i)},1,1`)].join('\n');
    expect(() => convertRacetrack(many, options({ gateEveryRows: 5 }))).toThrow(new RegExp(`the limit is ${MAX_GATES}`));
    const coincide = ['# h', '0,0,1,1', '5,0,1,1', '0,0,1,1', '5,5,1,1'].join('\n'); // rows 1 and 3 are the same point: row 2's tangent is zero
    expect(() => convertRacetrack(coincide, options({ gateEveryRows: 1 }))).toThrow(/coincide/);
  });
});

describe('the conversion of a small loop, by hand', () => {
  // Rows are listed clockwise in the database's y-up frame. After y is negated, row 0 stays first and the rest follow in REVERSE, so the cars go
  // right along y = 0 (the top of the picture), up the screen at x = 20, back left and down: counter-clockwise on the y-down screen, as the engine credits.
  const { document, lengthMetres, rows } = convertRacetrack(LOOP, options({ gateEveryRows: 2, startBehindMetres: 3, directionNote: 'note' }));

  it('lists the points in driving order starting from row 0, with the picture not mirrored', () => {
    expect(rows).toBe(8);
    // Row 0 is (0,0); the next in driving order is the original row 7 (10,0), then (20,0), (20,-10)...
    // Boundary at k = 0: the tangent is (next - previous) = (10,0) - (0,-10) = (10,10); its right normal on a y-down screen is (-10,10)/14.142.
    // outer = centre + normal x left width, inner = centre - normal x right width (both 2).
    expect(document.outer[0]).toEqual({ x: -1.414, y: 1.414 });
    expect(document.inner[0]).toEqual({ x: 1.414, y: -1.414 });
    // At k = 1 (centre (10,0)): tangent (20,0) - (0,0) = (20,0), right normal (0,20)/20 = (0,1): outer (10,2), inner (10,-2).
    expect(document.outer[1]).toEqual({ x: 10, y: 2 });
    expect(document.inner[1]).toEqual({ x: 10, y: -2 });
    expect(document.outer).toHaveLength(8);
    expect(document.inner).toHaveLength(8);
  });
  it('puts a gate on every second row, the inner end on the inner boundary and the outer end on the outer one', () => {
    expect(document.gates).toHaveLength(4);
    expect(document.gates[0]).toEqual({ a: document.inner[0], b: document.outer[0] });
    expect(document.gates[1]).toEqual({ a: document.inner[2], b: document.outer[2] });
    expect(document.gates[3]).toEqual({ a: document.inner[6], b: document.outer[6] });
  });
  it('puts the start 3 m behind gate 0 on the centre line, facing forward', () => {
    // Behind (0,0) in driving order is (0,-10) (the original row 1), so 3 m back is (0,-3), facing down the screen (+y): heading pi / 2.
    expect(document.start).toEqual({ position: { x: 0, y: -3 }, heading: 1.571 });
  });
  it('measures the closed centre line and records the source and the direction note', () => {
    expect(lengthMetres).toBeCloseTo(80, 9);
    expect(document.source).toEqual({ ...source, directionNote: 'note' });
    expect(Object.keys(document)).toEqual(['id', 'version', 'name', 'source', 'outer', 'inner', 'start', 'gates']);
  });
  it('is deterministic: the same text and options give the same bytes, and CRLF text gives the same track', () => {
    const again = convertRacetrack(LOOP, options({ gateEveryRows: 2, startBehindMetres: 3, directionNote: 'note' }));
    expect(serialiseRacetrack(again.document)).toBe(serialiseRacetrack(document));
    const crlf = convertRacetrack(LOOP.replace(/\n/g, '\r\n'), options({ gateEveryRows: 2, startBehindMetres: 3, directionNote: 'note' }));
    expect(serialiseRacetrack(crlf.document)).toBe(serialiseRacetrack(document));
  });
});

describe('the committed Silverstone track is the converter\'s output', () => {
  const conversion = convertRacetrack(csvText, SILVERSTONE());

  it('equals the conversion of the committed source file, byte for byte', () => {
    expect(serialiseRacetrack(conversion.document)).toBe(committed);
  });
  it('rests on the unmodified source: its SHA-256 and commit are recorded, in the source record and in the track file', () => {
    expect(createHash('sha256').update(csvText, 'utf8').digest('hex')).toBe(meta.sha256);
    expect(meta.sha256).toBe('27c51454e81780a75c353d3e6c9f73dbbcd1e82139782e95bd722ade19736e39');
    expect(meta.commit).toBe('e59595d1f3573b30d1ded6a08984935b957688e0');
    const file = JSON.parse(committed);
    expect(file.source.sha256).toBe(meta.sha256);
    expect(file.source.commit).toBe(meta.commit);
    expect(file.version).toBe('e59595d-27c51454e817'); // source commit (7 characters) and the first 12 hex characters of the source file's SHA-256
    expect(file.id).toBe('silverstone');
    expect(file.source.attribution).toContain('© OpenStreetMap contributors');
    expect(file.source.licence).toContain('LGPL-3.0');
    expect(file.source.licence).toContain('ODbL');
    expect(file.source.directionNote).toContain('opposite way round');
  });
  it('has the sizes the plan measured: 1,178 rows, 118 gates, a 5.89 km lap', () => {
    expect(conversion.rows).toBe(1178);
    expect(conversion.document.outer).toHaveLength(1178);
    expect(conversion.document.inner).toHaveLength(1178);
    expect(conversion.document.gates).toHaveLength(118);
    expect(conversion.lengthMetres).toBeGreaterThan(5880);
    expect(conversion.lengthMetres).toBeLessThan(5895);
  });
  it('has the NOTICE and the source copy in place', () => {
    const notice = readFileSync(join(TRACKS, 'NOTICE.md'), 'utf8');
    for (const text of ['TUM racetrack-database', 'LGPL-3.0', 'ODbL', '© OpenStreetMap contributors', meta.commit!, meta.sha256!, 'opposite way round']) expect(notice).toContain(text);
  });
});

describe('the committed Silverstone track passes the P4-01 validator', () => {
  const data = JSON.parse(committed);
  const result = validateTrack(data);
  const track = loadTrack(data);

  it('has no errors and no warnings', () => {
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });
  it('has its gates in driving order about 50 m apart, each spanning the road', () => {
    const centre = (i: number) => ({ x: (track.gates[i]!.a.x + track.gates[i]!.b.x) / 2, y: (track.gates[i]!.a.y + track.gates[i]!.b.y) / 2 });
    const gaps = track.gates.map((_, i) => {
      const a = centre(i);
      const b = centre((i + 1) % track.gates.length);
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    // Rows are 4.7 to 5.2 m apart and gates every 10th row, so consecutive gates are about 47 to 52 m apart along the road (a little less as a straight chord);
    // the last gap closes the loop over the remaining 8 rows (about 40 m). The validator already requires the order and that each gate spans the road.
    for (const gap of gaps.slice(0, -1)) {
      expect(gap).toBeGreaterThan(35);
      expect(gap).toBeLessThan(56);
    }
    expect(gaps[gaps.length - 1]).toBeGreaterThan(30);
    expect(gaps[gaps.length - 1]).toBeLessThan(56);
  });
  it('has its start behind gate 0 (about 10 m), on the road, facing forward', () => {
    const gate = track.gates[0]!;
    const mid = { x: (gate.a.x + gate.b.x) / 2, y: (gate.a.y + gate.b.y) / 2 };
    const back = Math.hypot(track.start.position.x - mid.x, track.start.position.y - mid.y);
    expect(back).toBeGreaterThan(9);
    expect(back).toBeLessThan(10.2);
    // The validator's start-heading rule (within 45 degrees of gate 0's forward direction, behind it) and start-on-road passed above; also check the direction directly.
    const forward = { x: gate.b.y - gate.a.y, y: -(gate.b.x - gate.a.x) };
    const along = Math.cos(track.start.heading) * forward.x + Math.sin(track.start.heading) * forward.y;
    expect(along).toBeGreaterThan(0.9 * Math.hypot(forward.x, forward.y));
  });
  it('is wider than the validator minimum everywhere and keeps the outer boundary on the right (counter-clockwise on the screen)', () => {
    let area = 0;
    for (let i = 0; i < track.outer.length; i += 1) {
      const a = track.outer[i]!;
      const b = track.outer[(i + 1) % track.outer.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    // On a y-down screen a counter-clockwise loop has a NEGATIVE signed area in this formula; the engine credits that direction.
    expect(area).toBeLessThan(0);
    const widths = track.gates.map((g) => Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y));
    expect(Math.min(...widths)).toBeGreaterThan(10);
    expect(Math.max(...widths)).toBeLessThan(19);
  });

  it('can be driven round once by a scripted pure-pursuit driver through the real checkpoint engine (geometry only: not a trained or tuned model)', () => {
    // The repo's gate-pursuit driver steers between gate midpoints 50 m apart and cuts Silverstone's first corner, so this test drives the road itself:
    // a conservative scripted follower of the midpoints of the boundary pairs (one per row, about 5 m apart), steering towards the midpoint two rows (about 10 m) ahead, slowing for curvature
    // read over the next 14 rows. It reads only the track's own geometry; nothing about it is trained, tuned on a model or evidence of learning.
    const dt = DEFAULT_SIM_CONFIG.timestepSeconds;
    const n = track.outer.length;
    const centre = track.outer.map((o, i) => ({ x: (o.x + track.inner[i]!.x) / 2, y: (o.y + track.inner[i]!.y) / 2 }));
    const context: EpisodeContext = {
      environment: { track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: dt },
      sensors: DEFAULT_SENSOR_CONFIG,
      rules: resolveEpisodeRules({ maxEpisodeSeconds: 900, stallSeconds: 20, maxLaps: 1 }, dt),
    };
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    let near = n - 2; // the start is just behind row 0
    const decide = (_inputs: readonly number[], racer: Racer) => {
      const v = racer.car.vehicle;
      let best = near;
      let bestDistance = Infinity;
      for (let k = -3; k <= 12; k += 1) {
        const index = (near + k + n) % n;
        const d = Math.hypot(centre[index]!.x - v.position.x, centre[index]!.y - v.position.y);
        if (d < bestDistance) {
          bestDistance = d;
          best = index;
        }
      }
      near = best;
      const target = centre[(near + 2) % n]!; // the midpoint two rows ahead
      const error = wrap(Math.atan2(target.y - v.position.y, target.x - v.position.x) - v.heading);
      const a = centre[(near + 2) % n]!;
      const b = centre[(near + 8) % n]!;
      const c = centre[(near + 14) % n]!;
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const bc = Math.hypot(c.x - b.x, c.y - b.y);
      const ac = Math.hypot(c.x - a.x, c.y - a.y);
      const twiceArea = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      const radius = twiceArea < 1e-9 ? Infinity : (ab * bc * ac) / (2 * twiceArea);
      const targetSpeed = Math.min(12, Math.sqrt(3 * radius));
      return { steering: Math.max(-1, Math.min(1, error * 2)), throttle: v.speed < targetSpeed ? 1 : 0, brake: v.speed > targetSpeed + 1 ? 1 : 0 };
    };
    let state = startEpisodeState(context);
    while (state.episode.outcome === null) state = stepEpisode(state, decide, context);
    expect(state.episode.outcome).toBe('completed');
    expect(state.racer.progress.lapTicks).toHaveLength(1);
    expect(state.episode.gatesPassed).toBeGreaterThanOrEqual(118);
  }, 240_000);
});

describe('the importer script', () => {
  const run = (dir: string, ...args: string[]) =>
    spawnSync(process.execPath, [join(ROOT, 'scripts/importSilverstone.mjs'), ...args], { env: { ...process.env, IMPORT_SILVERSTONE_DIR: dir }, encoding: 'utf8' });
  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), 'silverstone-'));
    cpSync(join(TRACKS, 'sources'), join(dir, 'sources'), { recursive: true });
    cpSync(join(TRACKS, 'silverstone.json'), join(dir, 'silverstone.json'));
    return dir;
  };
  it('--check passes on the committed files and writes nothing', () => {
    const dir = scratch();
    try {
      const result = run(dir, '--check');
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
  it('regenerates the committed file byte for byte, and --check fails when the track file is changed', () => {
    const dir = scratch();
    try {
      writeFileSync(join(dir, 'silverstone.json'), committed.replace('"Silverstone"', '"Silverstone X"'));
      const check = run(dir, '--check');
      expect(check.status).toBe(1);
      expect(check.stderr).toContain('differs');
      const write = run(dir);
      expect(write.status, write.stderr).toBe(0);
      expect(readFileSync(join(dir, 'silverstone.json'), 'utf8')).toBe(committed);
      expect(write.stdout).toContain('118 gates');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
  it('refuses a source file that is not the one whose SHA-256 is recorded', () => {
    const dir = scratch();
    try {
      writeFileSync(join(dir, 'sources/Silverstone.csv'), csvText.replace('3.439354', '3.439355'));
      const result = run(dir, '--check');
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('must stay unmodified');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('the converter is pure and Silverstone is not registered by this step', () => {
  it('reads no file, clock or randomness', () => {
    const text = readFileSync(join(ROOT, 'src/tracks/convertRacetrack.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/from 'node:|require\(|Date\.|Math\.random|performance\.|document\.|window\.|fetch\(/.test(text)).toBe(false);
  });
  it('is in no manifest, so nothing selects, trains or evaluates on it yet', () => {
    const manifest = readFileSync(join(TRACKS, 'index.json'), 'utf8');
    expect(manifest).not.toContain('silverstone');
  });
});
