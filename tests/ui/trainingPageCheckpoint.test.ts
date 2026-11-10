// Training checkpoints (P3-07) on the page's real wiring: `startTrainingPage` runs in Node with fake frames, a fake
// localStorage, a fake scheduler and fake nodes. The claims: checkpoints are saved at generation boundaries while training
// runs (not while paused); a hide saves the newest boundary once and an older queued save can never overwrite it; a stored
// checkpoint is only offered (autosave stays off until answered, nothing resumes by itself); Resume continues exactly as an
// uninterrupted run would; storage failures leave training running and Download still works; a file can be loaded.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { CHECKPOINT_KEY } from '../../src/persistence/checkpointStore';
import { MAX_CHECKPOINT_BYTES } from '../../src/persistence/checkpointFormat';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { checkpointFromTrainer, checkpointValidateOptions } from '../../src/ui/checkpointAdapter';
import { parseCheckpointText } from '../../src/persistence/checkpointStore';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { FakeFrames } from './fakeFrames';
import { FakeLocalStorage, fakePage } from './fakeTrainingPage';

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const FRAME_MS = DT * 1000;
const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DT };
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(options: { storage?: FakeLocalStorage; every?: number; minSeconds?: number; saved?: FakeLocalStorage; fps?: boolean } = {}) {
  const frames = new FakeFrames();
  const checkpointStorage = options.storage ?? new FakeLocalStorage();
  const made = fakePage(frames, {
    now: () => 0,
    storage: () => (options.saved ?? new FakeLocalStorage()) as never,
    checkpoint: { storage: () => checkpointStorage, ...(options.every === undefined ? {} : { everyGenerations: options.every }), ...(options.minSeconds === undefined ? {} : { minSeconds: options.minSeconds }) },
  });
  startTrainingPage(made.page);
  let lastMs = -FRAME_MS;
  const run = (count = 1) => {
    for (let i = 0; i < count; i += 1) frames.fire((lastMs += FRAME_MS));
  };
  const completed = () => Number(made.canvas.dataset.completedGenerations ?? 0);
  const completeGenerations = (count: number) => {
    made.controls.speeds.max.click();
    run();
    for (let i = 0; i < 100_000 && completed() < count; i += 1) run();
    expect(completed()).toBeGreaterThanOrEqual(count);
    made.controls.speeds.normal.click();
    run();
  };
  const cp = made.checkpoint!;
  const stored = () => checkpointStorage.data.get(CHECKPOINT_KEY);
  const storedGeneration = () => {
    const text = stored();
    if (text === undefined) return null;
    const parsed = parseCheckpointText(text, checkpointValidateOptions());
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    return parsed.checkpoint.generationIndex;
  };
  return { ...made, frames, run, completeGenerations, completed, cp, checkpointStorage, stored, storedGeneration };
}

/** A checkpoint document of the page's own configuration after `generations`, as the page would have stored it. */
function documentAfter(generations: number, keepLast = 20) {
  const trainer = createTrainer(DEFAULT_TRAINING_CONFIG, ENV);
  for (let g = 0; g < generations; g += 1) trainer.runGeneration();
  return checkpointFromTrainer(trainer, { id: 'cp-stored', createdAt: '2026-11-08T21:00:00.000Z', codeVersion: 'test' }, keepLast);
}
const seeded = (generations: number, keepLast?: number) => {
  const storage = new FakeLocalStorage();
  storage.setItem(CHECKPOINT_KEY, JSON.stringify(documentAfter(generations, keepLast)));
  return storage;
};

describe('saving while training runs', () => {
  it('starts with no checkpoint, says so, and shows no offer', () => {
    const p = setup();
    expect(p.cp.status.textContent).toContain('No checkpoint saved yet');
    expect(p.cp.offer.container.hidden).toBe(true);
    expect(p.canvas.dataset.checkpointOffer).toBeUndefined();
  });

  it('saves a valid checkpoint at a generation boundary every N generations, after the frame, and says so', () => {
    const p = setup({ every: 2 });
    p.completeGenerations(2);
    expect(p.stored()).toBeUndefined();
    p.runDeferred();
    expect(p.storedGeneration()).toBe(2);
    expect(p.cp.status.textContent).toMatch(/^Checkpoint saved after generation 2/);
    expect(p.canvas.dataset.checkpointSaved).toBe('2');
    p.completeGenerations(4);
    p.runDeferred();
    expect(p.storedGeneration()).toBeGreaterThanOrEqual(4);
  });

  it('does not save while paused', () => {
    const p = setup({ every: 1 });
    p.controls.pause.click();
    p.run(5);
    expect(p.completed()).toBe(0);
    p.controls.pause.click();
    p.completeGenerations(1);
    p.controls.pause.click();
    p.runDeferred(true);
    const before = p.storedGeneration();
    p.controls.pause.click();
    expect(p.storedGeneration()).toBe(before);
  });

  it('a hide saves the newest boundary once, and an older queued save released afterwards cannot overwrite it', () => {
    const p = setup({ every: 1 });
    p.completeGenerations(2);
    // A save for the latest boundary is queued, not yet written.
    expect(p.stored()).toBeUndefined();
    p.hide();
    const written = p.storedGeneration();
    expect(written).toBeGreaterThanOrEqual(2);
    const text = p.stored();
    // The queued callback was cancelled by the hide; even released anyway it must not change the slot.
    p.runDeferred(true);
    expect(p.stored()).toBe(text);
    // A second hide with nothing newer writes nothing.
    p.hide();
    expect(p.stored()).toBe(text);
  });
});

