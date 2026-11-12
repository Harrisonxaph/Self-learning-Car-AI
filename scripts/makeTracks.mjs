// Deterministic generator for the P4-04 circuits (docs/plans/p4-04-plan.md section 3). Each spec in
// src/data/tracks/specs/<id>.spec.json describes HALF a lap as a list of straights and arcs, from the bottom of the
// symmetry axis (heading east, the engine's counter-clockwise direction) to the top of it; the other half is its mirror
// image about the axis. One parameter is solved (by bisection) so the half ends exactly on the axis, which closes the lap.
// The generator samples the centre line (arcs every 15 degrees, straights in pieces of at most 10 m), offsets it by half the
// width (the outer boundary on the car's right), puts gates on boundary vertices about 25 m apart, puts the start 6 m
// behind gate 0 facing forward, rounds to 3 decimals, runs the P4-01 validator and writes the JSON.
//
// The committed JSON files are the source of truth (their hashes are pinned in the track-split manifest); this script makes
// the construction reproducible and reviewable, and a test regenerates the files and requires byte-identical output.
//
//   node scripts/makeTracks.mjs            write src/data/tracks/<id>.json for every spec
//   node scripts/makeTracks.mjs --check    write nothing; exit 1 if any committed file differs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = join(ROOT, 'src/data/tracks');
const SPECS = join(TRACKS, 'specs');
const ARC_STEP_DEGREES = 15;
const STRAIGHT_PIECE = 10;
const GATE_SPACING = 25;
const START_BEHIND = 6;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Walks a half lap and returns its vertices {x, y, heading} and its segments' end indexes. */
function walkHalf(segments) {
  let x = 0;
  let y = 0;
  let h = 0;
  const vertices = [{ x, y, h }];
  for (const s of segments) {
    if (s.type === 'straight') {
      const pieces = Math.max(1, Math.ceil(s.length / STRAIGHT_PIECE));
      for (let i = 1; i <= pieces; i += 1) {
        const d = s.length / pieces;
        x += Math.cos(h) * d;
        y += Math.sin(h) * d;
        vertices.push({ x, y, h });
      }
    } else {
      const total = (s.degrees * Math.PI) / 180;
      const pieces = Math.max(1, Math.ceil(s.degrees / ARC_STEP_DEGREES));
      const step = total / pieces;
      const left = s.turn === 'left';
      for (let i = 1; i <= pieces; i += 1) {
        const forward = s.radius * Math.sin(step);
        const side = s.radius * (1 - Math.cos(step));
        // left of the heading on a y-down screen is (sin h, -cos h); right is the opposite
        const sign = left ? 1 : -1;
        x += Math.cos(h) * forward + Math.sin(h) * side * sign;
        y += Math.sin(h) * forward - Math.cos(h) * side * sign;
        h += left ? -step : step;
        vertices.push({ x, y, h });
      }
    }
  }
  return vertices;
}

const withParameter = (spec, value) => {
  const segments = spec.half.map((s, i) => (i === spec.solve.segment ? { ...s, [spec.solve.field]: value } : s));
  return segments;
};

