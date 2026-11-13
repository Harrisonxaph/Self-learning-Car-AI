// Which page to run, chosen from the page address: manual driving by default, or the population training view
// (P2-05) with `?mode=train`, the track editor (P4-02) with `?mode=edit`, the evaluation of a saved champion (P4-05) with `?mode=evaluate`, a human vs AI race (P5-03) with `?mode=race`, or the in-page headless benchmark (P4-06 step 4 follow-up) with `?mode=bench`. Anything else keeps the default, so the normal page is unchanged.

export type PageMode = 'drive' | 'train' | 'edit' | 'evaluate' | 'race' | 'bench';

/** 'train', 'edit', 'evaluate', 'race' or 'bench' if the query string's last `mode` parameter is exactly that; otherwise 'drive'. */
export function pageMode(search: string): PageMode {
  const modes = new URLSearchParams(search).getAll('mode');
  const last = modes[modes.length - 1]?.trim();
  return last === 'train' || last === 'edit' || last === 'evaluate' || last === 'race' || last === 'bench' ? last : 'drive';
}