describe('a stored checkpoint is only offered', () => {
  it('offers Resume and Discard, turns automatic saving off, and does not resume by itself', () => {
    const storage = seeded(2);
    const p = setup({ storage, every: 1 });
    expect(p.cp.offer.container.hidden).toBe(false);
    expect(p.cp.offer.text.textContent).toContain('2 completed generations');
    expect(p.cp.offer.resume.disabled).toBe(false);
    expect(p.canvas.dataset.checkpointOffer).toBe('resumable');
    const original = storage.getItem(CHECKPOINT_KEY);
    // Training runs fresh; neither a periodic save nor a hide overwrites the unanswered checkpoint.
    p.completeGenerations(2);
    p.runDeferred(true);
    p.hide();
    expect(storage.getItem(CHECKPOINT_KEY)).toBe(original);
    expect(Number(p.canvas.dataset.checkpointResumed)).toBeNaN();
    expect(p.status.textContent).toContain('checkpoint found');
  });

  it('Resume continues exactly as an uninterrupted run would, restores the graph, and turns saving back on', () => {
    const storage = seeded(3);
    const p = setup({ storage, every: 1 });
    p.completeGenerations(1);
    p.cp.offer.resume.click();
    p.run();
    expect(p.cp.offer.container.hidden).toBe(true);
    expect(p.cp.status.textContent).toContain('Resumed from generation 3');
    expect(p.canvas.dataset.chartPoints).toBe('3');
    expect(p.canvas.dataset.checkpointResumed).toBe('3');
    p.completeGenerations(5);
    // Generation 5 (index 4) of the resumed run equals the uninterrupted run's.
    const whole = createTrainer(DEFAULT_TRAINING_CONFIG, ENV);
    const stats = Array.from({ length: 5 }, () => whole.runGeneration());
    expect(p.canvas.dataset.lastGeneration).toBe(String(p.completed()));
    const finished = stats[Number(p.canvas.dataset.lastGeneration) - 1]!;
    expect(p.canvas.dataset.lastBest).toBe(String(finished.bestFitness));
    expect(p.canvas.dataset.lastMean).toBe(String(finished.meanFitness));
    // Saving is back on: a hide now writes a checkpoint newer than the stored one.
    p.hide();
    expect(JSON.parse(storage.getItem(CHECKPOINT_KEY)!).generationIndex).toBeGreaterThan(3);
  });

  it('after a resume beyond the retention window, older generations are graph points only and cannot be replayed', () => {
    const storage = seeded(4, 1);
    const p = setup({ storage });
    p.cp.offer.resume.click();
    p.run();
    expect(p.canvas.dataset.chartPoints).toBe('4');
    p.replay.generation.value = '1';
    p.replay.start.click();
    expect(p.saved.status.textContent).toContain('was not kept in the checkpoint');
    expect(p.canvas.dataset.replay).not.toBe('running');
    // The newest generation's champion was kept and replays.
    p.replay.generation.value = '4';
    p.replay.start.click();
    p.run(2);
    expect(p.canvas.dataset.replaySource).toBe('generation');
  });

  it('Resume stops a champion replay that was running, and training carries on from the resumed run', () => {
    const storage = seeded(2);
    const p = setup({ storage });
    p.completeGenerations(1);
    p.replay.generation.value = '1';
    p.replay.start.click();
    p.run(2);
    expect(p.canvas.dataset.replay).toBe('running');
    p.cp.offer.resume.click();
    p.run();
    expect(p.canvas.dataset.replay).not.toBe('running');
    expect(p.replay.start.textContent).toBe('Replay');
    expect(p.replay.stop.disabled).toBe(true);
    expect(p.controls.speeds.normal.disabled).toBe(false);
  });

  it('Discard clears the slot, turns saving on, and says so', () => {
    const storage = seeded(2);
    const p = setup({ storage, every: 1 });
    p.cp.offer.discard.click();
    expect(storage.getItem(CHECKPOINT_KEY)).toBeNull();
    expect(p.cp.offer.container.hidden).toBe(true);
    expect(p.cp.status.textContent).toContain('Discarded the stored checkpoint');
    p.completeGenerations(1);
    p.hide();
    expect(storage.getItem(CHECKPOINT_KEY)).not.toBeNull();
  });

  it('a damaged stored checkpoint is reported with only Discard, and is never silently replaced', () => {
    const storage = new FakeLocalStorage();
    storage.setItem(CHECKPOINT_KEY, '{broken');
    const p = setup({ storage, every: 1 });
    expect(p.canvas.dataset.checkpointOffer).toBe('damaged');
    expect(p.cp.offer.resume.disabled).toBe(true);
    p.completeGenerations(2);
    p.hide();
    expect(storage.getItem(CHECKPOINT_KEY)).toBe('{broken');
    p.cp.offer.discard.click();
    expect(storage.getItem(CHECKPOINT_KEY)).toBeNull();
  });

  it('a checkpoint this build cannot resume (another simulation version) is offered for discarding only', () => {
    const doc = JSON.parse(JSON.stringify(documentAfter(1))) as Record<string, unknown>;
    doc.simulationVersion = 999;
    const storage = new FakeLocalStorage();
    storage.setItem(CHECKPOINT_KEY, JSON.stringify(doc));
    const p = setup({ storage });
    expect(p.canvas.dataset.checkpointOffer).toBe('unusable');
    expect(p.cp.offer.resume.disabled).toBe(true);
    expect(p.cp.offer.text.textContent).toContain('simulation version');
    p.cp.offer.resume.click();
    expect(p.canvas.dataset.checkpointResumed).toBeUndefined();
  });

  it('unavailable storage is a message and training carries on', () => {
    const frames = new FakeFrames();
    const made = fakePage(frames, { now: () => 0, checkpoint: { storage: () => { throw new Error('denied'); } } });
    startTrainingPage(made.page);
    expect(made.checkpoint!.status.textContent).toContain('unavailable');
    frames.fire(0);
    frames.fire(FRAME_MS);
    expect(made.canvas.dataset.completedGenerations).toBeDefined();
  });
});

