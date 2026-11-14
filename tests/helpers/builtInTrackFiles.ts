// Every built-in track file, keyed by the file name the split manifest (src/data/tracks/index.json) lists, for tests that
// load the real manifest through loadTrackSplits.
import hairpinChicane from '../../src/data/tracks/hairpin-chicane.json';
import hairpinRun from '../../src/data/tracks/hairpin-run.json';
import hookChicane from '../../src/data/tracks/hook-chicane.json';
import kidneyLoop from '../../src/data/tracks/kidney-loop.json';
import longSweepers from '../../src/data/tracks/long-sweepers.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import silverstone from '../../src/data/tracks/silverstone.json';
import sSweepers from '../../src/data/tracks/s-sweepers.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import sweepHook from '../../src/data/tracks/sweep-hook.json';
import technicalNarrow from '../../src/data/tracks/technical-narrow.json';

export const BUILT_IN_FILES: Readonly<Record<string, unknown>> = {
  'stadium-oval.json': stadiumOval,
  'rounded-rectangle.json': roundedRectangle,
  'hairpin-chicane.json': hairpinChicane,
  'kidney-loop.json': kidneyLoop,
  's-sweepers.json': sSweepers,
  'long-sweepers.json': longSweepers,
  'technical-narrow.json': technicalNarrow,
  'silverstone.json': silverstone,
  'hairpin-run.json': hairpinRun,
  'sweep-hook.json': sweepHook,
  'hook-chicane.json': hookChicane,
};
