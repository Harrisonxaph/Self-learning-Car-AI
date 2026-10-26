// Which page to run, chosen from the page address: manual driving by default, or the population training view
// (P2-05) with `?mode=train`. Anything else keeps the default, so the normal page is unchanged.

export type PageMode = 'drive' | 'train';

/** 'train' if the query string's last `mode` parameter is exactly `train`; otherwise 'drive'. */
export function pageMode(search: string): PageMode {
  const modes = new URLSearchParams(search).getAll('mode');
  return modes[modes.length - 1]?.trim() === 'train' ? 'train' : 'drive';
}