describe('review findings (correction cycle 1)', () => {
  const file = (text: string) => ({ name: 'cp.json', size: text.length, text: () => Promise.resolve(text) });
  const choose = async (p: ReturnType<typeof setup>, ...files: ReturnType<typeof file>[]) => {
    p.cp.importInput.files = files;
    p.cp.importInput.fire('change');
    await flush();
  };

  it('a checkpoint file with an enormous parameter is refused before it can replace the run, and training keeps running', async () => {
    const doc = JSON.parse(JSON.stringify(documentAfter(1))) as { population: { values: number[][] } };
    doc.population.values[0]![0] = 1e308;
    const p = setup();
    p.run(3);
    await choose(p, file(JSON.stringify(doc)));
    expect(p.cp.status.textContent).toMatch(/^Nothing was loaded\./);
    expect(p.cp.offer.container.hidden).toBe(true);
    expect(() => p.completeGenerations(1)).not.toThrow();
    expect(p.completed()).toBeGreaterThanOrEqual(1);
  });

  it('after resuming a file, hiding the page before another generation completes still saves the chosen run', async () => {
    const p = setup();
    await choose(p, file(JSON.stringify(documentAfter(2))));
    p.cp.offer.resume.click();
    expect(p.stored()).toBeUndefined();
    p.hide();
    expect(p.storedGeneration()).toBe(2);
  });

  it('after resuming the stored checkpoint, a hide with nothing newer writes nothing', () => {
    const storage = seeded(2);
    const original = storage.getItem(CHECKPOINT_KEY);
    const p = setup({ storage });
    p.cp.offer.resume.click();
    p.hide();
    expect(storage.getItem(CHECKPOINT_KEY)).toBe(original);
  });

  it('an unreadable slot at startup blocks writes, then offers what is there once it can be read, and never replaces it unseen', () => {
    const storage = seeded(3);
    const original = storage.getItem(CHECKPOINT_KEY);
    let readable = false;
    const realGet = storage.getItem.bind(storage);
    storage.getItem = (key: string) => {
      if (!readable) throw new Error('denied');
      return realGet(key);
    };
    const p = setup({ storage, every: 1 });
    expect(p.cp.status.textContent).toContain('unavailable');
    p.completeGenerations(2);
    p.runDeferred(true);
    p.hide();
    expect(original).not.toBeNull();
    expect(storage.data.get(CHECKPOINT_KEY)).toBe(original);
    readable = true;
    p.completeGenerations(p.completed() + 1);
    expect(p.cp.offer.container.hidden).toBe(false);
    expect(p.cp.offer.text.textContent).toContain('A saved checkpoint was found');
    p.hide();
    expect(storage.data.get(CHECKPOINT_KEY)).toBe(original);
  });

  it('resuming a file after the slot could not be read keeps saving blocked, so the stored checkpoint found later is offered and never overwritten unseen', async () => {
    const storage = seeded(3);
    const original = storage.getItem(CHECKPOINT_KEY);
    let readable = false;
    const realGet = storage.getItem.bind(storage);
    storage.getItem = (key: string) => {
      if (!readable) throw new Error('denied');
      return realGet(key);
    };
    const p = setup({ storage, every: 1 });
    await choose(p, file(JSON.stringify(documentAfter(2))));
    p.cp.offer.resume.click();
    expect(p.cp.status.textContent).toContain('stays off because the stored checkpoint could not be read');
    p.completeGenerations(p.completed() + 2);
    p.runDeferred(true);
    p.hide();
    expect(storage.data.get(CHECKPOINT_KEY)).toBe(original);
    // The slot becomes readable: the stored checkpoint is offered at the next boundary, and is still not overwritten.
    readable = true;
    p.completeGenerations(p.completed() + 1);
    expect(p.cp.offer.container.hidden).toBe(false);
    expect(p.cp.offer.text.textContent).toContain('A saved checkpoint was found');
    p.runDeferred(true);
    p.hide();
    expect(storage.data.get(CHECKPOINT_KEY)).toBe(original);
    // Answering it (Discard) turns saving on, and a hide then preserves the run in progress.
    p.cp.offer.discard.click();
    p.hide();
    expect(p.storedGeneration()).toBeGreaterThan(2);
  });

  it('resuming a file while a readable stored checkpoint is unanswered brings that offer back and keeps saving blocked', async () => {
    const storage = seeded(3);
    const original = storage.getItem(CHECKPOINT_KEY);
    const p = setup({ storage, every: 1 });
    await choose(p, file(JSON.stringify(documentAfter(2))));
    p.cp.offer.resume.click();
    p.run();
    // The run is the file's, but the stored checkpoint is offered again and nothing replaces it.
    expect(p.canvas.dataset.checkpointResumed).toBe('2');
    expect(p.cp.offer.container.hidden).toBe(false);
    expect(p.cp.offer.text.textContent).toContain('A saved checkpoint was found');
    expect(p.cp.status.textContent).toContain('stays off until you answer the stored checkpoint');
    p.completeGenerations(p.completed() + 2);
    p.runDeferred(true);
    p.hide();
    expect(storage.getItem(CHECKPOINT_KEY)).toBe(original);
    // Discarding the stored one turns saving on.
    p.cp.offer.discard.click();
    p.hide();
    expect(storage.getItem(CHECKPOINT_KEY)).not.toBe(original);
    expect(p.storedGeneration()).toBeGreaterThanOrEqual(2);
  });

  it('resuming a file when the slot is empty still turns saving on', async () => {
    const storage = new FakeLocalStorage();
    const p = setup({ storage, every: 1 });
    await choose(p, file(JSON.stringify(documentAfter(2))));
    p.cp.offer.resume.click();
    p.hide();
    expect(p.storedGeneration()).toBe(2);
  });

  it('an unreadable slot that turns out to be empty turns saving on', () => {
    const storage = new FakeLocalStorage();
    let readable = false;
    const realGet = storage.getItem.bind(storage);
    storage.getItem = (key: string) => {
      if (!readable) throw new Error('denied');
      return realGet(key);
    };
    const p = setup({ storage, every: 1 });
    p.completeGenerations(1);
    p.hide();
    expect(storage.data.get(CHECKPOINT_KEY)).toBeUndefined();
    readable = true;
    p.completeGenerations(p.completed() + 1);
    p.hide();
    expect(storage.data.get(CHECKPOINT_KEY)).toBeDefined();
  });
});

