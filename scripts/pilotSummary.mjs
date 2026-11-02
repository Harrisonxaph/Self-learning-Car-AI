// P2-08 pilot decisions (docs/experiments/p2-08-pilot-protocol.md §3), applied to the committed pilot outputs with
// the step-3 library code (unchanged since the frozen revision). Usage: node scripts/pilotSummary.mjs . <pilot-dir>.
// Reads seed-s.json or seed-s.json.gz. Prints JSON; writes nothing.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { runnerImport } from 'vite';

const [root, dir] = process.argv.slice(2).map((p) => resolve(p));
const { module: analysis } = await runnerImport(join(root, 'src/training/analysis.ts'));
const { module: splits } = await runnerImport(join(root, 'src/training/trackSplits.ts'));
const CANDIDATES = [['C0', 'c0'], ['C1', 'c1'], ['C2', 'c2']];
const SEEDS = [9001, 9002, 9003];
const readRecord = (c, s) => {
  for (const name of [`seed-${s}.json`, `seed-${s}.json.gz`]) {
    try {
      const buf = readFileSync(join(dir, c, name));
      return JSON.parse((name.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`No record for ${c} seed ${s}`);
};

const candidates = CANDIDATES.map(([id, c]) => {
  const records = SEEDS.map((s) => readRecord(c, s));
  const validationId = JSON.parse(readFileSync(join(root, `experiments/manifests/p2-08-pilot-${c}.json`), 'utf8')).tracks.validation.id;
  const gatesPerLap = splits.validationTrack(validationId).gates.length;
  const a5ValidationGates = records.map((r) => r.agents.A5.validation.gatesPassed);
  const result = JSON.parse(readFileSync(join(dir, c, 'analysis.json'), 'utf8'));
  return { id, c, gatesPerLap, a5ValidationGates, result };
});

const chosenId = analysis.selectByValidation(candidates.map(({ id, a5ValidationGates, gatesPerLap }) => ({ id, a5ValidationGates, gatesPerLap })));
const chosen = candidates.find((x) => x.id === chosenId);
const d = chosen.result.primary.differences;
const mean = d.reduce((a, b) => a + b, 0) / d.length;
const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1));
const halfWidth = (1.96 * sd) / Math.sqrt(10);
const a5Training = chosen.result.agents.A5.training;
console.log(JSON.stringify({
  selection: {
    rule: 'selectByValidation: highest mean A5 validation progress, first listed (C0) on ties',
    inputs: candidates.map(({ id, a5ValidationGates, gatesPerLap }) => ({ id, a5ValidationGates, gatesPerLap, meanLaps: a5ValidationGates.reduce((a, b) => a + b, 0) / a5ValidationGates.length / gatesPerLap })),
    chosen: chosenId,
  },
  nRule: { chosen: chosenId, differencesLaps: d, sampleSd: sd, projectedHalfWidthAt10: halfWidth, delta: 0.25, confirmatoryN: halfWidth > 0.25 ? 20 : 10 },
  lapCheck: { chosen: chosenId, a5TrainingLapCompletion: a5Training.lapCompletion, a5TrainingFirstLapSeconds: a5Training.firstLapSeconds },
  analyses: candidates.map(({ id, result }) => ({ id, label: result.label, n: result.n, acceptanceEligible: result.acceptanceEligible, decision: result.decision.result, claim: result.decision.claim, primaryMean: result.primary.mean })),
}, null, 2));