/** Bisection on the solved parameter so the half's end lies on the symmetry axis (x = 0). */
function solve(spec) {
  const f = (v) => walkHalf(withParameter(spec, v)).at(-1).x;
  let [lo, hi] = spec.solve.range;
  let flo = f(lo);
  const fhi = f(hi);
  if (flo === 0) return lo;
  if (!(flo * fhi < 0)) throw new Error(`${spec.id}: the solve range ${lo}..${hi} does not bracket closure (x = ${flo} and ${fhi}).`);
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

export function buildTrack(spec) {
  const value = solve(spec);
  const half = walkHalf(withParameter(spec, value));
  const n = half.length - 1;
  const centre = [...half.slice(0, n + 1)];
  // The second half is the mirror image about x = 0, traversed in reverse (turns keep their direction: mirroring and
  // reversing cancel), so its heading is the negative of the first half's.
  for (let i = n - 1; i >= 1; i -= 1) centre.push({ x: -half[i].x, y: half[i].y, h: -half[i].h });
  centre[n].x = 0; // the axis point, exactly
  const half_ = spec.width / 2;
  const outer = [];
  const inner = [];
  const arc = [0];
  for (let i = 0; i < centre.length; i += 1) {
    const c = centre[i];
    // The right of the heading on a y-down screen is (-sin h, cos h); the outer boundary is on the car's right.
    outer.push({ x: r3(c.x - Math.sin(c.h) * half_), y: r3(c.y + Math.cos(c.h) * half_) });
    inner.push({ x: r3(c.x + Math.sin(c.h) * half_), y: r3(c.y - Math.cos(c.h) * half_) });
    const next = centre[(i + 1) % centre.length];
    arc.push(arc[i] + Math.hypot(next.x - c.x, next.y - c.y));
  }
  const length = arc[centre.length];
  const gateCount = Math.max(3, Math.round(length / GATE_SPACING));
  const used = new Set();
  const gates = [];
  for (let k = 0; k < gateCount; k += 1) {
    const target = (k * length) / gateCount;
    let best = 0;
    for (let i = 0; i < centre.length; i += 1) if (Math.abs(arc[i] - target) < Math.abs(arc[best] - target)) best = i;
    if (used.has(best)) continue;
    used.add(best);
    gates.push({ a: inner[best], b: outer[best] });
  }
  // Gate 0 is the first vertex (the bottom of the axis); the start is START_BEHIND metres before it, on the centre line.
  const last = centre.at(-1);
  const first = centre[0];
  const back = Math.hypot(first.x - last.x, first.y - last.y);
  const t = Math.min(1, START_BEHIND / back);
  const start = {
    position: { x: r3(first.x + (last.x - first.x) * t), y: r3(first.y + (last.y - first.y) * t) },
    heading: r3(Math.atan2(first.y - last.y, first.x - last.x)),
  };
  return { document: { id: spec.id, version: spec.version, name: spec.name, outer, inner, start, gates }, length, solved: value };
}

const p = (v) => `{ "x": ${v.x}, "y": ${v.y} }`;
export function serialise(t) {
  const list = (items, f) => `[\n${items.map((i) => `    ${f(i)}`).join(',\n')}\n  ]`;
  return `{\n  "id": ${JSON.stringify(t.id)},\n  "version": ${JSON.stringify(t.version)},\n  "name": ${JSON.stringify(t.name)},\n  "outer": ${list(t.outer, p)},\n  "inner": ${list(t.inner, p)},\n  "start": { "position": ${p(t.start.position)}, "heading": ${t.start.heading} },\n  "gates": ${list(t.gates, (g) => `{ "a": ${p(g.a)}, "b": ${p(g.b)} }`)}\n}\n`;
}

export function loadSpecs() {
  return readdirSync(SPECS)
    .filter((f) => f.endsWith('.spec.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(SPECS, f), 'utf8')));
}

async function main() {
  const check = process.argv.includes('--check');
  const { module: validation } = await runnerImport(resolve(ROOT, 'src/sim/trackValidation.ts'));
  let differs = false;
  for (const spec of loadSpecs()) {
    const { document, length } = buildTrack(spec);
    const result = validation.validateTrack(JSON.parse(serialise(document)));
    if (!result.ok) throw new Error(`${spec.id} does not validate: ${result.errors.map((e) => e.message).join(' ')}`);
    const text = serialise(document);
    const file = join(TRACKS, `${spec.id}.json`);
    if (check) {
      let current = null;
      try {
        current = readFileSync(file, 'utf8');
      } catch {
        // missing counts as different
      }
      if (current !== text) {
        differs = true;
        console.error(`${spec.id}: the committed file differs from the generated one.`);
      }
    } else {
      writeFileSync(file, text);
      console.log(`${spec.id}: ${Math.round(length)} m lap, ${document.gates.length} gates, ${spec.width} m wide; warnings: ${result.warnings.length}.`);
    }
  }
  return differs ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }, (error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