describe('storage failures', () => {
  it('a full store: the save fails with a message, training continues, and the previous checkpoint is kept', () => {
    const storage = new FakeLocalStorage();
    const p = setup({ storage, every: 1 });
    p.completeGenerations(1);
    p.hide();
    const first = storage.getItem(CHECKPOINT_KEY);
    expect(first).not.toBeNull();
    const realSet = storage.setItem.bind(storage);
    storage.setItem = () => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    };
    p.completeGenerations(3);
    p.hide();
    expect(p.cp.status.textContent).toContain('storage is full');
    expect(p.canvas.dataset.checkpointFailed).toBeDefined();
    expect(storage.getItem(CHECKPOINT_KEY)).toBe(first);
    expect(p.completed()).toBeGreaterThanOrEqual(3);
    storage.setItem = realSet;
  });
});

describe('Download checkpoint', () => {
  it('downloads a valid checkpoint of the run so far, independent of storage', () => {
    const storage = new FakeLocalStorage();
    storage.setItem = () => {
      throw new Error('denied');
    };
    const p = setup({ storage });
    p.completeGenerations(1);
    p.cp.download.click();
    expect(p.cp.downloads).toHaveLength(1);
    expect(p.cp.downloads[0]!.filename).toMatch(/^sdae-checkpoint-gen\d+-[A-Za-z0-9]+\.json$/);
    const parsed = parseCheckpointText(p.cp.downloads[0]!.text, checkpointValidateOptions());
    expect(parsed.ok).toBe(true);
    expect(p.cp.status.textContent).toContain('Download started');
  });

  it('a browser that refuses the download gives a message', () => {
    const p = setup();
    p.cp.failDownload = true;
    p.cp.download.click();
    expect(p.cp.status.textContent).toContain('could not be started');
  });
});

describe('Load checkpoint file', () => {
  const file = (text: string, name = 'cp.json', size = text.length) => ({ name, size, text: () => Promise.resolve(text) });
  const choose = async (p: ReturnType<typeof setup>, ...files: ReturnType<typeof file>[]) => {
    p.cp.importInput.files = files;
    p.cp.importInput.fire('change');
    await flush();
  };

  it('a downloaded file is offered, resumes the run, and the chooser is reset', async () => {
    const p = setup();
    await choose(p, file(JSON.stringify(documentAfter(2))));
    expect(p.cp.offer.container.hidden).toBe(false);
    expect(p.cp.offer.text.textContent).toContain('A checkpoint file was loaded');
    expect(p.cp.importInput.value).toBe('');
    p.cp.offer.resume.click();
    p.run();
    expect(p.canvas.dataset.checkpointResumed).toBe('2');
    expect(p.canvas.dataset.chartPoints).toBe('2');
  });

  it('refuses a bad, oversized or multiple files with a message and changes nothing', async () => {
    const p = setup();
    await choose(p, file('hello'));
    expect(p.cp.status.textContent).toMatch(/^Nothing was loaded\./);
    expect(p.cp.offer.container.hidden).toBe(true);
    let read = 0;
    await choose(p, { name: 'big.json', size: MAX_CHECKPOINT_BYTES + 1, text: () => { read += 1; return Promise.resolve(''); } });
    expect(read).toBe(0);
    expect(p.cp.status.textContent).toContain('3 MiB');
    await choose(p, file('{}'), file('{}'));
    expect(p.cp.status.textContent).toBe('Nothing was loaded. Choose one file at a time.');
    await choose(p, file(JSON.stringify({ format: 'self-driving-ai-evolution/model' })));
    expect(p.cp.status.textContent).toContain('saved champion');
    expect(p.canvas.dataset.checkpointResumed).toBeUndefined();
  });

  it('discarding a loaded file brings back the stored checkpoint that was waiting, and leaves it untouched', async () => {
    const storage = seeded(2);
    const original = storage.getItem(CHECKPOINT_KEY);
    const p = setup({ storage, every: 1 });
    await choose(p, file(JSON.stringify(documentAfter(1))));
    expect(p.cp.offer.text.textContent).toContain('A checkpoint file was loaded');
    p.cp.offer.discard.click();
    expect(p.cp.offer.container.hidden).toBe(false);
    expect(p.cp.offer.text.textContent).toContain('A saved checkpoint was found');
    expect(storage.getItem(CHECKPOINT_KEY)).toBe(original);
    p.hide();
    expect(storage.getItem(CHECKPOINT_KEY)).toBe(original);
  });
});

describe('the default page is unchanged', () => {
  it('a page given no checkpoint feature has none of this and still trains', () => {
    const frames = new FakeFrames();
    const made = fakePage(frames, { now: () => 0 });
    startTrainingPage(made.page);
    expect(made.checkpoint).toBeUndefined();
    frames.fire(0);
    frames.fire(FRAME_MS);
    expect(made.canvas.dataset.checkpointOffer).toBeUndefined();
  });
});
